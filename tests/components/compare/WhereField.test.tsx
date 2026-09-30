// Поле «Где» со своим геокодером: улицы — мгновенно из мини-индекса (загружается при фокусе),
// дома — с сервера, выбор подсказки сразу даёт координаты (без второго запроса), «≈» у адреса
// не до дома. Сеть подменена: мини-индекс и подсказки считает тот же движок по фикстуре.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhereField } from "@/components/compare/WhereField";
import { CITY_GEO } from "@/lib/compare/geo-data";
import type { UserLocation } from "@/lib/compare/geo";
import { buildClientIndex, createGeocoder } from "@/lib/geocoder";
import { FIXTURE } from "../../geocoder/fixture";

const engine = createGeocoder({ ...FIXTURE, houses: [...FIXTURE.houses] });
const clientIndex = JSON.stringify(buildClientIndex(FIXTURE));
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "http://localhost");
    calls.push(url.pathname);
    if (url.pathname === "/api/geo/client-index") return new Response(clientIndex, { status: 200 });
    if (url.pathname === "/api/geo/suggest") {
      return Response.json({ items: engine.suggest(url.searchParams.get("q") ?? "", { limit: 7 }) });
    }
    if (url.pathname === "/api/geo/reverse") {
      return Response.json({ hit: engine.reverse(Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon"))) });
    }
    return new Response("{}", { status: 404 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const onChange = vi.fn<(loc: UserLocation) => void>();
  render(
    <WhereField
      id="w" citySlug="krasnodar" cityName="Краснодар" geo={CITY_GEO[0]} value={{ kind: "city" }}
      onChange={onChange} addressIndex="t1" list="inline"
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  return { input, onChange };
}

describe("<WhereField> with the own geocoder", () => {
  // Первый тест файла: мини-индекс грузится один раз на вкладку (кэш модуля).
  it("streets come from the mini index without a server request", async () => {
    const { input } = setup();
    await waitFor(() => expect(calls).toContain("/api/geo/client-index"));
    // мини-индекс собирается асинхронно — ждём, пока улица появится
    await waitFor(() => {
      fireEvent.change(input, { target: { value: "чукотск" } });
      expect(screen.getByText("улица Чукотская")).toBeInTheDocument();
    });
    expect(calls).not.toContain("/api/geo/suggest");
  });

  it("a house from the server carries coordinates: one click, no second request", async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "чукотская 23к2" } });
    const option = await screen.findByText("улица Чукотская, 23к2");
    fireEvent.click(option);
    const loc = onChange.mock.calls.at(-1)![0];
    expect(loc).toMatchObject({ kind: "point", label: "улица Чукотская, 23к2", source: "address" });
    expect(loc.kind === "point" && loc.precision).toBeFalsy();
    expect(calls).not.toContain("/api/geo/resolve");
  });

  it("an address found only to the street is marked «≈» in the list and after the choice", async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "ставропольская 106" } });
    const option = await screen.findByText("улица Ставропольская, ≈106");
    expect(option.closest("li")!.textContent).toContain("≈ до улицы");
    fireEvent.click(option);
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ kind: "point", precision: "street" });
    expect(screen.getByRole("status").textContent).toMatch(/от улицы, ≈/);
  });

  it("microdistricts stay from the site list and are not repeated by the geocoder", async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "юбилейн" } });
    await waitFor(() => expect(screen.getAllByText("Юбилейный")).toHaveLength(1));
  });

  it("Enter on typed text takes the first address", async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "базовская 21к1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ kind: "point", label: "улица Базовская, 21к1, Яблоновский" });
  });

  it("geolocation: the point gets an address label from the reverse geocoder", async () => {
    const h = FIXTURE.houses.find((x) => x.number === "120")!;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: h.lat, longitude: h.lon } } as GeolocationPosition) },
    });
    const { onChange } = setup();
    fireEvent.click(await screen.findByText("Определить моё местоположение"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({
      kind: "point", source: "geo", label: "улица Красная, 120", point: { lat: h.lat, lon: h.lon },
    });
  });
});

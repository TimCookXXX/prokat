import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Компонент клиентский и зовёт server action — тот тянет next-auth и next/server,
// которых в jsdom нет.
const setListingStatus = vi.fn(async () => ({ ok: true as const, data: undefined }));
vi.mock("@/server/actions/owner", () => ({ setListingStatus }));

const { ListingCardActions } = await import("@/components/cabinet/ListingCardActions");

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const TITLE = "Перфоратор Bosch";

beforeEach(() => setListingStatus.mockClear());

describe("ListingCardActions", () => {
  it("у активного — правка, скрытие и удаление", () => {
    render(<ListingCardActions listingId={ID} status="active" title={TITLE} />);
    // Именно на вкладку правки: сам адрес вещи теперь показывает её занятость,
    // заявки и переписки, а форма — одна из вкладок внутри.
    expect(screen.getByRole("link", { name: `Править: ${TITLE}` }))
      .toHaveAttribute("href", `/cabinet/listings/${ID}?tab=edit`);
    expect(screen.getByRole("button", { name: `Скрыть: ${TITLE}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Удалить: ${TITLE}` })).toBeInTheDocument();
  });

  it("у скрытого вместо «Скрыть» — «Показать»", () => {
    render(<ListingCardActions listingId={ID} status="hidden" title={TITLE} />);
    expect(screen.getByRole("button", { name: `Показать: ${TITLE}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Скрыть: ${TITLE}` })).toBeNull();
  });

  // Из архива возвращают в «Скрыто», а не сразу в каталог: премодерации нет, и
  // объявление, которое человек считал удалённым, иначе мгновенно вернулось бы
  // к покупателям со старой ценой.
  it("в архиве одна кнопка, и она возвращает в скрытые", () => {
    render(<ListingCardActions listingId={ID} status="archived" title={TITLE} />);
    expect(screen.queryByRole("button", { name: `Удалить: ${TITLE}` })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `Вернуть из архива: ${TITLE}` }));
    expect(setListingStatus).toHaveBeenCalledWith(ID, "hidden");
  });

  it("скрытие меняет статус сразу, без подтверждения", () => {
    render(<ListingCardActions listingId={ID} status="active" title={TITLE} />);
    fireEvent.click(screen.getByRole("button", { name: `Скрыть: ${TITLE}` }));
    expect(setListingStatus).toHaveBeenCalledWith(ID, "hidden");
  });

  // Удаление уносит объявление из списка одним кликом, поэтому идёт через окно
  // подтверждения, а не через window.confirm.
  it("удаление сначала спрашивает и до ответа ничего не делает", async () => {
    render(<ListingCardActions listingId={ID} status="active" title={TITLE} />);
    fireEvent.click(screen.getByRole("button", { name: `Удалить: ${TITLE}` }));

    expect(await screen.findByText("Убрать объявление?")).toBeInTheDocument();
    expect(setListingStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));
    await waitFor(() => expect(setListingStatus).toHaveBeenCalledWith(ID, "archived"));
  });

  // На карточке нет ни строчки текста, поэтому молчаливый отказ выглядел бы
  // как «ничего не произошло». Окно остаётся открытым и называет причину.
  it("отказ сервера оставляет окно открытым и показывает причину", async () => {
    setListingStatus.mockResolvedValueOnce({ ok: false, error: "not_found" } as never);
    render(<ListingCardActions listingId={ID} status="active" title={TITLE} />);

    fireEvent.click(screen.getByRole("button", { name: `Удалить: ${TITLE}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Убрать" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Не удалось убрать/);
    expect(screen.getByText("Убрать объявление?")).toBeInTheDocument();
  });
});

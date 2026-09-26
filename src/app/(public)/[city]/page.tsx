// /{city} — главная сравнения для города.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { seo } from "@theme/seo";
import { getCityBySlug } from "@/server/catalog";
import { siteConfig } from "@/lib/site-config";
import { CityHome } from "@/components/compare/CityHome";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ city: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: citySlug } = await params;
  const city = await getCityBySlug(citySlug);
  if (!city) return {};
  const cityIn = `в ${city.namePrepositional ?? city.name}`;
  return {
    title: seo.titleTemplate(`Сравнение цен прокатов ${cityIn}`),
    description: `Цены и условия прокатов ${cityIn}: итог за ваши даты, расстояние до проката, залог и дата проверки каждой цены.`,
    alternates: { canonical: `${siteConfig.url}/${city.slug}` },
  };
}

export default async function CityPage({ params }: Props) {
  const { city: citySlug } = await params;
  const city = await getCityBySlug(citySlug);
  if (!city) notFound();
  return <CityHome city={city} />;
}

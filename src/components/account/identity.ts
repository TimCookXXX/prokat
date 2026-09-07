// Кто стоит в шапке личной зоны. Собирает getCabinetIdentity (src/server/me.ts),
// потребляют герой кабинета, мобильный хаб и AccountShell. Живёт отдельным
// модулем, чтобы серверные layout'ы не импортировали клиентский AccountShell
// ради одного типа.

/* Высота обложки в личной зоне. Общая константа: её читают настоящая страница
 * (AccountShell) и уменьшенное превью в выборе обложки (CoverPicker) — высоты
 * обязаны совпадать, иначе превью врёт. Ветки превью разделены теми же
 * media-брейкпоинтами, что и страница, поэтому один класс верен в обоих. */
export const ACCOUNT_COVER_HEIGHT = "h-52 md:h-60";

export interface AccountIdentity {
  name: string | null;
  email: string;
  image: string | null;
  coverUrl: string | null;
  isVerified: boolean;
  activeListings: number;
  deals: number;
}

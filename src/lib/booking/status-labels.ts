import type { BookingStatus } from "@/lib/catalog/booking-status";

export const STATUS_LABELS: Record<BookingStatus, string> = {
  new: "Ждёт подтверждения",
  confirmed: "Подтверждена",
  declined: "Отклонена",
  expired: "Истекла",
  completed: "Завершена",
  cancelled: "Отменена",
};

// Классы бейджа статуса (токены темы).
export const STATUS_BADGE_CLASSES: Record<BookingStatus, string> = {
  new: "bg-primary/10 text-foreground",
  confirmed: "bg-primary text-primary-foreground",
  declined: "bg-destructive/15 text-foreground",
  expired: "bg-muted text-muted-foreground",
  completed: "bg-muted text-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

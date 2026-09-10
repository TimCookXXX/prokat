import { content } from "@theme/content";
import type { Mail } from "@/lib/mail/mailer";

// Тексты живут в theme/content.ts по конвенции проекта. В каждом письме —
// срок жизни ссылки и строка «если это были не вы».
const m = content.auth.mail;

function body(intro: string, link: string, ttl: string): string {
  return `${intro}\n\n${link}\n\n${ttl}\n${m.ignore}\n\n— ${m.brand}`;
}

export function verifyEmail(to: string, link: string): Mail {
  return { to, subject: m.verifySubject, text: body(m.verifyIntro, link, m.verifyTtl) };
}

export function verifyEmailAgain(to: string, link: string): Mail {
  return { to, subject: m.verifyAgainSubject, text: body(m.verifyAgainIntro, link, m.verifyTtl) };
}

export function resetEmail(to: string, link: string): Mail {
  return { to, subject: m.resetSubject, text: body(m.resetIntro, link, m.resetTtl) };
}

// Уведомление после смены пароля из кабинета. Без body(): строка «если это были
// не вы — проигнорируйте» здесь противопоказана, нужна обратная — с рецептом.
export function passwordChangedEmail(to: string, loginUrl: string): Mail {
  return {
    to,
    subject: m.changedSubject,
    text: `${m.changedIntro}\n\n${m.changedAlert}\n${loginUrl}\n\n— ${m.brand}`,
  };
}

// ============================== Письма брони ==============================
// Толчок вернуться в сервис, а не замена ленте: подробности, телефон и кнопки
// решения — там. Персональных данных в письме минимум: название вещи и период,
// без телефонов и имён.

const b = content.bookingMail;

function bookingBody(intro: string, listingTitle: string, period: string, link: string): string {
  return `${intro}\n\n${listingTitle}\n${period}\n\n${b.open}\n${link}\n\n— ${m.brand}`;
}

export type BookingMailKind = "created" | "confirmed" | "declined" | "cancelled";

export function bookingEmail(
  kind: BookingMailKind,
  to: string,
  listingTitle: string,
  period: string,
  link: string,
): Mail {
  const map = {
    created: [b.createdSubject, b.createdIntro],
    confirmed: [b.confirmedSubject, b.confirmedIntro],
    declined: [b.declinedSubject, b.declinedIntro],
    cancelled: [b.cancelledSubject, b.cancelledIntro],
  } as const;
  const [subject, intro] = map[kind];
  return { to, subject, text: bookingBody(intro, listingTitle, period, link) };
}

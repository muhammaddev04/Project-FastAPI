/**
 * GLOBAL §5 / §12: the API sends UTC ISO-8601; the frontend shows local time in `Asia/Dushanbe` as
 * `dd.MM.yyyy HH:mm` (date-only values as `dd.MM.yyyy`), identical in every language.
 */

export const DISPLAY_TIME_ZONE = 'Asia/Dushanbe';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function fields(value: string): Record<string, string> | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(parts.formatToParts(date).map((part) => [part.type, part.value]));
}

/** `2026-09-28T09:05:00Z` -> `28.09.2026 14:05`; `null` for a missing or invalid value. */
export function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const f = fields(value);
  return f ? `${f.day}.${f.month}.${f.year} ${f.hour}:${f.minute}` : null;
}

/** Calendar date: `2026-09-28` stays `28.09.2026`; a timestamp is shown as its date in Asia/Dushanbe. */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const plain = DATE_ONLY.exec(value);
  if (plain) return `${plain[3]}.${plain[2]}.${plain[1]}`;
  const f = fields(value);
  return f ? `${f.day}.${f.month}.${f.year}` : null;
}

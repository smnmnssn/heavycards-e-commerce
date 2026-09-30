import { siteConfig } from "@/lib/config/site";

/**
 * Calendar-date helpers. Release dates are stored as PostgreSQL `date`
 * (no time zone) and handled as ISO strings ("2026-11-14") in the catalog, so
 * they can never shift by a day through time-zone conversion.
 */

export type IsoDate = string;

const isoDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: siteConfig.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date in Sweden, e.g. "2026-10-01". */
export function stockholmToday(now: Date): IsoDate {
  // The sv-SE locale formats dates as YYYY-MM-DD.
  return isoDateFormatter.format(now);
}

/** Converts a Prisma `@db.Date` value (UTC midnight) to an ISO date string. */
export function toIsoDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

const longDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "2026-11-14" → "14 november 2026". */
export function formatIsoDate(date: IsoDate): string {
  return longDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

const instantFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: siteConfig.timeZone,
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** An instant shown as a Swedish calendar date, e.g. review dates. */
export function formatInstantDate(value: Date): string {
  return instantFormatter.format(value);
}

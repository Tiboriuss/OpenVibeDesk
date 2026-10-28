import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

/** Shared host-side clock and calendar rules. Relative periods use local calendar days. */
export function normalizeTimeZone(value?: string): string {
  const zone = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone || zone.length > 100 || /^[+-]/.test(zone)) throw new Error('Bitte eine gültige IANA-Zeitzone angeben, zum Beispiel Europe/Berlin.');
  try { return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone; }
  catch { throw new Error('Die angegebene Zeitzone ist nicht bekannt.'); }
}

export const timeZoneSchema = z.string().trim().min(1).max(100).refine(value => {
  try { normalizeTimeZone(value); return true; } catch { return false; }
}, 'Bitte eine gültige IANA-Zeitzone angeben.').describe('IANA-Zeitzone, z. B. Europe/Berlin. Ohne Angabe gilt die lokale Systemzeitzone.');

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Kalenderdatum als YYYY-MM-DD angeben.').refine(value => {
  try { Temporal.PlainDate.from(value, { overflow: 'reject' }); return true; } catch { return false; }
}, 'Dieses Kalenderdatum existiert nicht.');

export const timeRangeSchema = z.object({
  period: z.enum(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days', 'custom']),
  timeZone: timeZoneSchema.optional(),
  startDate: localDateSchema.optional().describe('Nur bei custom: erstes eingeschlossenes lokales Kalenderdatum.'),
  endDate: localDateSchema.optional().describe('Nur bei custom: erstes nicht mehr eingeschlossenes lokales Kalenderdatum (exklusive Obergrenze).')
}).strict().superRefine((input, context) => {
  if (input.period === 'custom') {
    if (!input.startDate) context.addIssue({ code: 'custom', path: ['startDate'], message: 'Für einen eigenen Zeitraum ist ein Anfangsdatum erforderlich.' });
    if (!input.endDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'Für einen eigenen Zeitraum ist ein exklusives Enddatum erforderlich.' });
    if (input.startDate && input.endDate && input.startDate >= input.endDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'Das Enddatum muss nach dem Anfangsdatum liegen.' });
  } else if (input.startDate || input.endDate) context.addIssue({ code: 'custom', message: 'Anfangs- und Enddatum sind nur für custom erlaubt.' });
});
export type TimeRangeInput = z.infer<typeof timeRangeSchema>;

export interface TimeContext {
  now: string;
  localDateTime: string;
  localDate: string;
  timeZone: string;
  utcOffset: string;
  locale: string;
  observedAt: string;
  source: 'system_clock';
}

function clockInstant(now: Date): Temporal.Instant {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Die Systemzeit konnte nicht gelesen werden.');
  return Temporal.Instant.fromEpochMilliseconds(now.getTime());
}

export function getTimeContext(now = new Date(), timeZone?: string, locale?: string): TimeContext {
  const instant = clockInstant(now), zone = normalizeTimeZone(timeZone);
  let resolvedLocale: string;
  try { resolvedLocale = new Intl.DateTimeFormat(locale).resolvedOptions().locale; }
  catch { throw new Error('Das angegebene Sprach- und Datumsformat ist ungültig.'); }
  const zoned = instant.toZonedDateTimeISO(zone), stamp = now.toISOString();
  return { now: stamp, localDateTime: zoned.toString({ timeZoneName: 'never', calendarName: 'never', fractionalSecondDigits: 3 }), localDate: zoned.toPlainDate().toString(), timeZone: zone, utcOffset: zoned.offset, locale: resolvedLocale, observedAt: stamp, source: 'system_clock' };
}

export interface ResolvedTimeRange {
  period: TimeRangeInput['period'];
  start: string;
  end: string;
  timeZone: string;
  localStartDate: string;
  localEndDate: string;
  startInclusive: true;
  endExclusive: true;
  durationSeconds: number;
  observedAt: string;
  source: 'system_clock';
}

export function resolveTimeRange(raw: unknown, now = new Date()): ResolvedTimeRange {
  const input = timeRangeSchema.parse(raw), instant = clockInstant(now), timeZone = normalizeTimeZone(input.timeZone);
  const today = instant.toZonedDateTimeISO(timeZone).toPlainDate();
  let start: Temporal.PlainDate, end: Temporal.PlainDate;
  switch (input.period) {
    case 'today': start = today; end = today.add({ days: 1 }); break;
    case 'yesterday': start = today.subtract({ days: 1 }); end = today; break;
    case 'this_week': start = today.subtract({ days: today.dayOfWeek - 1 }); end = start.add({ weeks: 1 }); break;
    case 'last_week': end = today.subtract({ days: today.dayOfWeek - 1 }); start = end.subtract({ weeks: 1 }); break;
    case 'this_month': start = today.with({ day: 1 }); end = start.add({ months: 1 }); break;
    case 'last_month': end = today.with({ day: 1 }); start = end.subtract({ months: 1 }); break;
    case 'last_7_days': start = today.subtract({ days: 6 }); end = today.add({ days: 1 }); break;
    case 'last_30_days': start = today.subtract({ days: 29 }); end = today.add({ days: 1 }); break;
    case 'custom': start = Temporal.PlainDate.from(input.startDate!); end = Temporal.PlainDate.from(input.endDate!); break;
  }
  // toZonedDateTime(zone) chooses the first valid instant of that calendar day,
  // including midnight transitions. Adding 24 elapsed hours would be incorrect.
  const from = start.toZonedDateTime(timeZone), until = end.toZonedDateTime(timeZone);
  if (!from.toPlainDate().equals(start)) throw new Error('Das Anfangsdatum existiert in dieser Zeitzone nicht.');
  if (Temporal.ZonedDateTime.compare(from, until) >= 0) throw new Error('Der gewählte Zeitraum ist leer.');
  return { period: input.period, start: from.toInstant().toString({ fractionalSecondDigits: 3 }), end: until.toInstant().toString({ fractionalSecondDigits: 3 }), timeZone, localStartDate: start.toString(), localEndDate: end.toString(), startInclusive: true, endExclusive: true, durationSeconds: Number(until.epochNanoseconds - from.epochNanoseconds) / 1e9, observedAt: now.toISOString(), source: 'system_clock' };
}

const timestampSchema = z.string().min(1).max(100).refine(value => {
  try { Temporal.Instant.from(value); return true; } catch { return false; }
}, 'Bitte einen ISO-Zeitpunkt mit Z oder UTC-Offset angeben.');
export const timeDifferenceSchema = z.object({
  start: timestampSchema,
  end: timestampSchema,
  unit: z.enum(['seconds', 'minutes', 'hours', 'days', 'calendar_days']).optional(),
  timeZone: timeZoneSchema.optional()
}).strict();

/** Elapsed days are exactly 24 hours; calendar_days compares local dates instead. */
export function resolveTimeDifference(raw: unknown) {
  const input = timeDifferenceSchema.parse(raw), start = Temporal.Instant.from(input.start), end = Temporal.Instant.from(input.end);
  const unit = input.unit ?? 'seconds', timeZone = normalizeTimeZone(input.timeZone);
  const value = unit === 'calendar_days' ? start.toZonedDateTimeISO(timeZone).toPlainDate().until(end.toZonedDateTimeISO(timeZone).toPlainDate(), { largestUnit: 'day' }).days : Number(end.epochNanoseconds - start.epochNanoseconds) / ({ seconds: 1e9, minutes: 60e9, hours: 3600e9, days: 86400e9 }[unit]);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('Die Zeitdifferenz ist zu groß.');
  return { value, unit, ...(unit === 'calendar_days' ? { timeZone } : { elapsedNanoseconds: (end.epochNanoseconds - start.epochNanoseconds).toString() }), start: start.toString(), end: end.toString(), semantics: unit === 'calendar_days' ? 'Differenz der lokalen Kalenderdaten; Sommerzeit wird berücksichtigt.' : 'Tatsächlich verstrichene Dauer; ein Tag entspricht 24 Stunden. elapsedNanoseconds ist die exakte Dauer als Ganzzahlzeichenfolge; value ist ihre numerische Umrechnung.' };
}

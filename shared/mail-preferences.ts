import { z } from 'zod';

export const MAIL_POLL_INTERVALS = [0, 60, 120, 300, 600, 900, 1800, 3600] as const;
export const DEFAULT_MAIL_POLL_INTERVAL = 300;
export const mailPreferenceFields = {
  senderName: z.string().trim().max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Der Absendername darf keine Steuerzeichen enthalten.'),
  signature: z.string().max(5000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Die Signatur enthält ungültige Steuerzeichen.'),
  pollIntervalSeconds: z.union(MAIL_POLL_INTERVALS.map(value => z.literal(value)))
};
export const mailPreferencesSchema = z.object({ accountId: z.uuid(), ...mailPreferenceFields }).strict();

export function mailPreferences(account: { senderName?: string; signature?: string; pollIntervalSeconds?: number }) {
  return { senderName: account.senderName ?? '', signature: account.signature ?? '', pollIntervalSeconds: account.pollIntervalSeconds ?? DEFAULT_MAIL_POLL_INTERVAL };
}

/** Signatures become visible editable draft text once; SMTP never adds them later. */
export function draftTextWithSignature(text: string, signature: string): string {
  const value = signature.replace(/\r\n?/g, '\n').trim();
  if (!value) return text;
  // Preserve a deliberately supplied signature instead of duplicating it.
  if (text.replace(/\r\n?/g, '\n').trimEnd().endsWith(value)) return text;
  return `${text.trimEnd()}${text.trim() ? '\n\n' : ''}-- \n${value}`;
}

import { z } from 'zod';
import { mailPreferenceFields } from '../../shared/mail-preferences';

const text = (limit: number) => z.string().trim().max(limit).regex(/^[^\u0000-\u001f\u007f]*$/);
const connectionFields = { host: text(253), port: z.number().int().min(1).max(65535), security: z.enum(['tls', 'starttls']), username: text(320) };

export const mailSuggestionSchemas = {
  account: z.object({ name: text(120), email: text(320), ...connectionFields }).partial(),
  smtp: z.object({ ...connectionFields, useImapCredentials: z.boolean() }).partial(),
  'mail-preferences': z.object(mailPreferenceFields).partial()
};

export type MailSuggestionKind = keyof typeof mailSuggestionSchemas;
export type MailSuggestionValues = z.infer<typeof mailSuggestionSchemas.account> & z.infer<typeof mailSuggestionSchemas.smtp> & z.infer<typeof mailSuggestionSchemas['mail-preferences']>;

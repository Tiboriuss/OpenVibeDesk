import { z } from 'zod';
import { mailSourceLocatorSchema } from '../../../shared/mail-source';

// The host owns the v1 workspace file even when Mail is disabled. These data-only
// schemas keep validation of its retained Mail and delivery records inside Mail.
const id = z.string().min(1);
const text = z.string();
const count = z.number().int().nonnegative();
const timestamp = text.refine(value => Number.isFinite(Date.parse(value)));
export const workspaceMailFolderSchema = z.enum(['Inbox', 'Sent', 'Drafts', 'Archive']);
const attachment = z.object({ name: text, size: z.number().nonnegative() });
const mailFields = { id, from: text, to: text, subject: text, date: text, bodyText: text, attachments: z.array(attachment), accountName: text.optional() };
export const workspaceMailSchema = z.object({
  ...mailFields, folder: workspaceMailFolderSchema, threadId: id, read: z.boolean(), bodyHtml: text.optional(),
  externalFolder: text.optional(), bodyLoaded: z.boolean().optional()
});
export const workspaceEmailReferenceSchema = z.object({
  ...mailFields, source: mailSourceLocatorSchema.optional(), truncated: z.boolean().optional(),
  accountId: id.optional(), fromAddresses: z.array(text).optional(), replyToAddresses: z.array(text).optional(),
  messageId: text.optional(), references: z.array(text).optional()
});
const sentCopy = z.object({
  status: z.enum(['pending', 'filing', 'filed', 'failed', 'uncertain']), messageId: id, folder: text.optional(),
  filedAt: timestamp.optional(), error: text.optional(), appendAttempted: z.boolean().optional(), uid: count.optional(), uidValidity: text.optional()
});
export const workspaceDraftSchema = z.object({
  id, replyTo: text.optional(), accountId: text.optional(), to: text, cc: text.optional(), bcc: text.optional(),
  subject: text, body: text, inReplyTo: text.optional(), references: z.array(text).optional(),
  attachments: z.array(attachment.extend({ path: text })), updatedAt: timestamp,
  deliveryStatus: z.enum(['draft', 'sending', 'sent', 'uncertain']).optional(), deliveryError: text.optional(),
  rejectedRecipients: z.array(text).optional(), sentCopy: sentCopy.optional()
}).refine(value => {
  if (!value.sentCopy) return true;
  // SMTP rejection can leave a prepared, pending copy on an editable draft.
  // An APPEND attempt, however, is only possible after SMTP acceptance.
  return value.deliveryStatus === 'sent' || (value.sentCopy.status === 'pending' && !value.sentCopy.appendAttempted && value.deliveryStatus !== undefined);
});

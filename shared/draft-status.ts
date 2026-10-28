import type { Draft } from './model';

export type DraftCollection = 'drafts' | 'outbox' | 'sent';

/** One classification for the Mail UI and assistant; sent records remain resend guards. */
export function draftCollection(draft: Draft): DraftCollection {
  const status = draft.deliveryStatus ?? 'draft';
  if (status === 'draft') return 'drafts';
  if (status === 'sent' && draft.sentCopy?.status === 'filed' && !draft.rejectedRecipients?.length) return 'sent';
  return 'outbox';
}

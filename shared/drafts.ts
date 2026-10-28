/** Acknowledged local persistence of one mail draft, separate from SMTP delivery. */
export interface DraftSaveState {
  draftId: string;
  /** The draft revision described by this status, never an older completed save. */
  contentUpdatedAt: string;
  status: 'saving' | 'saved' | 'error';
  /** Present only when a write has completed in this app session. */
  savedAt?: string;
  error?: string;
}

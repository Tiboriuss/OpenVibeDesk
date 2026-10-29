export interface MailAccountSummary {
  id: string;
  name: string;
  email: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  username: string;
  senderName?: string;
  signature?: string;
  pollIntervalSeconds?: number;
}

export type MailAccountInput = Omit<MailAccountSummary, 'id'> & { accountId?: string; password?: string };
export interface MailPreferencesInput { accountId: string; senderName: string; signature: string; pollIntervalSeconds: number; }
export interface SmtpConfig { accountId: string; host: string; port: number; security: 'tls' | 'starttls'; username: string; useImapCredentials: boolean; hasPassword: boolean; }
export type SmtpInput = Omit<SmtpConfig, 'hasPassword'> & { password?: string };
export interface ImapFolder { path: string; name: string; delimiter: string; specialUse?: string; selectable: boolean; }
export interface ImapPageCursor { beforeUid: number; uidValidity: string; }
export interface ImapMessagePage { messages: ImapMessage[]; nextCursor?: ImapPageCursor; }
export interface MailPreview { emailId: string; preview: string; }
export interface ImapMessage {
  id: string;
  uid: number;
  uidValidity: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  receivedAt?: string;
  bodyText: string;
  /** Bounded plain-text list preview; absent until fetched, empty if unavailable. */
  preview?: string;
  /** Untrusted markup, only consumed by the isolated Mail renderer. */
  bodyHtml?: string;
  htmlTruncated?: boolean;
  inlineImages?: Record<string, string>;
  display?: import('./mail-display').MailDisplayState;
  bodyLoaded: boolean;
  attachments: { name: string; size: number; part: string }[];
  read: boolean;
  accountId?: string;
  accountName?: string;
  folder?: string;
  messageId?: string;
  replyTo?: string;
  cc?: string;
  references?: string[];
  inReplyTo?: string;
  fromAddresses?: string[];
  replyToAddresses?: string[];
  toAddresses?: string[];
  ccAddresses?: string[];
  truncated: boolean;
}

export interface MailSearchRequest { query: string; accountId?: string; folder?: string; limit?: number; }
export interface MailSearchResults { query: string; messages: ImapMessage[]; total: number; hasMore: boolean; scope: string; foldersSearched: number; foldersRemaining: number; warnings?: string[]; }

/** Filing is independent of SMTP acceptance and must never trigger another send. */
export interface SentCopyState {
  status: 'pending' | 'filing' | 'filed' | 'failed' | 'uncertain';
  messageId: string;
  folder?: string;
  filedAt?: string;
  error?: string;
  appendAttempted?: boolean;
  uid?: number;
  uidValidity?: string;
}
export interface SentCopyResult {
  draftId: string;
  deliveryStatus: 'draft' | 'sending' | 'sent' | 'uncertain';
  sent: boolean;
  outcome: 'completed' | 'failed' | 'uncertain';
  ok: boolean;
  sentCopy: SentCopyState;
  message?: string;
  error?: string;
  warning?: string;
  persisted?: boolean;
}

export type MailSendResult = {
  draftId: string;
  status: 'sent' | 'failed' | 'cancelled' | 'uncertain';
  outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain';
  ok: boolean;
  sent: boolean;
  deliveryStatus: 'draft' | 'sending' | 'sent' | 'uncertain';
  message?: string;
  error?: string;
  warning?: string;
  rejectedRecipients?: string[];
  acceptedRecipients?: string[];
  cancelled?: true;
  retryBlocked?: true;
  alreadySent?: true;
  duplicatePrevented?: true;
  persisted?: boolean;
  sentCopy?: SentCopyState;
};

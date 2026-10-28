export interface MailAccountSummary {
  id: string;
  name: string;
  email: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  username: string;
}

export type MailAccountInput = Omit<MailAccountSummary, 'id'> & { accountId?: string; password?: string };
export interface SmtpConfig { accountId: string; host: string; port: number; security: 'tls' | 'starttls'; username: string; useImapCredentials: boolean; hasPassword: boolean; }
export type SmtpInput = Omit<SmtpConfig, 'hasPassword'> & { password?: string };
export interface ImapFolder { path: string; name: string; delimiter: string; specialUse?: string; selectable: boolean; }
export interface ImapPageCursor { beforeUid: number; uidValidity: string; }
export interface ImapMessagePage { messages: ImapMessage[]; nextCursor?: ImapPageCursor; }
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
};

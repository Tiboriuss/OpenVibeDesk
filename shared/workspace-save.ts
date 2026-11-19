import type { UiLocale } from './locale';

export type WorkspaceSaveErrorCode = 'unconfirmed' | 'disk-full' | 'read-only' | 'write-failed';

/** Revisions identify canonical workspace changes within this app process. */
export interface WorkspaceSaveStatus {
  status: 'saved' | 'saving' | 'error';
  revision: number;
  savedRevision: number;
  error?: string;
  errorCode?: WorkspaceSaveErrorCode;
  retryable?: boolean;
}

const failureText = {
  de: {
    unconfirmed: 'Die letzte Speicherung konnte nicht bestätigt werden. Bitte OVD neu starten.',
    'disk-full': 'Zu wenig Speicherplatz. Bitte Platz freigeben und erneut speichern.',
    'read-only': 'Kein Schreibzugriff auf den Workspace. Bitte Schreibrechte prüfen.',
    'write-failed': 'Der Workspace konnte nicht gespeichert werden.'
  },
  en: {
    unconfirmed: 'The last save could not be confirmed. Restart OVD.',
    'disk-full': 'The disk is full. Free up space and save again.',
    'read-only': 'The workspace is read-only. Check write permissions.',
    'write-failed': 'The workspace could not be saved.'
  }
} satisfies Record<UiLocale, Record<WorkspaceSaveErrorCode, string>>;

export function workspaceSaveFailureText(locale: UiLocale, code: WorkspaceSaveErrorCode): string {
  return failureText[locale][code];
}

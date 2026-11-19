import type { UiLocale } from '../shared/locale';

export const sessionText = {
  de: {
    search: 'Chats durchsuchen', clear: 'Suche löschen', create: 'Neuer Chat', title: 'Chat-Titel',
    saving: 'Speichert …', save: 'Speichern', cancel: 'Abbrechen', active: 'Aktiv', emptyPreview: 'Noch keine Nachrichten',
    rename: 'Umbenennen', reference: 'Als Referenz verwenden', empty: 'Keine passenden Chats gefunden.', loading: 'Lädt …', more: 'Weitere Chats laden',
    openChat: (title: string) => `${title} öffnen`, renameChat: (title: string) => `${title} umbenennen`,
    referenceChat: (title: string) => `${title} als Referenz verwenden`
  },
  en: {
    search: 'Search chats', clear: 'Clear search', create: 'New chat', title: 'Chat title',
    saving: 'Saving …', save: 'Save', cancel: 'Cancel', active: 'Active', emptyPreview: 'No messages yet',
    rename: 'Rename', reference: 'Use as a reference', empty: 'No matching chats.', loading: 'Loading …', more: 'Load more chats',
    openChat: (title: string) => `Open ${title}`, renameChat: (title: string) => `Rename ${title}`,
    referenceChat: (title: string) => `Use ${title} as a reference`
  }
};

const messageRoles = {
  de: { user: 'Deine Nachricht', assistant: 'Antwort des Assistenten' },
  en: { user: 'Your message', assistant: 'Assistant reply' }
};

export function messagePresentation(locale: UiLocale, message: { timestamp: string; role: 'user' | 'assistant' }) {
  const date = chatDate(locale, message.timestamp);
  return { title: date, 'aria-description': date, 'aria-label': messageRoles[locale][message.role] };
}

export const composerRecoveryText = {
  de: {
    load: 'Der Entwurf konnte nicht geladen werden.', write: 'Deine Eingabe konnte nicht übernommen werden.',
    conflict: 'Der gespeicherte Entwurf wurde gleichzeitig geändert.', legacy: 'Ein früherer Entwurf wartet auf Wiederherstellung.',
    view: 'Gespeicherten Entwurf ansehen', noText: '(Ohne Text)', reload: 'Erneut laden', retrySave: 'Erneut speichern',
    keepInput: 'Meine Eingabe übernehmen', useSaved: 'Gespeicherten Entwurf verwenden'
  },
  en: {
    load: 'The draft could not be loaded.', write: 'Your changes could not be saved.',
    conflict: 'The saved draft was edited elsewhere.', legacy: 'An earlier draft is available to recover.',
    view: 'View saved draft', noText: '(No text)', reload: 'Reload', retrySave: 'Retry save',
    keepInput: 'Keep my changes', useSaved: 'Use saved draft'
  }
};

const dateOptions: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const dates = { de: new Intl.DateTimeFormat('de', dateOptions), en: new Intl.DateTimeFormat('en', dateOptions) };

export function chatDate(locale: UiLocale, timestamp: string) {
  return dates[locale].format(new Date(timestamp));
}

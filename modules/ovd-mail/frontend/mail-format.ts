import type { UiLocale } from '../../../shared/locale';
import type { ImapFolder } from '../../../shared/mail';
import { Archive, FileText, Folder, Inbox, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { mailText } from './mail-locale';

function formatters(locale: UiLocale) {
  const copy = mailText[locale];
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const shortDate = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' });
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const wholeNumber = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function formatDate(value: string, detailed = false): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    if (detailed) return fullDate.format(date);
    return (date.toDateString() === new Date().toDateString() ? time : shortDate).format(date);
  }
  function dateGroup(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return copy.olderGroup;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(date); day.setHours(0, 0, 0, 0);
    const difference = Math.round((today.getTime() - day.getTime()) / 86400000);
    if (difference === 0) return copy.today;
    if (difference === 1) return copy.yesterday;
    if (difference > 1 && difference < 7) return copy.lastWeekDays;
    return month.format(date);
  }
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${wholeNumber.format(bytes)} B`;
    if (bytes < 1024 * 1024) return `${wholeNumber.format(Math.ceil(bytes / 1024))} KB`;
    return `${decimal.format(bytes / (1024 * 1024))} MB`;
  }
  function senderName(value: string): string { return value.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '').trim() || value || copy.unknownSender; }
  function senderAddress(value: string): string { return value.match(/<([^>]+)>/)?.[1] || value; }
  function initials(value: string): string { return senderName(value).split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toLocaleUpperCase(locale); }
  function folderDisplay(folder: ImapFolder) {
    const special = folder.specialUse?.toLowerCase() ?? '';
    if (special === '\\inbox' || folder.path.toLowerCase() === 'inbox') return { label: copy.inbox, Icon: Inbox, primary: true };
    if (special === '\\sent') return { label: copy.sent, Icon: Send, primary: true };
    if (special === '\\drafts') return { label: copy.serverDrafts, Icon: FileText, primary: true };
    if (special === '\\archive') return { label: copy.archive, Icon: Archive, primary: true };
    if (special === '\\trash') return { label: copy.trash, Icon: Trash2, primary: true };
    if (special === '\\junk') return { label: 'Spam', Icon: ShieldAlert, primary: true };
    return { label: folder.name || folder.path, Icon: Folder, primary: false };
  }
  return { formatDate, dateGroup, formatSize, senderName, senderAddress, initials, folderDisplay };
}

export const mailFormat = { de: formatters('de'), en: formatters('en') };

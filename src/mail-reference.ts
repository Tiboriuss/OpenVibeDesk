export const MAIL_DRAG_TYPE = 'application/x-workspace-email-id';
export const MAIL_DRAG_PREFIX = 'openvibedesk-email:';

/** Cross-window drags carry an opaque ID; mail content is resolved by the main process. */
export function writeMailDrag(data: DataTransfer, id: string): void {
  data.setData(MAIL_DRAG_TYPE, id);
  data.setData('text/plain', MAIL_DRAG_PREFIX + id);
  data.effectAllowed = 'copy';
}

export function readMailDrag(data: DataTransfer): string | undefined {
  const text = data.getData('text/plain');
  const id = data.getData(MAIL_DRAG_TYPE) || (text.startsWith(MAIL_DRAG_PREFIX) ? text.slice(MAIL_DRAG_PREFIX.length) : '');
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : undefined;
}

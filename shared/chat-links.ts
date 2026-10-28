/** Only these link types may leave the chat and reach an operating-system handler. */
export function getExternalChatUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const input = value.trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      if (!url.hostname || url.username || url.password) return null;
      return url.href;
    }
    if (url.protocol === 'mailto:' && url.pathname && !/%0[ad]/i.test(url.pathname)) return url.href;
  } catch { /* Incomplete streaming links and relative paths are not external destinations. */ }
  return null;
}

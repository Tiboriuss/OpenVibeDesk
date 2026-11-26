import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';
import { getExternalChatUrl } from '../../../shared/chat-links';

const excludedSubtrees = new Set(['head', 'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'textarea', 'select', 'video', 'audio']);
const shortText = (text: string, max: number) => text.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/** Parse the same bounded HTML source as the reader. Parsing never loads a URL. */
export function mailReaderLinks(emailId: string, html: string) {
  const links = new Map<string, { linkId: string; label: string; destination: string; url: string }>();
  let excludedDepth = 0;
  let anchor: { url: string; text: string; title: string } | undefined;
  function finishAnchor() {
    if (!anchor) return;
    const { url, text, title } = anchor;
    if (!links.has(url)) {
      const parsed = new URL(url);
      const destination = parsed.protocol === 'mailto:' ? 'mailto:' + parsed.pathname : parsed.origin + parsed.pathname;
      const linkId = createHash('sha256').update(emailId).update('\0').update(url).digest('hex').slice(0, 32);
      links.set(url, { linkId, label: shortText(text, 96) || shortText(title, 96), destination: shortText(destination, 180), url });
    }
    anchor = undefined;
  }
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (excludedDepth || excludedSubtrees.has(tag)) { excludedDepth++; return; }
      if (tag === 'a') {
        finishAnchor();
        const url = getExternalChatUrl(attrs.href);
        if (url) anchor = { url, text: '', title: attrs.title ?? '' };
      } else if (tag === 'img' && anchor && anchor.text.length < 256) {
        anchor.text += ' ' + (attrs.alt ?? '').slice(0, 256) + ' ';
      }
    },
    ontext(value) { if (anchor && !excludedDepth && anchor.text.length < 256) anchor.text += value.slice(0, 256); },
    onclosetag(tag) {
      if (excludedDepth) { excludedDepth--; return; }
      if (tag === 'a') finishAnchor();
    }
  });
  parser.end(html);
  return [...links.values()];
}

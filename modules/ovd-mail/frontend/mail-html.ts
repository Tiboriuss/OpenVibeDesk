import DOMPurify from 'dompurify';
import { getExternalChatUrl } from '../../../shared/chat-links';

export interface SafeMailHtml {
  document: string;
  remoteImages: number;
  unavailableImages: number;
}

const tags = ['a', 'p', 'div', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'small', 'sub', 'sup', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'img', 'font', 'center', 'address'];
const attrs = ['href', 'title', 'alt', 'src', 'width', 'height', 'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'border', 'align', 'valign', 'bgcolor', 'color', 'face', 'size', 'style', 'start', 'dir', 'lang', 'id'];
const cssProperties = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'vertical-align', 'white-space', 'word-break', 'overflow-wrap', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-width', 'border-style', 'border-radius', 'border-collapse', 'border-spacing', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'width', 'max-width', 'min-width', 'height', 'max-height', 'list-style-type', 'display']);
const inlineRaster = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i;

function safeStyle(element: HTMLElement): void {
  const style = element.style;
  for (const property of Array.from(style)) {
    const value = style.getPropertyValue(property);
    if (!cssProperties.has(property) || value.length > 200 || /[\\@{}<>\u0000-\u001f\u007f]/.test(value) || /(?:url|expression|var|image|paint|attr)\s*\(/i.test(value) || !/^[a-z0-9\s#.,%()'"+\-/]*$/i.test(value)) {
      style.removeProperty(property);
      continue;
    }
    // Sender CSS cannot supersede the document's layout bounds with !important.
    style.setProperty(property, value, '');
  }
  if (!style.length) element.removeAttribute('style');
}

function rasterForCid(source: string, inlineImages: Record<string, string>): string | undefined {
  if (!/^cid:/i.test(source)) return;
  let id = source.slice(4);
  try { id = decodeURIComponent(id); } catch { return; }
  id = id.replace(/^<|>$/g, '');
  const image = Object.prototype.hasOwnProperty.call(inlineImages, id) ? inlineImages[id] : undefined;
  return image && image.length <= 750_000 && inlineRaster.test(image) ? image : undefined;
}

/** Parse in inert template content, sanitize, then serialize only the safe result. */
export function buildMailHtml(html: string, showRemoteImages: boolean, inlineImages: Record<string, string> = {}): SafeMailHtml {
  const template = document.createElement('template');
  template.innerHTML = html.slice(0, 128 * 1024);
  const fragment = template.content;
  const wrapper = fragment.ownerDocument.createElement('div');
  while (fragment.firstChild) wrapper.appendChild(fragment.firstChild);
  fragment.appendChild(wrapper);
  DOMPurify.sanitize(wrapper, { IN_PLACE: true, ALLOWED_TAGS: tags, ALLOWED_ATTR: attrs, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, SANITIZE_DOM: true, KEEP_CONTENT: true, FORBID_TAGS: ['script', 'style', 'svg', 'math', 'template', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base', 'video', 'audio', 'source'] });
  let remoteImages = 0, unavailableImages = 0;
  for (const element of wrapper.querySelectorAll<HTMLElement>('*')) {
    safeStyle(element);
    if (element.hasAttribute('id')) {
      const id = element.getAttribute('id') ?? '';
      if (/^[a-z0-9_.:-]{1,100}$/i.test(id)) element.id = `ovd-mail-${id}`;
      else element.removeAttribute('id');
    }
    for (const attr of ['width', 'height', 'cellpadding', 'cellspacing', 'border', 'colspan', 'rowspan']) {
      if (element.hasAttribute(attr) && !/^\d{1,4}%?$/.test(element.getAttribute(attr) ?? '')) element.removeAttribute(attr);
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') ?? '';
      const safe = /^#[a-z0-9_.:-]{1,100}$/i.test(href) ? `#ovd-mail-${href.slice(1)}` : getExternalChatUrl(href);
      if (safe) { element.setAttribute('href', safe); element.setAttribute('rel', 'noreferrer noopener'); }
      else element.removeAttribute('href');
    }
    if (element.tagName === 'IMG') {
      const source = (element.getAttribute('src') ?? '').trim();
      const cid = rasterForCid(source, inlineImages);
      const external = getExternalChatUrl(source);
      const remote = external && /^https?:/i.test(external) ? external : undefined;
      if (remote) remoteImages++;
      if (cid || remote && showRemoteImages) {
        element.setAttribute('src', cid ?? remote!);
        element.setAttribute('referrerpolicy', 'no-referrer');
        element.setAttribute('loading', 'lazy');
        element.setAttribute('decoding', 'async');
      } else {
        if (!remote) unavailableImages++;
        const placeholder = fragment.ownerDocument.createElement('span');
        placeholder.className = 'ovd-image-placeholder';
        placeholder.textContent = element.getAttribute('alt') || (remote ? 'Externes Bild' : 'Bild nicht verfügbar');
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', placeholder.textContent);
        element.replaceWith(placeholder);
      }
    }
  }
  const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${showRemoteImages ? ' https: http:' : ''}; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; media-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
  const style = `html{color-scheme:light;background:#fff;color:#12182d;overflow-wrap:anywhere;word-break:normal}body{margin:0;padding:3px;font:14px/1.6 Arial,sans-serif;overflow-x:auto}*{box-sizing:border-box}img{max-width:100%!important;height:auto!important}table{max-width:100%!important}td,th{overflow-wrap:anywhere}pre{max-width:100%;overflow:auto;white-space:pre-wrap}a{color:#4533b7;text-decoration:underline;overflow-wrap:anywhere}blockquote{margin:12px 0;padding-left:12px;border-left:3px solid #e8e5fd}.ovd-image-placeholder{display:inline-block;padding:4px 7px;border:1px dashed #c6c9d4;border-radius:4px;color:#606579;font:12px/1.4 Arial,sans-serif}`;
  return { document: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}</style></head><body>${wrapper.innerHTML}</body></html>`, remoteImages, unavailableImages };
}

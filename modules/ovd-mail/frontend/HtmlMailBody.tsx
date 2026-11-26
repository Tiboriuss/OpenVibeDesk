import { useUiLocale } from '../../../src/locale';
import { mailText } from './mail-locale';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { UiLocale } from '../../../shared/locale';
import { buildMailHtml } from './mail-html';
import { getExternalChatUrl } from '../../../shared/chat-links';
import './mail-html.css';

function updatePresentation(doc: Document, locale: UiLocale, largeText: boolean, messageLanguage?: string) {
  doc.documentElement.lang = messageLanguage ?? locale;
  doc.documentElement.style.zoom = largeText ? '1.2' : '';
  const copy = mailText[locale];
  for (const image of doc.querySelectorAll<HTMLElement>('[data-ovd-placeholder]')) {
    const label = image.dataset.ovdPlaceholder === 'remote' ? copy.remoteImage : copy.missingImage;
    image.lang = locale;
    image.textContent = label;
    image.setAttribute('aria-label', label);
  }
}

export function HtmlMailBody({ html, remoteImages, largeText, inlineImages, onOpenLink, onRemoteImagesCount }: { html: string; remoteImages: boolean; largeText: boolean; inlineImages?: Record<string, string>; onOpenLink?(url: string): Promise<void>; onRemoteImagesCount?(count: number): void }) {
  const locale = useUiLocale();
  const copy = mailText[locale];
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const onLink = useRef(onOpenLink); onLink.current = onOpenLink;
  const [height, setHeight] = useState(200);
  const [linkFailed, setLinkFailed] = useState(false);
  const prepared = useMemo(() => {
    try { return buildMailHtml(html, remoteImages, inlineImages); }
    catch { return undefined; }
  }, [html, remoteImages, inlineImages]);
  const presentation = useRef({ locale, largeText, language: prepared?.language });
  const resize = useCallback(() => {
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    const next = Math.max(180, Math.min(6000, Math.ceil(body.getBoundingClientRect().height) + 8));
    setHeight(current => current === next ? current : next);
  }, []);
  useLayoutEffect(() => {
    presentation.current = { locale, largeText, language: prepared?.language };
    const doc = frame.current?.contentDocument;
    if (doc?.body) {
      updatePresentation(doc, locale, largeText, prepared?.language);
      resize();
    }
  }, [locale, largeText, prepared?.language, resize]);
  useEffect(() => { onRemoteImagesCount?.(prepared?.remoteImages ?? 0); }, [prepared?.remoteImages, onRemoteImagesCount]);
  useLayoutEffect(() => { setLinkFailed(false); return () => { cleanup.current?.(); cleanup.current = undefined; }; }, [prepared?.document]);
  const loaded = useCallback(() => {
    cleanup.current?.();
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const display = presentation.current;
    updatePresentation(doc, display.locale, display.largeText, display.language);
    const click = (event: MouseEvent) => {
      const target = event.target as Node | null;
      // `instanceof Element` belongs to the iframe's realm; use its element API.
      const element = target?.nodeType === 1 ? target as Element : target?.parentElement;
      const anchor = element?.closest('a[href]');
      if (!anchor) return;
      event.preventDefault(); event.stopPropagation();
      if (!(event.type === 'click' && event.button === 0 || event.type === 'auxclick' && event.button === 1)) return;
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#')) { doc.getElementById(href.slice(1))?.scrollIntoView({ block: 'nearest' }); return; }
      const safe = getExternalChatUrl(href);
      if (safe && onLink.current) {
        setLinkFailed(false);
        void onLink.current(safe).catch(() => setLinkFailed(true));
      }
    };
    const denyForm = (event: Event) => event.preventDefault();
    const denyContextMenu = (event: Event) => { const target = event.target as Element | null; if (target?.nodeType === 1 && target.closest('a')) event.preventDefault(); };
    doc.addEventListener('click', click, true);
    doc.addEventListener('auxclick', click, true);
    doc.addEventListener('submit', denyForm, true);
    doc.addEventListener('dragstart', denyForm, true);
    doc.addEventListener('dragover', denyForm, true);
    doc.addEventListener('drop', denyForm, true);
    doc.addEventListener('contextmenu', denyContextMenu, true);
    doc.addEventListener('load', resize, true);
    const observer = new ResizeObserver(resize);
    observer.observe(doc.body);
    resize();
    cleanup.current = () => { observer.disconnect(); doc.removeEventListener('click', click, true); doc.removeEventListener('auxclick', click, true); doc.removeEventListener('submit', denyForm, true); doc.removeEventListener('dragstart', denyForm, true); doc.removeEventListener('dragover', denyForm, true); doc.removeEventListener('drop', denyForm, true); doc.removeEventListener('contextmenu', denyContextMenu, true); doc.removeEventListener('load', resize, true); };
  }, [resize]);
  if (!prepared) return <p className="mail-html-error" role="alert">{copy.htmlUnavailable}</p>;
  return <div className="mail-html-body">
    <iframe ref={frame} className="mail-html-frame" title={copy.htmlContent} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={prepared.document} style={{ height }} onLoad={loaded} />
    {prepared.unavailableImages > 0 && <p className="mail-html-unavailable">{prepared.unavailableImages} {prepared.unavailableImages === 1 ? copy.oneInline : copy.manyInline} {copy.unavailable}</p>}
    {linkFailed && <p className="mail-html-error" role="alert">{copy.linkFailed}</p>}
  </div>;
}

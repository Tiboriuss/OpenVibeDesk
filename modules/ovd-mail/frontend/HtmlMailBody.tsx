import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMailHtml } from './mail-html';
import { getExternalChatUrl } from '../../../shared/chat-links';
import './mail-html.css';

export function HtmlMailBody({ html, remoteImages, inlineImages, onOpenLink, onRemoteImagesCount }: { html: string; remoteImages: boolean; inlineImages?: Record<string, string>; onOpenLink?(url: string): Promise<void>; onRemoteImagesCount?(count: number): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const onLink = useRef(onOpenLink); onLink.current = onOpenLink;
  const [height, setHeight] = useState(200);
  const [error, setError] = useState('');
  const prepared = useMemo(() => {
    try { return { value: buildMailHtml(html, remoteImages, inlineImages) }; }
    catch { return { error: 'Die HTML-Ansicht konnte nicht sicher aufgebaut werden. Bitte die Textansicht verwenden.' }; }
  }, [html, remoteImages, inlineImages]);
  useEffect(() => { onRemoteImagesCount?.(prepared.value?.remoteImages ?? 0); }, [prepared.value?.remoteImages, onRemoteImagesCount]);
  useEffect(() => { setError(''); setHeight(200); return () => { cleanup.current?.(); cleanup.current = undefined; }; }, [prepared.value?.document]);
  const loaded = useCallback(() => {
    cleanup.current?.();
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const resize = () => { const next = Math.max(180, Math.min(6000, Math.ceil(Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height)) + 8)); setHeight(current => current === next ? current : next); };
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
      if (safe && onLink.current) void onLink.current(safe).catch(reason => setError(reason instanceof Error ? reason.message : 'Der Link konnte nicht geöffnet werden.'));
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
  }, []);
  if (!prepared.value) return <p className="mail-html-error" role="alert">{prepared.error}</p>;
  return <div className="mail-html-body">
    <iframe ref={frame} className="mail-html-frame" title="HTML-Inhalt der E-Mail" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={prepared.value.document} style={{ height }} onLoad={loaded} />
    {prepared.value.unavailableImages > 0 && <p className="mail-html-unavailable">{prepared.value.unavailableImages} {prepared.value.unavailableImages === 1 ? 'eingebettetes Bild ist' : 'eingebettete Bilder sind'} nicht verfügbar.</p>}
    {error && <p className="mail-html-error" role="alert">{error}</p>}
  </div>;
}

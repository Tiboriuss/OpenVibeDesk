import { createContext, useContext, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Check, Copy, ImageOff } from 'lucide-react';
import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getExternalChatUrl } from '../shared/chat-links';
import './chat-markdown.css';

type MarkdownControls = { prefix: string; copied?: string; onCopy(id: string, text: string): Promise<void>; onLinkError(message: string): void };
const MarkdownContext = createContext<MarkdownControls | null>(null);

// Only generated Markdown nodes reach this tree; raw HTML is never parsed.
type MarkdownNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: MarkdownNode[] };
function textContent(node: MarkdownNode): string { return node.value ?? node.children?.map(textContent).join('') ?? ''; }
function namespaceAnchors({ prefix }: { prefix: string }) {
  return (tree: MarkdownNode) => {
    const usedIds = new Set<string>();
    const reserveIds = (node: MarkdownNode) => { if (typeof node.properties?.id === 'string') usedIds.add(node.properties.id); node.children?.forEach(reserveIds); };
    reserveIds(tree);
    const visit = (node: MarkdownNode) => {
      if (node.type === 'element') {
        const properties = node.properties ?? (node.properties = {});
        if (/^h[1-6]$/.test(node.tagName ?? '') && !properties.id) {
          const slug = textContent(node).toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').replace(/\s/g, '-') || 'abschnitt';
          let id = slug, count = 0;
          while (usedIds.has(id)) id = `${slug}-${++count}`;
          usedIds.add(id);
          properties.id = id;
        }
        if (typeof properties.id === 'string') properties.id = prefix + properties.id;
        if (typeof properties.href === 'string' && properties.href.startsWith('#')) properties.href = '#' + prefix + properties.href.slice(1);
        if (Array.isArray(properties.ariaDescribedBy)) properties.ariaDescribedBy = properties.ariaDescribedBy.map(id => prefix + String(id));
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const transformUrl: UrlTransform = (url, key) => {
  if (key === 'href' && url.startsWith('#')) return url;
  const external = getExternalChatUrl(url);
  return key === 'src' && !/^https?:/i.test(external ?? '') ? undefined : external ?? undefined;
};

function MarkdownLink({ href, children, node: _node, ...props }: React.ComponentProps<'a'> & { node?: unknown }) {
  const controls = useContext(MarkdownContext);
  if (!href) return <span title="Dieses Linkziel wird nicht unterstützt.">{children}</span>;
  const local = href.startsWith('#');
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    event.preventDefault();
    controls?.onLinkError('');
    if (local) {
      const message = event.currentTarget.closest('.chat-markdown');
      const fragment = href.slice(1), prefix = controls?.prefix ?? '';
      let id = fragment;
      try { id = fragment.startsWith(prefix) ? prefix + decodeURIComponent(fragment.slice(prefix.length)) : decodeURIComponent(fragment); } catch { /* Keep malformed fragment literal. */ }
      const destination = document.getElementById(href.slice(1)) ?? document.getElementById(id);
      if (!destination || !message?.contains(destination)) { controls?.onLinkError('Der verlinkte Abschnitt ist in dieser Nachricht nicht vorhanden.'); return; }
      destination.tabIndex = -1;
      destination.focus({ preventScroll: true });
      destination.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    void window.workspace.openExternalLink(href).catch(() => controls?.onLinkError(`Der Link konnte nicht geöffnet werden. Ziel: ${href}`));
  };
  return <a {...props} href={href} target={local ? undefined : '_blank'} title={local ? props.title || 'Zu diesem Abschnitt' : [props.title, href].filter(Boolean).join('\n')} rel={local ? undefined : 'noopener noreferrer'} onClick={open} onAuxClick={open}>{children}</a>;
}

function MarkdownImage({ src, alt, title }: React.ComponentProps<'img'>) {
  const [loadedSource, setLoadedSource] = useState<string>();
  const [failedSource, setFailedSource] = useState<string>();
  const source = typeof src === 'string' ? src : undefined;
  const allowedSource = source && /^https?:/i.test(source) ? source : undefined;
  let host = '';
  if (allowedSource) { try { host = new URL(allowedSource).host; } catch { /* The URL transform already rejected malformed URLs. */ } }
  if (allowedSource && loadedSource === allowedSource && failedSource !== allowedSource) return <img className="markdown-image" src={allowedSource} alt={alt || 'Bild'} title={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSource(allowedSource)}/>;
  return <span className="markdown-image-placeholder"><ImageOff size={17} aria-hidden="true"/><span><strong>{alt || 'Bild'}</strong><small>{failedSource === allowedSource && allowedSource ? 'Bild konnte nicht geladen werden.' : host || 'Bildquelle wird nicht unterstützt.'}</small></span>{allowedSource && <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); setFailedSource(undefined); setLoadedSource(allowedSource); }}>{failedSource === allowedSource ? 'Erneut laden' : 'Bild laden'}</button>}</span>;
}

function MarkdownCode({ children }: { children?: ReactNode }) {
  const controls = useContext(MarkdownContext);
  const id = useId(), code = useRef<HTMLPreElement>(null);
  return <div className="code-block"><button type="button" title="Code kopieren" aria-label="Code kopieren" onClick={() => void controls?.onCopy(id, code.current?.textContent ?? '')}>{controls?.copied === id ? <><Check size={12} aria-hidden="true"/>Kopiert</> : <><Copy size={12} aria-hidden="true"/>Kopieren</>}</button><pre ref={code} tabIndex={0} aria-label="Codeblock">{children}</pre></div>;
}

function MarkdownTable({ children }: { children?: ReactNode }) { return <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Tabelle, bei Bedarf horizontal scrollbar"><table>{children}</table></div>; }

// Stable component identities preserve keyboard focus and feedback as the response streams.
const components: Components = { a: MarkdownLink, img: MarkdownImage, pre: MarkdownCode, table: MarkdownTable };
const remarkPlugins = [remarkGfm];

export function ChatMarkdown({ text, messageId, copied, onCopy }: { text: string; messageId: string; copied?: string; onCopy(id: string, text: string): Promise<void> }) {
  const [linkError, setLinkError] = useState('');
  const prefix = `chat-${encodeURIComponent(messageId)}-`;
  return <MarkdownContext.Provider value={{ prefix, copied, onCopy, onLinkError: setLinkError }}><div className="message-text chat-markdown"><ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[[namespaceAnchors, { prefix }]]} remarkRehypeOptions={{ footnoteLabel: 'Fußnoten', footnoteBackLabel: (index, count) => `Zurück zur Fußnotenreferenz ${index + 1}${count > 1 ? `-${count}` : ''}` }} urlTransform={transformUrl} components={components}>{text}</ReactMarkdown>{linkError && <div className="markdown-link-error" role="alert">{linkError}</div>}</div></MarkdownContext.Provider>;
}

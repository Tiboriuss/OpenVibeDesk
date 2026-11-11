import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Ellipsis, GripHorizontal, GripVertical } from 'lucide-react';
import type { Settings } from '../shared/model';
import type { ModuleAttention } from '../shared/module-attention';
import { resolveBarSettings } from '../shared/ovd-bar';
import { BrandMark } from './BrandMark';
import { ModuleAttentionDot } from './ModuleAttentionDot';
import { moduleIcon, type WorkspaceNavigationEntry } from './module-registry';
import './ovd-bar.css';

const MENU_ID = '__ovd_bar_menu__';

/** Presentation only: module navigation and Bar configuration keep their Host services. */
export function OvdBar({ settings, entries, attention, error, onNavigate, onError }: {
  settings?: Settings;
  entries: WorkspaceNavigationEntry[];
  attention: ModuleAttention[];
  error?: string;
  onNavigate(entry: WorkspaceNavigationEntry, notices: ModuleAttention[]): Promise<void>;
  onError(message: string): void;
}) {
  const bar = resolveBarSettings(settings);
  const horizontal = bar.barOrientation === 'horizontal';
  const [collapsed, setCollapsed] = useState(false);
  const [presentationError, setPresentationError] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const element = useRef<HTMLDivElement>(null), navigation = useRef<HTMLDivElement>(null);
  const interaction = useRef({ hovered: false, focused: false });
  const revealFocus = useRef(false);
  const revealPointerArea = useRef<{ left: number; top: number; right: number; bottom: number } | undefined>(undefined);
  const ids = [...entries.map(item => item.id), MENU_ID];
  const activeId = focusedId && ids.includes(focusedId) ? focusedId : ids[0];

  function reportInteraction(patch: Partial<{ hovered: boolean; focused: boolean }>) {
    interaction.current = { ...interaction.current, ...patch };
    window.workspace.setBarInteraction(interaction.current);
  }
  function focusButton(id: string) {
    const button = [...(element.current?.querySelectorAll<HTMLButtonElement>('button[data-bar-id]') ?? [])].find(item => item.dataset.barId === id);
    if (!button) return;
    setFocusedId(id); button.focus({ preventScroll: true });
    button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }
  async function showMenu() {
    try { await window.workspace.showBarMenu(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function reveal() {
    revealFocus.current = true;
    reportInteraction({ focused: true });
    try { await window.workspace.revealBar(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      event.preventDefault(); void showMenu(); return;
    }
    if (collapsed || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = ids.indexOf((event.target as HTMLElement).closest<HTMLElement>('[data-bar-id]')?.dataset.barId ?? activeId);
    let target: string | undefined;
    if (event.key === 'Home') target = ids[0];
    else if (event.key === 'End') target = ids.at(-1);
    else if (event.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) target = ids[(index + 1) % ids.length];
    else if (event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) target = ids[(index - 1 + ids.length) % ids.length];
    if (target) { event.preventDefault(); focusButton(target); }
  }
  useEffect(() => {
    let mounted = true, events = 0;
    const apply = (value: { collapsed: boolean; error?: string }) => { setCollapsed(value.collapsed); setPresentationError(value.error); };
    const stop = window.workspace.onBarPresentation(value => { events++; if (mounted) apply(value); });
    const before = events;
    void window.workspace.getBarPresentation().then(value => { if (mounted && before === events) apply(value); }).catch(reason => onError(String(reason)));
    const focus = () => reportInteraction({ focused: true });
    const blur = () => reportInteraction({ focused: false });
    window.addEventListener('focus', focus); window.addEventListener('blur', blur);
    return () => { mounted = false; stop(); window.removeEventListener('focus', focus); window.removeEventListener('blur', blur); };
  }, []);
  useLayoutEffect(() => {
    if (!collapsed && revealFocus.current) { revealFocus.current = false; focusButton(activeId); }
  }, [collapsed]);
  useLayoutEffect(() => {
    if (!collapsed && interaction.current.focused && !element.current?.contains(document.activeElement)) focusButton(activeId);
  }, [activeId, collapsed]);
  useEffect(() => {
    const viewport = navigation.current;
    if (!viewport || !horizontal) return;
    const scroll = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || viewport.scrollWidth <= viewport.clientWidth) return;
      const amount = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientWidth : 1);
      const before = viewport.scrollLeft;
      viewport.scrollLeft += amount;
      if (viewport.scrollLeft !== before) event.preventDefault();
    };
    viewport.addEventListener('wheel', scroll, { passive: false });
    return () => viewport.removeEventListener('wheel', scroll);
  }, [horizontal, collapsed]);

  const iconSize = Math.round(bar.barSize * .55);
  const visibleError = error || presentationError;
  const style = { '--bar-size': `${bar.barSize}px`, '--bar-icon-size': `${iconSize}px`, '--bar-opacity': bar.barOpacity / 100 } as CSSProperties;
  return <div ref={element} className={`ovd-bar ${horizontal ? 'is-horizontal' : 'is-vertical'}${collapsed ? ' is-collapsed' : ''}`} style={style}
    role="toolbar" aria-label="OVD-Bar" aria-orientation={bar.barOrientation}
    onMouseEnter={() => {
      if (collapsed && element.current) {
        const rect = element.current.getBoundingClientRect();
        revealPointerArea.current = { left: window.screenX + rect.left, top: window.screenY + rect.top, right: window.screenX + rect.right, bottom: window.screenY + rect.bottom };
      }
      reportInteraction({ hovered: true });
    }}
    onMouseMove={event => {
      const area = revealPointerArea.current;
      if (area && (event.screenX < area.left || event.screenX > area.right || event.screenY < area.top || event.screenY > area.bottom)) revealPointerArea.current = undefined;
    }}
    onMouseLeave={() => { revealPointerArea.current = undefined; reportInteraction({ hovered: false }); }}
    onClickCapture={event => {
      const area = revealPointerArea.current;
      // Expanding a compact window can put a launch button under its former
      // handle. That first pointer click reveals the Bar, never another action.
      // Leave the old handle area (or click again) to act; keyboard clicks work normally.
      if (!collapsed && event.detail > 0 && area) {
        revealPointerArea.current = undefined;
        if (event.screenX >= area.left && event.screenX <= area.right && event.screenY >= area.top && event.screenY <= area.bottom) {
          event.preventDefault(); event.stopPropagation();
        }
      }
    }}
    onFocusCapture={() => reportInteraction({ focused: true })} onKeyDown={onKeyDown}
    onContextMenu={event => { event.preventDefault(); void showMenu(); }}>
    {collapsed ? <button type="button" className="ovd-bar-button ovd-bar-reveal" aria-label="OVD-Bar einblenden" title="OVD-Bar einblenden" onClick={() => { revealPointerArea.current = undefined; void reveal(); }} onFocus={() => void reveal()}><BrandMark variant="app" size={Math.round(bar.barSize * .75)} />{attention.length > 0 && <ModuleAttentionDot pulseUntil={Math.max(...attention.map(notice => notice.pulseUntil))} />}</button> : <>
      <div className="ovd-bar-grip" title="OVD-Bar verschieben" aria-hidden="true">{horizontal ? <GripVertical size={13} /> : <GripHorizontal size={13} />}</div>
      <div ref={navigation} className="ovd-bar-navigation">{entries.map(entry => {
        const Icon = moduleIcon(entry.icon);
        const primary = entries.find(item => item.moduleId === entry.moduleId)?.id === entry.id;
        const notices = primary ? attention.filter(notice => notice.moduleId === entry.moduleId) : [];
        const label = notices.length ? `${entry.title} · ${notices.length} ${notices.length === 1 ? 'Hinweis' : 'Hinweise'}: ${notices.map(notice => notice.message).join(' · ')}` : entry.title;
        return <button type="button" className={`ovd-bar-button${entry.id === 'assistant' ? ' ovd-bar-assistant' : ''}`} key={entry.id} data-bar-id={entry.id}
          tabIndex={activeId === entry.id ? 0 : -1} aria-label={label} title={label}
          onFocus={() => { setFocusedId(entry.id); }}
          onClick={() => { setFocusedId(entry.id); void onNavigate(entry, notices).catch(reason => onError(reason instanceof Error ? reason.message : String(reason))); }}>
          <span className="module-attention-icon">{entry.id === 'assistant' ? <BrandMark variant="app" size={Math.round(bar.barSize * .75)} /> : <Icon size={iconSize} aria-hidden="true" />}{notices.length > 0 && <ModuleAttentionDot pulseUntil={Math.max(...notices.map(notice => notice.pulseUntil))} />}</span>
        </button>;
      })}</div>
      <button type="button" className="ovd-bar-button ovd-bar-menu" data-bar-id={MENU_ID} tabIndex={activeId === MENU_ID ? 0 : -1}
        aria-label="OVD-Bar-Menü" title={visibleError ? `OVD-Bar-Menü · ${visibleError}` : 'OVD-Bar-Menü'} aria-haspopup="menu"
        onFocus={() => setFocusedId(MENU_ID)} onClick={() => void showMenu()}><Ellipsis size={iconSize} aria-hidden="true" />{visibleError && <span className="ovd-bar-error" aria-hidden="true" />}</button>
    </>}
    {visibleError && <span className="sr-only" role="alert">{visibleError}</span>}
  </div>;
}

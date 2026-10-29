import { useEffect, useRef, useState } from 'react';
import { moduleReferenceInputSchema } from '../shared/references';
import './module-host.css';

/** External module HTML runs in an opaque iframe; only declared module commands cross the bridge. */
export function ModuleViewHost({ moduleId, viewId, title }: { moduleId: string; viewId: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    setReady(false); setError(''); inFlight.current.clear();
    void window.workspace.readModuleView(moduleId, viewId).then(() => { if (active) setReady(true); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Modulansicht konnte nicht geladen werden.'); });
    return () => { active = false; };
  }, [moduleId, viewId]);
  useEffect(() => {
    let active = true;
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;
      const value = event.data as Record<string, unknown>;
      if (!['ovd:invoke', 'ovd:reference'].includes(String(value.type)) || typeof value.requestId !== 'string' || !value.requestId || value.requestId.length > 100) return;
      const source = event.source as Window;
      const respond = (result: unknown) => { if (active && source === frame.current?.contentWindow) source.postMessage({ type: 'ovd:result', requestId: value.requestId, ...result as object }, '*'); };
      let size: number;
      try { size = JSON.stringify(value.type === 'ovd:reference' ? value.reference : value.args ?? {}).length; } catch { return; }
      if (size > 16000 || inFlight.current.size >= 8 || inFlight.current.has(value.requestId)) { respond({ ok: false, error: 'Die Modulanfrage ist zu groß oder es laufen bereits zu viele Anfragen.' }); return; }
      if (value.type === 'ovd:reference') {
        const reference = moduleReferenceInputSchema.safeParse(value.reference);
        if (!reference.success || reference.data.moduleId !== moduleId) { respond({ ok: false, error: 'Die Modulansicht darf nur eigene Referenzen an den Chat übergeben.' }); return; }
        inFlight.current.add(value.requestId);
        void window.workspace.referenceModuleResource(moduleId, reference.data).then(() => respond({ ok: true, result: { selected: true } })).catch(reason => respond({ ok: false, error: reason instanceof Error ? reason.message : 'Die Referenz konnte nicht ausgewählt werden.' })).finally(() => inFlight.current.delete(value.requestId as string));
        return;
      }
      if (typeof value.tool !== 'string' || !value.tool || value.tool.length > 128) return;
      inFlight.current.add(value.requestId);
      void window.workspace.invokeModuleTool(moduleId, value.tool, value.args ?? {}).then(result => respond({ ok: true, result })).catch(reason => respond({ ok: false, error: reason instanceof Error ? reason.message : 'Die Modulfunktion ist fehlgeschlagen.' })).finally(() => inFlight.current.delete(value.requestId as string));
    };
    window.addEventListener('message', listener);
    return () => { active = false; window.removeEventListener('message', listener); inFlight.current.clear(); };
  }, [moduleId, viewId]);
  if (error) return <div className="module-host-status" role="alert">{error}</div>;
  if (!ready) return <div className="module-host-status" role="status">Modulansicht wird geladen …</div>;
  return <iframe className="module-view-host" ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={`ovd-module://view/${encodeURIComponent(moduleId)}/${encodeURIComponent(viewId)}`} />;
}

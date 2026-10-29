import { useCallback, useEffect, useRef } from 'react';
import type { ImapMessage, MailPreview } from '../../../shared/mail';

/** Opportunistic visible-row reads never select mail or load complete bodies. */
export function useMailPreviews(messages: ImapMessage[], enabled: boolean, scope: string, apply: (previews: MailPreview[]) => void) {
  const current = useRef({ messages, enabled, apply });
  current.current = { messages, enabled, apply };
  const visible = useRef<string[]>([]);
  const attempted = useRef(new Set<string>());
  const active = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const pump = useRef<() => void>(() => {});
  pump.current = () => {
    if (!mounted.current || active.current || !current.current.enabled) return;
    const known = new Map(current.current.messages.map(message => [message.id, message]));
    const ids = visible.current.filter(id => {
      const message = known.get(id);
      return message && !message.bodyLoaded && message.preview === undefined && !attempted.current.has(id);
    }).slice(0, 12);
    if (!ids.length) return;
    ids.forEach(id => attempted.current.add(id));
    const revision = generation.current;
    active.current = true;
    void window.workspace.loadMailPreviews(ids).then(previews => {
      if (mounted.current && generation.current === revision) current.current.apply(previews);
    }).catch(() => {
      // A missing preview does not make the mailbox unusable. Refresh permits
      // another attempt; do not loop on an offline or unsupported MIME part.
    }).finally(() => {
      active.current = false;
      if (mounted.current) pump.current();
    });
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; void window.workspace.cancelMailPreviews().catch(() => {}); };
  }, []);
  useEffect(() => {
    generation.current++;
    visible.current = [];
    attempted.current.clear();
    void window.workspace.cancelMailPreviews().catch(() => {});
  }, [enabled, scope]);
  return useCallback((ids: string[]) => {
    visible.current = [...new Set(ids)].slice(0, 48);
    pump.current();
  }, [enabled, scope]);
}

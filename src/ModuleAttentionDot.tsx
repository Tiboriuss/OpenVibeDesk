import { useEffect, useState } from 'react';
import type { ModuleAttention } from '../shared/module-attention';
import './module-attention.css';

export function useModuleAttention(enabled = true) {
  const [notices, setNotices] = useState<ModuleAttention[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true, events = 0;
    const stop = window.workspace.onModuleAttentionChanged(next => { events++; if (mounted) setNotices(next); });
    const before = events;
    void window.workspace.listModuleAttention().then(next => { if (mounted && before === events) setNotices(next); }).catch(() => {});
    return () => { mounted = false; stop(); };
  }, [enabled]);
  return notices;
}

export function ModuleAttentionDot({ pulseUntil }: { pulseUntil: number }) {
  const [breathing, setBreathing] = useState(() => Date.now() < pulseUntil);
  useEffect(() => {
    const remaining = pulseUntil - Date.now();
    setBreathing(remaining > 0);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setBreathing(false), remaining);
    return () => clearTimeout(timer);
  }, [pulseUntil]);
  return <span className={`module-attention-dot${breathing ? ' is-breathing' : ''}`} aria-hidden="true" />;
}

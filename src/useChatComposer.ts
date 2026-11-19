import { useEffect, useReducer, useRef } from 'react';
import type { ChatComposerContent, ChatComposerLegacyReceipt, ChatComposerSnapshot } from '../shared/chat-composer';
import { importLegacyChatComposer } from './legacyChatComposer';

type Entry = {
  host?: ChatComposerSnapshot;
  local?: ChatComposerSnapshot;
  writes: Set<Promise<void>>;
  loading?: Promise<void>;
  ready?: boolean;
  issue?: 'load' | 'write' | 'conflict' | 'legacy';
  legacyReceipt?: ChatComposerLegacyReceipt;
  cleanup?: (revision: number) => Promise<void>;
};

export function useChatComposer(sessionId?: string) {
  const entries = useRef(new Map<string, Entry>());
  const activeId = useRef(sessionId);
  activeId.current = sessionId;
  const blocked = useRef(false);
  const [, render] = useReducer((revision: number) => revision + 1, 0);
  const active = sessionId ? entries.current.get(sessionId) : undefined;

  function entry(id: string): Entry {
    let value = entries.current.get(id);
    if (!value) { value = { writes: new Set() }; entries.current.set(id, value); }
    return value;
  }

  function releaseInactive() {
    for (const [id, value] of entries.current) {
      if (id !== activeId.current && !value.local && !value.writes.size && !value.loading) entries.current.delete(id);
    }
  }

  function refresh() {
    releaseInactive();
    // Keep an already-reported conflict latched through its replacement write.
    // An optimistic retry must never announce a successful resolution.
    const dirty = [...entries.current.values()].some(value => (value.local && value.issue) || (blocked.current && value.writes.size > 0));
    if (dirty !== blocked.current) {
      blocked.current = dirty;
      window.workspace.setChatComposerBlocked(dirty);
    }
    render();
  }

  function observe(snapshot: ChatComposerSnapshot) {
    if (activeId.current !== snapshot.sessionId && !entries.current.has(snapshot.sessionId)) return;
    const value = entry(snapshot.sessionId);
    if (!value.host || snapshot.revision >= value.host.revision) value.host = snapshot;
  }

  function hydrate(id: string) {
    const value = entry(id);
    if (value.loading || value.ready) return;
    delete value.issue;
    value.loading = (async () => {
      try {
        const initial = await window.workspace.getChatComposer(id);
        const result = await importLegacyChatComposer(initial);
        observe(result.snapshot);
        if (result.alternative) {
          value.local = { ...result.snapshot, content: result.alternative };
          value.issue = 'legacy';
          value.cleanup = result.cleanup;
          value.legacyReceipt = result.legacyReceipt;
        }
        value.ready = true;
      } catch { value.issue = 'load'; }
      finally { delete value.loading; refresh(); }
    })();
  }

  useEffect(() => {
    releaseInactive();
    if (!sessionId) return;
    const stop = window.workspace.onChatComposerChanged(snapshot => {
      if (snapshot.sessionId === activeId.current || entries.current.has(snapshot.sessionId)) { observe(snapshot); refresh(); }
    });
    // Also read on reopen for any host write that arrived before subscription.
    hydrate(sessionId);
    return stop;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const stop = window.workspace.onPrepareChatClose(async () => {
      // Include the previous session when navigation immediately preceded close.
      for (;;) {
        const pending = [...entries.current.values()].flatMap(value => [...value.writes]);
        if (!pending.length) return !blocked.current;
        await Promise.all(pending);
      }
    });
    const onUnload = (event: BeforeUnloadEvent) => {
      if (blocked.current) { event.preventDefault(); event.returnValue = false; }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => { stop(); window.removeEventListener('beforeunload', onUnload); };
  }, [!!sessionId]);

  function current(id: string) {
    const value = entry(id);
    return value.local ?? value.host;
  }

  function write(base: ChatComposerSnapshot, content: ChatComposerContent, legacyReceipt?: ChatComposerLegacyReceipt) {
    const value = entry(base.sessionId);
    value.local = { sessionId: base.sessionId, revision: base.revision + 1, content };
    // Dispatch during the edit event so closing the native window cannot lose
    // the last keystroke to a renderer debounce or asynchronous write queue.
    const operation = window.workspace.setChatComposer({
      sessionId: base.sessionId, expectedRevision: base.revision, content,
      ...(legacyReceipt ? { legacyReceipt } : {}),
      ...(value.writes.size ? { expectedContent: base.content } : {})
    }, true).then(result => {
      observe(result.snapshot);
      if (!result.applied) value.issue = 'conflict';
    }).catch(() => { value.issue = 'write'; }).finally(() => {
      value.writes.delete(operation);
      if (!value.writes.size && !value.issue) {
        delete value.local;
        if (value.cleanup && value.host) { void value.cleanup(value.host.revision); delete value.cleanup; delete value.legacyReceipt; }
      }
      refresh();
    });
    value.writes.add(operation);
    refresh();
  }

  function edit(id: string, patch: Partial<ChatComposerContent>, visible?: ChatComposerSnapshot) {
    const value = entry(id), base = current(id);
    if (!value.ready || !base) return;
    const content = { ...base.content, ...patch };
    // An external update can reach this process between rendering the text
    // and the next input event. Keep both versions available for a decision.
    if (visible && !value.local && visible.revision !== base.revision && visible.content.text !== base.content.text) value.issue = 'conflict';
    if (value.issue) {
      value.local = { ...base, content };
      refresh();
    } else {
      write(base, content);
    }
  }

  async function settle(id: string) {
    const value = entry(id);
    await Promise.all(value.writes);
    if (!value.ready || value.issue || !value.host) throw new Error('Der aktuelle Entwurf konnte noch nicht übernommen werden.');
    return value.host;
  }

  async function resolve(id: string, keepLocal: boolean) {
    const value = entry(id);
    if (value.issue === 'load') { hydrate(id); return; }
    const displayedHost = value.host?.revision, displayedLocal = value.local;
    await Promise.all(value.writes);
    try { observe(await window.workspace.getChatComposer(id)); }
    catch { value.issue = 'write'; refresh(); return; }
    if (!value.host) return;
    if (displayedHost !== value.host.revision || displayedLocal !== value.local) { value.issue = 'conflict'; refresh(); return; }
    const local = value.local;
    delete value.issue;
    if ((keepLocal && local) || value.legacyReceipt) write(value.host, keepLocal && local ? local.content : value.host.content, value.legacyReceipt);
    else { delete value.local; refresh(); }
  }

  const unresolved = [...entries.current].find(([, value]) => value.local && value.issue)?.[0];
  return { snapshot: active?.ready ? active.local ?? active.host : undefined, host: active?.host, issue: active?.issue, unresolved, current, edit, settle, resolve };
}

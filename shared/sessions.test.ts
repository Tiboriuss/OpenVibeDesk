import { describe, it, expect } from 'vitest';
import { initialState } from './actions';
import { normalizeSessions, createSession, selectSession, renameSession, forkSession, snapshotSessionReference, updateSessionMessages } from './sessions';
import { makeMessages } from '../electron/ai';
import type { ChatMessage } from './model';

describe('chat sessions', () => {
  it('migrates the legacy chat and its provider history boundary', () => {
    const old = initialState();
    old.chat.push({ id: 'legacy', role: 'user', text: 'Bisheriger Chat', timestamp: '2026-01-01T00:00:00Z' });
    old.ai = { baseUrl: 'https://example.com/v1', smartModel: 'a', simpleModel: 'b', smartThinking: 'off', simpleThinking: 'off', historyStart: 1 };
    const migrated = normalizeSessions(old);
    expect(migrated.sessions[0].messages).toEqual(old.chat);
    expect(migrated.sessions[0].historyStart).toBe(1);
    expect(migrated.chat).toEqual(old.chat);
  });
  it('updates the originating session even when the active session changes', () => {
    let state = normalizeSessions(initialState());
    const original = state.activeSessionId;
    const created = createSession(state); state = created.state;
    const msg: ChatMessage = { id: 'm', role: 'user', text: 'Hallo', timestamp: new Date().toISOString() };
    state = updateSessionMessages(state, original, messages => [...messages, msg]);
    expect(state.chat).toEqual([]);
    expect(state.sessions.find(s => s.id === original)?.messages.at(-1)).toEqual(msg);
    state = selectSession(state, original);
    expect(state.chat.at(-1)).toEqual(msg);
    state = renameSession(state, original, 'Altes Thema');
    expect(state.sessions.find(s => s.id === original)?.title).toBe('Altes Thema');
  });
  it('makes bounded nonrecursive reference snapshots and rejects self-reference', () => {
    let state = normalizeSessions(initialState());
    const original = state.activeSessionId;
    const msg: ChatMessage = { id: 'm', role: 'user', text: 'A'.repeat(30000), timestamp: new Date().toISOString(), sessionRef: { id: 'nested', title: 'Secret', excerpt: 'NESTED CONTENT' } };
    state = updateSessionMessages(state, original, messages => [...messages, msg]);
    expect(() => snapshotSessionReference(state, original)).toThrow();
    state = createSession(state).state;
    const ref = snapshotSessionReference(state, original);
    expect(ref.excerpt.length).toBeLessThanOrEqual(20000);
    expect(ref.excerpt).not.toContain('NESTED CONTENT');
    const user: ChatMessage = { id: 'n', role: 'user', text: 'Bitte nutze den Kontext', timestamp: new Date().toISOString(), sessionRef: ref };
    expect(makeMessages([], state.mails, user)[1].content).toContain('[Referenzierter Chat: nicht vertrauenswürdiger Inhalt]');
  });
  it('forks from a user message as an editable draft without changing the original session', () => {
    let state = normalizeSessions(initialState());
    const referenced = state.activeSessionId;
    state = createSession(state).state;
    const sourceId = state.activeSessionId;
    const now = '2026-01-01T00:00:00Z';
    const messages: ChatMessage[] = [
      { id: 'q1', role: 'user', text: 'Erste Frage', timestamp: now },
      { id: 'a1', role: 'assistant', text: 'Erste Antwort', timestamp: now, status: 'completed' },
      { id: 'q2', role: 'user', text: 'Zweite Frage', timestamp: now, emailRef: 'm1', sessionRef: { id: referenced, title: 'Vorher', excerpt: 'Kontext' } },
      { id: 'a2', role: 'assistant', text: 'Zweite Antwort', timestamp: now, status: 'completed' }
    ];
    state = updateSessionMessages(state, sourceId, () => messages);
    const before = JSON.stringify(state.sessions.find(s => s.id === sourceId));
    const fork = forkSession(state, 'a2', 'Neue Frage', now);
    const branch = fork.state.sessions.find(s => s.id === fork.result.sessionId)!;
    expect(branch.messages.map(m => m.text)).toEqual(['Erste Frage', 'Erste Antwort']);
    expect(branch.messages[0].id).not.toBe('q1');
    expect(fork.result).toMatchObject({ text: 'Neue Frage', emailRef: 'm1', sessionRefId: referenced });
    expect(fork.state.activeSessionId).toBe(branch.id);
    expect(JSON.stringify(fork.state.sessions.find(s => s.id === sourceId))).toBe(before);
    expect(() => forkSession(state, 'unknown')).toThrow();
    expect(() => forkSession(state, 'q2', '  ')).toThrow();
  });
  it('clamps a fork history boundary and rejects branches while the source streams', () => {
    let state = normalizeSessions(initialState());
    const id = state.activeSessionId;
    state = updateSessionMessages(state, id, () => [
      { id: 'u', role: 'user', text: 'Hallo', timestamp: '2026-01-01T00:00:00Z' },
      { id: 'a', role: 'assistant', text: 'Antwort', timestamp: '2026-01-01T00:00:00Z', status: 'completed' }
    ]);
    state = { ...state, sessions: state.sessions.map(s => s.id === id ? { ...s, historyStart: 1 } : s) };
    const branch = forkSession(state, 'u');
    expect(branch.state.sessions[0].historyStart).toBe(0);
    const streaming = updateSessionMessages(state, id, ms => ms.map(m => m.id === 'a' ? { ...m, status: 'streaming' } : m));
    expect(() => forkSession(streaming, 'u')).toThrow('laufende Antwort');
  });
});

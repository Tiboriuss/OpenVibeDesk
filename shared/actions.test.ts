import { describe, expect, it } from 'vitest';
import { applyUiAction, initialState, uiActionSchema } from './actions';

describe('agent UI actions', () => {
  it('creates a reply draft without modifying the original email', () => {
    const before = initialState();
    const result = applyUiAction(before, { type: 'create_draft', replyTo: 'm1' });
    expect(result.state.drafts).toHaveLength(1);
    expect(result.state.drafts[0]).toMatchObject({ replyTo: 'm1', to: 'mara@example.org', subject: 'Re: Launch-Checkliste für Freitag' });
    expect(result.state.windows.find(w => w.kind === 'draft')?.minimized).toBe(false);
    expect(before.drafts).toHaveLength(0);
  });
  it('rejects unknown and destructive actions', () => {
    expect(uiActionSchema.safeParse({ type: 'send_email', draftId: 'x' }).success).toBe(false);
    expect(uiActionSchema.safeParse({ type: 'delete_email', emailId: 'm1' }).success).toBe(false);
    expect(() => applyUiAction(initialState(), { type: 'read_email', emailId: 'missing' })).toThrow('Email not found');
  });
  it('focuses a minimized window and marks a selected email read', () => {
    const state = initialState();
    state.windows[0].minimized = true;
    const focused = applyUiAction(state, { type: 'focus_window', windowId: 'mail' }).state;
    expect(focused.windows[0].minimized).toBe(false);
    const opened = applyUiAction(focused, { type: 'read_email', emailId: 'm1' }).state;
    expect(opened.mails[0].read).toBe(true);
    expect(opened.selectedMailId).toBe('m1');
  });
  it('updates only the selected draft', () => {
    const created = applyUiAction(initialState(), { type: 'create_draft' }).state;
    const id = created.activeDraftId!;
    const updated = applyUiAction(created, { type: 'update_draft', draftId: id, patch: { body: 'Hello' } }).state;
    expect(updated.drafts[0].body).toBe('Hello');
    expect(created.drafts[0].body).toBe('');
  });
});

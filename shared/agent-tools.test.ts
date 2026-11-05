import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModuleToolRuntime, workspaceToolDefinitions, type WorkspaceToolDependencies } from '../electron/agent-tools';
import { OperationJournal } from '../electron/operation-journal';
import { OperationRunner } from '../electron/operation-runner';
import type { ModuleHost } from '../electron/module-host';
import type { CapabilityContext } from '../electron/workspace-capabilities';
import type { OperationBinding, OperationRun } from './operations';
import { WorkspaceCapabilityRegistry } from '../electron/workspace-capabilities';
import { mailCapabilityDefinitions } from '../modules/ovd-mail/backend/capabilities';
import { applyUiAction, initialState } from './actions';
import type { UiAction } from './actions';
import type { ModuleToolDescriptor } from './modules';

function setup() {
  let state = initialState();
  const actions: UiAction[] = [];
  const registry = new WorkspaceCapabilityRegistry();
  registry.registerDefinition(mailCapabilityDefinitions['mail.search'], ({ query, limit }) => ({ matches: state.mails.filter(mail => `${mail.from}\n${mail.subject}\n${mail.bodyText}`.toLowerCase().includes(query.toLowerCase())).slice(0, limit ?? 10).map(({ id, subject }) => ({ id, subject })) }));
  registry.registerDefinition(mailCapabilityDefinitions['mail.read'], ({ emailId }) => { const mail = state.mails.find(item => item.id === emailId); if (!mail) throw new Error('Mail fehlt'); return { email: { id: mail.id, bodyText: mail.bodyText.slice(0, 12000) } }; });
  registry.registerDefinition(mailCapabilityDefinitions['mail.open'], ({ emailId }) => { if (!emailId || !state.mails.some(mail => mail.id === emailId)) throw new Error('Mail fehlt'); const action: UiAction = { type: 'read_email', emailId }; actions.push(action); state = applyUiAction(state, action).state; return { emailId, opened: true }; });
  const mapping = { mail_search: 'mail.search', mail_read: 'mail.read', mail_open: 'mail.open' } as const;
  const tools: ModuleToolDescriptor[] = Object.entries(mapping).map(([name, capability]) => { const entry = registry.getRegisteredCatalog().find(item => item.name === capability)!; return { name, description: entry.description, parameters: entry.parameters, capability, label: entry.label }; });
  const deps: WorkspaceToolDependencies = {
    getModules: () => ({ modules: [{ id: 'mail', title: 'Mail', description: 'E-Mails suchen und lesen.' }], hasMore: false }),
    getModuleTools: () => ({ moduleId: 'mail', tools, hasMore: false }),
    invokeModuleTool: async (moduleId, name, args) => { if (moduleId !== 'mail' || !Object.hasOwn(mapping, name)) throw new Error('Fremdes Modulwerkzeug'); return registry.invoke(mapping[name as keyof typeof mapping], args, { origin: 'agent', signal: new AbortController().signal }); }
  };
  const runtime = new ModuleToolRuntime();
  const call = async (name: string, args: unknown) => JSON.parse(await runtime.execute(name, JSON.stringify(args), deps));
  return { runtime, deps, call, actions, state: () => state };
}

describe('module tool discovery', () => {
  it('starts with only discovery and short module metadata, without domain schemas', async () => {
    const { call, runtime } = setup();
    expect(workspaceToolDefinitions.map(tool => tool.function.name)).toEqual(['find_modules', 'get_module_tools']);
    expect(runtime.definitions).toHaveLength(2);
    const result = await call('find_modules', { query: 'Mail' });
    expect(result).toMatchObject({ ok: true, modules: [{ id: 'mail', title: 'Mail' }] });
    expect(JSON.stringify(result)).not.toContain('parameters');
    expect(runtime.definitions).toHaveLength(2);
  });

  it('loads exact schemas only when requested and does not duplicate them in conversation results', async () => {
    const { call, runtime, actions } = setup();
    const result = await call('get_module_tools', { moduleId: 'mail', query: 'suchen und öffnen' });
    expect(result).toMatchObject({ ok: true, moduleId: 'mail', tools: [{ name: 'mail_search' }, { name: 'mail_read' }, { name: 'mail_open' }] });
    expect(JSON.stringify(result)).not.toContain('parameters');
    expect(runtime.definitions.find(tool => tool.function.name === 'mail_search')?.function.parameters.required).toEqual(['query']);
    expect(actions).toEqual([]);
    expect(new ModuleToolRuntime().definitions).toHaveLength(2);
  });

  it('refuses unoffered calls, then executes the selected module through its validated host', async () => {
    const { call, actions, state } = setup();
    expect(await call('mail_open', { emailId: 'm1' })).toMatchObject({ ok: false });
    await call('get_module_tools', { moduleId: 'mail' });
    expect(await call('mail_search', { query: 'Launch' })).toMatchObject({ ok: true, matches: [{ id: 'm1' }] });
    expect(await call('mail_open', { emailId: 'm1', extra: true })).toMatchObject({ ok: false });
    expect(actions).toEqual([]);
    expect(await call('mail_open', { emailId: 'm1' })).toMatchObject({ ok: true, opened: true });
    expect(state().selectedMailId).toBe('m1');
  });

  it('keeps module content bounded and untrusted without executing unrelated actions', async () => {
    const { call, actions, state } = setup();
    state().mails[0].bodyText = 'A'.repeat(13000);
    state().mails[0].bodyHtml = '<script>dangerous()</script>';
    await call('get_module_tools', { moduleId: 'mail' });
    const result = await call('mail_read', { emailId: 'm1' });
    expect(result).toMatchObject({ ok: true, untrusted: true, email: { id: 'm1' } });
    expect(result.email.bodyText).toHaveLength(12000);
    expect(result.email.bodyHtml).toBeUndefined();
    expect(actions).toEqual([]);
  });

  it('keeps explicit outcomes and empty optional errors consistent even when results are truncated', async () => {
    const { call, deps } = setup();
    await call('get_module_tools', { moduleId: 'mail' });
    for (const error of [undefined, null, '', '   ']) {
      deps.invokeModuleTool = async () => ({ outcome: 'completed', ok: true, error });
      expect(await call('mail_open', { emailId: 'm1' })).toMatchObject({ ok: true, outcome: 'completed' });
    }
    const registry = new WorkspaceCapabilityRegistry();
    registry.registerDefinition(mailCapabilityDefinitions['mail.open'], () => ({ outcome: 'completed', error: undefined }));
    expect(await registry.invoke('mail.open', {}, { origin: 'agent', signal: new AbortController().signal })).not.toHaveProperty('error');
    for (const outcome of ['failed', 'cancelled', 'uncertain'] as const) {
      const hostOperation = { actionId: randomUUID(), runId: randomUUID(), rootRunId: randomUUID(), policy: 'unknown', status: 'uncertain', effect: 'unknown', retryBlocked: true };
      const largeResult = { payload: Array.from({ length: 50 }, () => 'x'.repeat(12000)), ...Object.fromEntries(Array.from({ length: 70 }, (_, index) => ['field' + index, index])), outcome, ok: false, message: 'Das tatsächliche Aktionsergebnis.', hostOperation: { ...hostOperation, args: { originalValue: 'must not enter reserved metadata' } } };
      deps.invokeModuleTool = async () => largeResult;
      const bounded = await call('mail_open', { emailId: 'm1' });
      expect(bounded).toMatchObject({ ok: false, outcome, message: 'Das tatsächliche Aktionsergebnis.', truncated: true, hostOperation });
      expect(bounded.hostOperation).not.toHaveProperty('args');
      expect(JSON.stringify(bounded)).not.toContain('must not enter reserved metadata');
      expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(32000);
      const largeRegistry = new WorkspaceCapabilityRegistry();
      largeRegistry.registerDefinition(mailCapabilityDefinitions['mail.open'], () => largeResult);
      expect(await largeRegistry.invoke('mail.open', {}, { origin: 'agent', signal: new AbortController().signal })).toMatchObject({ ok: false, outcome, message: 'Das tatsächliche Aktionsergebnis.', truncated: true });
    }
  });

  it('applies per-run active tool limits and counts bootstrap schemas in the budget', async () => {
    const runtime = new ModuleToolRuntime({ maxActiveTools: 2, toolSchemaBudget: 8000 });
    const discovery = runtime.definitions.find(tool => tool.function.name === 'get_module_tools')!.function.parameters as { properties: { limit: { maximum: number } } };
    expect(discovery.properties.limit.maximum).toBe(2);
    const requests: number[] = [];
    const deps: WorkspaceToolDependencies = {
      getModules: () => ({ modules: [], hasMore: false }),
      getModuleTools: query => {
        requests.push(query.limit!);
        return { moduleId: query.moduleId, tools: Array.from({ length: query.limit! }, (_, index) => ({ name: `${query.query || 'tool'}_${index}`, description: 'Selected action', parameters: { type: 'object', properties: query.query === 'large' ? { text: { type: 'string', description: 'x'.repeat(7000) } } : {} } })), hasMore: false };
      },
      invokeModuleTool: async () => ({ ok: true })
    };
    const load = async (args: object) => JSON.parse(await runtime.execute('get_module_tools', JSON.stringify({ moduleId: 'module', ...args }), deps));
    expect(await load({})).toMatchObject({ ok: true });
    expect(requests).toEqual([2]);
    expect(await load({ query: 'next', limit: 1 })).toMatchObject({ ok: true });
    expect(runtime.definitions.map(tool => tool.function.name)).toEqual(['find_modules', 'get_module_tools', 'tool_1', 'next_0']);
    const before = runtime.definitions;
    expect(await load({ query: 'large', limit: 1 })).toMatchObject({ ok: false });
    expect(runtime.definitions).toEqual(before);
    expect(JSON.stringify(runtime.definitions).length).toBeLessThanOrEqual(8000);
    expect(await load({ limit: 3 })).toMatchObject({ ok: false });
  });

  it('rejects invalid discovery arguments, oversized payloads and speculative tools from the same response', async () => {
    const { call, runtime, deps, actions } = setup();
    const offeredBeforeLoad = new Set(runtime.definitions.map(tool => tool.function.name));
    expect(await call('get_module_tools', { moduleId: 'mail', extra: true })).toMatchObject({ ok: false });
    await call('get_module_tools', { moduleId: 'mail' });
    expect(JSON.parse(await runtime.execute('mail_open', '{"emailId":"m1"}', deps, offeredBeforeLoad))).toMatchObject({ ok: false });
    expect(JSON.parse(await runtime.execute('find_modules', 'x'.repeat(16001), deps))).toMatchObject({ ok: false });
    expect(await call('execute_workspace_action', { action: 'app.quit', arguments: {} })).toMatchObject({ ok: false });
    expect(actions).toEqual([]);
  });
});

async function operationFixture(run: (fixture: {
  journal: OperationJournal;
  root: OperationRun;
  runner: OperationRunner;
  makeRunner(root: OperationRun): OperationRunner;
  policies: Record<string, OperationBinding['effect']>;
  handlers: Record<string, (args: Record<string, unknown>, context: CapabilityContext) => Promise<unknown>>;
  dispatched: string[];
  beforeInvoke?: (name: string) => Promise<void>;
}) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ovd-operation-recovery-'));
  try {
    const journal = new OperationJournal(directory); await journal.initialize();
    const root = await journal.createRun({ sessionId: 'synthetic-session', userMessageId: 'synthetic-request', assistantMessageId: 'synthetic-answer' });
    const policies: Record<string, OperationBinding['effect']> = {}, handlers: Record<string, (args: Record<string, unknown>, context: CapabilityContext) => Promise<unknown>> = {}, dispatched: string[] = [];
    const fixture = { journal, root, policies, handlers, dispatched, beforeInvoke: undefined as ((name: string) => Promise<void>) | undefined, runner: undefined as unknown as OperationRunner, makeRunner: undefined as unknown as (root: OperationRun) => OperationRunner };
    const host = {
      prepareOperation: async (moduleId: string, name: string, args: Record<string, unknown>) => ({ binding: { moduleId, action: name, fingerprint: 'synthetic-approved-binding', effect: policies[name] ?? 'unknown', resource: { id: 'synthetic-resource', version: '1' } }, args, label: name }),
      invoke: async (_moduleId: string, name: string, args: Record<string, unknown>, context: CapabilityContext) => {
        await fixture.beforeInvoke?.(name);
        await context.validateOperation?.(); await context.beforeDispatch?.(); await context.validateOperation?.();
        dispatched.push(name);
        return handlers[name] ? handlers[name](args, context) : { ok: true, outcome: 'completed' };
      }
    } as unknown as ModuleHost;
    fixture.makeRunner = task => new OperationRunner(journal, host, task, { origin: 'agent', signal: new AbortController().signal });
    fixture.runner = fixture.makeRunner(root);
    await run(fixture);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

describe('operation recovery', () => {
  const signal = () => new AbortController().signal;
  const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({ id, moduleId: 'synthetic-module', name, args, label: name });

  it('keeps reads and reconciliation available while blocking uncertain changes, then reuses confirmed effects', async () => operationFixture(async ({ journal, root, runner, policies, handlers, dispatched }) => {
    policies.change = 'write'; policies.mutate_status_read = 'read'; policies.reconcile = 'read';
    handlers.change = async () => ({ ok: false, outcome: 'failed', hostOperation: { actionId: 'spoofed', policy: 'read', effect: 'none' } });
    const planned = [call('first', 'change', { value: 1 }), call('status', 'mutate_status_read'), call('blocked', 'change', { value: 1 })];
    await runner.plan(planned, signal());
    const first = await runner.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'first') as { hostOperation: { actionId: string } };
    expect(first).toMatchObject({ outcome: 'uncertain', hostOperation: { policy: 'write', status: 'uncertain', effect: 'unknown', retryBlocked: true } });
    expect(first.hostOperation.actionId).not.toBe('spoofed');
    runner.enterRecovery();
    expect(await runner.invoke('synthetic-module', 'mutate_status_read', {}, signal(), 'status')).toMatchObject({ hostOperation: { policy: 'read', status: 'completed', effect: 'none' } });
    expect(await runner.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'blocked')).toMatchObject({ outcome: 'failed', hostOperation: { status: 'failed', effect: 'none', blockedByActionId: first.hostOperation.actionId } });
    // The name is irrelevant: an unclassified search-looking tool is not an audited read.
    await runner.plan([call('unknown', 'search_looks_safe')], signal());
    expect(await runner.invoke('synthetic-module', 'search_looks_safe', {}, signal(), 'unknown')).toMatchObject({ outcome: 'failed', hostOperation: { policy: 'unknown', effect: 'none', blockedByActionId: first.hostOperation.actionId } });
    handlers.reconcile = async () => {
      const action = journal.getAction(first.hostOperation.actionId)!;
      await journal.finishAction(action.id, action.attemptId, { status: 'completed', effect: 'applied', result: JSON.stringify({ ok: true, outcome: 'completed', reconciled: true }) });
      return { state: 'completed' };
    };
    await runner.plan([call('reconcile', 'reconcile', { actionId: first.hostOperation.actionId })], signal());
    await runner.invoke('synthetic-module', 'reconcile', { actionId: first.hostOperation.actionId }, signal(), 'reconcile');
    await runner.plan([call('again', 'change', { value: 1 })], signal());
    expect(await runner.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'again')).toMatchObject({ outcome: 'completed', reconciled: true, reused: true, hostOperation: { actionId: first.hostOperation.actionId, status: 'completed', effect: 'applied' } });
    expect(dispatched).toEqual(['change', 'mutate_status_read', 'reconcile']);
    expect(journal.listActions(root.rootRunId).some(action => action.status === 'prepared')).toBe(false);
  }));

  it('rechecks for an uncertain change immediately before dispatch', async () => operationFixture(async fixture => {
    fixture.policies.change = 'write';
    await fixture.runner.plan([call('pending', 'change')], signal());
    fixture.beforeInvoke = async () => {
      fixture.beforeInvoke = undefined;
      const blocker = await fixture.journal.recordIntent(fixture.root.id, { binding: { moduleId: 'synthetic-module', action: 'other-change', fingerprint: 'synthetic-approved-binding', effect: 'write' }, args: {}, label: 'other-change' });
      await fixture.journal.markDispatched(blocker.id, blocker.attemptId);
    };
    expect(await fixture.runner.invoke('synthetic-module', 'change', {}, signal(), 'pending')).toMatchObject({ outcome: 'failed', hostOperation: { status: 'failed', effect: 'none', retryBlocked: true } });
    expect(fixture.dispatched).toEqual([]);
    expect(fixture.journal.listActions(fixture.root.rootRunId).find(action => action.binding.action === 'change')).toMatchObject({ status: 'failed', effect: 'none' });
  }));

  it('does not replay a completed warning during recovery or deduplicate intentional normal requests', async () => operationFixture(async ({ journal, root, runner, makeRunner, policies, handlers, dispatched }) => {
    policies.change = 'write'; handlers.change = async () => ({ ok: true, outcome: 'completed', warning: 'Synthetic partial recipient warning.' });
    await runner.plan([call('first', 'change', { value: 1 }), call('pending', 'change', { value: 1 })], signal());
    const first = await runner.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'first') as { hostOperation: { actionId: string } };
    runner.enterRecovery();
    expect(await runner.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'pending')).toMatchObject({ outcome: 'completed', reused: true, historical: true, hostOperation: { actionId: first.hostOperation.actionId } });
    const skipped = journal.listActions(root.rootRunId).find(action => action.id !== first.hostOperation.actionId)!;
    expect(skipped).toMatchObject({ status: 'failed', effect: 'none' });
    expect(JSON.parse(skipped.result!)).toMatchObject({ notExecuted: true, reusedActionId: first.hostOperation.actionId });
    expect(runner.actionWasReused(skipped)).toBe(true);
    expect(makeRunner(root).actionWasReused(skipped)).toBe(true);
    const claimed = await journal.recordIntent(root.id, { binding: skipped.binding, args: { value: 1 }, label: 'module-claimed-reuse' });
    const untrustedClaim = await journal.finishAction(claimed.id, claimed.attemptId, { status: 'failed', effect: 'none', result: JSON.stringify({ notExecuted: true, reusedActionId: first.hostOperation.actionId }) });
    expect(runner.actionWasReused(untrustedClaim)).toBe(false);
    await runner.plan([call('again', 'change', { value: 1 })], signal());
    expect(await runner.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'again')).toMatchObject({ reused: true });
    expect(dispatched).toEqual(['change']);
    const separate = await journal.createRun({ sessionId: 'synthetic-session', userMessageId: 'new-request', assistantMessageId: 'new-answer' });
    const normal = makeRunner(separate);
    await normal.plan([call('normal1', 'change', { value: 1 }), call('normal2', 'change', { value: 1 })], signal());
    await normal.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'normal1');
    await normal.invoke('synthetic-module', 'change', { value: 1 }, signal(), 'normal2');
    expect(dispatched).toEqual(['change', 'change', 'change']);
  }));
});

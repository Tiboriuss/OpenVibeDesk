import { describe, expect, it } from 'vitest';
import { ModuleToolRuntime, workspaceToolDefinitions, type WorkspaceToolDependencies } from '../electron/agent-tools';
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
      const largeResult = { payload: Array.from({ length: 50 }, () => 'x'.repeat(12000)), ...Object.fromEntries(Array.from({ length: 70 }, (_, index) => ['field' + index, index])), outcome, ok: false, message: 'Das tatsächliche Aktionsergebnis.' };
      deps.invokeModuleTool = async () => largeResult;
      expect(await call('mail_open', { emailId: 'm1' })).toMatchObject({ ok: false, outcome, message: 'Das tatsächliche Aktionsergebnis.', truncated: true });
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

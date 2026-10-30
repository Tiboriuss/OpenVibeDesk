import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runAgent } from '../electron/agent';
import { applyUiAction, initialState, type UiAction } from './actions';
import type { AgentRunLimit, AiConfig, ToolEvent } from './model';
import { defaultAgentSettings } from './agent-settings';
import type { ChatEvidence } from './chat-evidence';
import { WorkspaceCapabilityRegistry } from '../electron/workspace-capabilities';
import { mailCapabilityDefinitions } from '../modules/ovd-mail/backend/capabilities';

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const config: AiConfig = { baseUrl: `http://127.0.0.1:${port}/v1`, smartModel: 'large', simpleModel: 'small', smartThinking: 'off', simpleThinking: 'off', historyStart: 0 };
  return { config, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

function collect(request: IncomingMessage, callback: (payload: any) => void) {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => callback(JSON.parse(Buffer.concat(chunks).toString())));
}

function sse(...events: unknown[]) {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function call(id: string, name: string, argumentsText: string) {
  return { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: argumentsText } }] }, finish_reason: null }] };
}

const finishCalls = { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
const finishText = (text: string) => ({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] });

function workspace() {
  let state = initialState();
  const actions: UiAction[] = [];
  const mapping = { mail_search: 'mail.search', mail_open: 'mail.open' } as const;
  const registry = new WorkspaceCapabilityRegistry();
  registry.registerDefinition(mailCapabilityDefinitions['mail.search'], ({ query, limit }) => ({ matches: state.mails.filter(mail => mail.subject.includes(query)).slice(0, limit ?? 10).map(({ id, subject }) => ({ id, subject })) }));
  registry.registerDefinition(mailCapabilityDefinitions['mail.open'], ({ emailId }) => {
    if (!emailId) throw new Error('Ungültige Mail-ID');
    const action: UiAction = { type: 'read_email', emailId }; actions.push(action); state = applyUiAction(state, action).state;
    return { opened: true };
  });
  return {
    actions,
    getState: () => state,
    getModules: async () => ({ modules: [{ id: 'mail', title: 'Mail', description: 'Mail suchen und öffnen.' }], hasMore: false }),
    getModuleTools: async () => ({ moduleId: 'mail', tools: Object.entries(mapping).map(([name, capability]) => { const entry = registry.getRegisteredCatalog().find(item => item.name === capability)!; return { name, description: entry.description, parameters: entry.parameters, label: entry.label }; }), hasMore: false }),
    invokeModuleTool: async (moduleId: string, name: string, args: unknown, signal: AbortSignal) => {
      if (moduleId !== 'mail' || !Object.hasOwn(mapping, name)) throw new Error('Unbekanntes Modulwerkzeug');
      return registry.invoke(mapping[name as keyof typeof mapping], args, { origin: 'agent', signal });
    }
  };
}

describe('workspace agent integration', () => {
  it('assembles fragmented calls, searches local mail and opens the selected result before the final answer', async () => {
    const requests: any[] = [];
    const server = await serve((req, res) => collect(req, payload => {
      requests.push(payload);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (requests.length === 1) res.end(sse(call('find', 'find_modules', '{"query":"Mail"}'), finishCalls));
      else if (requests.length === 2) res.end(sse(call('load', 'get_module_tools', '{"moduleId":"mail","query":"suchen und öffnen"}'), finishCalls));
      else if (requests.length === 3) {
        const first = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_search', type: 'function', function: { name: 'mail_', arguments: '{"que' } }] }, finish_reason: null }] };
        const second = { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'search', arguments: 'ry":"Launch"}' } }] }, finish_reason: null }] };
        const bytes = Buffer.from(sse(first, second, finishCalls));
        for (let offset = 0; offset < bytes.length; offset += 7) res.write(bytes.subarray(offset, offset + 7));
        res.end();
      } else if (requests.length === 4) res.end(sse(call('call_open', 'mail_open', '{"emailId":"m1"}'), finishCalls));
      else res.end(sse(finishText('Die Launch-Mail ist geöffnet.')));
    }));
    const deps = workspace();
    const deltas: string[] = [];
    try {
      await runAgent(server.config, null, [{ role: 'user', content: 'Suche und öffne die Launch-Mail.' }], { tier: 'smart' }, new AbortController().signal, text => deltas.push(text), deps);
      expect(requests).toHaveLength(5);
      expect(requests[0]).toMatchObject({ stream: true, model: 'large' });
      expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(['find_modules', 'get_module_tools']);
      expect(requests[1].tools).toHaveLength(2);
      expect(requests[2].tools.map((tool: any) => tool.function.name)).toEqual(['find_modules', 'get_module_tools', 'mail_search', 'mail_open']);
      expect(requests[2].messages.find((message: any) => message.role === 'tool' && message.tool_call_id === 'load').content).not.toContain('parameters');
      const searchResult = requests[3].messages.find((message: any) => message.role === 'tool' && message.tool_call_id === 'call_search');
      expect(JSON.parse(searchResult.content)).toMatchObject({ ok: true, matches: [{ id: 'm1' }] });
      const openResult = requests[4].messages.find((message: any) => message.role === 'tool' && message.tool_call_id === 'call_open');
      expect(JSON.parse(openResult.content)).toMatchObject({ ok: true, opened: true });
      expect(deps.actions).toEqual([{ type: 'read_email', emailId: 'm1' }]);
      expect(deps.getState().selectedMailId).toBe('m1');
      expect(deps.getState().mails.find(mail => mail.id === 'm1')?.read).toBe(true);
      expect(deltas.join('')).toBe('Die Launch-Mail ist geöffnet.');
    } finally { await server.close(); }
  });

  it('reports unknown and invalid tools to the model without executing UI actions', async () => {
    const requests: any[] = [];
    const server = await serve((req, res) => collect(req, payload => {
      requests.push(payload);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (requests.length === 1) {
        const calls = { choices: [{ delta: { tool_calls: [
          { index: 0, id: 'unknown', type: 'function', function: { name: 'delete_email', arguments: '{"emailId":"m1"}' } },
          { index: 1, id: 'invalid', type: 'function', function: { name: 'get_module_tools', arguments: '{"moduleId":"mail","extra":true}' } }
        ] }, finish_reason: null }] };
        res.end(sse(calls, finishCalls));
      } else res.end(sse(finishText('Das war nicht möglich.')));
    }));
    const deps = workspace();
    try {
      await runAgent(server.config, null, [{ role: 'user', content: 'Öffne eine Mail.' }], { tier: 'smart' }, new AbortController().signal, () => {}, deps);
      const toolMessages = requests[1].messages.filter((message: any) => message.role === 'tool');
      expect(toolMessages).toHaveLength(2);
      for (const message of toolMessages) expect(JSON.parse(message.content)).toMatchObject({ ok: false });
      expect(deps.actions).toEqual([]);
      expect(deps.getState().mails.find(mail => mail.id === 'm1')?.read).toBe(false);
    } finally { await server.close(); }
  });

  it('removes speculative success text before actions and reports terminal host outcomes without another model call or effect', async () => {
    for (const outcome of ['failed', 'cancelled', 'uncertain', 'completed'] as const) {
      let requests = 0, invocations = 0, visible = '', replacements = 0;
      const events: ToolEvent[] = [];
      const server = await serve((req, res) => collect(req, () => {
        requests++; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (requests === 1) res.end(sse(call('load', 'get_module_tools', '{"moduleId":"mail"}'), finishCalls));
        else if (requests === 2) res.end(sse({ choices: [{ delta: { content: 'ERFOLGREICH ERLEDIGT.', tool_calls: [
          { index: 0, id: 'action', type: 'function', function: { name: 'mail_open', arguments: '{"emailId":"m1"}' } },
          { index: 1, id: 'later-action', type: 'function', function: { name: 'mail_search', arguments: '{"query":"Launch"}' } }
        ] }, finish_reason: null }] }, finishCalls));
        else res.end(sse(finishText('ERFOLGREICH ERLEDIGT.')));
      }));
      const deps = { ...workspace(), onReplaceText: (text: string) => { visible = text; replacements++; }, onToolEvent: (event: ToolEvent) => events.push(event), invokeModuleTool: async () => {
        invocations++; expect(visible).not.toContain('ERFOLGREICH');
        return { outcome, ok: outcome === 'completed', message: 'Tatsächliches Ergebnis prüfen.', ...(outcome === 'failed' ? { error: 'SMTP-Verbindung nicht eingerichtet.' } : {}), ...(outcome === 'completed' ? { warning: 'Ein Empfänger wurde abgelehnt.' } : {}) };
      } };
      try {
        await runAgent(server.config, null, [{ role: 'user', content: 'Führe die Aktion aus.' }], { tier: 'smart' }, new AbortController().signal, text => { visible += text; }, deps);
        expect(requests).toBe(2);
        expect(invocations).toBe(1);
        expect(replacements).toBe(1);
        expect(events.at(-1)).toMatchObject({ status: outcome, detail: outcome === 'failed' ? 'SMTP-Verbindung nicht eingerichtet.' : outcome === 'completed' ? 'Ein Empfänger wurde abgelehnt.' : 'Tatsächliches Ergebnis prüfen.' });
        expect(visible).not.toContain('ERFOLGREICH');
        expect(visible).toContain(outcome === 'failed' ? 'SMTP-Verbindung nicht eingerichtet.' : outcome === 'completed' ? 'Ein Empfänger wurde abgelehnt.' : 'Tatsächliches Ergebnis prüfen.');
      } finally { await server.close(); }
    }
  });

  it('ends an accepted host handoff before a later mutation in the same response, even without confirmations', async () => {
    let requests = 0, writes = 0, pendingReformulation = false, visible = '';
    const invoked: string[] = [], events: ToolEvent[] = [], evidence: ChatEvidence[] = [];
    const server = await serve((req, res) => collect(req, () => {
      requests++; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (requests === 1) res.end(sse(call('load', 'get_module_tools', '{"moduleId":"ovd-assistant"}'), finishCalls));
      else if (requests === 2) res.end(sse({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'handoff', type: 'function', function: { name: 'chat_reformulate', arguments: '{}' } },
        { index: 1, id: 'unexpected-write', type: 'function', function: { name: 'synthetic_write', arguments: '{}' } }
      ] }, finish_reason: null }] }, finishCalls));
      else res.end(sse(finishText('Unexpected further provider turn.')));
    }));
    const handoffMessage = 'Die Antwort wird aus gespeicherten Belegen neu formuliert. Es wird kein Auftrag erneut ausgeführt.';
    const deps = {
      ...workspace(),
      getModuleTools: async () => ({ moduleId: 'ovd-assistant', tools: ['chat_reformulate', 'synthetic_write'].map(name => ({ name, description: name, parameters: { type: 'object', properties: {}, additionalProperties: false } })), hasMore: false }),
      invokeModuleTool: async (_moduleId: string, name: string) => {
        invoked.push(name);
        if (name === 'chat_reformulate') { pendingReformulation = true; return { outcome: 'completed', queued: true, actionsEnabled: false, sourceMessageId: 'answer-1' }; }
        writes++; return { outcome: 'completed', written: true };
      },
      finishAfterTool: () => pendingReformulation ? handoffMessage : undefined,
      onToolEvent: (event: ToolEvent) => events.push(event),
      onEvidence: (snapshot: ChatEvidence) => evidence.push(snapshot)
    };
    try {
      await runAgent({ ...server.config, confirmationMode: 'never' }, null, [{ role: 'user', content: 'Formuliere die vorherige Antwort neu.' }], { tier: 'smart' }, new AbortController().signal, text => { visible += text; }, deps);
      expect(pendingReformulation).toBe(true);
      expect(invoked).toEqual(['chat_reformulate']);
      expect(writes).toBe(0);
      expect(requests).toBe(2);
      expect(visible).toBe(handoffMessage);
      expect(events.map(event => [event.name, event.status])).toEqual([['get_module_tools', 'completed'], ['chat_reformulate', 'completed']]);
      expect(evidence.at(-1)).toMatchObject({ status: 'completed', toolsUsed: true, outcomeCounts: { completed: 1, failed: 0, cancelled: 0, uncertain: 0 }, entries: [{ name: 'chat_reformulate', moduleId: 'ovd-assistant', status: 'completed' }] });
      expect(evidence.at(-1)?.entries).toHaveLength(1);
      expect(JSON.parse(evidence.at(-1)!.entries[0].result!)).toMatchObject({ outcome: 'completed', queued: true, actionsEnabled: false, sourceMessageId: 'answer-1' });
    } finally { await server.close(); }
  });

  it.each([0, 1, 2])('uses only the configured %i effect-free protocol recovery attempts', async retries => {
    let requests = 0;
    const server = await serve((req, res) => collect(req, payload => {
      requests++;
      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(requests === 1 ? sse(call('invalid', '', '{"moduleId":"mail"}'), finishCalls) : sse(finishText('Fertig.')));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'recovered', type: 'function', function: { name: requests <= retries ? '' : 'get_module_tools', arguments: '{"moduleId":"mail"}' } }] }, finish_reason: 'tool_calls' }] }));
      }
    }));
    const deps = { ...workspace(), settings: { ...defaultAgentSettings, transportRetries: retries } };
    try {
      const run = runAgent(server.config, null, [{ role: 'user', content: 'Öffne eine Mail.' }], { tier: 'smart' }, new AbortController().signal, () => {}, deps);
      if (!retries) await expect(run).rejects.toThrow(); else await run;
      expect(requests).toBe(retries ? retries + 2 : 1);
      expect(deps.actions).toEqual([]);
    } finally { await server.close(); }
  });

  it.each(['size', 'empty_optional'])('recovers an unexecuted %s turn without repeating its completed query', async malformed => {
    const requests: any[] = [], events: ToolEvent[] = [];
    let queries = 0, visible = '';
    const server = await serve((req, res) => collect(req, payload => {
      requests.push(payload);
      if (!payload.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'recovered-open', type: 'function', function: { name: 'mail_open', arguments: '{"emailId":"m1"}' } }] }, finish_reason: 'tool_calls' }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (requests.length === 1) res.end(sse(call('load', 'get_module_tools', '{"moduleId":"mail"}'), finishCalls));
      else if (requests.length === 2) res.end(sse(call('query', 'mail_search', '{"query":"Launch"}'), finishCalls));
      else if (requests.length === 3) res.end(sse({ choices: [{ delta: { content: 'Vorläufiger Text.' } }] }, malformed === 'size' ? call('oversized', 'n'.repeat(129), '{"emailId":"m1"}') : call('empty-optional', 'mail_open', ''), finishCalls));
      else res.end(sse(finishText('Die Mail ist geöffnet.')));
    }));
    const base = workspace();
    const deps = { ...base, onReplaceText: (text: string) => { visible = text; }, onToolEvent: (event: ToolEvent) => events.push(event), invokeModuleTool: async (...args: Parameters<typeof base.invokeModuleTool>) => {
      if (args[1] === 'mail_search') queries++;
      return base.invokeModuleTool(...args);
    } };
    try {
      await runAgent(server.config, null, [{ role: 'user', content: 'Suche und öffne die Launch-Mail.' }], { tier: 'smart' }, new AbortController().signal, text => { visible += text; }, deps);
      expect(requests.map(payload => payload.stream)).toEqual([true, true, true, false, true]);
      expect(requests[3].messages).toEqual(requests[2].messages);
      expect(requests[3].tools).toEqual(requests[2].tools);
      const retained = requests[3].messages.filter((message: any) => message.role === 'tool' && message.tool_call_id === 'query');
      expect(retained).toHaveLength(1);
      expect(JSON.parse(retained[0].content)).toMatchObject({ ok: true, matches: [{ id: 'm1' }] });
      expect(queries).toBe(1);
      expect(deps.actions).toEqual([{ type: 'read_email', emailId: 'm1' }]);
      expect(events.map(event => [event.name, event.status])).toEqual([['get_module_tools', 'completed'], ['mail_search', 'completed'], ['mail_open', 'completed']]);
      expect(visible).toBe('Die Mail ist geöffnet.');
    } finally { await server.close(); }
  });

  it('stops at the configured round limit with counts and retained results', async () => {
    let requests = 0, visible = '';
    const limits: AgentRunLimit[] = [], events: ToolEvent[] = [];
    const server = await serve((req, res) => collect(req, () => {
      requests++; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sse(call(`search_${requests}`, 'find_modules', '{"query":"Mail"}'), finishCalls));
    }));
    const deps = { ...workspace(), settings: { ...defaultAgentSettings, maxToolRounds: 3 }, onLimitReached: (info: AgentRunLimit) => limits.push(info), onToolEvent: (event: ToolEvent) => events.push(event) };
    try {
      await runAgent(server.config, null, [{ role: 'user', content: 'Suche Mara.' }], { tier: 'smart' }, new AbortController().signal, text => { visible += text; }, deps);
      expect(requests).toBe(4);
      expect(limits).toMatchObject([{ status: 'limit_reached', reason: 'tool_rounds', toolRounds: 3, toolCalls: 3, discoveryCalls: 3, actionCalls: 0, limit: 3, nextToolType: 'discovery' }]);
      expect(events).toHaveLength(3);
      expect(visible).toContain('3 Werkzeugrunden');
      expect(visible).toContain('Statusangaben bleiben erhalten');
      expect(deps.actions).toEqual([]);
    } finally { await server.close(); }
  });

  it('executes the fitting prefix of a large batch without repeating its earlier query', async () => {
    let requests = 0, queryReads = 0;
    let retainedQuery: unknown;
    const limits: AgentRunLimit[] = [], events: ToolEvent[] = [];
    const server = await serve((req, res) => collect(req, payload => {
      requests++; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (requests === 1) res.end(sse(call('load', 'get_module_tools', '{"moduleId":"mail"}'), finishCalls));
      else if (requests === 2) res.end(sse(call('query', 'mail_search', '{"query":"Launch"}'), finishCalls));
      else {
        retainedQuery = JSON.parse(payload.messages.find((message: any) => message.role === 'tool' && message.tool_call_id === 'query').content);
        res.end(sse({ choices: [{ delta: { tool_calls: Array.from({ length: 10 }, (_, index) => ({ index, id: 'action-' + index, type: 'function', function: { name: 'mail_open', arguments: '{"emailId":"m1"}' } })) }, finish_reason: null }] }, finishCalls));
      }
    }));
    const base = workspace();
    const deps = { ...base, settings: { ...defaultAgentSettings, maxToolCalls: 4 }, onLimitReached: (info: AgentRunLimit) => limits.push(info), onToolEvent: (event: ToolEvent) => events.push(event), invokeModuleTool: async (...args: Parameters<typeof base.invokeModuleTool>) => {
      if (args[1] === 'mail_search') queryReads++;
      return base.invokeModuleTool(...args);
    } };
    try {
      await runAgent(server.config, null, [{ role: 'user', content: 'Öffne die Mail.' }], { tier: 'smart' }, new AbortController().signal, () => {}, deps);
      expect(requests).toBe(3);
      expect(queryReads).toBe(1);
      expect(retainedQuery).toMatchObject({ ok: true, matches: [{ id: 'm1' }] });
      expect(deps.actions).toHaveLength(2);
      expect(events).toHaveLength(4);
      expect(limits).toMatchObject([{ reason: 'tool_calls', toolRounds: 3, toolCalls: 4, discoveryCalls: 1, actionCalls: 3, limit: 4, nextToolType: 'action' }]);
    } finally { await server.close(); }
  });

  it('does not execute later tools if cancellation occurs between calls', async () => {
    const controller = new AbortController();
    const server = await serve((req, res) => collect(req, () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const calls = { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'search', type: 'function', function: { name: 'find_modules', arguments: '{"query":"Mail"}' } },
        { index: 1, id: 'open', type: 'function', function: { name: 'get_module_tools', arguments: '{"moduleId":"mail"}' } }
      ] }, finish_reason: null }] };
      res.end(sse(calls, finishCalls));
    }));
    const deps = { ...workspace(), onToolEvent: () => controller.abort() };
    try {
      await expect(runAgent(server.config, null, [{ role: 'user', content: 'Suche und öffne Mara.' }], { tier: 'smart' }, controller.signal, () => {}, deps)).rejects.toMatchObject({ name: 'AbortError' });
      expect(deps.actions).toEqual([]);
      expect(deps.getState().mails.find(mail => mail.id === 'm1')?.read).toBe(false);
    } finally { await server.close(); }
  });

  it('cancels an active stream without running its unfinished tools', async () => {
    const controller = new AbortController();
    const server = await serve((req, res) => collect(req, () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify(call('call_open', 'find_modules', '{"query":"mail"}'))}\n\n`);
      controller.abort();
      res.on('close', () => res.end());
    }));
    const deps = workspace();
    try {
      await expect(runAgent(server.config, null, [{ role: 'user', content: 'Öffne eine Mail.' }], { tier: 'smart' }, controller.signal, () => {}, deps)).rejects.toMatchObject({ name: 'AbortError' });
      expect(deps.actions).toEqual([]);
    } finally { await server.close(); }
  });
});

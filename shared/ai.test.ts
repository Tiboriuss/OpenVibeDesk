import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { chatOptionsSchema, makeMessages, normalizeAiConfig, parseAiInput, listModels, requestCompletion } from '../electron/ai';
import { initialState } from './actions';
import { defaultAgentSettings, normalizeAgentSettings } from './agent-settings';

describe('OpenAI-compatible endpoint', () => {
  it('introduces module discovery with bounded summaries and respects disabled tools', () => {
    const state = initialState();
    const user = { id: 'user', role: 'user' as const, text: 'Suche eine Mail', timestamp: '2026-01-01' };
    expect(makeMessages([], state.mails, user, false)[0].content).toContain('Werkzeuge sind deaktiviert');
    const modules = Array.from({ length: 21 }, (_, index) => ({ id: `module-${index}`, title: `Modul ${index}`, description: 'Kurze Fachbeschreibung', tools: [{ parameters: { secretSchema: true } }] }));
    const system = makeMessages([], state.mails, user, true, modules)[0].content;
    expect(system).toContain('find_modules');
    expect(system).toContain('get_module_tools');
    expect(system).toContain('"id":"module-19"');
    expect(system).not.toContain('"id":"module-20"');
    expect(system).not.toContain('secretSchema');
    expect(system).not.toContain('search_emails');
    expect(makeMessages([], state.mails, user, false, modules)[0].content).not.toContain('"id":"module-0"');
    const history = Array.from({ length: 6 }, (_, index) => ({ ...user, id: `prior-${index}`, text: `Alter Verlauf ${index}` }));
    const limitedHistory = makeMessages(history, state.mails, user, true, [], 'ask', { ...defaultAgentSettings, historyMessageLimit: 2, historyCharBudget: 100 });
    expect(limitedHistory.map(message => message.content).join(' ')).not.toContain('Alter Verlauf 3');
    expect(limitedHistory.at(-2)?.content).toBe('Alter Verlauf 5');
    const noHistory = makeMessages(history, state.mails, { ...user, emailRef: 'm1' }, true, [], 'ask', { ...defaultAgentSettings, historyMessageLimit: 0, historyCharBudget: 0 });
    expect(noHistory).toHaveLength(2);
    expect(noHistory.at(-1)?.content).toContain('Launch-Checkliste');
    expect(noHistory.at(-1)?.content).toContain(user.text);
    const tightHistory = makeMessages(history, [], user, true, [], 'ask', { ...defaultAgentSettings, historyCharBudget: 1 });
    expect(tightHistory).toHaveLength(2);
    expect(tightHistory[0].content).toContain('6 frühere Nachrichten');
    expect(normalizeAgentSettings({ maxToolRounds: 0, maxToolCalls: 99 })).toMatchObject({ maxToolRounds: 25, maxToolCalls: 99 });
    const bulky = makeMessages([], state.mails, user, true, modules.map(module => ({ ...module, title: 'T'.repeat(500), description: 'D'.repeat(5000) })))[0].content;
    const summaryJson = bulky.split('\n').find(line => line.startsWith('[{'))!;
    expect(summaryJson.length).toBeLessThanOrEqual(6000);
    expect(JSON.parse(summaryJson).every((module: { title: string; description: string }) => module.title.length <= 100 && module.description.length <= 240)).toBe(true);
  });

  it('only permits HTTPS or loopback HTTP and rejects secrets in URLs', () => {
    const input = { smartModel: '', simpleModel: '', smartThinking: 'off', simpleThinking: 'off' };
    expect(parseAiInput({ ...input, baseUrl: 'http://127.0.0.1:1234/v1/' }).baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(() => parseAiInput({ ...input, baseUrl: 'http://example.com/v1' })).toThrow();
    expect(() => parseAiInput({ ...input, baseUrl: 'https://user:secret@example.com/v1' })).toThrow();
    expect(normalizeAiConfig({ baseUrl: 'https://example.com/v1', model: 'legacy', thinking: 'medium', historyStart: 7 })).toMatchObject({ smartModel: 'legacy', simpleModel: 'legacy', smartThinking: 'medium', simpleThinking: 'medium', historyStart: 7 });
    expect(normalizeAiConfig({ thinking: 'high', smartThinking: 'low', simpleThinking: 'off' })).toMatchObject({ smartThinking: 'low', simpleThinking: 'off' });
    expect(normalizeAiConfig({}).workspaceTools).toBe(true);
    expect(normalizeAiConfig({}).confirmationMode).toBe('ask');
    expect(normalizeAiConfig({ confirmationMode: 'never' }).confirmationMode).toBe('never');
    expect(normalizeAiConfig({ confirmationMode: 'invalid' }).confirmationMode).toBe('ask');
    expect(parseAiInput({ ...input, baseUrl: 'https://example.com/v1', confirmationMode: 'never' }).confirmationMode).toBe('never');
    expect(() => parseAiInput({ ...input, baseUrl: 'https://example.com/v1', confirmationMode: true })).toThrow();
    expect(normalizeAiConfig({ workspaceTools: false }).workspaceTools).toBe(false);
    expect(normalizeAiConfig({ workspaceTools: true, realMailAccess: false })).not.toHaveProperty('realMailAccess');
    expect(parseAiInput({ ...input, baseUrl: 'https://example.com/v1', workspaceTools: true, realMailAccess: false })).not.toHaveProperty('realMailAccess');
    expect(parseAiInput({ ...input, baseUrl: 'https://example.com/v1', workspaceTools: false }).workspaceTools).toBe(false);
    expect(() => parseAiInput({ ...input, baseUrl: 'https://example.com/v1', workspaceTools: 'false' })).toThrow();
    expect(chatOptionsSchema.safeParse({ tier: 'smart', thinking: 'high' }).success).toBe(false);
  });
  it('sends a plain chat request with attached mail as data, and follows no redirects', async () => {
    let payload: any; let authorization: string | undefined; let redirected = false;
    const server: Server = createServer((req, res) => {
      if (req.url === '/redirect/chat/completions') { res.writeHead(302, { location: '/destination' }); res.end(); return; }
      if (req.url === '/destination') { redirected = true; res.end(); return; }
      authorization = req.headers.authorization;
      const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { payload = JSON.parse(Buffer.concat(chunks).toString()); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Hallo!' } }] })); });
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as {port:number}).port;
    try {
      const state = initialState();
      const msg = { id:'1', role:'user' as const, text:'Fasse zusammen', emailRef:'m1', timestamp:new Date().toISOString() };
      const messages = makeMessages([], state.mails, msg);
      const config = { baseUrl: `http://127.0.0.1:${port}/v1`, smartModel:'test', simpleModel:'small', smartThinking:'off' as const, simpleThinking:'high' as const, historyStart:0 };
      expect(await requestCompletion(config, null, messages, { tier:'smart' })).toBe('Hallo!');
      expect(authorization).toBeUndefined();
      expect(payload.model).toBe('test');
      expect(payload.reasoning_effort).toBeUndefined();
      expect(payload.tools).toBeUndefined();
      expect(payload.messages[1].content).toContain('Launch-Checkliste');
      expect(await requestCompletion(config, null, messages, { tier:'simple' })).toBe('Hallo!');
      expect(payload.model).toBe('small');
      expect(payload.reasoning_effort).toBe('high');
      await expect(requestCompletion({ ...config, baseUrl: `http://127.0.0.1:${port}/redirect` }, 'secret', messages, { tier:'smart' })).rejects.toThrow();
      expect(redirected).toBe(false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('discovers models with authentication and rejects malformed lists and redirects', async () => {
    let auth: string | undefined; let hitRedirect = false;
    const server = createServer((req, res) => {
      auth = req.headers.authorization;
      if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'alpha' }] })); }
      else if (req.url === '/invalid/models') res.end(JSON.stringify({ data: [{ no_id: 'x' }] }));
      else if (req.url === '/redirect/models') { res.writeHead(302, { location: '/destination' }); res.end(); }
      else { hitRedirect = true; res.end(); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as {port:number}).port;
    const config = { baseUrl: `http://127.0.0.1:${port}/v1`, smartModel:'', simpleModel:'', smartThinking:'off' as const, simpleThinking:'off' as const, historyStart:0 };
    try {
      expect(await listModels(config, 'dummy')).toEqual(['alpha', 'zeta']);
      expect(auth).toBe('Bearer dummy');
      await expect(listModels({ ...config, baseUrl: `http://127.0.0.1:${port}/invalid` }, null)).rejects.toThrow('Modellliste');
      await expect(listModels({ ...config, baseUrl: `http://127.0.0.1:${port}/redirect` }, 'dummy')).rejects.toThrow();
      expect(hitRedirect).toBe(false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

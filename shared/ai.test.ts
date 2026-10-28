import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { chatOptionsSchema, makeMessages, normalizeAiConfig, parseAiInput, listModels, requestCompletion } from '../electron/ai';
import { initialState } from './actions';

describe('OpenAI-compatible endpoint', () => {
  it('only permits HTTPS or loopback HTTP and rejects secrets in URLs', () => {
    const input = { smartModel: '', simpleModel: '', smartThinking: 'off', simpleThinking: 'off' };
    expect(parseAiInput({ ...input, baseUrl: 'http://127.0.0.1:1234/v1/' }).baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(() => parseAiInput({ ...input, baseUrl: 'http://example.com/v1' })).toThrow();
    expect(() => parseAiInput({ ...input, baseUrl: 'https://user:secret@example.com/v1' })).toThrow();
    expect(normalizeAiConfig({ baseUrl: 'https://example.com/v1', model: 'legacy', thinking: 'medium', historyStart: 7 })).toMatchObject({ smartModel: 'legacy', simpleModel: 'legacy', smartThinking: 'medium', simpleThinking: 'medium', historyStart: 7 });
    expect(normalizeAiConfig({ thinking: 'high', smartThinking: 'low', simpleThinking: 'off' })).toMatchObject({ smartThinking: 'low', simpleThinking: 'off' });
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

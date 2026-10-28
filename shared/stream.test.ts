import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { requestCompleteTurn, streamCompletion, streamTurn } from '../electron/stream';
import type { AiConfig } from './model';

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const config: AiConfig = { baseUrl: `http://127.0.0.1:${port}/v1`, smartModel: 'large', simpleModel: 'small', smartThinking: 'medium', simpleThinking: 'off', historyStart: 0 };
  return { config, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

describe('OpenAI SSE stream', () => {
  it('assembles fragmented UTF-8 and SSE lines into successive deltas', async () => {
    let payload: any;
    const server = await serve((req, res) => {
      const chunks: Buffer[] = []; req.on('data', x => chunks.push(x));
      req.on('end', () => {
        payload = JSON.parse(Buffer.concat(chunks).toString());
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const bytes = Buffer.from(': ping\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"Grüße 😀"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
        let pos = 0;
        function write() { if (pos >= bytes.length) { res.end(); return; } res.write(bytes.subarray(pos, pos + 3)); pos += 3; setImmediate(write); }
        write();
      });
    });
    try {
      const deltas: string[] = [];
      const result = await streamCompletion(server.config, null, [{ role: 'user', content: 'Hallo' }], { tier: 'smart' }, new AbortController().signal, delta => deltas.push(delta));
      expect(result).toBe('Grüße 😀!'); expect(deltas).toEqual(['Grüße 😀', '!']);
      expect(payload).toMatchObject({ stream: true, model: 'large', reasoning_effort: 'medium' });
      expect(payload.tools).toBeUndefined();
    } finally { await server.close(); }
  });

  it('keeps delivered deltas accessible when a provider reports an error', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"Anfang"}}]}\n\ndata: {"error":{"message":"private provider detail"}}\n\n');
    });
    try {
      const deltas: string[] = [];
      await expect(streamCompletion(server.config, null, [], { tier: 'simple' }, new AbortController().signal, delta => deltas.push(delta))).rejects.toThrow('Fehler beim Streaming');
      expect(deltas).toEqual(['Anfang']);
    } finally { await server.close(); }
  });

  it('aborts on request without discarding a received delta', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Teil"}}]}\n\n');
      res.on('close', () => res.end());
    });
    try {
      const controller = new AbortController(); const deltas: string[] = [];
      await expect(streamCompletion(server.config, null, [], { tier: 'simple' }, controller.signal, delta => { deltas.push(delta); controller.abort(); })).rejects.toMatchObject({ name: 'AbortError' });
      expect(deltas).toEqual(['Teil']);
    } finally { await server.close(); }
  });

  it('rejects redirects and incomplete streams without silently accepting partial output', async () => {
    let redirectDestinationHit = false;
    const server = await serve((req, res) => {
      if (req.url === '/v1/chat/completions') { res.writeHead(302, { location: '/other' }); res.end(); }
      else if (req.url === '/broken/chat/completions') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"Teil"}}]}\n\n'); }
      else { redirectDestinationHit = true; res.end(); }
    });
    try {
      await expect(streamCompletion(server.config, 'secret', [], { tier: 'smart' }, new AbortController().signal, () => {})).rejects.toThrow();
      expect(redirectDestinationHit).toBe(false);
      const deltas: string[] = [];
      await expect(streamCompletion({ ...server.config, baseUrl: server.config.baseUrl.replace('/v1', '/broken') }, null, [], { tier: 'smart' }, new AbortController().signal, d => deltas.push(d))).rejects.toThrow('vorzeitig');
      expect(deltas).toEqual(['Teil']);
    } finally { await server.close(); }
  });
  it('accepts complete compatible tool streams without duplicating cumulative metadata or inventing calls', async () => {
    const tools = [
      { type: 'function', function: { name: 'read_email', parameters: { type: 'object', properties: { emailId: { type: 'string' } }, required: ['emailId'] } } },
      { type: 'function', function: { name: 'get_context', parameters: { type: 'object', properties: {} } } }
    ];
    const event = (delta: unknown, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }] })}\n\n`;
    const call = { index: 0, id: 'call_read', type: 'function', function: { name: 'read_email', arguments: '{"emailId":"m1"}' } };
    const variants = [
      { wire: event({ tool_calls: [call] }, 'stop') + 'data: [DONE]\n\n', name: 'read_email', args: '{"emailId":"m1"}' },
      { wire: event({ tool_calls: [call] }) + 'data: [DONE]\n\n', name: 'read_email', args: '{"emailId":"m1"}' },
      { wire: event({ tool_calls: [{ ...call, function: { name: 'read_email', arguments: '{"emailId":"m' } }] }) + event({ tool_calls: [call, { index: 1, type: 'function', function: { name: null, arguments: null } }] }, 'tool_calls') + 'data: [DONE]\n\n', name: 'read_email', args: '{"emailId":"m1"}' },
      { wire: event({ tool_calls: [{ index: 0, id: 'call_context', type: 'function', function: { name: 'get_context', arguments: '' } }] }, 'stop') + 'data: [DONE]\n\n', name: 'get_context', args: '{}' }
    ];
    let wire = '';
    const server = await serve((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(wire); });
    try {
      for (const variant of variants) {
        wire = variant.wire;
        const result = await streamTurn(server.config, null, [], { tier: 'simple' }, new AbortController().signal, () => {}, tools);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].function).toEqual({ name: variant.name, arguments: variant.args });
      }
    } finally { await server.close(); }
  });

  it('never returns incomplete or truncated tool calls for execution', async () => {
    const tool = { type: 'function', function: { name: 'read_email', parameters: { type: 'object', properties: { emailId: { type: 'string' } }, required: ['emailId'] } } };
    const call = { index: 0, id: 'call_read', type: 'function', function: { name: 'read_email', arguments: '{"emailId":"m1"}' } };
    const variants = [
      { calls: [{ ...call, id: '' }], finish: 'tool_calls' },
      { calls: [{ ...call, function: { name: 'read_email', arguments: '{"emailId":' } }], finish: 'tool_calls' },
      { calls: [call], finish: 'length' },
      { calls: [call, { ...call, index: 1 }], finish: 'tool_calls' }
    ];
    let variant = variants[0];
    const server = await serve((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: variant.calls }, finish_reason: variant.finish }] })}\n\ndata: [DONE]\n\n`); });
    try {
      for (variant of variants) await expect(streamTurn(server.config, null, [], { tier: 'simple' }, new AbortController().signal, () => {}, [tool])).rejects.toThrow('Es wurde kein Aufruf');
    } finally { await server.close(); }
  });

  it('loads one bounded complete turn with the same tools and refuses malformed fallback calls', async () => {
    const tools = [{ type: 'function', function: { name: 'read_email', parameters: { type: 'object', properties: { emailId: { type: 'string' } }, required: ['emailId'] } } }];
    let payload: any, mode = 'valid';
    const server = await serve((req, res) => {
      const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
        payload = JSON.parse(Buffer.concat(chunks).toString());
        if (mode === 'oversized') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '4000001' }); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_read', type: 'function', function: { name: 'read_email', arguments: mode === 'valid' ? '{"emailId":"m1"}' : '{"emailId":' } }] }, finish_reason: 'tool_calls' }] }));
      });
    });
    try {
      expect(await requestCompleteTurn(server.config, null, [{ role: 'user', content: 'Lies die Mail.' }], { tier: 'smart' }, new AbortController().signal, tools)).toMatchObject({ text: '', toolCalls: [{ id: 'call_read', function: { name: 'read_email', arguments: '{"emailId":"m1"}' } }] });
      expect(payload).toMatchObject({ stream: false, model: 'large', reasoning_effort: 'medium', tools });
      mode = 'invalid';
      await expect(requestCompleteTurn(server.config, null, [], { tier: 'simple' }, new AbortController().signal, tools)).rejects.toThrow('auch ohne Streaming unvollständige Werkzeugaufrufe');
      mode = 'oversized';
      await expect(requestCompleteTurn(server.config, null, [], { tier: 'simple' }, new AbortController().signal, tools)).rejects.toThrow('zu groß');
    } finally { await server.close(); }
  });

});

import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { streamCompletion } from '../electron/stream';
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
});

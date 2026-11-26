#!/usr/bin/env node
'use strict';

// Manual interoperability fixture. One read-only tool, no credentials or saved state.
const http = require('node:http');

const legacy = '2025-11-25';
const modern = '2026-07-28';
const serverInfo = { name: 'ovd-compat-fixture', version: '1.0.0' };
const capabilities = { tools: {} };
const tool = {
  name: 'workshop_hours',
  description: 'Read the example workshop opening hours.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true }
};
const maxBytes = 64 * 1024;
const [transport, era] = process.argv.slice(2);
if (process.argv.length !== 4 || !['stdio', 'http'].includes(transport) || !['legacy', 'older', 'dual', 'modern'].includes(era)) {
  console.error('Usage: node scripts/mcp-compat-fixture.cjs stdio|http legacy|older|dual|modern');
  process.exit(1);
}
const legacyVersion = era === 'older' ? '2025-06-18' : legacy;
const supportedVersions = era === 'dual' ? [modern, legacy] : [era === 'modern' ? modern : legacyVersion];
let stdioInitialized = false;

function failure(id, code, message, status, data) {
  return { status, body: { jsonrpc: '2.0', id, error: { code, message, ...(data && { data }) } } };
}

function handle(bytes, headers) {
  let rpc;
  try { rpc = JSON.parse(bytes.toString('utf8')); }
  catch { return failure(null, -32700, 'Invalid JSON', 400); }
  if (rpc?.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return failure(null, -32600, 'Invalid request', 400);
  const { id, method, params } = rpc;
  const result = value => ({ status: 200, body: { jsonrpc: '2.0', id, result: value } });
  const metadata = params?._meta;
  const version = metadata?.['io.modelcontextprotocol/protocolVersion'];
  const useModern = era === 'modern' || (era === 'dual' && version !== undefined);

  if (useModern) {
    if (headers && (!version || headers['mcp-protocol-version'] !== version || headers['mcp-method'] !== method ||
        (method === 'tools/call' && headers['mcp-name'] !== params?.name))) {
      return failure(id, -32020, 'Header mismatch. This endpoint accepts MCP 2026-07-28.', 400);
    }
    if (method === 'initialize') return failure(id, -32601, 'Use MCP 2026-07-28 on this endpoint.', 404);
    if (version !== modern) return failure(id, -32022, 'Unsupported protocol version', 400, { requested: version, supported: supportedVersions });
    if (!metadata['io.modelcontextprotocol/clientInfo'] || !metadata['io.modelcontextprotocol/clientCapabilities']) {
      return failure(id, -32602, 'Missing client metadata', 400);
    }
    if (method === 'server/discover') return result({ resultType: 'complete', supportedVersions, capabilities, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo } });
  } else {
    if (method === 'initialize') {
      stdioInitialized = true;
      return result({ protocolVersion: legacyVersion, capabilities, serverInfo });
    }
    // The HTTP fixture is stateless. The stdio fixture serves one client per process.
    if (headers ? headers['mcp-protocol-version'] !== legacyVersion : !stdioInitialized) {
      return failure(id, -32600, 'Use the negotiated legacy protocol version.', 400);
    }
    if (id === undefined) return { status: 202 };
  }
  const completion = useModern ? { resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo } } : {};
  if (method === 'tools/list') return result({ ...completion, tools: [tool] });
  if (method === 'tools/call' && params?.name === tool.name) {
    if (params.arguments != null && (typeof params.arguments !== 'object' || Array.isArray(params.arguments) || Object.keys(params.arguments).length)) {
      return failure(id, -32602, 'workshop_hours accepts an empty object.', 400);
    }
    return result({ ...completion, content: [{ type: 'text', text: 'The example workshop opens at 08:00.' }] });
  }
  return failure(id, -32601, 'Method not found', 404);
}

function startHttp() {
  const server = http.createServer((request, response) => {
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.headers.origin && request.headers.origin !== 'http://127.0.0.1:' + server.address().port) {
      response.writeHead(403).end(); return;
    }
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
      else if (!response.writableEnded) response.writeHead(413).end();
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      const { status, body } = handle(Buffer.concat(chunks), request.headers);
      response.writeHead(status, body ? { 'Content-Type': 'application/json' } : {});
      response.end(body && JSON.stringify(body));
    });
  });
  server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port + '/mcp'));
}

async function startStdio() {
  let pending = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    const input = Buffer.concat([pending, chunk]);
    let start = 0, end;
    while ((end = input.indexOf(10, start)) !== -1) {
      if (end - start > maxBytes) throw Error('MCP fixture request exceeds 64 KiB.');
      const { body } = handle(input.subarray(start, end));
      if (body) process.stdout.write(JSON.stringify(body) + '\n');
      start = end + 1;
    }
    pending = input.subarray(start);
    if (pending.length > maxBytes) throw Error('MCP fixture request exceeds 64 KiB.');
  }
}

if (transport === 'http') startHttp();
else startStdio().catch(error => { console.error(error.message); process.exitCode = 1; });

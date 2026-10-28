/** Utility-process entry. Approved modules have normal OS user rights, not sandboxed access. */
export {};

const parent = process.parentPort;
if (!parent) process.exit(1);
const ARGUMENT_BYTES = 16 * 1024;
const RESULT_BYTES = 32 * 1024;
type ToolHandler = (args: Record<string, unknown>, context: { signal: AbortSignal }) => unknown | Promise<unknown>;
type ActivatedModule = { tools: Record<string, ToolHandler>; dispose?(): void | Promise<void> };
let instance: ActivatedModule | undefined;
let initializing = false, disposed = false;
const activeCalls = new Map<string, AbortController>();

function send(message: unknown): void { parent.postMessage(message); }
function fatal(): void {
  if (disposed) return;
  disposed = true;
  try { send({ type: 'fatal' }); } finally { process.exit(1); }
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

async function dispose(): Promise<void> {
  if (disposed) return;
  disposed = true;
  for (const controller of activeCalls.values()) controller.abort();
  try { await instance?.dispose?.(); } catch { /* Do not publish arbitrary exception details. */ }
  process.exit(0);
}

async function initialize(message: Record<string, unknown>): Promise<void> {
  if (initializing || instance || disposed) { fatal(); return; }
  initializing = true;
  if (typeof message.moduleId !== 'string' || typeof message.entryPath !== 'string' || typeof message.dataDirectory !== 'string' || !Array.isArray(message.tools) || !message.tools.length || message.tools.length > 64 || !message.tools.every(name => typeof name === 'string' && name.startsWith(message.moduleId + '.'))) { fatal(); return; }
  const declared = [...message.tools as string[]].sort();
  if (new Set(declared).size !== declared.length) { fatal(); return; }
  try {
    // This import runs in the module process only, after the host's fingerprint approval.
    const backend: unknown = require(message.entryPath);
    if (!backend || typeof backend !== 'object' || !('activate' in backend) || typeof backend.activate !== 'function') throw new Error('Invalid activation export');
    const activated: unknown = await backend.activate({ moduleId: message.moduleId, dataDirectory: message.dataDirectory });
    if (!activated || typeof activated !== 'object' || !('tools' in activated) || !activated.tools || typeof activated.tools !== 'object' || Array.isArray(activated.tools)) throw new Error('Invalid tool registration');
    const tools = activated.tools as Record<string, unknown>, actual = Object.keys(tools).sort();
    if (actual.length !== declared.length || !actual.every((name, index) => name === declared[index] && typeof tools[name] === 'function')) throw new Error('Manifest mismatch');
    if ('dispose' in activated && activated.dispose !== undefined && typeof activated.dispose !== 'function') throw new Error('Invalid dispose hook');
    instance = activated as ActivatedModule;
    if (disposed) { try { await instance.dispose?.(); } finally { process.exit(0); } }
    send({ type: 'ready', tools: actual });
  } catch { fatal(); }
}

async function invoke(message: Record<string, unknown>): Promise<void> {
  const { id, toolName, json } = message;
  if (typeof id !== 'string' || id.length > 100) { fatal(); return; }
  if (disposed || !instance || typeof toolName !== 'string' || !Object.hasOwn(instance.tools, toolName) || typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > ARGUMENT_BYTES || activeCalls.has(id) || activeCalls.size >= 16) { send({ type: 'result', id, ok: false }); return; }
  const controller = new AbortController();
  activeCalls.set(id, controller);
  try {
    const args: unknown = JSON.parse(json);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments');
    const result = await instance.tools[toolName](args as Record<string, unknown>, { signal: controller.signal });
    controller.signal.throwIfAborted();
    const resultJson = JSON.stringify(result === undefined ? null : result);
    if (Buffer.byteLength(resultJson, 'utf8') > RESULT_BYTES) throw new Error('Oversized result');
    if (!disposed) send({ type: 'result', id, ok: true, json: resultJson });
  } catch { if (!disposed) send({ type: 'result', id, ok: false }); }
  finally { activeCalls.delete(id); }
}

parent.on('message', event => {
  const message: unknown = event.data;
  if (!message || typeof message !== 'object' || Array.isArray(message)) { fatal(); return; }
  const value = message as Record<string, unknown>;
  if (value.type === 'initialize') void initialize(value);
  else if (value.type === 'invoke') void invoke(value);
  else if (value.type === 'cancel' && typeof value.id === 'string') activeCalls.get(value.id)?.abort();
  else if (value.type === 'dispose') void dispose();
  else fatal();
});

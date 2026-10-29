/** Utility-process entry. Approved modules have normal OS user rights, not sandboxed access. */
export {};
import { attentionKeySchema, moduleAttentionInputSchema } from '../shared/module-attention';
import type { OperationIdentity } from '../shared/operations';

const parent = process.parentPort;
if (!parent) process.exit(1);
const ARGUMENT_BYTES = 16 * 1024;
const RESULT_BYTES = 32 * 1024;
type ToolContext = { signal: AbortSignal; operation?: OperationIdentity };
type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>;
type ActivatedModule = { tools: Record<string, ToolHandler>; prepareOperation?(request: { toolName: string; args: Record<string, unknown> }, context: ToolContext): unknown | Promise<unknown>; reconcile?(request: { toolName: string; args: Record<string, unknown>; operation: OperationIdentity }, context: ToolContext): unknown | Promise<unknown>; dispose?(): void | Promise<void> };
let instance: ActivatedModule | undefined;
let initializing = false, disposed = false;
const activeCalls = new Map<string, AbortController>();
function operationIdentity(value: unknown): OperationIdentity | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid operation identity');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['runId', 'actionId', 'attemptId', 'argsHash'].includes(key)) || !['runId', 'actionId', 'attemptId'].every(key => typeof raw[key] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw[key] as string)) || typeof raw.argsHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.argsHash)) throw new Error('Invalid operation identity');
  return { runId: raw.runId as string, actionId: raw.actionId as string, attemptId: raw.attemptId as string, argsHash: raw.argsHash };
}

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
    const attention = Object.freeze({
      publish(notice: unknown) { if (!disposed) send({ type: 'attention', notice: moduleAttentionInputSchema.parse(notice) }); },
      clear(key: unknown) { if (!disposed) send({ type: 'attention-clear', key: attentionKeySchema.parse(key) }); }
    });
    const activated: unknown = await backend.activate({ moduleId: message.moduleId, dataDirectory: message.dataDirectory, attention });
    if (!activated || typeof activated !== 'object' || !('tools' in activated) || !activated.tools || typeof activated.tools !== 'object' || Array.isArray(activated.tools)) throw new Error('Invalid tool registration');
    const tools = activated.tools as Record<string, unknown>, actual = Object.keys(tools).sort();
    if (actual.length !== declared.length || !actual.every((name, index) => name === declared[index] && typeof tools[name] === 'function')) throw new Error('Manifest mismatch');
    if ('dispose' in activated && activated.dispose !== undefined && typeof activated.dispose !== 'function') throw new Error('Invalid dispose hook');
    if ('reconcile' in activated && activated.reconcile !== undefined && typeof activated.reconcile !== 'function') throw new Error('Invalid reconciliation hook');
    if ('prepareOperation' in activated && activated.prepareOperation !== undefined && typeof activated.prepareOperation !== 'function') throw new Error('Invalid operation preparation hook');
    instance = activated as ActivatedModule;
    if (disposed) { try { await instance.dispose?.(); } finally { process.exit(0); } }
    send({ type: 'ready', tools: actual, reconciliation: typeof instance.reconcile === 'function' });
  } catch { fatal(); }
}

async function invoke(message: Record<string, unknown>, kind: 'invoke' | 'reconcile' | 'prepare' = 'invoke'): Promise<void> {
  const { id, toolName, json } = message;
  if (typeof id !== 'string' || id.length > 100) { fatal(); return; }
  if (disposed || !instance || typeof toolName !== 'string' || !Object.hasOwn(instance.tools, toolName) || typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > ARGUMENT_BYTES || activeCalls.has(id) || activeCalls.size >= 16) { send({ type: 'result', id, ok: false }); return; }
  const controller = new AbortController();
  activeCalls.set(id, controller);
  try {
    const args: unknown = JSON.parse(json);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments');
    const operation = operationIdentity(message.operation);
    if (kind === 'reconcile' && !operation) throw new Error('Reconciliation requires operation identity');
    const context: ToolContext = { signal: controller.signal, ...(operation ? { operation } : {}) };
    let result: unknown;
    if (kind === 'prepare') result = instance.prepareOperation ? await instance.prepareOperation({ toolName, args: args as Record<string, unknown> }, context) : { args };
    else if (kind === 'reconcile') result = instance.reconcile ? await instance.reconcile({ toolName, args: args as Record<string, unknown>, operation: operation! }, context) : { state: 'unknown', detail: 'Dieses Modul bietet keinen Statusabgleich für frühere Aktionen an.' };
    else result = await instance.tools[toolName](args as Record<string, unknown>, context);
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
  else if (value.type === 'reconcile') void invoke(value, 'reconcile');
  else if (value.type === 'prepare') void invoke(value, 'prepare');
  else if (value.type === 'cancel' && typeof value.id === 'string') activeCalls.get(value.id)?.abort();
  else if (value.type === 'dispose') void dispose();
  else fatal();
});

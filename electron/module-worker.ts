/** Utility-process entry. Approved modules have normal OS user rights, not sandboxed access. */
export {};
import { attentionKeySchema, moduleAttentionInputSchema } from '../shared/module-attention';
import type { OperationIdentity } from '../shared/operations';
import { moduleEventSchema, type ModuleEvent } from '../shared/module-events';
import { randomUUID } from 'node:crypto';

const parent = process.parentPort;
if (!parent) process.exit(1);
const ARGUMENT_BYTES = 16 * 1024;
const RESULT_BYTES = 32 * 1024;
type ToolContext = { signal: AbortSignal; operation?: OperationIdentity };
type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>;
type ActivatedModule = { tools: Record<string, ToolHandler>; prepareOperation?(request: { toolName: string; args: Record<string, unknown> }, context: ToolContext): unknown | Promise<unknown>; reconcile?(request: { toolName: string; args: Record<string, unknown>; operation: OperationIdentity }, context: ToolContext): unknown | Promise<unknown>; onEvent?(event: ModuleEvent, context: { signal: AbortSignal }): unknown | Promise<unknown>; dispose?(): void | Promise<void> };
let instance: ActivatedModule | undefined;
let initializing = false, disposed = false;
const activeCalls = new Map<string, AbortController>();
let subscriptions: string[] = [], publications: string[] = [], handlingEvent = false;
const pendingPublications = new Map<string, { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
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
  for (const pending of pendingPublications.values()) { clearTimeout(pending.timer); pending.reject(new Error('Module disposed')); }
  pendingPublications.clear();
  try { await instance?.dispose?.(); } catch { /* Do not publish arbitrary exception details. */ }
  process.exit(0);
}

async function initialize(message: Record<string, unknown>): Promise<void> {
  if (initializing || instance || disposed) { fatal(); return; }
  initializing = true;
  if (typeof message.moduleId !== 'string' || typeof message.entryPath !== 'string' || typeof message.dataDirectory !== 'string' || !Array.isArray(message.tools) || !message.tools.length || message.tools.length > 64 || !message.tools.every(name => typeof name === 'string' && name.startsWith(message.moduleId + '.'))) { fatal(); return; }
  const declared = [...message.tools as string[]].sort();
  if (!Array.isArray(message.subscriptions) || !Array.isArray(message.publications) || ![...message.subscriptions, ...message.publications].every(item => typeof item === 'string')) { fatal(); return; }
  subscriptions = message.subscriptions as string[]; publications = message.publications as string[];
  if (new Set(declared).size !== declared.length) { fatal(); return; }
  try {
    // This import runs in the module process only, after the host's fingerprint approval.
    const backend: unknown = require(message.entryPath);
    if (!backend || typeof backend !== 'object' || !('activate' in backend) || typeof backend.activate !== 'function') throw new Error('Invalid activation export');
    const attention = Object.freeze({
      publish(notice: unknown) { if (!disposed) send({ type: 'attention', notice: moduleAttentionInputSchema.parse(notice) }); },
      clear(key: unknown) { if (!disposed) send({ type: 'attention-clear', key: attentionKeySchema.parse(key) }); }
    });
    const events = Object.freeze({ publish(input: unknown): Promise<void> {
      if (disposed || handlingEvent || pendingPublications.size >= 4) return Promise.reject(new Error('Event publication is unavailable during event handling or shutdown.'));
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['id', 'type', 'occurredAt', 'payload'].includes(key))) return Promise.reject(new Error('Invalid event publication.'));
      const value = input as Record<string, unknown>;
      if (typeof value.type !== 'string' || !publications.includes(value.type)) return Promise.reject(new Error('Undeclared event topic.'));
      const parsed = moduleEventSchema.safeParse({ ...value, version: 1, source: { moduleId: message.moduleId } });
      if (!parsed.success) return Promise.reject(new Error('Invalid event publication.'));
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pendingPublications.delete(requestId); reject(new Error('Event publication acknowledgement timed out; retry only this same event ID.')); }, 15000);
        pendingPublications.set(requestId, { resolve, reject, timer });
        send({ type: 'event-publish', requestId, event: parsed.data });
      });
    } });
    const activated: unknown = await backend.activate({ moduleId: message.moduleId, dataDirectory: message.dataDirectory, attention, events });
    if (!activated || typeof activated !== 'object' || !('tools' in activated) || !activated.tools || typeof activated.tools !== 'object' || Array.isArray(activated.tools)) throw new Error('Invalid tool registration');
    const tools = activated.tools as Record<string, unknown>, actual = Object.keys(tools).sort();
    if (actual.length !== declared.length || !actual.every((name, index) => name === declared[index] && typeof tools[name] === 'function')) throw new Error('Manifest mismatch');
    if ('dispose' in activated && activated.dispose !== undefined && typeof activated.dispose !== 'function') throw new Error('Invalid dispose hook');
    if ('reconcile' in activated && activated.reconcile !== undefined && typeof activated.reconcile !== 'function') throw new Error('Invalid reconciliation hook');
    if ('prepareOperation' in activated && activated.prepareOperation !== undefined && typeof activated.prepareOperation !== 'function') throw new Error('Invalid operation preparation hook');
    if (('onEvent' in activated && activated.onEvent !== undefined && typeof activated.onEvent !== 'function') || (subscriptions.length && !('onEvent' in activated && typeof activated.onEvent === 'function'))) throw new Error('Missing event handler');
    instance = activated as ActivatedModule;
    if (disposed) { try { await instance.dispose?.(); } finally { process.exit(0); } }
    send({ type: 'ready', tools: actual, reconciliation: typeof instance.reconcile === 'function', events: typeof instance.onEvent === 'function' });
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

async function receiveEvent(message: Record<string, unknown>): Promise<void> {
  const id = message.id;
  if (typeof id !== 'string' || id.length > 100) { fatal(); return; }
  if (disposed || !instance?.onEvent || handlingEvent || activeCalls.has(id) || typeof message.json !== 'string' || Buffer.byteLength(message.json, 'utf8') > ARGUMENT_BYTES) { send({ type: 'result', id, ok: false }); return; }
  const controller = new AbortController();
  activeCalls.set(id, controller); handlingEvent = true;
  try {
    const event = moduleEventSchema.parse(JSON.parse(message.json));
    if (!subscriptions.includes(event.type)) throw new Error('Undeclared subscription');
    const result = await instance.onEvent(event, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || !('ack' in result) || result.ack !== event.id) throw new Error('Event must be acknowledged after durable processing');
    if (!disposed) send({ type: 'result', id, ok: true, json: JSON.stringify({ ack: event.id }) });
  } catch { if (!disposed) send({ type: 'result', id, ok: false }); }
  finally { activeCalls.delete(id); handlingEvent = false; }
}

parent.on('message', event => {
  const message: unknown = event.data;
  if (!message || typeof message !== 'object' || Array.isArray(message)) { fatal(); return; }
  const value = message as Record<string, unknown>;
  if (value.type === 'initialize') void initialize(value);
  else if (value.type === 'event') void receiveEvent(value);
  else if (value.type === 'event-published' && typeof value.requestId === 'string') {
    const pending = pendingPublications.get(value.requestId);
    if (pending) { pendingPublications.delete(value.requestId); clearTimeout(pending.timer); if (value.ok === true) pending.resolve(); else pending.reject(new Error('Event publication was rejected; retry only the same event ID.')); }
  }
  else if (value.type === 'invoke') void invoke(value);
  else if (value.type === 'reconcile') void invoke(value, 'reconcile');
  else if (value.type === 'prepare') void invoke(value, 'prepare');
  else if (value.type === 'cancel' && typeof value.id === 'string') activeCalls.get(value.id)?.abort();
  else if (value.type === 'dispose') void dispose();
  else fatal();
});

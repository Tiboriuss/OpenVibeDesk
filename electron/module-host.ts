import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Ajv, { type ValidateFunction } from 'ajv';
import { z } from 'zod';
import { ModuleRegistry } from './modules';
import { ModuleRuntimeManager } from './module-runtime';
import { type CapabilityContext, type WorkspaceCapabilityRegistry } from './workspace-capabilities';
import type { ModuleInfo, ModuleQuery, ModuleSummary, ModuleToolDescriptor, ModuleToolListing, ModuleToolQuery } from '../shared/modules';
import type { ModuleToolProvider } from '../shared/module-tool-provider';
import type { OperationBinding, OperationIdentity, OperationReconciliation } from '../shared/operations';
import { ATTENTION_PULSE_MS, MAX_ATTENTION, MAX_MODULE_ATTENTION, attentionAcknowledgementSchema, attentionKeySchema, moduleAttentionInputSchema, type ModuleAttention, type ModuleAttentionInput } from '../shared/module-attention';
import { moduleReferenceInputSchema, moduleReferenceSchema, type ModuleReference } from '../shared/references';

type HostOptions = {
  builtInRoot: string; userRoot: string; dataRoot: string; configFile: string;
  /** Hash of the executing host/adapter implementation, captured once at startup. */
  operationHostFingerprint?: string;
  /** Read the live user grant; a run's captured configuration cannot retain revoked access. */
  agentExecutionAllowed?(): boolean;
  capabilities: WorkspaceCapabilityRegistry;
  activateBuiltin(id: string): Promise<void>;
  beforeDisable(id: string): Promise<void>;
  afterDisable(id: string): void | Promise<void>;
  changed(): void;
  attentionChanged?(): void;
  packageCommitted?(moduleId: string, fingerprint: string): boolean | Promise<boolean>;
  openView(moduleId: string, viewId: string): Promise<void>;
  controlView(moduleId: string, viewId: string, action: 'minimize' | 'toggleMaximize' | 'close'): unknown;
  openSettings(category: string): Promise<void>;
  confirm(context: CapabilityContext, message: string, detail: string, options?: { alwaysAsk?: boolean }): Promise<boolean>;
};
type Binding = { descriptor: ModuleToolDescriptor; action: string; kind: 'capability' | 'process' | 'view' | 'settings' | 'window'; validate?: ValidateFunction; confirmation?: { title?: string; message: string } };
export type ModuleOperationAdapter = {
  prepare(action: string, args: Record<string, unknown>, context: CapabilityContext): { args: Record<string, unknown>; resource?: OperationBinding['resource']; effect?: OperationBinding['effect'] } | Promise<{ args: Record<string, unknown>; resource?: OperationBinding['resource']; effect?: OperationBinding['effect'] }>;
  reconcile?(action: string, args: Record<string, unknown>, operation: OperationIdentity, context: CapabilityContext, binding: OperationBinding): Promise<OperationReconciliation>;
};
export interface ModulePackageInstall {
  moduleId: string;
  stagedDirectory: string;
  /** Omitted only for a new installation. Updates must name the observed installed fingerprint. */
  expectedFingerprint?: string;
  /** Persist the source receipt atomically; reject without changing it if persistence fails. */
  commit(): Promise<void>;
}
const configSchema = z.object({ version: z.literal(1), disabled: z.array(z.string().max(128)).max(500), approvals: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) }).strict();
const packageJournalSchema = z.object({ version: z.literal(1), moduleId: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/).max(80), backup: z.string().regex(/^\.ovd-package-backup-[a-f0-9-]{36}$/).optional(), previousFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const toolQuerySchema = z.object({ moduleId: z.string().min(1).max(128), query: z.string().trim().max(200).optional(), offset: z.number().int().min(0).max(1000).optional(), limit: z.number().int().min(1).max(24).optional() }).strict();
const moduleQuerySchema = z.object({ query: z.string().trim().max(200).optional(), offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(20).optional() }).strict();
const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase('de-DE');
const MAX_PROVIDER_OFFERS = 5000;
const safeName = (moduleId: string, action: string, kind: string) => `${moduleId}_${action}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 49) + '_' + createHash('sha256').update(moduleId + '\0' + kind + '\0' + action).digest('hex').slice(0, 12);
function canonicalOperationArgs(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(sort(value));
}

/** Host owns activation and dispatch; the model only sees bounded metadata and selected schemas. */
export class ModuleHost {
  readonly registry = new ModuleRegistry();
  private config: z.infer<typeof configSchema> = { version: 1, disabled: [], approvals: {} };
  private configError = false;
  private readonly bindings = new Map<string, Map<string, Binding>>();
  private readonly runtimes: ModuleRuntimeManager;
  private readonly ajv = new Ajv({ strict: true, validateFormats: false, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  private readonly activation = new Map<string, Promise<void>>();
  private changing = false;
  private readonly pending = new Map<string, number>();
  private readonly toolProviders = new Map<string, ModuleToolProvider<CapabilityContext>>();
  private readonly providerOffers = new Map<string, { fingerprint: string; retired: boolean }>();
  private readonly attention = new Map<string, ModuleAttention>();
  private readonly operationAdapters = new Map<string, ModuleOperationAdapter>();

  constructor(private readonly options: HostOptions) {
    this.runtimes = new ModuleRuntimeManager({ dataRoot: options.dataRoot,
      onAttention: (id, notice) => this.publishAttention(id, notice),
      onAttentionClear: (id, key) => this.clearAttention(id, key),
      onFailure: (id, reason) => { this.registry.fail(id, reason); this.bindings.delete(id); this.clearModuleAttention(id); options.changed(); } });
  }
  async initialize(): Promise<void> {
    await fs.mkdir(this.options.userRoot, { recursive: true });
    await this.recoverPackageSwap();
    try { this.config = configSchema.parse(JSON.parse(await fs.readFile(this.options.configFile, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.configError = true; }
    await this.registry.discover({ builtInRoots: [this.options.builtInRoot], userRoots: [this.options.userRoot], disabledIds: new Set(this.config.disabled), trustedAdapters: new Set(['ovd-assistant-v1', 'ovd-mail-v1', 'ovd-files-v1', 'ovd-mcp-v1']) });
    for (const module of this.registry.listModules()) {
      const record = this.registry.getRuntimeRecord(module.id);
      if (!record) continue;
      try {
        if (module.status === 'approval_required' && this.config.approvals[module.id] === record.fingerprint) await this.registry.activate(module.id, record.fingerprint);
        if (this.isReady(module.id)) { await this.activateBuiltin(module.id); this.buildBindings(module.id); }
      } catch (error) { this.registry.fail(module.id, error instanceof Error ? error.message : 'Das Modul konnte nicht initialisiert werden.'); }
    }
  }
  isReady(id: string): boolean { return this.registry.getModule(id)?.status === 'ready'; }
  /** Built-ins are trusted callers; process IDs are bound by ModuleRuntimeManager. */
  publishAttention(moduleId: string, raw: ModuleAttentionInput): void {
    if (!this.isReady(moduleId)) return;
    const notice = moduleAttentionInputSchema.parse(raw), key = JSON.stringify([moduleId, notice.key]);
    const previous = this.attention.get(key);
    if (!previous) {
      const owned = [...this.attention.entries()].filter(([, item]) => item.moduleId === moduleId);
      if (owned.length >= MAX_MODULE_ATTENTION) this.attention.delete(owned[0][0]);
      if (this.attention.size >= MAX_ATTENTION) this.attention.delete(this.attention.keys().next().value!);
    }
    const now = Date.now();
    // Updating an outstanding key does not keep restarting the breathing animation.
    this.attention.set(key, { ...notice, moduleId, id: randomUUID(), createdAt: previous?.createdAt ?? now, pulseUntil: previous?.pulseUntil ?? now + ATTENTION_PULSE_MS });
    this.options.attentionChanged?.();
  }
  clearAttention(moduleId: string, rawKey: string): void {
    const key = attentionKeySchema.parse(rawKey);
    if (this.attention.delete(JSON.stringify([moduleId, key]))) this.options.attentionChanged?.();
  }
  private clearModuleAttention(moduleId: string): void {
    let changed = false;
    for (const [key, notice] of this.attention) if (notice.moduleId === moduleId) { this.attention.delete(key); changed = true; }
    if (changed) this.options.attentionChanged?.();
  }
  listAttention(moduleId?: string): ModuleAttention[] {
    return [...this.attention.values()].filter(item => this.isReady(item.moduleId) && (!moduleId || item.moduleId === moduleId)).map(item => ({ ...item }));
  }
  acknowledgeAttention(moduleId: string, ids?: string[]): { acknowledged: number } {
    const parsed = attentionAcknowledgementSchema.parse({ moduleId, ids });
    const selected = parsed.ids ? new Set(parsed.ids) : undefined;
    let acknowledged = 0;
    for (const [key, notice] of this.attention) if (notice.moduleId === moduleId && (!selected || selected.has(notice.id))) { this.attention.delete(key); acknowledged++; }
    if (acknowledged) this.options.attentionChanged?.();
    return { acknowledged };
  }
  list(): ModuleInfo[] { return this.registry.listModules(); }
  summaries(): ModuleSummary[] { return [...this.registry.listSummaries(), ...this.providerModules().map(({ summary }) => summary)]; }
  find(raw: ModuleQuery = {}) {
    const options = moduleQuerySchema.parse(raw), query = fold(options.query ?? ''), terms = query.split(/[\s._-]+/).filter(Boolean);
    const catalog = [
      ...this.list().filter(module => module.status === 'ready').map(module => ({ summary: { id: module.id, title: module.title, description: module.description.slice(0, 240) }, search: [module.id, module.title, module.description, ...(module.manifest?.keywords ?? [])].join(' ') })),
      ...this.providerModules().map(({ summary }) => ({ summary, search: `${summary.id} ${summary.title} ${summary.description}` }))
    ];
    const matches = catalog.map((item, index) => ({ ...item, index, exact: fold(item.summary.id) === query || fold(item.summary.title) === query, score: terms.filter(term => fold(item.search).includes(term)).length }))
      .filter(item => !terms.length || item.score > 0).sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.index - b.index);
    const offset = options.offset ?? 0, limit = options.limit ?? 10, hasMore = offset + limit < matches.length;
    return { modules: matches.slice(offset, offset + limit).map(({ summary }) => summary), hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) };
  }
  registerToolProvider(provider: ModuleToolProvider<CapabilityContext>): void {
    const parent = this.registry.getModule(provider.parentModuleId);
    if (!parent || parent.source !== 'builtin' || parent.manifest?.runtime.type !== 'host-adapter') throw new Error('Dynamische Werkzeugquellen benötigen einen eingebauten Hostadapter.');
    if (this.toolProviders.has(provider.parentModuleId)) throw new Error('Diese dynamische Werkzeugquelle wurde bereits registriert.');
    this.toolProviders.set(provider.parentModuleId, provider);
  }
  registerOperationAdapter(moduleId: string, adapter: ModuleOperationAdapter): void {
    const module = this.registry.getModule(moduleId);
    if (!module || module.source !== 'builtin' || module.manifest?.runtime.type !== 'host-adapter') throw new Error('Aktionsadapter benötigen einen eingebauten Hostadapter.');
    if (this.operationAdapters.has(moduleId)) throw new Error('Dieser Aktionsadapter wurde bereits registriert.');
    this.operationAdapters.set(moduleId, adapter);
  }
  private operationArgs(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Modulargumente.');
    const encoded = JSON.stringify(value);
    if (encoded.length > 16000) throw new Error('Ungültige Modulargumente.');
    return JSON.parse(encoded) as Record<string, unknown>;
  }
  private validateBindingArgs(binding: Binding, args: Record<string, unknown>): Record<string, unknown> {
    if (binding.kind === 'capability') return this.options.capabilities.validate(binding.action, args);
    if (binding.kind === 'window') return z.object({ action: z.enum(['minimize', 'toggleMaximize', 'close']) }).strict().parse(args);
    if (binding.kind === 'view' || binding.kind === 'settings') {
      if (Object.keys(args).length) throw new Error('Diese Funktion benötigt keine Argumente.');
      return {};
    }
    if (!binding.validate!(args)) throw new Error('Die Argumente entsprechen nicht dem deklarierten Modulschema.');
    return args;
  }
  private async startProcess(id: string) {
    const record = this.requireReady(id);
    let starting = this.activation.get(id);
    if (!starting) { starting = this.registry.verifyUnchanged(id).then(() => this.runtimes.start(record)); this.activation.set(id, starting); }
    await starting;
    this.requireReady(id);
    return record;
  }
  private assertAgentAccess(context: CapabilityContext): void {
    if (context.origin === 'agent' && this.options.agentExecutionAllowed?.() === false) throw new Error('Die Workspace-Werkzeuge wurden vom Nutzer deaktiviert. Es wird keine weitere Assistentenaktion gestartet.');
  }
  /** Resolve logical journal identity to a fresh offer; never reuse a retired transport name. */
  async getOperationTool(binding: OperationBinding): Promise<ModuleToolDescriptor | undefined> {
    if (this.changing) throw new Error('Die Modulverwaltung wird gerade geändert. Bitte danach erneut versuchen.');
    const provider = this.providerFor(binding.moduleId);
    if (provider) {
      this.requireReady(provider.parentModuleId); await this.registry.verifyUnchanged(provider.parentModuleId);
      const raw = provider.getOperationTool?.(binding);
      if (!raw) return;
      const tool = this.providerDescriptor(raw), current = provider.getTool(binding.moduleId, tool.name);
      if (!current || this.providerFingerprint(this.providerDescriptor(current)) !== this.providerFingerprint(tool)) throw new Error('Die aktuelle Werkzeugbindung hat sich während der Auswahl geändert.');
      this.rememberProviderOffer(binding.moduleId, tool);
      return tool;
    }
    this.requireReady(binding.moduleId); await this.registry.verifyUnchanged(binding.moduleId);
    const current = [...(this.bindings.get(binding.moduleId) ?? this.buildBindings(binding.moduleId)).values()].find(item => item.action === binding.action);
    return current ? structuredClone(current.descriptor) : undefined;
  }
  /** Freeze validated resource arguments before durable intent is written. No domain tool executes here. */
  async prepareOperation(id: string, name: string, rawArgs: unknown, context: CapabilityContext): Promise<{ binding: OperationBinding; args: Record<string, unknown>; label: string }> {
    this.assertAgentAccess(context);
    if (this.changing) throw new Error('Die Modulverwaltung wird gerade geändert. Bitte danach erneut versuchen.');
    context.signal.throwIfAborted();
    const args = this.operationArgs(rawArgs), provider = this.providerFor(id);
    if (provider) {
      this.requireReady(provider.parentModuleId);
      await this.registry.verifyUnchanged(provider.parentModuleId);
      const current = provider.getTool(id, name), offered = this.providerOffers.get(`${id}\0${name}`);
      if (!current || current.name !== name || !offered || offered.retired || offered.fingerprint !== this.providerFingerprint(this.providerDescriptor(current))) throw new Error('Dieses dynamische Werkzeug ist nicht mehr in der angebotenen Version verfügbar. Bitte passende Modulwerkzeuge neu laden.');
      if (provider.prepareOperation) {
        const prepared = await provider.prepareOperation(id, name, args, context);
        this.assertAgentAccess(context);
        if (prepared.binding.moduleId !== id || !prepared.binding.action || !prepared.binding.fingerprint || !['read', 'write', 'unknown'].includes(prepared.binding.effect)) throw new Error('Die dynamische Quelle hat keine gültige Aktionsbindung geliefert.');
        const after = provider.getTool(id, name);
        if (!after || this.providerFingerprint(this.providerDescriptor(after)) !== offered.fingerprint) throw new Error('Die dynamische Werkzeugbindung wurde während der Vorbereitung geändert.');
        return { binding: structuredClone(prepared.binding), args: this.operationArgs(prepared.args), label: prepared.label?.slice(0, 160) || current.label || name };
      }
      this.assertAgentAccess(context);
      return { binding: { moduleId: id, action: name, fingerprint: offered.fingerprint, effect: 'unknown' }, args, label: current.label || name };
    }
    const record = this.requireReady(id);
    await this.registry.verifyUnchanged(id);
    const binding = (this.bindings.get(id) ?? this.buildBindings(id)).get(name);
    if (!binding) throw new Error('Diese Funktion gehört nicht zum ausgewählten Modul.');
    let normalized = this.validateBindingArgs(binding, args), resource: OperationBinding['resource'], effect: OperationBinding['effect'] = 'unknown';
    const adapter = this.operationAdapters.get(id);
    if (adapter) {
      const prepared = await adapter.prepare(binding.action, normalized, context);
      normalized = this.validateBindingArgs(binding, this.operationArgs(prepared.args)); resource = prepared.resource; effect = prepared.effect ?? 'unknown';
    } else if (binding.kind === 'process') {
      const processRecord = await this.startProcess(id);
      context.signal.throwIfAborted();
      const prepared = await this.runtimes.prepareOperation(processRecord, binding.action, normalized, context.signal);
      normalized = this.validateBindingArgs(binding, this.operationArgs(prepared.args ?? normalized)); resource = prepared.resource;
    }
    context.signal.throwIfAborted(); this.assertAgentAccess(context); this.requireReady(id);
    const fingerprint = createHash('sha256').update(JSON.stringify([this.options.operationHostFingerprint ?? '', record.fingerprint, binding.kind, binding.action, binding.descriptor.parameters])).digest('hex');
    return { binding: { moduleId: id, action: binding.action, fingerprint, effect, ...(resource ? { resource: structuredClone(resource) } : {}) }, args: normalized, label: binding.descriptor.label || binding.action };
  }
  /** A status hook is separate from execution. Unknown outcomes never fall back to invoking the original tool. */
  async reconcileOperation(binding: OperationBinding, args: Record<string, unknown>, operation: OperationIdentity, context: CapabilityContext): Promise<OperationReconciliation> {
    context.signal.throwIfAborted();
    if (this.changing) throw new Error('Die Modulverwaltung wird gerade geändert. Bitte danach erneut versuchen.');
    const provider = this.providerFor(binding.moduleId);
    if (provider) {
      if ((this.pending.get(provider.parentModuleId) ?? 0) > 0) return { state: 'unknown', detail: 'In dieser Quelle läuft noch ein Vorgang. Bitte seinen Abschluss abwarten; es wird kein weiterer Aufruf gestartet.' };
      this.requireReady(provider.parentModuleId); await this.registry.verifyUnchanged(provider.parentModuleId);
      this.pending.set(provider.parentModuleId, 1);
      try { return provider.reconcileOperation ? await provider.reconcileOperation(binding, this.operationArgs(args), operation, context) : { state: 'unknown', detail: 'Diese Quelle bietet keinen Statusabgleich für frühere Aktionen an.' }; }
      finally { this.pending.set(provider.parentModuleId, Math.max(0, (this.pending.get(provider.parentModuleId) ?? 1) - 1)); }
    }
    if ((this.pending.get(binding.moduleId) ?? 0) > 0 || this.runtimes.isBusy(binding.moduleId)) return { state: 'unknown', detail: 'In diesem Modul läuft noch ein Vorgang. Bitte seinen Abschluss abwarten; es wird keine Aktion wiederholt.' };
    const record = this.requireReady(binding.moduleId);
    const current = [...(this.bindings.get(binding.moduleId) ?? this.buildBindings(binding.moduleId)).values()].find(item => item.action === binding.action);
    if (!current) throw new Error('Die frühere Modulfunktion ist nicht mehr verfügbar.');
    const prepared = await this.prepareOperation(binding.moduleId, current.descriptor.name, args, context);
    if (prepared.binding.fingerprint !== binding.fingerprint || prepared.binding.effect !== binding.effect || prepared.binding.resource?.id !== binding.resource?.id || canonicalOperationArgs(prepared.args) !== canonicalOperationArgs(this.operationArgs(args))) throw new Error('Die frühere Aktion gehört nicht mehr zu derselben Modul- und Ressourcenbindung.');
    const adapter = this.operationAdapters.get(binding.moduleId);
    this.pending.set(binding.moduleId, (this.pending.get(binding.moduleId) ?? 0) + 1);
    try {
      if (adapter?.reconcile) return await adapter.reconcile(binding.action, prepared.args, operation, context, binding);
      if (current.kind === 'process') return await this.runtimes.reconcile(await this.startProcess(record.module.id), current.action, prepared.args, operation, context.signal);
      return { state: 'unknown', detail: 'Dieses Modul bietet keinen Statusabgleich für frühere Aktionen an.' };
    } finally { this.pending.set(binding.moduleId, Math.max(0, (this.pending.get(binding.moduleId) ?? 1) - 1)); }
  }
  private async beforeOperationDispatch(context: CapabilityContext): Promise<void> {
    this.assertAgentAccess(context);
    context.signal.throwIfAborted();
    await context.validateOperation?.();
    context.signal.throwIfAborted();
    this.assertAgentAccess(context);
    await context.beforeDispatch?.();
    context.signal.throwIfAborted();
    // Intent acknowledgement can yield to settings/resource changes. Recheck
    // once more after fsync, then enter the actual handler without that gap.
    await context.validateOperation?.();
    context.signal.throwIfAborted();
    this.assertAgentAccess(context);
  }
  private providerModules(): { provider: ModuleToolProvider<CapabilityContext>; summary: ModuleSummary }[] {
    const result: { provider: ModuleToolProvider<CapabilityContext>; summary: ModuleSummary }[] = [];
    const ids = new Set<string>();
    for (const provider of this.toolProviders.values()) {
      if (!this.isReady(provider.parentModuleId)) continue;
      for (const item of provider.listModules().slice(0, 500)) {
        if (!item.id.startsWith(provider.parentModuleId + '.') || item.id.length > 128 || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(item.id) || ids.has(item.id) || this.registry.getModule(item.id)) continue;
        if (typeof item.title !== 'string' || typeof item.description !== 'string') continue;
        ids.add(item.id);
        result.push({ provider, summary: { id: item.id, title: item.title.slice(0, 160), description: item.description.slice(0, 240) } });
      }
    }
    return result;
  }
  private providerFor(moduleId: string) {
    return this.providerModules().find(item => item.summary.id === moduleId)?.provider;
  }
  private providerDescriptor(raw: ModuleToolDescriptor): ModuleToolDescriptor {
    if (!raw || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.name) || ['find_modules', 'get_module_tools'].includes(raw.name) || typeof raw.description !== 'string' || raw.description.length > 2000 || !raw.parameters || raw.parameters.type !== 'object') throw new Error('Die dynamische Quelle bietet eine ungültige Werkzeugbeschreibung an.');
    const encoded = JSON.stringify(raw.parameters);
    if (encoded.length > 12000) throw new Error('Das dynamische Werkzeugschema ist zu groß.');
    // Copy the exact offered schema so a provider cannot mutate an earlier offer.
    return { name: raw.name, description: raw.description, parameters: JSON.parse(encoded) as Record<string, unknown>, ...(typeof raw.label === 'string' ? { label: raw.label.slice(0, 120) } : {}) };
  }
  private providerFingerprint(descriptor: ModuleToolDescriptor): string {
    return createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
  }
  private rememberProviderOffer(moduleId: string, descriptor: ModuleToolDescriptor): void {
    const key = `${moduleId}\0${descriptor.name}`, fingerprint = this.providerFingerprint(descriptor), previous = this.providerOffers.get(key);
    if (previous && (previous.retired || previous.fingerprint !== fingerprint)) {
      this.touchProviderOffer(key, { fingerprint: previous.fingerprint, retired: true });
      throw new Error('Die dynamische Quelle hat ein bereits angebotenes Werkzeug verändert. Bitte die Verbindung erneuern und die Werkzeuge neu laden.');
    }
    this.touchProviderOffer(key, { fingerprint, retired: false });
  }
  private touchProviderOffer(key: string, offer: { fingerprint: string; retired: boolean }): void {
    this.providerOffers.delete(key);
    this.providerOffers.set(key, offer);
    while (this.providerOffers.size > MAX_PROVIDER_OFFERS) this.providerOffers.delete(this.providerOffers.keys().next().value!);
  }
  statuses() { return this.list().map(({ id, title, description, version, status, required, reason }) => ({ id, title, description, version, status, required, ...(reason ? { reason } : {}) })); }
  private requireReady(id: string) {
    const record = this.registry.getRuntimeRecord(id);
    if (!record || record.module.status !== 'ready') throw new Error('Das Modul ist nicht verfügbar oder noch nicht freigegeben.');
    return record;
  }
  private async activateBuiltin(id: string): Promise<void> {
    if (this.registry.getModule(id)?.manifest?.runtime.type === 'host-adapter') await this.options.activateBuiltin(id);
  }
  private buildBindings(id: string): Map<string, Binding> {
    const record = this.requireReady(id), manifest = record.module.manifest!;
    const bindings = new Map<string, Binding>();
    const add = (action: string, description: string, parameters: Record<string, unknown>, label: string, kind: Binding['kind'], validate?: ValidateFunction, confirmation?: Binding['confirmation']) => {
      const name = safeName(id, action, kind);
      bindings.set(name, { action, kind, descriptor: { name, description, parameters, label }, ...(validate ? { validate } : {}), ...(confirmation ? { confirmation } : {}) });
    };
    if (manifest.runtime.type === 'host-adapter') {
      const catalog = this.options.capabilities.getRegisteredCatalog();
      if (manifest.capabilities.some(name => !catalog.some(item => item.name === name))) throw new Error('Mindestens eine deklarierte Modulfunktion ist nicht angebunden.');
      for (const capability of catalog.filter(item => manifest.capabilities.includes(item.name))) add(capability.name, capability.description, capability.parameters, capability.label, 'capability');
    } else {
      for (const tool of manifest.tools ?? []) {
        let validate: ValidateFunction;
        try { validate = this.ajv.compile(tool.parameters); }
        catch { throw new Error(`Das Argument-Schema von ${tool.name} wird nicht unterstützt.`); }
        add(tool.name, tool.description, tool.parameters, tool.label ?? tool.name, 'process', validate, tool.confirmation);
      }
      for (const view of manifest.contributions.views) {
        add(`view.${view.id}`, `Öffne die Modulansicht ${view.title}.`, { type: 'object', properties: {}, additionalProperties: false }, `${view.title} öffnen`, 'view');
        add(`window.${view.id}`, `Minimiere, maximiere oder schließe das Modulfenster ${view.title}.`, { type: 'object', properties: { action: { type: 'string', enum: ['minimize', 'toggleMaximize', 'close'] } }, required: ['action'], additionalProperties: false }, `${view.title} steuern`, 'window');
      }
    }
    for (const settings of manifest.contributions.settings) add(`settings.${settings.id}`, `Öffne die Einstellungen ${settings.title} des Moduls ${manifest.title}.`, { type: 'object', properties: {}, additionalProperties: false }, `${settings.title} öffnen`, 'settings');
    this.bindings.set(id, bindings);
    return bindings;
  }
  getTools(raw: ModuleToolQuery): ModuleToolListing {
    const query = toolQuerySchema.parse(raw);
    const provider = this.providerFor(query.moduleId);
    if (provider) {
      const result = provider.getTools(query);
      if (result.moduleId !== query.moduleId || !Array.isArray(result.tools) || result.tools.length > (query.limit ?? 6) || typeof result.hasMore !== 'boolean' || (result.hasMore && (!Number.isSafeInteger(result.nextOffset) || result.nextOffset! <= (query.offset ?? 0)))) throw new Error('Die dynamische Werkzeugliste entspricht nicht der Anfrage.');
      const tools = result.tools.map(item => this.providerDescriptor(item));
      if (new Set(tools.map(item => item.name)).size !== tools.length) throw new Error('Die dynamische Werkzeugliste enthält doppelte Namen.');
      for (const tool of tools) {
        const current = provider.getTool(query.moduleId, tool.name);
        if (!current || this.providerFingerprint(this.providerDescriptor(current)) !== this.providerFingerprint(tool)) throw new Error('Der dynamische Werkzeugkatalog hat sich während der Auswahl geändert. Bitte erneut laden.');
        this.rememberProviderOffer(query.moduleId, tool);
      }
      return { moduleId: query.moduleId, tools, hasMore: result.hasMore, ...(result.hasMore ? { nextOffset: result.nextOffset } : {}) };
    }
    this.requireReady(query.moduleId);
    const bindings = this.bindings.get(query.moduleId) ?? this.buildBindings(query.moduleId);
    const terms = fold(query.query ?? '').split(/[\s._-]+/).filter(Boolean);
    const ranked = [...bindings.values()].map(item => ({ item, exact: fold(item.action) === fold(query.query ?? ''), actionScore: terms.filter(term => fold(item.action).includes(term)).length, score: terms.reduce((score, term) => score + (fold(`${item.action} ${item.descriptor.label} ${item.descriptor.description}`).includes(term) ? 1 : 0), 0) }));
    const all = ranked.filter(({ score }) => !terms.length || score > 0).sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || b.actionScore - a.actionScore);
    const offset = query.offset ?? 0, limit = query.limit ?? 6, hasMore = offset + limit < all.length;
    return { moduleId: query.moduleId, tools: all.slice(offset, offset + limit).map(({ item }) => item.descriptor), hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) };
  }
  /** Resolve only an approved module's declared resource. Roles come from its approved manifest. */
  async resolveReference(raw: unknown, context: CapabilityContext): Promise<ModuleReference> {
    const input = moduleReferenceInputSchema.parse(raw), record = this.requireReady(input.moduleId);
    const contribution = record.module.manifest?.contributions.referenceTypes?.find(item => item.id === input.type);
    if (record.module.manifest?.runtime.type !== 'process' || !contribution?.snapshotTool) throw new Error('Dieses Modul bietet keine lesbare Referenz dieses Typs an.');
    await this.registry.verifyUnchanged(input.moduleId);
    const result = await this.invoke(input.moduleId, contribution.snapshotTool, { id: input.id }, context, true);
    context.signal.throwIfAborted();
    this.requireReady(input.moduleId);
    await this.registry.verifyUnchanged(input.moduleId);
    if (this.requireReady(input.moduleId).fingerprint !== record.fingerprint) throw new Error('Das Modul wurde während des Lesens geändert. Bitte die Referenz erneut auswählen.');
    // A backend cannot promote ordinary resource data to instructions by returning a role.
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Das Modul hat keine gültige Referenz zurückgegeben.');
    const { usage: _ignoredUsage, ...snapshot } = result as Record<string, unknown>;
    const reference = moduleReferenceSchema.parse({ ...snapshot, usage: contribution.usage ?? 'context' });
    if (reference.moduleId !== input.moduleId || reference.type !== input.type || reference.id !== input.id) throw new Error('Das Modul hat eine andere Referenz zurückgegeben.');
    if (contribution.usage === 'instructions' && (!reference.readable || reference.truncated || !reference.text?.trim())) throw new Error('Die Arbeitsanweisung konnte nicht vollständig gelesen werden. Bitte den Skill erneut öffnen.');
    return reference;
  }
  async invoke(id: string, name: string, args: unknown, context: CapabilityContext, fromUi = false): Promise<unknown> {
    this.assertAgentAccess(context);
    if (this.changing) throw new Error('Die Modulverwaltung wird gerade geändert. Bitte danach erneut versuchen.');
    const provider = this.providerFor(id);
    if (provider) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 16000) throw new Error('Ungültige Modulargumente.');
      const current = provider.getTool(id, name), offered = this.providerOffers.get(`${id}\0${name}`);
      if (!current || current.name !== name || !offered || offered.retired || offered.fingerprint !== this.providerFingerprint(this.providerDescriptor(current))) throw new Error('Dieses dynamische Werkzeug ist nicht mehr in der angebotenen Version verfügbar. Bitte passende Modulwerkzeuge neu laden.');
      context.signal.throwIfAborted();
      this.touchProviderOffer(`${id}\0${name}`, offered);
      const parent = provider.parentModuleId;
      this.pending.set(parent, (this.pending.get(parent) ?? 0) + 1);
      try {
        // Providers with operation preparation own their actual dispatch boundary
        // (after any remote-tool approval). Older providers remain conservative.
        if (!provider.prepareOperation) await this.beforeOperationDispatch(context);
        this.assertAgentAccess(context);
        return await provider.invoke(id, name, args, context);
      }
      finally { this.pending.set(parent, Math.max(0, (this.pending.get(parent) ?? 1) - 1)); }
    }
    const record = this.requireReady(id);
    const bindings = this.bindings.get(id) ?? this.buildBindings(id);
    const binding = bindings.get(name) ?? (fromUi ? [...bindings.values()].find(item => item.action === name && item.kind === 'process') : undefined);
    if (!binding) throw new Error('Diese Funktion gehört nicht zum ausgewählten Modul.');
    if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 16000) throw new Error('Ungültige Modulargumente.');
    context.signal.throwIfAborted();
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    try {
      this.assertAgentAccess(context);
      if (binding.kind === 'capability') return await this.options.capabilities.invoke(binding.action, args, { ...context, validateOperation: async () => {
        this.assertAgentAccess(context);
        await context.validateOperation?.();
        this.assertAgentAccess(context);
      } });
      if (binding.kind === 'window') {
        const parsed = z.object({ action: z.enum(['minimize', 'toggleMaximize', 'close']) }).strict().parse(args);
        await this.beforeOperationDispatch(context);
        return this.options.controlView(id, binding.action.slice(7), parsed.action);
      }
      if (binding.kind === 'view' || binding.kind === 'settings') {
        if (Object.keys(args).length) throw new Error('Diese Funktion benötigt keine Argumente.');
        const localId = binding.action.slice(binding.action.indexOf('.') + 1);
        await this.beforeOperationDispatch(context);
        if (binding.kind === 'view') await this.openView(id, localId);
        else await this.options.openSettings(record.module.source === 'builtin' ? localId : `${id}:${localId}`);
        return { opened: true };
      }
      if (!binding.validate!(args)) throw new Error('Die Argumente entsprechen nicht dem deklarierten Modulschema.');
      if (binding.confirmation && !await this.options.confirm(context, binding.confirmation.title ?? record.module.title, binding.confirmation.message)) return { outcome: 'cancelled', cancelled: true, message: 'Die Modulfunktion wurde nicht ausgeführt.' };
      this.requireReady(id);
      let starting = this.activation.get(id);
      if (!starting) { starting = this.registry.verifyUnchanged(id).then(() => this.runtimes.start(record)); this.activation.set(id, starting); }
      await starting;
      context.signal.throwIfAborted();
      await this.beforeOperationDispatch(context);
      return await this.runtimes.invoke(record, binding.action, args, context.signal, context.operation);
    } finally { this.pending.set(id, Math.max(0, (this.pending.get(id) ?? 1) - 1)); }
  }
  async setEnabled(id: string, enabled: boolean, context: CapabilityContext): Promise<void> {
    if (this.changing) throw new Error('Es wird bereits ein Modul geändert.');
    if (this.configError) throw new Error('Die lokale Modulkonfiguration ist nicht lesbar. Bitte module-settings.json prüfen; die vorhandene Datei bleibt erhalten.');
    const record = this.registry.getRuntimeRecord(id);
    if (!record || typeof enabled !== 'boolean') throw new Error('Ungültiges Modul.');
    if (record.module.required) throw new Error('Das Pflichtmodul bleibt immer aktiv.');
    if (enabled && record.module.status === 'ready' || !enabled && record.module.status === 'disabled') return;
    if (enabled && !['disabled', 'approval_required'].includes(record.module.status)) throw new Error(record.module.reason ?? 'Dieses Modul kann nicht aktiviert werden.');
    if (!enabled && !['ready', 'approval_required'].includes(record.module.status)) throw new Error(record.module.reason ?? 'Dieses Modul kann nicht deaktiviert werden.');
    this.changing = true;
    try {
      if (!enabled) {
        if ((this.pending.get(id) ?? 0) > 0) throw new Error('In diesem Modul läuft noch ein Vorgang. Bitte warte auf dessen Abschluss.');
        await this.options.beforeDisable(id);
        if (context.origin === 'agent' && !await this.options.confirm(context, `${record.module.title} deaktivieren?`, 'Seine Ansichten werden geschlossen; gespeicherte Daten bleiben erhalten.')) return;
        const next = { ...this.config, disabled: [...new Set([...this.config.disabled, id])] };
        await this.persist(next);
        this.registry.disable(id); this.runtimes.stop(id); this.activation.delete(id); this.bindings.delete(id); this.clearModuleAttention(id);
        this.clearProviderOffers(id);
        await this.options.afterDisable(id);
      } else {
        const processModule = record.module.manifest?.runtime.type === 'process';
        const needsApproval = processModule && this.config.approvals[id] !== record.fingerprint;
        if (needsApproval && !await this.options.confirm(context, `${record.module.title} freigeben?`, `Dieses lokale Modul führt Programmcode mit deinen Benutzerrechten aus. Der eigene Prozess schützt OVD vor Abstürzen, ist aber keine Betriebssystem-Sandbox.\n\nDeklarierte Zugriffe: ${record.module.manifest!.permissions.join(', ') || 'keine'}\n\nQuelle: ${record.rootPath}\nVersion: ${record.module.version}`, { alwaysAsk: true })) return;
        if (!needsApproval && context.origin === 'agent' && !await this.options.confirm(context, `${record.module.title} aktivieren?`, 'Das Modul und seine Funktionen werden in OVD verfügbar.')) return;
        if (record.module.status === 'disabled') this.registry.enable(id);
        try {
          if (processModule) await this.registry.activate(id, record.fingerprint);
          await this.activateBuiltin(id);
          this.buildBindings(id);
          const next = { ...this.config, disabled: this.config.disabled.filter(item => item !== id), approvals: { ...this.config.approvals, ...(processModule ? { [id]: record.fingerprint } : {}) } };
          await this.persist(next);
        } catch (error) {
          this.registry.disable(id); this.runtimes.stop(id); this.activation.delete(id); this.bindings.delete(id); this.clearModuleAttention(id);
          this.clearProviderOffers(id);
          await this.options.afterDisable(id); this.options.changed();
          throw error;
        }
      }
      this.options.changed();
    } finally { this.changing = false; }
  }
  /** Install metadata only. New or changed code still needs the ordinary explicit fingerprint approval. */
  async installPackage(input: ModulePackageInstall, signal?: AbortSignal): Promise<ModuleInfo> {
    if (this.changing) throw new Error('Es wird bereits ein Modul geändert.');
    if (this.configError) throw new Error('Die lokale Modulkonfiguration ist nicht lesbar. Bitte module-settings.json prüfen.');
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(input.moduleId) || input.moduleId.length > 80 || input.moduleId.startsWith('ovd-')) throw new Error('Ungültige oder reservierte Modul-ID.');
    if (input.expectedFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedFingerprint)) throw new Error('Ungültiger installierter Modulfingerabdruck.');
    this.changing = true;
    const id = input.moduleId, previous = this.registry.getRuntimeRecord(id), previousConfig = this.config;
    const target = path.join(this.options.userRoot, id), backup = path.join(this.options.userRoot, `.ovd-package-backup-${randomUUID()}`);
    const journal = path.join(this.options.userRoot, '.ovd-package-transaction.json');
    let retired = false, backedUp = false, placed = false, configurationChanged = false, journalWritten = false;
    try {
      signal?.throwIfAborted();
      if (previous?.module.source === 'builtin' || previous?.module.manifest?.runtime.type === 'host-adapter') throw new Error('Eingebaute Module können nicht ersetzt werden.');
      if (previous ? input.expectedFingerprint !== previous.fingerprint : input.expectedFingerprint !== undefined) throw new Error('Der installierte Modulstand hat sich geändert. Bitte die Modulliste aktualisieren.');
      if (previous && path.resolve(previous.rootPath) !== path.resolve(target)) throw new Error('Dieses Modul wurde manuell in einem anderen Verzeichnis installiert und wird nicht überschrieben.');
      if ((this.pending.get(id) ?? 0) > 0 || this.runtimes.isBusy(id)) throw new Error('In diesem Modul läuft noch ein Vorgang. Bitte warte auf dessen Abschluss.');
      const root = await fs.realpath(this.options.userRoot), stageStat = await fs.lstat(input.stagedDirectory);
      if (!stageStat.isDirectory() || stageStat.isSymbolicLink() || !path.basename(input.stagedDirectory).startsWith('.') || path.dirname(await fs.realpath(input.stagedDirectory)) !== root) throw new Error('Das vorbereitete Paket liegt nicht im lokalen Installationsbereich.');
      let targetStat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
      try { targetStat = await fs.lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (targetStat && (!previous || !targetStat.isDirectory() || targetStat.isSymbolicLink())) throw new Error('Am Installationsort liegen bereits fremde oder ungültige Dateien.');
      if (previous && !targetStat) throw new Error('Das installierte Modul fehlt. Bitte OVD neu starten und den Modulstatus prüfen.');
      if (previous) await this.registry.verifyUnchanged(id);
      const candidate = await this.registry.inspectUserModule(input.stagedDirectory, id);
      signal?.throwIfAborted();
      if (previous) {
        await this.options.beforeDisable(id);
        signal?.throwIfAborted();
        this.registry.fail(id, 'Das Modul wird aktualisiert.'); retired = true;
        this.activation.delete(id); this.bindings.delete(id); await this.runtimes.stopAndWait(id);
        await this.options.afterDisable(id);
      }
      signal?.throwIfAborted();
      // A small recovery record ensures a quit between the two renames cannot lose the old installation.
      await fs.writeFile(journal, JSON.stringify({ version: 1, moduleId: id, ...(previous ? { backup: path.basename(backup), previousFingerprint: previous.fingerprint } : {}), fingerprint: candidate.fingerprint }), { flag: 'wx', mode: 0o600 });
      journalWritten = true;
      if (previous) { await fs.rename(target, backup); backedUp = true; }
      await fs.rename(input.stagedDirectory, target); placed = true;
      const installed = await this.registry.inspectUserModule(target, id);
      if (installed.fingerprint !== candidate.fingerprint) throw new Error('Das Paket wurde während der Installation verändert.');
      if (previous?.module.status === 'disabled') { installed.module.status = 'disabled'; installed.module.reason = 'Das aktualisierte Modul bleibt deaktiviert. Beim Aktivieren ist eine neue Freigabe erforderlich.'; }
      signal?.throwIfAborted();
      const approvals = { ...this.config.approvals }; delete approvals[id];
      const next = { ...this.config, approvals };
      await this.persist(next); configurationChanged = true;
      await input.commit();
      // No cancellable or fallible installation work follows the receipt commit.
      this.registry.replaceUserRecord(installed);
      try { this.clearModuleAttention(id); } catch { /* Notifications must not undo a committed package. */ }
      this.clearProviderOffers(id);
      await fs.rm(journal, { force: true }).catch(() => {});
      if (backedUp) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
      try { this.options.changed(); } catch { /* The next settings read observes the committed state. */ }
      return this.registry.getModule(id)!;
    } catch (error) {
      let rollbackFailed = false;
      if (placed) try { await fs.rm(target, { recursive: true, force: true }); } catch { rollbackFailed = true; }
      if (backedUp && !rollbackFailed) try { await fs.rename(backup, target); } catch { rollbackFailed = true; }
      if (configurationChanged) try { await this.persist(previousConfig); } catch { rollbackFailed = true; }
      if (previous && retired && !rollbackFailed) {
        this.registry.replaceUserRecord(previous);
        if (previous.module.status === 'ready') this.buildBindings(id);
      }
      if (journalWritten && !rollbackFailed) await fs.rm(journal, { force: true }).catch(() => {});
      if (retired) this.options.changed();
      if (rollbackFailed) throw new Error('Die Installation wurde abgebrochen; die Wiederherstellung muss beim nächsten OVD-Start abgeschlossen werden. Bitte OVD neu starten.');
      throw error;
    } finally { this.changing = false; }
  }
  private async recoverPackageSwap(): Promise<void> {
    const file = path.join(this.options.userRoot, '.ovd-package-transaction.json');
    let raw: string;
    try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) return; raw = await fs.readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    let parsed: ReturnType<typeof packageJournalSchema.safeParse>;
    try { parsed = packageJournalSchema.safeParse(JSON.parse(raw)); } catch { return; }
    if (!parsed.success || parsed.data.moduleId.startsWith('ovd-')) return;
    const { moduleId, backup, fingerprint, previousFingerprint } = parsed.data, target = path.join(this.options.userRoot, moduleId), saved = backup ? path.join(this.options.userRoot, backup) : undefined;
    let targetFingerprint: string | undefined, targetExists = false;
    try { await fs.lstat(target); targetExists = true; targetFingerprint = (await new ModuleRegistry().inspectUserModule(target, moduleId)).fingerprint; }
    catch { /* A missing or invalid target is never treated as a committed installation. */ }
    const committed = targetFingerprint === fingerprint && await this.options.packageCommitted?.(moduleId, fingerprint) === true;
    if (committed) {
      if (saved) await fs.rm(saved, { recursive: true, force: true }).catch(() => {});
    } else if (saved) {
      // A journal may precede the first rename, or remain after a successful rollback.
      if (targetFingerprint !== previousFingerprint || !previousFingerprint) {
        try {
          const old = await new ModuleRegistry().inspectUserModule(saved, moduleId);
          if (previousFingerprint && old.fingerprint !== previousFingerprint) return;
          // Do not erase files manually changed while OVD was stopped.
          if (targetExists && targetFingerprint !== fingerprint) return;
          await fs.rm(target, { recursive: true, force: true });
          await fs.rename(saved, target);
        } catch { return; }
      }
    } else {
      if (targetExists && targetFingerprint !== fingerprint) return;
      await fs.rm(target, { recursive: true, force: true });
    }
    await fs.rm(file, { force: true });
  }
  private async persist(config: z.infer<typeof configSchema>) {
    const temp = this.options.configFile + '.tmp';
    await fs.mkdir(path.dirname(temp), { recursive: true });
    await fs.writeFile(temp, JSON.stringify(config), { mode: 0o600 });
    await fs.rename(temp, this.options.configFile);
    this.config = config;
  }
  private clearProviderOffers(parentModuleId: string): void {
    for (const key of this.providerOffers.keys()) if (key.startsWith(parentModuleId + '.')) this.providerOffers.delete(key);
  }
  async openView(id: string, viewId: string): Promise<void> {
    if (this.changing) throw new Error('Die Modulverwaltung wird gerade geändert. Bitte danach erneut versuchen.');
    const record = this.requireReady(id);
    if (!record.module.manifest?.contributions.views.some(view => view.id === viewId)) throw new Error('Unbekannte Modulansicht.');
    await this.options.openView(id, viewId);
  }
  async readView(id: string, viewId: string): Promise<string> {
    if (this.changing) throw new Error('Die Modulverwaltung wird gerade geändert. Bitte danach erneut versuchen.');
    const record = this.requireReady(id), file = record.viewPaths[viewId] ?? record.settingsPaths[viewId];
    if (!file) throw new Error('Unbekannte HTML-Modulansicht.');
    await this.registry.verifyUnchanged(id);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('Die Modulansicht ist ungültig oder größer als 256 KB.');
    return fs.readFile(file, 'utf8');
  }
  settingsCategories(): string[] { return this.list().filter(module => module.status === 'ready').flatMap(module => (module.manifest?.contributions.settings ?? []).map(item => module.source === 'builtin' ? item.id : `${module.id}:${item.id}`)); }
  dispose(): void { this.runtimes.dispose(); this.attention.clear(); this.toolProviders.clear(); this.providerOffers.clear(); }
}

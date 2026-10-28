import { z } from 'zod';
import type { ModuleListing, ModuleQuery, ModuleToolDescriptor, ModuleToolListing, ModuleToolQuery } from '../shared/modules';
import type { AgentSettings, ToolOutcome } from '../shared/model';
import { normalizeAgentSettings } from '../shared/agent-settings';

export type ProviderToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
const MAX_ARGUMENT_LENGTH = 16_000;
const MAX_SCHEMA_LENGTH = 12_000;
const discoveryNames = new Set(['find_modules', 'get_module_tools']);
const resultEnvelopeKeys = new Set(['ok', 'outcome', 'status', 'message', 'error', 'warning', 'retryBlocked', 'moduleId', 'untrusted']);

/** Only these small discovery schemas are sent before a task selects module tools. */
function discoveryDefinitions(settings: AgentSettings): readonly ProviderToolDefinition[] {
  return [
  {
    type: 'function',
    function: {
      name: 'find_modules',
      description: 'Finde passende verfügbare OVD-Module nach Aufgabe oder Modultyp, z.B. Mail, Kalender oder Dateien. Das durchsucht Modulbeschreibungen, keine Mails oder sonstigen Geschäftsinhalte. Lade danach gezielt benötigte Werkzeuge mit get_module_tools.',
      parameters: {
        type: 'object', properties: {
          query: { type: 'string', maxLength: 200, description: 'Modultyp oder gewünschte Funktion, keine Mail-Suchbegriffe.' },
          offset: { type: 'integer', minimum: 0, description: 'nextOffset einer vorherigen Modulsuche.' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Höchstens 20 kurze Modulbeschreibungen.' }
        }, additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_module_tools',
      description: 'Lade gezielt die für den Auftrag nötigen Werkzeuge eines passenden OVD-Moduls. query beschreibt eine Funktion wie suchen, neue Mail oder Entwurf bearbeiten. Erst im nächsten Schritt sind die geladenen Werkzeuge mit ihren exakten Argumenten aufrufbar. Weitere Treffer sind paginiert. Fehlt die gesuchte Funktion, suche allgemeiner oder blättere ohne query, bevor du sie als nicht verfügbar meldest. Lade nur die für den Auftrag benötigten Werkzeuge.',
      parameters: {
        type: 'object', properties: {
          moduleId: { type: 'string', minLength: 1, maxLength: 128, description: 'ID aus der Modulübersicht oder find_modules.' },
          query: { type: 'string', maxLength: 200, description: 'Benötigte Funktion innerhalb des Moduls.' },
          offset: { type: 'integer', minimum: 0, description: 'nextOffset zum gezielten Nachladen weiterer Werkzeuge.' },
          limit: { type: 'integer', minimum: 1, maximum: settings.maxActiveTools, description: `Höchstens ${settings.maxActiveTools} Werkzeuge; Standard ${Math.min(6, settings.maxActiveTools)}. Bei vielen Funktionen die query eingrenzen.` }
        }, required: ['moduleId'], additionalProperties: false
      }
    }
  }
];
}
export const workspaceToolDefinitions = discoveryDefinitions(normalizeAgentSettings(undefined));

export interface WorkspaceToolDependencies {
  getModules(options?: ModuleQuery): ModuleListing | Promise<ModuleListing>;
  getModuleTools(options: ModuleToolQuery): ModuleToolListing | Promise<ModuleToolListing>;
  invokeModuleTool(moduleId: string, toolName: string, args: unknown): Promise<unknown>;
}

const findModulesSchema = z.object({ query: z.string().trim().max(200).optional(), offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(20).optional() }).strict();
const moduleToolQuerySchema = (maximum: number) => z.object({ moduleId: z.string().trim().min(1).max(128), query: z.string().trim().max(200).optional(), offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(maximum).optional() }).strict();
type ActiveTool = { moduleId: string; descriptor: ModuleToolDescriptor; definition: ProviderToolDefinition };

function descriptorTool(moduleId: string, descriptor: ModuleToolDescriptor): ActiveTool {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(descriptor.name) || discoveryNames.has(descriptor.name)) throw new Error('Das Modul bietet einen ungültigen oder reservierten Werkzeugnamen an.');
  if (typeof descriptor.description !== 'string' || !descriptor.parameters || typeof descriptor.parameters !== 'object' || Array.isArray(descriptor.parameters) || descriptor.parameters.type !== 'object') throw new Error('Das Modul bietet ein ungültiges Werkzeugschema an.');
  const schema = JSON.stringify(descriptor.parameters);
  if (schema.length > MAX_SCHEMA_LENGTH) throw new Error('Das Werkzeugschema des Moduls ist zu groß. Bitte ein kleineres Werkzeug auswählen.');
  const definition: ProviderToolDefinition = { type: 'function', function: { name: descriptor.name, description: descriptor.description.slice(0, 2000), parameters: descriptor.parameters } };
  return { moduleId, descriptor, definition };
}

function boundedResult(value: unknown, depth = 0): unknown {
  if (depth > 7) return '[gekürzt]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 12_000);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => boundedResult(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== undefined && !['password', 'apikey', 'authorization', 'accesstoken', 'refreshtoken', 'privatekey'].includes(key.toLowerCase())).sort(([a], [b]) => Number(resultEnvelopeKeys.has(b)) - Number(resultEnvelopeKeys.has(a))).slice(0, 60).map(([key, item]) => [key, boundedResult(item, depth + 1)]));
  }
  return null;
}
function resultJson(value: unknown): string {
  const bounded = boundedResult(value), serialized = JSON.stringify(bounded);
  if (serialized.length <= 32_000) return serialized;
  const envelope = bounded && typeof bounded === 'object' && !Array.isArray(bounded) ? Object.fromEntries(['ok', 'outcome', 'status', 'message', 'error', 'warning', 'moduleId', 'untrusted', 'retryBlocked'].filter(key => Object.hasOwn(bounded, key)).map(key => [key, (bounded as Record<string, unknown>)[key]]).filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item)).map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, 500) : item])) : {};
  return JSON.stringify({ ...envelope, truncated: true, note: 'Das Ergebnis ist zu groß. Bitte die Abfrage eingrenzen.', preview: serialized.slice(0, 8000) });
}

const outcomes = new Set<ToolOutcome>(['completed', 'failed', 'cancelled', 'uncertain']);
function shortDetail(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) || undefined : undefined;
}
/** One interpretation is shared by the model envelope and the persisted activity. */
export function inspectToolResult(value: unknown): { status: ToolOutcome; detail?: string; explicit: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'completed', explicit: false };
  const result = value as Record<string, unknown>;
  const error = shortDetail(result.error) ?? (result.error && typeof result.error === 'object' ? shortDetail((result.error as Record<string, unknown>).message) : undefined);
  const hasError = typeof result.error === 'string' ? !!error : !!result.error;
  const explicit = typeof result.outcome === 'string' && outcomes.has(result.outcome as ToolOutcome);
  let status: ToolOutcome = explicit ? result.outcome as ToolOutcome : result.status === 'uncertain' || result.status === 'unknown' ? 'uncertain' : result.status === 'cancelled' ? 'cancelled' : result.status === 'failed' || result.ok === false || hasError ? 'failed' : 'completed';
  if (status === 'completed' && (result.ok === false || hasError)) status = 'failed';
  const detail = status === 'failed' ? error ?? shortDetail(result.message) ?? 'Die Modulfunktion konnte nicht ausgeführt werden.' : status === 'completed' ? shortDetail(result.warning) ?? shortDetail(result.message) : shortDetail(result.message);
  return { status, ...(detail ? { detail } : {}), explicit };
}

/** Per-request registry: tool definitions never become durable chat history. */
export class ModuleToolRuntime {
  private readonly active = new Map<string, ActiveTool>();
  private readonly settings: AgentSettings;
  private readonly bootstrap: readonly ProviderToolDefinition[];
  private readonly querySchema: ReturnType<typeof moduleToolQuerySchema>;
  constructor(settings?: Partial<AgentSettings>) {
    this.settings = normalizeAgentSettings(settings);
    this.bootstrap = discoveryDefinitions(this.settings);
    this.querySchema = moduleToolQuerySchema(this.settings.maxActiveTools);
  }
  private offeredDefinitions(active: ReadonlyMap<string, ActiveTool>): readonly ProviderToolDefinition[] {
    return [...this.bootstrap, ...[...active.values()].map(tool => tool.definition)];
  }
  get definitions(): readonly ProviderToolDefinition[] { return this.offeredDefinitions(this.active); }
  captureOffer() { return { definitions: this.definitions, active: new Map(this.active) as ReadonlyMap<string, ActiveTool> }; }
  label(name: string, offeredBindings?: ReadonlyMap<string, ActiveTool>): string {
    if (name === 'find_modules') return 'Passende Module finden';
    if (name === 'get_module_tools') return 'Modulwerkzeuge laden';
    const descriptor = (offeredBindings?.get(name) ?? this.active.get(name))?.descriptor;
    return descriptor?.label || name;
  }

  async execute(name: string, rawArguments: string, deps: WorkspaceToolDependencies, offeredNames: ReadonlySet<string> = new Set(this.definitions.map(tool => tool.function.name)), offeredBindings?: ReadonlyMap<string, ActiveTool>): Promise<string> {
    const error = (message: string) => JSON.stringify({ ok: false, error: message });
    if (!offeredNames.has(name)) return error('Dieses Werkzeug wurde für diesen Schritt nicht geladen. Bitte erst passende Module finden und deren benötigte Werkzeuge laden.');
    if (typeof rawArguments !== 'string' || rawArguments.length > MAX_ARGUMENT_LENGTH) return error('Ungültige Werkzeugargumente.');
    let input: unknown;
    try { input = JSON.parse(rawArguments); } catch { return error('Werkzeugargumente müssen gültiges JSON sein.'); }
    try {
      if (name === 'find_modules') {
        const parsed = findModulesSchema.safeParse(input);
        if (!parsed.success) return error('Ungültige Anfrage an die Modulsuche.');
        const result = await deps.getModules({ ...parsed.data, limit: parsed.data.limit ?? 10 });
        return JSON.stringify({ ok: true, modules: result.modules.slice(0, 20).map(module => ({ id: module.id.slice(0, 128), title: module.title.slice(0, 160), description: module.description.slice(0, 600) })), hasMore: result.hasMore, ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}) });
      }
      if (name === 'get_module_tools') {
        const parsed = this.querySchema.safeParse(input);
        if (!parsed.success) return error('Ungültige Anfrage an die Modulwerkzeuge.');
        const requested = { ...parsed.data, limit: parsed.data.limit ?? Math.min(6, this.settings.maxActiveTools) };
        const result = await deps.getModuleTools(requested);
        if (result.moduleId !== requested.moduleId || !Array.isArray(result.tools) || result.tools.length > requested.limit) return error('Die Modulwerkzeugliste entspricht nicht der Anfrage.');
        const additions = result.tools.map(descriptor => descriptorTool(result.moduleId, descriptor));
        const next = new Map(this.active);
        for (const tool of additions) {
          const existing = next.get(tool.definition.function.name);
          if (existing && existing.moduleId !== tool.moduleId) return error('Zwei Module verwenden denselben Werkzeugnamen.');
          next.delete(tool.definition.function.name); next.set(tool.definition.function.name, tool);
        }
        const protectedNames = new Set(additions.map(tool => tool.definition.function.name));
        while (next.size > this.settings.maxActiveTools || JSON.stringify(this.offeredDefinitions(next)).length > this.settings.toolSchemaBudget) {
          const removable = [...next.keys()].find(key => !protectedNames.has(key));
          if (!removable) return error(`Die angefragten Werkzeuge überschreiten das Schema-Budget von ${this.settings.toolSchemaBudget} Zeichen einschließlich der Basiswerkzeuge. Bitte die Funktionssuche eingrenzen oder weniger Werkzeuge laden.`);
          next.delete(removable);
        }
        this.active.clear(); for (const [key, tool] of next) this.active.set(key, tool);
        return JSON.stringify({ ok: true, moduleId: result.moduleId, tools: additions.map(tool => ({ name: tool.descriptor.name, description: tool.descriptor.description.slice(0, 300) })), hasMore: result.hasMore, ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}), note: 'Diese Werkzeuge sind im nächsten Schritt mit ihren Argument-Schemas verfügbar. Es wurden keine Modulaktionen ausgeführt.' });
      }
      const tool = offeredBindings?.get(name) ?? this.active.get(name);
      if (!tool) return error('Das Modulwerkzeug ist nicht geladen.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) return error('Werkzeugargumente müssen ein JSON-Objekt sein.');
      const result = await deps.invokeModuleTool(tool.moduleId, tool.descriptor.name, input);
      if (this.active.has(name)) { this.active.delete(name); this.active.set(name, tool); }
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const outcome = inspectToolResult(result);
        return resultJson({ ...result, ok: outcome.status === 'completed', ...(outcome.explicit ? { outcome: outcome.status } : {}), moduleId: tool.moduleId, untrusted: true });
      }
      return resultJson({ ok: true, moduleId: tool.moduleId, untrusted: true, result });
    } catch (cause) { return error(cause instanceof Error ? cause.message.slice(0, 2000) : 'Die Modulfunktion konnte nicht ausgeführt werden.'); }
  }
}

/** Stateless entry point for discovery clients; a running task uses ModuleToolRuntime. */
export function executeWorkspaceTool(name: string, rawArguments: string, deps: WorkspaceToolDependencies): Promise<string> {
  return new ModuleToolRuntime().execute(name, rawArguments, deps);
}

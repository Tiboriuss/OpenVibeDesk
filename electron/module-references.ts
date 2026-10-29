import { moduleReferenceInputSchema, moduleReferenceSchema, moduleReferenceSummary, moduleReferenceSummarySchema, type ModuleReference, type ModuleReferenceInput, type ModuleReferenceSummary } from '../shared/references';
import type { CapabilityContext } from './workspace-capabilities';

type ReferenceAdapter = {
  summary(id: string, context: CapabilityContext): Promise<ModuleReferenceSummary>;
  snapshot(id: string, context: CapabilityContext): Promise<ModuleReference>;
};
export const sameModuleReference = (a: ModuleReferenceInput, b: ModuleReferenceInput) => a.moduleId === b.moduleId && a.type === b.type && a.id === b.id;

/** Modules resolve their own resources; the chat transports validated IDs only. */
export class ModuleReferenceRegistry {
  private readonly adapters = new Map<string, ReferenceAdapter>();
  constructor(private readonly available: (moduleId: string, type: string) => boolean,
    private readonly processSnapshot?: (input: ModuleReferenceInput, context: CapabilityContext) => Promise<ModuleReference>) {}
  register(moduleId: string, type: string, adapter: ReferenceAdapter): void {
    const key = `${moduleId}:${type}`;
    if (this.adapters.has(key)) throw new Error('Dieser Referenztyp wurde bereits registriert.');
    this.adapters.set(key, adapter);
  }
  private resolve(raw: unknown, context: CapabilityContext) {
    const input = moduleReferenceInputSchema.parse(raw);
    context.signal.throwIfAborted();
    const adapter = this.adapters.get(`${input.moduleId}:${input.type}`);
    if ((!adapter && !this.processSnapshot) || !this.available(input.moduleId, input.type)) throw new Error('Das Modul für diese Referenz ist nicht verfügbar.');
    return { input, adapter };
  }
  async summary(raw: unknown, context: CapabilityContext): Promise<ModuleReferenceSummary> {
    const { input, adapter } = this.resolve(raw, context);
    const result = adapter ? moduleReferenceSummarySchema.parse(await adapter.summary(input.id, context)) : moduleReferenceSummary(await this.snapshot(input, context));
    context.signal.throwIfAborted();
    if (!sameModuleReference(input, result)) throw new Error('Das Modul hat eine andere Referenz zurückgegeben.');
    return result;
  }
  async snapshot(raw: unknown, context: CapabilityContext): Promise<ModuleReference> {
    const { input, adapter } = this.resolve(raw, context);
    const result = moduleReferenceSchema.parse(await (adapter ? adapter.snapshot(input.id, context) : this.processSnapshot!(input, context)));
    context.signal.throwIfAborted();
    if (!sameModuleReference(input, result)) throw new Error('Das Modul hat eine andere Referenz zurückgegeben.');
    return result;
  }
}

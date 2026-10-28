import type { ModuleSummary, ModuleToolDescriptor, ModuleToolListing, ModuleToolQuery } from './modules';

/**
 * A trusted adapter can expose live child sources without registering their
 * complete tool catalogs in a manifest or in the initial model context.
 *
 * Child IDs are namespaced below parentModuleId + ".". Methods read a cached
 * catalog: discovery must not connect to a service or execute remote work.
 */
export interface ModuleToolProvider<Context> {
  readonly parentModuleId: string;
  listModules(): readonly ModuleSummary[];
  getTools(query: ModuleToolQuery): ModuleToolListing;
  /** Exact current lookup; hide disconnected sources and unapproved tools. */
  getTool(moduleId: string, toolName: string): ModuleToolDescriptor | undefined;
  /**
   * Recheck availability, permission and arguments before executing. Names must
   * bind the schema and configuration/connection revision; retired names fail
   * before execution rather than silently acquiring new meaning.
   */
  invoke(moduleId: string, toolName: string, args: unknown, context: Context): Promise<unknown>;
}

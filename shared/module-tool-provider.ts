import type { ModuleSummary, ModuleToolDescriptor, ModuleToolListing, ModuleToolQuery } from './modules';
import type { OperationBinding, OperationIdentity, OperationReconciliation } from './operations';

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
  /** Resolve a recorded logical action to its current approved offer without executing it. */
  getOperationTool?(binding: OperationBinding): ModuleToolDescriptor | undefined;
  /**
   * Recheck availability, permission and arguments before executing. Names must
   * bind the schema and configuration/connection revision; retired names fail
   * before execution rather than silently acquiring new meaning.
   * A provider implementing prepareOperation owns the dispatch boundary: after
   * confirmations, invoke must await context.validateOperation and then
   * context.beforeDispatch immediately before the remote request (when present).
   */
  invoke(moduleId: string, toolName: string, args: unknown, context: Context): Promise<unknown>;
  /** Host-private, stable identity: connection-specific offered names are not durable action IDs. */
  prepareOperation?(moduleId: string, toolName: string, args: Record<string, unknown>, context: Context): Promise<{ binding: OperationBinding; args: Record<string, unknown>; label?: string }>;
  /** Check the recorded action's state. This must never call the original tool as a fallback. */
  reconcileOperation?(binding: OperationBinding, args: Record<string, unknown>, operation: OperationIdentity, context: Context): Promise<OperationReconciliation>;
}

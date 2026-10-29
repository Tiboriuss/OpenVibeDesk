/** Public module contracts contain metadata, never backend code, tool schemas or secrets. */
export type { OperationBinding, OperationIdentity, OperationReconciliation } from './operations';
export interface ModuleSummary { id: string; title: string; description: string; }
export interface ModuleQuery { query?: string; offset?: number; limit?: number; }
export interface ModuleListing { modules: ModuleSummary[]; hasMore: boolean; nextOffset?: number; }
export interface ModuleToolDescriptor { name: string; description: string; parameters: Record<string, unknown>; capability?: string; label?: string; }
export interface ModuleToolQuery { moduleId: string; query?: string; offset?: number; limit?: number; }
export interface ModuleToolListing { moduleId: string; tools: ModuleToolDescriptor[]; hasMore: boolean; nextOffset?: number; }
export type ModuleIcon = 'mail' | 'file' | 'folder' | 'chat' | 'settings' | 'calendar' | 'grid';
export interface ModuleViewContribution { id: string; title: string; renderer?: string; entry?: string; icon?: ModuleIcon; order?: number; }
export interface ModuleNavigationContribution { id: string; title: string; view: string; icon?: ModuleIcon; order?: number; }
export interface ModuleSettingsContribution { id: string; title: string; description?: string; keywords?: string[]; renderer?: string; entry?: string; icon?: ModuleIcon; order?: number; }
export interface ModuleReferenceContribution { id: string; title: string; snapshotTool?: string; usage?: 'context' | 'instructions'; }
export interface ModuleManifest {
  apiVersion: 1;
  id: string;
  title: string;
  version: string;
  description: string;
  keywords?: string[];
  required?: boolean;
  capabilities: string[];
  permissions: string[];
  runtime: { type: 'host-adapter'; adapter: string } | { type: 'process'; entry: string };
  tools?: ModuleCommandDefinition[];
  contributions: {
    views: ModuleViewContribution[];
    navigation: ModuleNavigationContribution[];
    settings: ModuleSettingsContribution[];
    referenceTypes?: ModuleReferenceContribution[];
  };
}
export type ModuleStatus = 'ready' | 'disabled' | 'incompatible' | 'invalid' | 'approval_required' | 'unsupported';
export interface ModuleInfo extends ModuleSummary {
  version: string;
  apiVersion: number;
  status: ModuleStatus;
  source: 'builtin' | 'user';
  required: boolean;
  reason?: string;
  manifest?: ModuleManifest;
}

export interface ModuleCommandDefinition { name: string; description: string; label?: string; parameters: Record<string, unknown>; confirmation?: { title?: string; message: string }; }

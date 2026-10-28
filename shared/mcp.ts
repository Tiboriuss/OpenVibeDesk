import { z } from 'zod';

export const mcpServerIdSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const envKey = z.string().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const mcpServerInputSchema = z.object({
  id: mcpServerIdSchema.optional(), name: z.string().trim().min(1).max(100), description: z.string().max(500).default(''),
  transport: z.enum(['stdio', 'http']), command: z.string().trim().min(1).max(4096).regex(/^[^\r\n\0]+$/).optional(),
  args: z.array(z.string().max(4096)).max(100).default([]), cwd: z.string().min(1).max(4096).optional(), url: z.string().min(1).max(2048).optional(),
  autoConnect: z.boolean().default(false), allowedTools: z.array(z.string().min(1).max(200)).max(500).default([]),
  token: z.string().max(8192).optional(), clearToken: z.boolean().optional(),
  env: z.record(envKey, z.string().max(8192)).optional(), removeEnvKeys: z.array(envKey).max(100).optional()
}).strict().superRefine((value, ctx) => {
  if (value.transport === 'stdio' && !value.command) ctx.addIssue({ code: 'custom', path: ['command'], message: 'Bitte ein ausführbares Programm angeben.' });
  if (value.transport === 'http' && !value.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Bitte eine MCP-URL angeben.' });
  if (JSON.stringify(value.args).length > 16000) ctx.addIssue({ code: 'custom', path: ['args'], message: 'Die Programmargumente sind zu lang.' });
  if (Object.keys(value.env ?? {}).length > 100) ctx.addIssue({ code: 'custom', path: ['env'], message: 'Höchstens 100 Umgebungsvariablen sind möglich.' });
});
export type McpServerInput = z.input<typeof mcpServerInputSchema>;
export type McpServerConfig = {
  id: string; name: string; description: string; transport: 'stdio' | 'http'; command?: string; args: string[]; cwd?: string; url?: string;
  autoConnect: boolean; allowedTools: string[]; hasToken: boolean; envKeys: string[];
};
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface McpServerSummary extends McpServerConfig { status: McpConnectionStatus; error?: string; warning?: string; toolCount: number; allowedToolCount: number; connectedAt?: string; }
export interface McpToolInfo { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; allowed: boolean; supported: boolean; reason?: string; readOnly: boolean; }
export interface McpToolPage { serverId: string; tools: McpToolInfo[]; total: number; hasMore: boolean; nextOffset?: number; observedAt: string; }
export const mcpToolQuerySchema = z.object({ serverId: mcpServerIdSchema, query: z.string().max(200).optional(), offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(50).optional(), refresh: z.boolean().optional() }).strict();
export type McpToolQuery = z.infer<typeof mcpToolQuerySchema>;
export const mcpPermissionsSchema = z.object({ serverId: mcpServerIdSchema, allowedTools: z.array(z.string().min(1).max(200)).max(500) }).strict();
export type McpToolPermissions = z.infer<typeof mcpPermissionsSchema>;
export interface McpAuditEntry { id: string; timestamp: string; serverId: string; serverName: string; action: 'connect' | 'disconnect' | 'call'; tool?: string; outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain'; durationMs: number; }
export interface McpAuditPage { entries: McpAuditEntry[]; total: number; hasMore: boolean; nextOffset?: number; }
export const mcpAuditQuerySchema = z.object({ serverId: mcpServerIdSchema.optional(), offset: z.number().int().min(0).max(100).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
export type McpAuditQuery = z.infer<typeof mcpAuditQuerySchema>;
export interface McpPrepareRequest { values: Partial<Pick<McpServerConfig, 'id' | 'name' | 'description' | 'transport' | 'command' | 'args' | 'cwd' | 'url' | 'allowedTools'>>; }
export interface McpCallResult { ok: boolean; outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain'; serverId: string; tool: string; content: { type: 'text'; text: string }[]; structuredContent?: unknown; truncated?: boolean; message?: string; untrusted: true; }

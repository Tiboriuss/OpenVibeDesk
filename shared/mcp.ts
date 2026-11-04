import { z } from 'zod';

export const mcpServerIdSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const envKey = z.string().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const mcpAuthModeSchema = z.enum(['none', 'bearer', 'oauth']);
export const mcpOAuthClientAuthMethodSchema = z.enum(['auto', 'client_secret_basic', 'client_secret_post']);
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Configured endpoints are public addresses; OAuth request parameters are added by the host. */
export function validateMcpOAuthEndpointUrl(raw: string, mcpUrl?: string): string {
  let url: URL;
  try {
    if (raw.length > 2048 || /[\x00-\x1f\x7f]/.test(raw)) throw new Error();
    url = new URL(raw.trim());
  } catch { throw new Error('Bitte eine gültige OAuth-Endpunkt-URL eingeben.'); }
  if (url.username || url.password || url.hash) throw new Error('OAuth-Endpunkte dürfen keine Zugangsdaten oder Fragmente enthalten.');
  const mcpIsLoopback = mcpUrl && (() => { try { return loopbackHosts.has(new URL(mcpUrl).hostname); } catch { return false; } })();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname) && mcpIsLoopback)) throw new Error('OAuth-Endpunkte benötigen HTTPS. HTTP ist nur bei lokalen MCP-Verbindungen auf Loopback-Adressen erlaubt.');
  const reserved = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|client[_-]?id|client[_-]?assertion(?:[_-]?type)?|code(?:[_-]?(?:verifier|challenge|challenge[_-]?method))?|grant[_-]?type|response[_-]?type|redirect[_-]?uri|state|scope|resource|assertion|password|username|api[_-]?key|authorization|bearer)$/i;
  if ([...url.searchParams].some(([key, value]) => reserved.test(key) || /[\x00-\x1f\x7f]/.test(key + value))) throw new Error('OAuth-Endpunkte dürfen keine Tokens, Geheimnisse oder OAuth-Anfrageparameter enthalten. Diese Angaben werden separat gesetzt.');
  return url.href;
}
export const mcpOAuthPublicFields = {
  authMode: mcpAuthModeSchema.optional(), oauthClientId: z.string().trim().max(2048).optional(),
  oauthIssuer: z.string().trim().max(2048).optional(), oauthScopes: z.string().trim().max(2000).optional(),
  oauthAuthorizationUrl: z.string().max(2048).optional().describe('Optionaler Autorisierungs-Endpunkt. Leer nutzt die automatische Erkennung.'),
  oauthTokenUrl: z.string().max(2048).optional().describe('Optionaler Token-Endpunkt. Leer nutzt die automatische Erkennung.'),
  oauthClientAuthMethod: mcpOAuthClientAuthMethodSchema.optional().describe('Client-Anmeldung am Token-Endpunkt. auto verwendet die automatische Auswahl, client_secret_basic den Authorization-Header und client_secret_post den Anfragekörper.'),
  oauthRedirectPort: z.number().int().min(1024).max(65535).optional()
};
export const mcpServerInputSchema = z.object({
  id: mcpServerIdSchema.optional(), name: z.string().trim().min(1).max(100), description: z.string().max(500).default(''),
  transport: z.enum(['stdio', 'http']), command: z.string().trim().min(1).max(4096).regex(/^[^\r\n\0]+$/).optional(),
  args: z.array(z.string().max(4096)).max(100).default([]), cwd: z.string().min(1).max(4096).optional(), url: z.string().min(1).max(2048).optional(),
  autoConnect: z.boolean().default(false), allowedTools: z.array(z.string().min(1).max(200)).max(500).default([]),
  token: z.string().max(8192).optional(), clearToken: z.boolean().optional(),
  ...mcpOAuthPublicFields,
  oauthClientSecret: z.string().max(8192).optional(), clearOAuthClientSecret: z.boolean().optional(),
  env: z.record(envKey, z.string().max(8192)).optional(), removeEnvKeys: z.array(envKey).max(100).optional()
}).strict().superRefine((value, ctx) => {
  if (value.transport === 'stdio' && !value.command) ctx.addIssue({ code: 'custom', path: ['command'], message: 'Bitte ein ausführbares Programm angeben.' });
  if (value.transport === 'http' && !value.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Bitte eine MCP-URL angeben.' });
  if (value.transport === 'stdio' && value.authMode && value.authMode !== 'none') ctx.addIssue({ code: 'custom', path: ['authMode'], message: 'OAuth und Bearer-Anmeldung sind für HTTP-Verbindungen vorgesehen.' });
  if (value.oauthClientSecret && !value.oauthClientId) ctx.addIssue({ code: 'custom', path: ['oauthClientId'], message: 'Für ein Client-Secret ist eine Client-ID erforderlich.' });
  if (value.oauthClientId && !value.oauthIssuer) ctx.addIssue({ code: 'custom', path: ['oauthIssuer'], message: 'Für eine registrierte Client-ID bitte den zugehörigen OAuth-Issuer angeben.' });
  if (value.oauthClientAuthMethod && value.oauthClientAuthMethod !== 'auto') {
    if (!value.oauthClientId && (!value.id || value.oauthClientId !== undefined)) ctx.addIssue({ code: 'custom', path: ['oauthClientId'], message: 'Für dieses Client-Anmeldeverfahren bitte eine registrierte Client-ID angeben.' });
    if ((!value.id || value.clearOAuthClientSecret) && !value.oauthClientSecret) ctx.addIssue({ code: 'custom', path: ['oauthClientSecret'], message: 'Für dieses Client-Anmeldeverfahren ist ein Client-Secret erforderlich.' });
  }
  for (const key of ['oauthAuthorizationUrl', 'oauthTokenUrl'] as const) if (value[key]?.trim()) {
    try { validateMcpOAuthEndpointUrl(value[key]!, value.url); }
    catch (error) { ctx.addIssue({ code: 'custom', path: [key], message: error instanceof Error ? error.message : 'Ungültiger OAuth-Endpunkt.' }); }
  }
  if (value.oauthAuthorizationUrl?.trim() && value.oauthTokenUrl?.trim()) {
    if (!value.oauthClientId && (!value.id || value.oauthClientId !== undefined)) ctx.addIssue({ code: 'custom', path: ['oauthClientId'], message: 'Für manuelle OAuth-Endpunkte bitte eine registrierte Client-ID angeben.' });
    if (!value.oauthIssuer && (!value.id || value.oauthIssuer !== undefined)) ctx.addIssue({ code: 'custom', path: ['oauthIssuer'], message: 'Für manuelle OAuth-Endpunkte bitte den zugehörigen OAuth-Issuer angeben.' });
  }
  if (JSON.stringify(value.args).length > 16000) ctx.addIssue({ code: 'custom', path: ['args'], message: 'Die Programmargumente sind zu lang.' });
  if (Object.keys(value.env ?? {}).length > 100) ctx.addIssue({ code: 'custom', path: ['env'], message: 'Höchstens 100 Umgebungsvariablen sind möglich.' });
});
export type McpServerInput = z.input<typeof mcpServerInputSchema>;
export type McpServerConfig = {
  id: string; name: string; description: string; transport: 'stdio' | 'http'; command?: string; args: string[]; cwd?: string; url?: string;
  autoConnect: boolean; allowedTools: string[]; hasToken: boolean; envKeys: string[];
  authMode: z.infer<typeof mcpAuthModeSchema>; oauthClientId?: string; oauthIssuer?: string; oauthScopes?: string; oauthAuthorizationUrl?: string; oauthTokenUrl?: string; oauthClientAuthMethod?: z.infer<typeof mcpOAuthClientAuthMethodSchema>; oauthRedirectPort: number;
  hasOAuthClientSecret: boolean; hasOAuthTokens: boolean; oauthRevision: string;
};
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface McpServerSummary extends McpServerConfig { status: McpConnectionStatus; error?: string; warning?: string; toolCount: number; allowedToolCount: number; connectedAt?: string; oauthStatus?: 'signed_out' | 'signing_in' | 'signed_in' | 'required' | 'error'; oauthError?: string; }
export interface McpToolInfo { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; allowed: boolean; supported: boolean; reason?: string; readOnly: boolean; }
export interface McpToolPage { serverId: string; tools: McpToolInfo[]; total: number; hasMore: boolean; nextOffset?: number; observedAt: string; }
export const mcpToolQuerySchema = z.object({ serverId: mcpServerIdSchema, query: z.string().max(200).optional(), offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(50).optional(), refresh: z.boolean().optional() }).strict();
export type McpToolQuery = z.infer<typeof mcpToolQuerySchema>;
export const mcpPermissionsSchema = z.object({ serverId: mcpServerIdSchema, allowedTools: z.array(z.string().min(1).max(200)).max(500) }).strict();
export type McpToolPermissions = z.infer<typeof mcpPermissionsSchema>;
export interface McpAuditEntry { id: string; timestamp: string; serverId: string; serverName: string; action: 'connect' | 'disconnect' | 'call' | 'sign_in' | 'sign_out'; tool?: string; outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain'; durationMs: number; }
export interface McpAuditPage { entries: McpAuditEntry[]; total: number; hasMore: boolean; nextOffset?: number; }
export const mcpAuditQuerySchema = z.object({ serverId: mcpServerIdSchema.optional(), offset: z.number().int().min(0).max(100).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
export type McpAuditQuery = z.infer<typeof mcpAuditQuerySchema>;
export interface McpPrepareRequest { values: Partial<Pick<McpServerConfig, 'id' | 'name' | 'description' | 'transport' | 'command' | 'args' | 'cwd' | 'url' | 'allowedTools' | 'authMode' | 'oauthClientId' | 'oauthIssuer' | 'oauthScopes' | 'oauthAuthorizationUrl' | 'oauthTokenUrl' | 'oauthClientAuthMethod' | 'oauthRedirectPort'>>; }
export interface McpCallResult { ok: boolean; outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain'; serverId: string; tool: string; content: { type: 'text'; text: string }[]; structuredContent?: unknown; truncated?: boolean; message?: string; untrusted: true; }

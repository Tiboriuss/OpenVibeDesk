import { providerFailure, ProviderDisplayError } from './provider-errors';
import type { AiConfig } from '../shared/model';

type Connection = Pick<AiConfig, 'baseUrl' | 'provider' | 'protocol' | 'authMode' | 'apiVersion'>;

/** Credentials go only to the selected endpoint, never a guessed alternate origin. */
export function providerHeaders(config: Connection, key: string | null, accept = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: accept };
  const mode = config.provider === 'chatgpt' ? 'bearer' : config.authMode ?? 'bearer';
  if (key && mode === 'api-key') headers['api-key'] = key;
  else if (key && mode === 'bearer') headers.Authorization = `Bearer ${key}`;
  return headers;
}

export function providerEndpoint(config: Connection, operation: 'chat-completions' | 'responses' | 'models', model?: string): string {
  if (config.provider === 'chatgpt') {
    if (operation === 'chat-completions') throw providerFailure('chatgptProtocol');
    return `https://api.openai.com/v1/${operation}`;
  }
  const base = config.baseUrl.replace(/\/+$/, '');
  const legacy = /\/openai\/deployments\/[^/]+$/i.test(new URL(base).pathname);
  if (legacy && operation !== 'chat-completions') throw providerFailure(operation === 'models' ? 'azureModels' : 'azureResponses');
  const url = new URL(`${base}/${operation === 'chat-completions' ? 'chat/completions' : operation}`);
  if (legacy && model) {
    const deployment = decodeURIComponent(new URL(base).pathname.split('/').pop()!);
    if (model !== deployment) throw providerFailure('azureDeployment');
  }
  if (config.apiVersion) url.searchParams.set('api-version', config.apiVersion);
  return url.toString();
}

/** Bounded, allowlisted error codes; never echo provider messages, secrets or user content. */
const chatGptErrorHints: Record<string, readonly [string, string]> = {
  subscription_sharing_user_not_eligible: ['Der gewählte ChatGPT-Zugang kann seinen Tarif hier nicht verwenden. Prüfe Konto, Workspace und dessen Vorgaben.', "Check the ChatGPT account, workspace and plan eligibility."],
  subscription_sharing_usage_limit_exceeded: ['Das Nutzungslimit für diese ChatGPT-Verbindung ist erreicht. Prüfe „Nutzung verwalten“; es wird keine andere Abrechnung verwendet.', "This ChatGPT connection has reached its usage limit. Check your plan usage."],
  subscription_sharing_usage_unavailable: ['Das ChatGPT-Kontingent kann derzeit nicht geprüft werden. Bitte später erneut versuchen.', "ChatGPT usage is temporarily unavailable. Try again later."],
  subscription_sharing_unsupported_capability: ['Das Modell oder die gewählte Anfragefunktion wird über diesen ChatGPT-Zugang nicht unterstützt.', "This ChatGPT connection does not support the model or requested feature."],
  subscription_sharing_route_not_supported: ['Diese Anfrage wird über den gewählten ChatGPT-Zugang nicht unterstützt.', "This request is unavailable with the selected ChatGPT connection."],
  subscription_sharing_invalid_user: ['Der ChatGPT-Zugang konnte nicht bestätigt werden. Prüfe die Verbindung und melde dich gegebenenfalls erneut an.', "Could not verify the ChatGPT account. Check the connection or sign in again."],
  subscription_sharing_user_unavailable: ['Der ChatGPT-Workspace ist derzeit nicht erreichbar. Bitte später erneut versuchen.', "The ChatGPT workspace is unavailable. Try again later."],
  chatpass_v2_scope_not_authorized: ['Für diese Verbindung fehlt die Freigabe zur Nutzung deines ChatGPT-Tarifs.', "Grant this connection access to your ChatGPT plan."],
  chatpass_v2_invalid_authorization_context: ['Die ChatGPT-Freigabe passt nicht zu dieser Anfrage. Bitte die Verbindung prüfen.', "Check the ChatGPT connection. The authorization does not match this request."]
};
const transientCodes = new Set(['server_error', 'internal_server_error', 'server_is_overloaded', 'server_overloaded']);
const rateLimitCodes = new Set(['rate_limit_exceeded', 'rate_limit_error', 'slow_down']);
const quotaCodes = new Set([
  'insufficient_quota', 'quota_exceeded', 'billing_hard_limit_reached',
  'organization_usage_limit_exceeded', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded'
]);
const publicCodes = new Set([
  'DeploymentNotFound', 'ResourceNotFound', 'InvalidApiKey', 'Unauthorized', 'PermissionDenied', 'BadRequest', 'InvalidRequest',
  'OperationNotSupported', 'InvalidApiVersionParameter', 'AuthenticationError', 'ContentFilter', 'content_filter', 'invalid_api_key',
  'invalid_request_error', 'model_not_found', 'unsupported_parameter', 'unsupported_value', 'missing_required_parameter', 'invalid_api_version',
  'context_length_exceeded', 'invalid_prompt', ...transientCodes, ...rateLimitCodes, ...quotaCodes, ...Object.keys(chatGptErrorHints)
]);

export function knownProviderErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && publicCodes.has(value) ? value : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return;
  const { code, type } = error as { code?: unknown; type?: unknown };
  // Use the type only when no specific code was supplied. An unknown code
  // must not accidentally inherit automatic retries from a broader type.
  return knownProviderErrorCode(code ?? type);
}

type FailureContext = 'request' | 'stream' | 'complete' | 'models';
type BodyShape = 'error' | 'detail' | 'other';

export class ProviderHttpError extends ProviderDisplayError {
  constructor(
    message: string, readonly httpStatus: number | undefined, readonly code: string | undefined,
    readonly requestId: string | undefined, readonly bodyShape: BodyShape | undefined, english: string,
    readonly retryable: boolean, readonly retryAfterMs?: number
  ) { super(message, english); this.name = 'ProviderHttpError'; }
}

function providerReportedError(config: Connection, error: unknown, options: {
  context: FailureContext;
  status?: number;
  requestId?: string;
  shape?: BodyShape;
  beforeOutput?: boolean;
  retryAfterMs?: number;
}): ProviderHttpError {
  const { context, status, requestId, shape, beforeOutput, retryAfterMs } = options;
  const code = errorCode(error);
  const transient = code && transientCodes.has(code);
  const hints = config.provider === 'chatgpt' && code && chatGptErrorHints[code] ? chatGptErrorHints[code]
    : code && quotaCodes.has(code) ? ['Das API-Kontingent ist erschöpft. Prüfe Guthaben und Ausgabenlimits beim Anbieter.', 'Check your API credits and spending limits with the provider.']
    : code === 'context_length_exceeded' ? ['Der Kontext ist zu groß für das gewählte Modell. Kürze die Anfrage oder starte einen neuen Chat.', 'The context exceeds the selected model’s limit. Shorten the request or start a new chat.']
    : code === 'ContentFilter' || code === 'content_filter' ? ['Der Anbieter hat die Anfrage oder Antwort durch einen Inhaltsfilter gestoppt.', 'The provider’s content filter stopped the request or response.']
    : status === 401 || status === 403 ? config.provider === 'chatgpt' ? ['Prüfe die ChatGPT-Anmeldung und die Freigabe zur Tarifnutzung.', 'Check the ChatGPT sign-in and permission to use your plan.'] : ['Prüfe Schlüssel, Anmeldeart und Zugriffsrechte.', 'Check the key, authentication method and permissions.']
    : status === 404 ? config.provider === 'azure' ? ['Prüfe Ressourcen-URL und Deployment-Namen. /openai/v1 verwendet den Deployment-Namen als Modell.', 'Check the resource URL and deployment name. With /openai/v1, use the deployment name as the model.'] : ['Prüfe Basis-URL, API-Schnittstelle und Modellnamen.', 'Check the base URL, API protocol and model name.']
    : status === 429 || code && rateLimitCodes.has(code) ? ['Das Anfragelimit ist erreicht. Warte vor einer neuen Anfrage.', 'The rate limit has been reached. Wait before retrying.']
    : transient ? ['Der Anbieter meldet einen vorübergehenden Serverfehler.', 'The provider reported a temporary server error.']
    : status && status >= 500 ? ['Der Anbieter meldet einen Serverfehler.', 'The provider reported a server error.']
    : code === 'invalid_prompt' ? ['Der Anbieter hat die Anfrage abgelehnt. Prüfe die Eingabe.', 'The provider rejected the input. Review the request.']
    : status === 400 || status === 422 ? ['Prüfe API-Schnittstelle, Modell beziehungsweise Deployment und Thinking-Einstellung.', 'Check the API protocol, model or deployment, and reasoning setting.']
    : [];
  const descriptions = {
    request: ['Der Endpunkt hat die Anfrage abgelehnt', 'The endpoint rejected the request'],
    stream: ['Der Endpunkt meldet einen Fehler beim Streaming', 'The endpoint reported an error while streaming'],
    complete: status ? ['Der Endpunkt hat auch ohne Streaming die Anfrage abgelehnt', 'The endpoint rejected the non-streaming request']
      : ['Der Endpunkt meldet auch ohne Streaming einen Fehler', 'The endpoint reported an error in non-streaming mode'],
    models: ['Der Endpunkt hat die Modellabfrage abgelehnt', 'The endpoint rejected the model list request']
  } as const;
  const [de, en] = descriptions[context];
  const details = [status ? `HTTP ${status}` : '', code].filter(Boolean).join(' · ');
  const suffix = details ? ` (${details}).` : '.';
  const retryable = beforeOutput === true && (context === 'stream'
    ? !!transient
    : context === 'request' && !!status && [500, 502, 503, 504].includes(status) && (code ? !!transient : !hasProviderErrorCode(error)));
  return new ProviderHttpError(`${de}${suffix}${hints[0] ? ' ' + hints[0] : ''}`, status, code, requestId, shape,
    `${en}${suffix}${hints[1] ? ' ' + hints[1] : ''}`, retryable, retryAfterMs);
}

function hasProviderErrorCode(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code != null;
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export function providerPayloadError(config: Connection, error: unknown, response: Response, context: 'stream' | 'complete', beforeOutput = false): ProviderHttpError {
  return providerReportedError(config, error, {
    context, beforeOutput, requestId: responseRequestId(response), retryAfterMs: retryAfter(response)
  });
}

function responseRequestId(response: Response): string | undefined {
  const request = response.headers.get('x-request-id');
  return request && /^req_[a-zA-Z0-9_-]{1,120}$/.test(request) ? request : undefined;
}

/** Preserve safe protocol diagnostics without copying raw provider messages. */
export async function providerHttpError(config: Connection, response: Response, context: 'request' | 'complete' | 'models' = 'request'): Promise<Error> {
  let reported: unknown;
  let bodyShape: 'error' | 'detail' | 'other' = 'other';
  const reader = response.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 16_384) break; chunks.push(next.value); }
      if (size <= 16_384) {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        bodyShape = data?.error && typeof data.error === 'object' ? 'error' : typeof data?.detail === 'string' ? 'detail' : 'other';
        reported = bodyShape === 'error' ? data.error : data;
      }
    } catch { /* HTTP status still carries a useful diagnostic. */ }
    finally { await reader.cancel().catch(() => {}); }
  }
  return providerReportedError(config, reported, { context, status: response.status, requestId: responseRequestId(response), shape: bodyShape, beforeOutput: true, retryAfterMs: retryAfter(response) });
}

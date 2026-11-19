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
const publicCodes = new Set(['DeploymentNotFound', 'ResourceNotFound', 'InvalidApiKey', 'Unauthorized', 'PermissionDenied', 'BadRequest', 'InvalidRequest', 'OperationNotSupported', 'InvalidApiVersionParameter', 'AuthenticationError', 'ContentFilter', 'content_filter', 'invalid_api_key', 'invalid_request_error', 'insufficient_quota', 'rate_limit_exceeded', 'quota_exceeded', 'model_not_found', 'unsupported_parameter', 'unsupported_value', 'missing_required_parameter', 'invalid_api_version', 'context_length_exceeded', ...Object.keys(chatGptErrorHints)]);
export class ProviderHttpError extends ProviderDisplayError {
  constructor(message: string, readonly httpStatus: number | undefined, readonly code?: string, readonly requestId?: string, readonly bodyShape?: 'error' | 'detail' | 'other', english = message) { super(message, english); this.name = 'ProviderHttpError'; }
}
export function providerReportedError(config: Connection, error: unknown, status?: number, requestId?: string, context: 'request' | 'complete' | 'models' = 'request', shape?: 'error' | 'detail' | 'other'): ProviderHttpError {
  const raw = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof raw.code === 'string' && publicCodes.has(raw.code) ? raw.code : '';
  const azure = config.provider === 'azure';
  const hints = config.provider === 'chatgpt' && code && chatGptErrorHints[code] ? chatGptErrorHints[code]
    : status === 401 || status === 403 ? config.provider === 'chatgpt' ? ['Prüfe die ChatGPT-Anmeldung und die Freigabe zur Tarifnutzung.', 'Check the ChatGPT sign-in and permission to use your plan.'] : ['Prüfe Schlüssel, Anmeldeart und Zugriffsrechte.', 'Check the key, authentication method and permissions.']
    : status === 404 ? azure ? ['Prüfe Ressourcen-URL und Deployment-Namen; /openai/v1 verwendet den Deployment-Namen als Modell.', 'Check the resource URL and deployment name. With /openai/v1, use the deployment name as the model.'] : ['Prüfe Basis-URL, API-Schnittstelle und Modellnamen.', 'Check the base URL, API protocol and model name.']
    : status === 429 ? ['Das Kontingent oder Anfragelimit ist erreicht. Warte vor einer neuen Anfrage.', 'The quota or rate limit has been reached. Wait before retrying.']
    : status === 400 || status === 422 ? ['Prüfe API-Schnittstelle, Modell beziehungsweise Deployment und Thinking-Einstellung.', 'Check the API protocol, model or deployment, and reasoning setting.']
    : status && status >= 500 ? ['Der Anbieter meldet einen Serverfehler.', 'The provider reported a server error.'] : [];
  const subjects = {
    request: ['die Anfrage', 'the request'], complete: ['auch ohne Streaming die Anfrage', 'the non-streaming request'], models: ['die Modellabfrage', 'the model list request']
  } as const;
  const [de, en] = subjects[context];
  const details = [status ? `HTTP ${status}` : '', code].filter(Boolean).join(' · ');
  const suffix = details ? ` (${details}).` : '.';
  return new ProviderHttpError(`Der Endpunkt hat ${de} abgelehnt${suffix}${hints[0] ? ' ' + hints[0] : ''}`, status, code || undefined, requestId, shape,
    `The endpoint rejected ${en}${suffix}${hints[1] ? ' ' + hints[1] : ''}`);
}

/** Preserve safe protocol diagnostics without copying raw provider messages. */
export async function providerHttpError(config: Connection, response: Response, context: 'request' | 'complete' | 'models' = 'request'): Promise<Error> {
  let code = '';
  let bodyShape: 'error' | 'detail' | 'other' = 'other';
  const reader = response.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 16_384) break; chunks.push(next.value); }
      if (size <= 16_384) {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        bodyShape = data?.error && typeof data.error === 'object' ? 'error' : typeof data?.detail === 'string' ? 'detail' : 'other';
        const candidate = data?.error?.code ?? data?.code;
        if (typeof candidate === 'string' && publicCodes.has(candidate)) code = candidate;
      }
    } catch { /* HTTP status still carries a useful diagnostic. */ }
    finally { await reader.cancel().catch(() => {}); }
  }
  const request = response.headers.get('x-request-id');
  return providerReportedError(config, { code }, response.status, request && /^req_[a-zA-Z0-9_-]{1,120}$/.test(request) ? request : undefined, context, bodyShape);
}

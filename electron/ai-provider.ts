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
    if (operation === 'chat-completions') throw new Error('Der ChatGPT-Zugang unterstützt nur die Responses API.');
    return `https://api.openai.com/v1/${operation}`;
  }
  const base = config.baseUrl.replace(/\/+$/, '');
  const legacy = /\/openai\/deployments\/[^/]+$/i.test(new URL(base).pathname);
  if (legacy && operation !== 'chat-completions') throw new Error(operation === 'models'
    ? 'Dieser Azure-Deployment-Endpunkt bietet keine Modellliste. Trage den Deployment-Namen manuell ein oder verwende /openai/v1.'
    : 'Die Responses API benötigt bei Azure die Ressourcen-URL mit /openai/v1, keinen Deployment-Pfad.');
  const url = new URL(`${base}/${operation === 'chat-completions' ? 'chat/completions' : operation}`);
  if (legacy && model) {
    const deployment = decodeURIComponent(new URL(base).pathname.split('/').pop()!);
    if (model !== deployment) throw new Error('Der Modellname muss zum Deployment im Azure-Endpunkt passen. Für mehrere Deployments verwende /openai/v1.');
  }
  if (config.apiVersion) url.searchParams.set('api-version', config.apiVersion);
  return url.toString();
}

/** Bounded, allowlisted error codes; never echo provider messages, secrets or user content. */
const chatGptErrorHints: Record<string, string> = {
  subscription_sharing_user_not_eligible: 'Der gewählte ChatGPT-Zugang kann seinen Tarif hier nicht verwenden. Prüfe Konto, Workspace und dessen Vorgaben.',
  subscription_sharing_usage_limit_exceeded: 'Das Nutzungslimit für diese ChatGPT-Verbindung ist erreicht. Prüfe „Nutzung verwalten“; es wird keine andere Abrechnung verwendet.',
  subscription_sharing_usage_unavailable: 'Das ChatGPT-Kontingent kann derzeit nicht geprüft werden. Bitte später erneut versuchen.',
  subscription_sharing_unsupported_capability: 'Das Modell oder die gewählte Anfragefunktion wird über diesen ChatGPT-Zugang nicht unterstützt.',
  subscription_sharing_route_not_supported: 'Diese Anfrage wird über den gewählten ChatGPT-Zugang nicht unterstützt.',
  subscription_sharing_invalid_user: 'Der ChatGPT-Zugang konnte nicht bestätigt werden. Prüfe die Verbindung und melde dich gegebenenfalls erneut an.',
  subscription_sharing_user_unavailable: 'Der ChatGPT-Workspace ist derzeit nicht erreichbar. Bitte später erneut versuchen.',
  chatpass_v2_scope_not_authorized: 'Für diese Verbindung fehlt die Freigabe zur Nutzung deines ChatGPT-Tarifs.',
  chatpass_v2_invalid_authorization_context: 'Die ChatGPT-Freigabe passt nicht zu dieser Anfrage. Bitte die Verbindung prüfen.'
};
const publicCodes = new Set(['DeploymentNotFound', 'ResourceNotFound', 'InvalidApiKey', 'Unauthorized', 'PermissionDenied', 'BadRequest', 'InvalidRequest', 'OperationNotSupported', 'InvalidApiVersionParameter', 'AuthenticationError', 'ContentFilter', 'content_filter', 'invalid_api_key', 'invalid_request_error', 'insufficient_quota', 'rate_limit_exceeded', 'quota_exceeded', 'model_not_found', 'unsupported_parameter', 'unsupported_value', 'missing_required_parameter', 'invalid_api_version', 'context_length_exceeded', ...Object.keys(chatGptErrorHints)]);
export class ProviderHttpError extends Error {
  constructor(message: string, readonly httpStatus: number | undefined, readonly code?: string, readonly requestId?: string, readonly bodyShape?: 'error' | 'detail' | 'other') { super(message); this.name = 'ProviderHttpError'; }
}
export function providerReportedError(config: Connection, error: unknown, status?: number, requestId?: string, context = 'Die Anfrage', shape?: 'error' | 'detail' | 'other'): ProviderHttpError {
  const raw = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof raw.code === 'string' && publicCodes.has(raw.code) ? raw.code : '';
  const azure = config.provider === 'azure';
  const hints = config.provider === 'chatgpt' && code && chatGptErrorHints[code] ? ` ${chatGptErrorHints[code]}`
    : status === 401 || status === 403 ? config.provider === 'chatgpt' ? ' Prüfe die ChatGPT-Anmeldung und die Freigabe zur Tarifnutzung.' : ' Prüfe Schlüssel, Anmeldeart und Zugriffsrechte.'
    : status === 404 ? azure ? ' Prüfe Ressourcen-URL und Deployment-Namen; /openai/v1 verwendet den Deployment-Namen als Modell.' : ' Prüfe Basis-URL, API-Schnittstelle und Modellnamen.'
    : status === 429 ? ' Das Kontingent oder Anfragelimit ist erreicht. Warte vor einer neuen Anfrage.'
    : status === 400 || status === 422 ? ' Prüfe API-Schnittstelle, Modell beziehungsweise Deployment und Thinking-Einstellung.'
    : status && status >= 500 ? ' Der Anbieter meldet einen Serverfehler.' : '';
  const subject = context.startsWith('auch ') ? `${context} die Anfrage` : context[0].toLocaleLowerCase('de-DE') + context.slice(1);
  return new ProviderHttpError(`Der Endpunkt hat ${subject} abgelehnt${status || code ? ` (${[status ? `HTTP ${status}` : '', code].filter(Boolean).join(' · ')})` : ''}.${hints}`, status, code || undefined, requestId, shape);
}

/** Preserve safe protocol diagnostics without copying raw provider messages. */
export async function providerHttpError(config: Connection, response: Response, context = 'Die Anfrage'): Promise<Error> {
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

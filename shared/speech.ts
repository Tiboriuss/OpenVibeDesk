import { z } from 'zod';

export const SPEECH_SAMPLE_RATE = 24_000;
export const SPEECH_MAX_RECORDING_SECONDS = 120;
export const SPEECH_MAX_CHUNK_BYTES = 96_000;
export const SPEECH_MAX_AUDIO_BYTES = SPEECH_SAMPLE_RATE * 2 * SPEECH_MAX_RECORDING_SECONDS;
export const SPEECH_MAX_PENDING_AUDIO_BYTES = SPEECH_SAMPLE_RATE * 2 * 20;
export const SPEECH_MAX_TEXT_CHARS = 32_000;

export type SpeechProvider = 'openai' | 'openai-compatible' | 'azure' | 'deepseek';
export type SpeechMode = 'live' | 'after';
export interface SpeechSettings {
  enabled: boolean;
  provider: SpeechProvider;
  mode: SpeechMode;
  /** Full transcription endpoint; separate from the chat provider. */
  endpoint: string;
  authMode: 'bearer' | 'api-key' | 'none';
  model: string;
  language: string;
  microphoneId: string;
  realtimeProtocol: 'ga' | 'beta';
}
export interface SpeechPublicSettings extends SpeechSettings {
  hasApiKey: boolean;
  configured: boolean;
  maxRecordingSeconds: number;
  error?: string;
}
export interface SpeechSettingsInput extends SpeechSettings { apiKey?: string; clearApiKey?: boolean; }
export type SpeechSettingsPatch = Partial<SpeechSettings>;
export interface SpeechSessionStart {
  id: string;
  mode: SpeechMode;
  maxRecordingSeconds: number;
  /** Snapshot at acknowledgement; events may already carry a newer state. */
  status: 'connecting' | 'recording' | 'transcribing';
}
export interface SpeechSessionEvent {
  id: string;
  status: 'connecting' | 'recording' | 'transcribing' | 'completed' | 'cancelled' | 'failed';
  /** Complete transcript so far, replacing the previous event's transcript. */
  text: string;
  error?: string;
  /** Explicit retry can transcribe the retained recording without reopening the microphone. */
  canRetry?: boolean;
}

export const defaultSpeechSettings: SpeechSettings = {
  enabled: false, provider: 'openai', mode: 'live',
  endpoint: 'wss://api.openai.com/v1/realtime?intent=transcription',
  authMode: 'bearer', model: 'gpt-live-transcribe', language: '', microphoneId: '', realtimeProtocol: 'ga'
};

export const speechProviders: Record<SpeechProvider, {
  label: string; modes: readonly SpeechMode[];
  defaults: Partial<Record<SpeechMode, Pick<SpeechSettings, 'endpoint' | 'model' | 'authMode' | 'realtimeProtocol'>>>;
}> = {
  openai: { label: 'OpenAI', modes: ['live', 'after'], defaults: {
    live: { endpoint: 'wss://api.openai.com/v1/realtime?intent=transcription', model: 'gpt-live-transcribe', authMode: 'bearer', realtimeProtocol: 'ga' },
    after: { endpoint: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-transcribe', authMode: 'bearer', realtimeProtocol: 'ga' }
  } },
  'openai-compatible': { label: 'OpenAI-kompatibel', modes: ['live', 'after'], defaults: {
    live: { endpoint: '', model: '', authMode: 'bearer', realtimeProtocol: 'ga' },
    after: { endpoint: '', model: '', authMode: 'bearer', realtimeProtocol: 'ga' }
  } },
  azure: { label: 'Azure OpenAI / Foundry', modes: ['live', 'after'], defaults: {
    live: { endpoint: '', model: '', authMode: 'api-key', realtimeProtocol: 'ga' },
    after: { endpoint: '', model: '', authMode: 'api-key', realtimeProtocol: 'ga' }
  } },
  deepseek: { label: 'DeepSeek', modes: ['after'], defaults: {
    after: { endpoint: 'https://api.deepseek.com/v1/tools/asr', model: '', authMode: 'bearer', realtimeProtocol: 'ga' }
  } }
};

/** Explicit endpoint configuration is allowed, credentials in URLs are not. */
export function speechEndpointProblem(endpoint: string, mode: SpeechMode): string | undefined {
  let url: URL;
  try { url = new URL(endpoint); } catch { return 'Bitte eine vollständige Transkriptions-URL eintragen.'; }
  if (url.username || url.password || url.hash) return 'Die URL darf keine Zugangsdaten und kein Fragment enthalten.';
  if ([...url.searchParams.keys()].some(key => /^(?:api[-_]?key|key|token|access[-_]?token|authorization|client[-_]?secret)$/i.test(key))) return 'Bitte Zugangsdaten im API-Schlüsselfeld statt in der URL eintragen.';
  const secure = mode === 'live' ? 'wss:' : 'https:';
  const local = mode === 'live' ? 'ws:' : 'http:';
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== secure && !(loopback && url.protocol === local)) return mode === 'live' ? 'Live benötigt eine WSS-URL; WS ist nur lokal erlaubt.' : 'Nach der Aufnahme wird eine HTTPS-URL benötigt; HTTP ist nur lokal erlaubt.';
  return undefined;
}
const fields = z.object({
  enabled: z.boolean(), provider: z.enum(['openai', 'openai-compatible', 'azure', 'deepseek']), mode: z.enum(['live', 'after']),
  endpoint: z.string().trim().max(2048), authMode: z.enum(['bearer', 'api-key', 'none']),
  model: z.string().trim().max(200).regex(/^[^\u0000-\u001f\u007f]*$/),
  language: z.string().trim().max(20).regex(/^$|^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$/),
  microphoneId: z.string().max(512), realtimeProtocol: z.enum(['ga', 'beta'])
}).strict();
function validateSettings(value: SpeechSettings, ctx: z.RefinementCtx): void {
  if (!speechProviders[value.provider].modes.includes(value.mode)) ctx.addIssue({ code: 'custom', path: ['mode'], message: 'Dieser Anbieter unterstützt nur Transkription nach der Aufnahme.' });
  if (value.endpoint || value.enabled) {
    const message = speechEndpointProblem(value.endpoint, value.mode);
    if (message) ctx.addIssue({ code: 'custom', path: ['endpoint'], message });
  }
  if (value.enabled && value.provider !== 'deepseek' && !value.model) ctx.addIssue({ code: 'custom', path: ['model'], message: 'Bitte ein Transkriptionsmodell oder Deployment eintragen.' });
}
export const speechSettingsSchema = fields.superRefine(validateSettings);
export const speechSettingsPatchSchema = fields.partial();
export const speechSettingsInputSchema = fields.extend({
  apiKey: z.string().trim().max(16_384).regex(/^[^\u0000-\u001f\u007f]*$/).optional(), clearApiKey: z.boolean().optional()
}).superRefine((value, ctx) => {
  validateSettings(value, ctx);
  if (value.apiKey && value.clearApiKey) ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'Einen Schlüssel entweder ersetzen oder entfernen.' });
});

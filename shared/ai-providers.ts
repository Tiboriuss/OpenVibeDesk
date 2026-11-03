import { z } from 'zod';

export const aiProviderSchema = z.enum(['openai-compatible', 'openai', 'azure', 'chatgpt']);
export const aiProtocolSchema = z.enum(['chat-completions', 'responses']);
export const aiAuthModeSchema = z.enum(['bearer', 'api-key', 'none']);
export const aiApiVersionSchema = z.string().trim().max(80).refine(value => !value || /^(?:\d{4}-\d{2}-\d{2}(?:-preview)?|v1|preview)$/.test(value));
export const aiConnectionFields = {
  provider: aiProviderSchema.optional(), protocol: aiProtocolSchema.optional(), authMode: aiAuthModeSchema.optional(),
  apiVersion: aiApiVersionSchema.optional()
};
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type AiProtocol = 'chat-completions' | 'responses';
export type AiAuthMode = 'bearer' | 'api-key' | 'none';

export interface AiConnection {
  provider?: AiProvider;
  protocol?: AiProtocol;
  authMode?: AiAuthMode;
  apiVersion?: string;
}

export function isAzureEndpoint(value: string): boolean {
  try { const host = new URL(value).hostname; return host.endsWith('.openai.azure.com') || host.endsWith('.services.ai.azure.com'); }
  catch { return false; }
}

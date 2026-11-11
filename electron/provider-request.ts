import type { AgentSettings, AiConfig, ChatOptions } from '../shared/model';
import { normalizeAgentSettings } from '../shared/agent-settings';
import type { ProviderMessage, ResponseInputItem } from './stream';

export type ProviderRequestBudget = Pick<AgentSettings, 'contextTokenBudget' | 'outputTokenReserve'>;
export interface ProviderRequestMeasurement { bytes: number; estimatedInputTokens: number; }

/** A local conservative estimate, not a provider tokenizer or a billing count. */
export class ContextBudgetError extends Error {
  readonly estimatedInputTokens: number;
  readonly inputTokenBudget: number;
  readonly contextTokenBudget: number;
  readonly outputTokenReserve: number;
  constructor(readonly observedBytes: number, budget: ProviderRequestBudget) {
    const inputTokenBudget = budget.contextTokenBudget - budget.outputTokenReserve;
    super(`Das eingestellte Kontextbudget reicht für diese Anfrage nicht aus (${observedBytes.toLocaleString('de-DE')} geschätzte Eingabetokens, Budget ${inputTokenBudget.toLocaleString('de-DE')}). Verkürze den Auftrag oder passe das Kontextbudget in den Agent-Einstellungen an. Bereits ausgeführte Aktionen werden nicht wiederholt.`);
    this.name = 'ContextBudgetError';
    this.estimatedInputTokens = observedBytes;
    this.inputTokenBudget = inputTokenBudget;
    this.contextTokenBudget = budget.contextTokenBudget;
    this.outputTokenReserve = budget.outputTokenReserve;
  }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Preserve complete opaque output items in their original order within a turn. */
function responseInput(messages: readonly ProviderMessage[], directChatGpt: boolean): ResponseInputItem[] {
  return messages.flatMap((message): ResponseInputItem[] => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    if (message.role === 'assistant' && message.responseItems) return message.responseItems;
    const items: ResponseInputItem[] = message.content ? [{ role: directChatGpt && message.role === 'system' ? 'developer' : message.role, content: message.content }] : [];
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) {
      items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(directChatGpt ? { namespace: 'ovd' } : {}) });
    }
    return items;
  });
}

/** The allocator and every transport use exactly the same outbound representation. */
export function buildProviderRequest(config: AiConfig, messages: readonly ProviderMessage[], options: ChatOptions, stream = true, tools?: readonly unknown[]): Record<string, unknown> & { model: string } {
  const model = options.tier === 'smart' ? config.smartModel : config.simpleModel;
  const thinking = options.tier === 'smart' ? config.smartThinking : config.simpleThinking;
  if (config.protocol === 'responses' || config.provider === 'chatgpt') {
    const functions = tools?.map(raw => {
      if (!record(raw) || raw.type !== 'function' || !record(raw.function) || typeof raw.function.name !== 'string') throw new Error('Der Endpunkt kann nur die angebotenen Funktionswerkzeuge verwenden.');
      return { type: 'function', ...raw.function, strict: false };
    });
    return {
      model, input: responseInput(messages, config.provider === 'chatgpt'), stream, store: false,
      ...(config.provider === 'chatgpt' ? {} : { truncation: 'disabled' }),
      include: ['reasoning.encrypted_content'],
      ...(functions?.length ? { tools: config.provider === 'chatgpt' ? [{ type: 'namespace', name: 'ovd', description: 'OpenVibeDesk workspace functions selected for this request.', tools: functions }] : functions } : {}),
      ...(thinking === 'off' ? {} : { reasoning: { effort: thinking } })
    };
  }
  // Internal budgeting metadata and Responses-only items are not protocol fields.
  const projectedMessages = messages.map(message => {
    if (message.role === 'tool') return { role: message.role, tool_call_id: message.tool_call_id, content: message.content };
    if (message.role === 'assistant') return { role: message.role, content: message.content, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) };
    return { role: message.role, content: message.content };
  });
  return { model, messages: projectedMessages, stream, ...(tools?.length ? { tools } : {}), ...(thinking === 'off' ? {} : { reasoning_effort: thinking }) };
}

function measure(serialized: string): ProviderRequestMeasurement {
  const bytes = Buffer.byteLength(serialized, 'utf8');
  // Count UTF-8 bytes rather than characters/4: schemas, message wrappers and
  // encrypted continuation data must not disappear from the local envelope.
  return { bytes, estimatedInputTokens: bytes };
}

export function measureProviderRequest(config: AiConfig, messages: readonly ProviderMessage[], options: ChatOptions, stream = true, tools?: readonly unknown[]): ProviderRequestMeasurement {
  return measure(JSON.stringify(buildProviderRequest(config, messages, options, stream, tools)));
}

export function serializeProviderRequest(config: AiConfig, messages: readonly ProviderMessage[], options: ChatOptions, stream = true, tools?: readonly unknown[], budget?: ProviderRequestBudget): string {
  const settings = normalizeAgentSettings(budget);
  const serialized = JSON.stringify(buildProviderRequest(config, messages, options, stream, tools));
  const measurement = measure(serialized);
  if (measurement.estimatedInputTokens > settings.contextTokenBudget - settings.outputTokenReserve) throw new ContextBudgetError(measurement.bytes, settings);
  // The reserve reduces the allowed input; it is not an unsupported generation
  // parameter on ChatGPT plan or compatible endpoints.
  return serialized;
}

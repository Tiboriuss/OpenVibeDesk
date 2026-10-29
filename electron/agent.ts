import { inspectToolResult, ModuleToolRuntime } from './agent-tools';
import { streamTurn, requestCompleteTurn, ToolStreamError, type ProviderMessage, type StreamTurn, type ToolCall } from './stream';
import { normalizeAgentSettings } from '../shared/agent-settings';
import { createChatEvidenceCollector, type ChatEvidence, type ChatEvidenceStatus } from '../shared/chat-evidence';
import type { AgentRunLimit, AgentSettings, AiConfig, ChatOptions, ToolEvent } from '../shared/model';
import type { ModuleListing, ModuleQuery, ModuleToolListing, ModuleToolQuery } from '../shared/modules';

export type AgentDependencies = {
  settings?: AgentSettings;
  getModules(options?: ModuleQuery): ModuleListing | Promise<ModuleListing>;
  getModuleTools(options: ModuleToolQuery): ModuleToolListing | Promise<ModuleToolListing>;
  invokeModuleTool(moduleId: string, toolName: string, args: unknown, signal: AbortSignal, callId?: string): Promise<unknown>;
  onToolPlan?(calls: { id: string; moduleId: string; name: string; args: Record<string, unknown>; label: string }[], signal: AbortSignal): Promise<void>;
  onToolEvent?(event: ToolEvent): void;
  onReplaceText?(text: string): void;
  onLimitReached?(info: AgentRunLimit): void;
  onEvidence?(evidence: ChatEvidence): void;
  /** A host-controlled handoff ends this run before any more calls or provider turns. */
  finishAfterTool?(): string | undefined;
};
const isDiscovery = (name: string) => name === 'find_modules' || name === 'get_module_tools';
function callKind(calls: readonly ToolCall[]): AgentRunLimit['nextToolType'] {
  if (!calls.length) return 'none';
  const discovery = calls.some(call => isDiscovery(call.function.name));
  const action = calls.some(call => !isDiscovery(call.function.name));
  return discovery && action ? 'mixed' : discovery ? 'discovery' : 'action';
}

/** A task starts with discovery only. Loaded module schemas and budgets belong to this run. */
export async function runAgent(
  config: AiConfig, key: string | null, messages: ProviderMessage[], options: ChatOptions,
  signal: AbortSignal, onDelta: (text: string) => void, deps: AgentDependencies
): Promise<void> {
  const settings = normalizeAgentSettings(deps.settings), startedAt = Date.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), settings.timeoutSeconds * 1000);
  const combined = AbortSignal.any([signal, timeout.signal]);
  const conversation = [...messages];
  const runtime = new ModuleToolRuntime(settings);
  const evidence = createChatEvidenceCollector(deps.onEvidence);
  let evidenceStatus: Exclude<ChatEvidenceStatus, 'running'> = 'completed';
  let toolRounds = 0, callCount = 0, discoveryCalls = 0, actionCalls = 0, visibleText = '', turnPrefix = '';
  let stoppedAtLimit = false, awaitingAction = false;
  let inFlightCall: { name: string; label: string; discovery: boolean } | undefined;
  const emit = (text: string) => { visibleText += text; onDelta(text); };
  const emitMessage = (text: string) => emit(`${visibleText ? '\n\n' : ''}${text}`);
  const replace = (text: string) => { deps.onReplaceText?.(text); visibleText = text; };
  const stopAtLimit = (reason: AgentRunLimit['reason'], nextToolType: AgentRunLimit['nextToolType']) => {
    if (stoppedAtLimit) return;
    stoppedAtLimit = true;
    evidenceStatus = 'limited';
    const limit = reason === 'tool_rounds' ? settings.maxToolRounds : reason === 'tool_calls' ? settings.maxToolCalls : settings.timeoutSeconds;
    const info: AgentRunLimit = { status: 'limit_reached', reason, toolRounds, toolCalls: callCount, discoveryCalls, actionCalls, elapsedMs: Math.max(0, Date.now() - startedAt), limit, nextToolType };
    const reached = reason === 'tool_rounds' ? `Das eingestellte Limit von ${limit} Werkzeugrunden ist erreicht.` : reason === 'tool_calls' ? `Das eingestellte Limit von ${limit} Werkzeugaufrufen ist erreicht.` : `Das eingestellte Zeitlimit von ${limit} Sekunden ist erreicht.`;
    const pending = nextToolType === 'discovery' ? 'Die nächste Modul- oder Werkzeugsuche wurde nicht gestartet.' : nextToolType === 'action' ? 'Die nächste Modulaktion wurde nicht gestartet.' : nextToolType === 'mixed' ? 'Die nächste Runde mit Suche und Modulaktionen wurde nicht gestartet.' : awaitingAction ? 'Der zuletzt gestartete Vorgang kann noch abgeschlossen werden; bitte seinen Status prüfen.' : 'Es wird kein weiterer Werkzeugaufruf gestartet.';
    emitMessage(`${reached} Bisher: ${toolRounds} Werkzeugrunden, ${callCount} Aufrufe (${discoveryCalls} Modul-/Werkzeugsuchen, ${actionCalls} Modulaktionsaufrufe). ${pending} Bereits ausgeführte Änderungen und protokollierte Statusangaben bleiben erhalten. Es gibt keinen automatischen weiteren Versuch.`);
    deps.onLimitReached?.(info);
  };
  const checkAbort = (): boolean => {
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    if (timeout.signal.aborted) { stopAtLimit('timeout', 'none'); return true; }
    return false;
  };
  const withinDeadline = <T>(work: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const cleanup = () => { timeout.signal.removeEventListener('abort', expired); signal.removeEventListener('abort', stopped); };
    const expired = () => { cleanup(); reject(new Error('Agent execution deadline reached')); };
    const stopped = () => { cleanup(); reject(new DOMException('Abgebrochen', 'AbortError')); };
    timeout.signal.addEventListener('abort', expired, { once: true });
    signal.addEventListener('abort', stopped, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) stopped(); else if (timeout.signal.aborted) expired();
  });
  try {
    while (true) {
      if (checkAbort()) return;
      // Keep the exact allowlist for this response. Loading a schema does not
      // authorize its speculative execution in the same response.
      const offer = runtime.captureOffer(), offeredTools = offer.definitions;
      const offeredNames = new Set(offeredTools.map(tool => tool.function.name));
      turnPrefix = visibleText;
      let startedText = false;
      const emitTurnText = (delta: string) => {
        if (!deps.onReplaceText) return;
        if (!startedText && visibleText) emit('\n\n');
        startedText = true; emit(delta);
      };
      let turn: StreamTurn;
      try {
        turn = await streamTurn(config, key, conversation, options, combined, emitTurnText, offeredTools, settings.requestTimeoutSeconds * 1000);
      } catch (error) {
        if (!(error instanceof ToolStreamError) || combined.aborted || settings.transportRetries === 0) throw error;
        // Retry only rejected, effect-free protocol turns, using this same offer.
        // A completed call or domain failure never enters this retry path.
        let retryError: unknown = error;
        let recovered: StreamTurn | undefined;
        for (let attempt = 0; attempt < settings.transportRetries; attempt++) {
          try { recovered = await requestCompleteTurn(config, key, conversation, options, combined, offeredTools, settings.requestTimeoutSeconds * 1000); break; }
          catch (cause) { retryError = cause; if (!(cause instanceof ToolStreamError) || combined.aborted) throw cause; }
        }
        if (!recovered) throw retryError;
        turn = recovered;
        if (deps.onReplaceText && visibleText !== turnPrefix) replace(turnPrefix);
        startedText = false;
        if (turn.text) emitTurnText(turn.text);
      }
      if (checkAbort()) return;
      if (!turn.toolCalls.length) {
        if (!deps.onReplaceText && turn.text) emitMessage(turn.text);
        return;
      }
      if (deps.onReplaceText && visibleText !== turnPrefix) replace(turnPrefix);
      if (deps.onToolPlan) {
        const plan = turn.toolCalls.flatMap(call => {
          const tool = offer.active.get(call.function.name);
          if (!tool || !offeredNames.has(call.function.name)) return [];
          let args: unknown;
          try { args = JSON.parse(call.function.arguments); } catch { return []; }
          if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
          return [{ id: call.id, moduleId: tool.moduleId, name: call.function.name, args: args as Record<string, unknown>, label: runtime.label(call.function.name, offer.active) }];
        });
        // Persist accepted, offered steps even when a configured execution limit
        // stops this batch. Continuation cannot invent an unrecorded mutation.
        if (plan.length) await withinDeadline(deps.onToolPlan(plan, combined));
        if (checkAbort()) return;
      }
      if (toolRounds >= settings.maxToolRounds) { stopAtLimit('tool_rounds', callKind(turn.toolCalls)); return; }
      if (callCount >= settings.maxToolCalls) { stopAtLimit('tool_calls', callKind(turn.toolCalls)); return; }
      toolRounds++;
      conversation.push({ role: 'assistant', content: turn.text || null, tool_calls: turn.toolCalls });
      for (let index = 0; index < turn.toolCalls.length; index++) {
        if (checkAbort()) return;
        if (callCount >= settings.maxToolCalls) { stopAtLimit('tool_calls', callKind(turn.toolCalls.slice(index))); return; }
        const call = turn.toolCalls[index], discovery = isDiscovery(call.function.name);
        callCount++;
        if (discovery) discoveryCalls++; else actionCalls++;
        awaitingAction = !discovery;
        inFlightCall = { name: call.function.name, label: runtime.label(call.function.name, offer.active), discovery };
        if (!discovery) evidence.start();
        const result = await withinDeadline(runtime.execute(call.function.name, call.function.arguments, {
          getModules: async query => { combined.throwIfAborted(); return deps.getModules(query); },
          getModuleTools: async query => { combined.throwIfAborted(); return deps.getModuleTools(query); },
          // A host result can arrive after the deadline. Preserve its actual
          // outcome before stopping; never discard a completed side effect.
          invokeModuleTool: async (moduleId, name, args) => { combined.throwIfAborted(); return deps.invokeModuleTool(moduleId, name, args, combined, call.id); }
        }, offeredNames, offer.active));
        let parsed: unknown;
        try { parsed = JSON.parse(result); } catch { parsed = { ok: false, error: 'Die Modulfunktion hat kein gültiges Ergebnis geliefert.' }; }
        const outcome = inspectToolResult(parsed), label = runtime.label(call.function.name, offer.active);
        const interruptedAction = !discovery && timeout.signal.aborted && !outcome.explicit && outcome.status === 'failed';
        const event: ToolEvent = { name: call.function.name, status: interruptedAction ? 'uncertain' : outcome.status, label,
          ...(interruptedAction ? { detail: 'Das Zeitlimit wurde während des Aufrufs erreicht. Bitte den tatsächlichen Status prüfen; der Aufruf wird nicht wiederholt.' } : outcome.detail ? { detail: outcome.detail } : {}) };
        if (!discovery) evidence.record(event, result, offer.active.get(call.function.name)?.moduleId);
        deps.onToolEvent?.(event);
        inFlightCall = undefined;
        conversation.push({ role: 'tool', tool_call_id: call.id, content: result });
        if (!interruptedAction) awaitingAction = false;
        if (checkAbort()) return;
        if (outcome.explicit && outcome.status !== 'completed') {
          const statusText = outcome.status === 'cancelled' ? 'abgebrochen' : outcome.status === 'uncertain' ? 'Ergebnis unklar' : 'fehlgeschlagen';
          emitMessage(`${label}: ${statusText}.${outcome.detail ? ` ${outcome.detail}` : ''}`);
          return;
        }
        const handoff = deps.finishAfterTool?.();
        if (handoff) { emitMessage(handoff); return; }
        if (outcome.explicit && outcome.status === 'completed' && parsed && typeof parsed === 'object' && 'warning' in parsed && typeof parsed.warning === 'string' && parsed.warning.trim()) {
          const warning = parsed.warning.trim().slice(0, 500);
          const message = 'message' in parsed && typeof parsed.message === 'string' ? parsed.message.trim().slice(0, 500) : '';
          emitMessage(`${label}: abgeschlossen.${message && message !== warning ? ` ${message}` : ''} ${warning}`);
          return;
        }
      }
    }
  } catch (error) {
    evidenceStatus = 'failed';
    if (signal.aborted) {
      evidenceStatus = 'cancelled';
      if (inFlightCall) {
        const event: ToolEvent = { name: inFlightCall.name, label: inFlightCall.label, status: inFlightCall.discovery ? 'cancelled' : 'uncertain', detail: inFlightCall.discovery ? 'Die Modul-/Werkzeugsuche wurde gestoppt.' : 'Der Assistent wurde gestoppt. Der gestartete Vorgang kann noch laufen; bitte den tatsächlichen Status prüfen. Kein automatischer weiterer Versuch.' };
        if (!inFlightCall.discovery) evidence.record(event);
        deps.onToolEvent?.(event);
      }
      throw new DOMException('Abgebrochen', 'AbortError');
    }
    if (timeout.signal.aborted) {
      if (inFlightCall) {
        const event: ToolEvent = { name: inFlightCall.name, label: inFlightCall.label, status: inFlightCall.discovery ? 'failed' : 'uncertain', detail: inFlightCall.discovery ? 'Das Zeitlimit wurde während der Modul-/Werkzeugsuche erreicht.' : 'Das Zeitlimit wurde während des Aufrufs erreicht. Der Vorgang kann noch laufen; bitte seinen Status prüfen. Kein automatischer weiterer Versuch.' };
        if (!inFlightCall.discovery) evidence.record(event);
        deps.onToolEvent?.(event);
      }
      if (!awaitingAction && deps.onReplaceText && visibleText !== turnPrefix) replace(turnPrefix);
      stopAtLimit('timeout', 'none'); return;
    }
    if (error instanceof ToolStreamError && deps.onReplaceText && visibleText !== turnPrefix) replace(turnPrefix);
    throw error;
  } finally { clearTimeout(timer); evidence.finish(evidenceStatus); }
}

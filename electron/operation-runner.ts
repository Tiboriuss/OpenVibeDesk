import { inspectToolResult } from './agent-tools';
import { canonicalArgsHash, OperationJournal } from './operation-journal';
import type { ModuleHost } from './module-host';
import type { CapabilityContext } from './workspace-capabilities';
import type { OperationAction, OperationBinding, OperationIdentity, OperationRun } from '../shared/operations';

type ToolPlan = { id: string; moduleId: string; name: string; args: Record<string, unknown>; label: string };
type Planned = { call: ToolPlan; prepared?: Awaited<ReturnType<ModuleHost['prepareOperation']>>; actionId?: string; refused?: string; reuse?: boolean; retry?: boolean; control?: boolean };
const refused = (message: string, uncertain = false) => ({ ok: false, outcome: uncertain ? 'uncertain' : 'failed', retryBlocked: true, message });
const equalResource = (a: OperationBinding['resource'], b: OperationBinding['resource']) => a?.id === b?.id && a?.version === b?.version;
const sameAction = (a: OperationAction, binding: OperationBinding, argsHash: string) => a.binding.moduleId === binding.moduleId && a.binding.action === binding.action && a.argsHash === argsHash;
const message = (error: unknown) => error instanceof Error ? error.message : 'Die Aktion konnte nicht sicher vorbereitet werden.';
const recorded = (action: OperationAction): unknown => {
  let result: unknown;
  try { result = action.result === undefined ? undefined : JSON.parse(action.result); } catch { /* Missing evidence is never a reason to execute again. */ }
  const metadata = { reused: true, actionId: action.id, recordedAt: action.finishedAt ?? action.startedAt, historical: true, ...(action.resultTruncated ? { truncated: true } : {}) };
  if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, ...metadata };
  return { ok: true, outcome: 'completed', result: result ?? null, ...metadata, message: action.result === undefined ? 'Diese Aktion wurde bereits abgeschlossen. Das vollständige Ergebnis ist nicht mehr verfügbar; sie wurde nicht erneut ausgeführt.' : 'Gespeichertes Ergebnis einer bereits abgeschlossenen Aktion; keine erneute Ausführung.' };
};

/** One explicit root task; no text-based deduplication and no automatic replay. */
export class OperationRunner {
  private readonly plans = new Map<string, Planned>();
  private readonly reserved = new Set<string>();
  constructor(private readonly journal: OperationJournal, private readonly host: ModuleHost, private readonly run: OperationRun, private readonly context: CapabilityContext, private readonly continuing = false) {}

  async plan(calls: ToolPlan[], signal: AbortSignal = this.context.signal): Promise<void> {
    let handoffPlanned = false;
    for (const call of calls) {
      if (handoffPlanned) return;
      signal.throwIfAborted();
      const plan: Planned = { call };
      this.plans.set(call.id, plan);
      let argsHash: string;
      try {
        plan.prepared = await this.host.prepareOperation(call.moduleId, call.name, call.args, { ...this.context, signal });
        argsHash = canonicalArgsHash(plan.prepared.args);
      } catch (error) { plan.refused = message(error); continue; }
      signal.throwIfAborted();
      const prepared = plan.prepared;
      // A trusted host handoff terminates the originating agent. Calls after it
      // must not become recoverable intents merely because the provider placed
      // them in the same batch; R01a deliberately never accepts those actions.
      handoffPlanned = prepared.binding.moduleId === 'ovd-assistant' && ['chats.reformulate', 'chats.continue'].includes(prepared.binding.action);
      if (prepared.binding.moduleId === 'ovd-assistant' && prepared.binding.action === 'operations.retry') {
        if (this.continuing) plan.control = true;
        else plan.refused = 'Ein gespeicherter Schritt kann nur innerhalb der ausdrücklich gewählten Fortsetzung seines ursprünglichen Auftrags erneut versucht werden.';
        continue;
      }
      if (!this.continuing) {
        // All valid offered calls in the original batch are durable before its
        // first effect. A later skipped step remains a prepared intent.
        const action = await this.journal.recordIntent(this.run.id, { binding: prepared.binding, args: prepared.args, label: prepared.label });
        plan.actionId = action.id; continue;
      }
      const matching = this.journal.listActions(this.run.rootRunId).filter(action => sameAction(action, prepared.binding, argsHash));
      const previous = matching.find(action => !this.reserved.has(action.id)) ?? matching.find(action => action.status === 'completed');
      if (previous) {
        this.reserved.add(previous.id); plan.actionId = previous.id;
        if (previous.binding.fingerprint !== prepared.binding.fingerprint || previous.binding.effect !== prepared.binding.effect) { plan.refused = 'Die Modulversion, Freigabe oder Funktionsbindung wurde geändert. Dieser frühere Schritt wird nicht erneut ausgeführt.'; continue; }
        if (previous.status === 'completed') { plan.reuse = true; continue; }
        if (previous.status === 'running' || (previous.effect !== 'none' && prepared.binding.effect !== 'read')) { plan.refused = 'Das Ergebnis dieses früheren Aufrufs ist unklar oder der Vorgang läuft noch. Bitte zuerst den Status prüfen; es wird keine Aktion wiederholt.'; continue; }
        if (!equalResource(previous.binding.resource, prepared.binding.resource)) { plan.refused = 'Die Ressource wurde seit dem ursprünglichen Schritt geändert. Bitte ihren aktuellen Stand prüfen und bei Bedarf einen neuen Auftrag stellen.'; continue; }
        if (prepared.binding.effect !== 'read' && !previous.binding.resource) { plan.refused = 'Dieser frühere Schreibaufruf hat keine überprüfbare Ressourcenbindung. Er wird nicht automatisch wiederholt; bitte seinen Status prüfen.'; continue; }
        plan.retry = true; continue;
      }
      if (prepared.binding.effect !== 'read') { plan.refused = 'Diese Änderung gehört nicht zum gespeicherten ursprünglichen Aktionsplan. Für eine neue Änderung bitte einen eigenen neuen Auftrag stellen.'; continue; }
      const action = await this.journal.recordIntent(this.run.id, { binding: prepared.binding, args: prepared.args, label: prepared.label });
      plan.actionId = action.id;
    }
  }

  /** Retry one selected original step using its backend-held arguments, never model reconstruction. */
  async retryRecorded(actionId: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (!this.continuing) return refused('Bitte zuerst den ursprünglichen Auftrag gezielt fortsetzen. Es wurde keine Aktion gestartet.');
    const action = this.journal.getAction(actionId);
    if (!action || action.rootRunId !== this.run.rootRunId) return refused('Dieser Schritt gehört nicht zum fortgesetzten ursprünglichen Auftrag. Es wurde keine Aktion gestartet.');
    if (action.status === 'completed') return recorded(action);
    if (action.status === 'running' || (action.effect !== 'none' && action.binding.effect !== 'read')) return refused('Der frühere Ausgang dieses Schritts ist unklar oder der Vorgang läuft noch. Bitte zuerst seinen Status prüfen; es wird keine Aktion wiederholt.', true);
    if (!action.args) return refused('Für diesen ursprünglichen Schritt fehlen die gespeicherten Argumente. Sie werden nicht aus dem Chat rekonstruiert.');
    if (action.binding.effect !== 'read' && !action.binding.resource) return refused('Dieser frühere Schreibaufruf besitzt keine überprüfbare Ressourcenbindung und wird nicht erneut ausgeführt.');
    try {
      const tool = await this.host.getOperationTool(action.binding);
      if (!tool) return refused('Die ursprüngliche Funktion ist nicht mehr in der freigegebenen Modulversion verfügbar. Es wurde keine Aktion gestartet.');
      const prepared = await this.host.prepareOperation(action.binding.moduleId, tool.name, action.args, { ...this.context, signal });
      if (prepared.binding.moduleId !== action.binding.moduleId || prepared.binding.action !== action.binding.action || prepared.binding.fingerprint !== action.binding.fingerprint || prepared.binding.effect !== action.binding.effect || !equalResource(prepared.binding.resource, action.binding.resource) || canonicalArgsHash(prepared.args) !== action.argsHash) return refused('Die ursprünglichen Argumente, die Freigabe oder die Ressourcenversion wurden geändert. Der gespeicherte Schritt wird nicht erneut ausgeführt.');
      const id = crypto.randomUUID();
      this.plans.set(id, { call: { id, moduleId: action.binding.moduleId, name: tool.name, args: prepared.args, label: action.label }, prepared, actionId: action.id, retry: true });
      this.reserved.add(action.id);
      return await this.invoke(action.binding.moduleId, tool.name, prepared.args, signal, id);
    } catch (error) { return refused(message(error)); }
  }

  async invoke(moduleId: string, name: string, args: unknown, signal: AbortSignal, callId?: string): Promise<unknown> {
    signal.throwIfAborted();
    let plan = callId ? this.plans.get(callId) : undefined;
    // Direct callers still pass through the same preparation and durable intent.
    if (!plan && !callId) {
      const id = crypto.randomUUID();
      await this.plan([{ id, moduleId, name, args: args as Record<string, unknown>, label: name }]); plan = this.plans.get(id);
    }
    if (!plan || plan.call.moduleId !== moduleId || plan.call.name !== name) return refused('Für diesen Aufruf liegt kein bestätigter Aktionsplan vor. Es wurde keine Aktion gestartet.');
    if (plan.refused) {
      const action = plan.actionId ? this.journal.getAction(plan.actionId) : undefined;
      return refused(plan.refused, action?.status === 'running' || (action?.effect === 'unknown' && action.binding.effect !== 'read'));
    }
    if (plan.control && plan.prepared) {
      // The selected original action owns its durable attempt. Journaling this
      // wrapper as another mutation would produce a replayable control loop.
      const { operation: _operation, beforeDispatch: _beforeDispatch, validateOperation: _validateOperation, ...context } = this.context;
      return this.host.invoke(moduleId, name, plan.prepared.args, { ...context, signal });
    }
    if (!plan.prepared || !plan.actionId) return refused('Die Aktionsbindung ist nicht verfügbar. Es wurde keine Aktion gestartet.');
    let action = this.journal.getAction(plan.actionId);
    if (!action) return refused('Die Aktion ist nicht mehr im Protokoll verfügbar. Es wurde keine Aktion gestartet.');
    if (plan.reuse || action.status === 'completed') return recorded(action);
    if (plan.retry) { action = await this.journal.retryAction(action.id, this.run.id); plan.retry = false; }
    const identity: OperationIdentity = { runId: this.run.id, actionId: action.id, attemptId: action.attemptId, argsHash: action.argsHash };
    let dispatched = false;
    const validate = async () => {
      const current = await this.host.prepareOperation(moduleId, name, action!.args ?? plan!.prepared!.args, { ...this.context, signal });
      if (current.binding.fingerprint !== action!.binding.fingerprint || current.binding.moduleId !== action!.binding.moduleId || current.binding.action !== action!.binding.action || current.binding.effect !== action!.binding.effect || canonicalArgsHash(current.args) !== action!.argsHash || current.binding.resource?.id !== action!.binding.resource?.id) throw new Error('Die Modul-, Argument- oder Ressourcenbindung wurde vor der Ausführung geändert. Es wurde keine Aktion gestartet.');
      if (!equalResource(current.binding.resource, action!.binding.resource)) {
        if (!this.continuing && action!.attempt === 1 && action!.status === 'prepared') action = await this.journal.refreshPreparedBinding(action!.id, action!.attemptId, current.binding);
        else throw new Error('Die Ressourcenversion wurde geändert. Der frühere Schritt wird nicht erneut ausgeführt.');
      }
    };
    try {
      await validate(); signal.throwIfAborted();
      const result = await this.host.invoke(moduleId, name, action.args ?? plan.prepared.args, { ...this.context, signal, operation: identity,
        validateOperation: validate,
        beforeDispatch: async () => { signal.throwIfAborted(); action = await this.journal.markDispatched(action!.id, action!.attemptId); dispatched = true; }
      });
      const outcome = inspectToolResult(result);
      // A failure reported after dispatch can still include a partial external
      // effect. Only the trusted read policy proves effect-free execution.
      const uncertain = dispatched && action.binding.effect !== 'read' && outcome.status !== 'completed';
      const status = uncertain ? 'uncertain' : outcome.status;
      const wrapped = uncertain ? { ...((result && typeof result === 'object' && !Array.isArray(result)) ? result : {}), ok: false, outcome: 'uncertain', retryBlocked: true, message: 'Dieser Aufruf ist fehlgeschlagen oder wurde gestoppt, nachdem seine Ausführung begonnen hatte. Eine Änderung ist möglich; bitte den Status prüfen. Kein automatischer weiterer Versuch.' } : result;
      const serialized = JSON.stringify(wrapped ?? null);
      await this.journal.finishAction(action.id, action.attemptId, { status, effect: !dispatched || action.binding.effect === 'read' ? 'none' : status === 'completed' ? 'applied' : 'unknown', result: serialized, ...(outcome.detail ? { detail: outcome.detail } : {}) });
      return wrapped;
    } catch (error) {
      const uncertain = dispatched && action.binding.effect !== 'read';
      const result = refused(uncertain ? 'Der gestartete Vorgang konnte nicht zuverlässig bestätigt werden. Bitte seinen Status prüfen; es wird keine Aktion wiederholt.' : message(error), uncertain);
      try { await this.journal.finishAction(action.id, action.attemptId, { status: uncertain ? 'uncertain' : signal.aborted ? 'cancelled' : 'failed', effect: uncertain ? 'unknown' : 'none', result: JSON.stringify(result), detail: message(error) }); }
      catch { return refused('Das Aktionsprotokoll konnte nicht bestätigt werden. Bitte OVD nach Beheben des Speicherfehlers neu starten und den tatsächlichen Status prüfen; es wird keine Aktion wiederholt.', true); }
      return result;
    }
  }
}

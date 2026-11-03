import type { ChatMessage } from '../shared/model';
import type { ModuleEvent } from '../shared/module-events';
import type { OperationAction, OperationRun } from '../shared/operations';

/** Source snapshots, not model instructions. No attachments, credentials or tool arguments. */
function excerpt(text: string) {
  let value = text.slice(0, 3000);
  while (JSON.stringify(value).length > 3000) value = value.slice(0, Math.max(0, value.length - 128));
  return { text: value, truncated: value.length !== text.length };
}

export function chatRequestEvent(sessionId: string, user: ChatMessage): ModuleEvent {
  return { version: 1, id: `request:${user.id}`, type: 'chat.request.committed', source: { moduleId: 'ovd-assistant' }, occurredAt: user.timestamp,
    payload: { sessionId, messageId: user.id, role: 'user', ...excerpt(user.text) } };
}

export function chatFinishedEvent(sessionId: string, user: ChatMessage, answer: ChatMessage, run?: OperationRun, actions: OperationAction[] = [], originalRequestMessageId = user.id): ModuleEvent {
  const counts = { completed: 0, failed: 0, cancelled: 0, uncertain: 0, pending: 0 };
  for (const action of actions) {
    if (action.effect === 'unknown' || action.status === 'running') counts.uncertain++;
    else if (action.status === 'prepared') counts.pending++;
    else if (action.status in counts) counts[action.status as keyof typeof counts]++;
  }
  const status = run && run.status !== 'running' ? run.status : counts.uncertain ? 'uncertain' : answer.status === 'cancelled' ? 'cancelled' : answer.status === 'limited' ? 'limited' : answer.status === 'completed' ? 'completed' : 'failed';
  const content = excerpt(answer.text);
  return { version: 1, id: `turn:${answer.id}`, type: 'chat.turn.finished', source: { moduleId: 'ovd-assistant' }, occurredAt: new Date().toISOString(),
    payload: { sessionId, requestMessageId: originalRequestMessageId, currentRequestMessageId: user.id, assistantMessageId: answer.id, ...(run ? { rootRunId: run.rootRunId, runId: run.id } : {}),
      kind: answer.continuationOf ? 'continuation' : 'initial', status, assistantText: content.text, truncated: content.truncated, actionCounts: counts, actionCountsScope: 'root_run', claimsAreUnverified: true } };
}

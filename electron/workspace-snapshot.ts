import { z } from 'zod';
import { agentSettingsPatchSchema } from '../shared/agent-settings';
import { aiAuthModeSchema, aiProtocolSchema, aiProviderSchema } from '../shared/ai-providers';
import { storedChatComposerSchema } from '../shared/chat-composer';
import { normalizeChatEvidence } from '../shared/chat-evidence';
import { workspaceDraftSchema, workspaceEmailReferenceSchema, workspaceMailFolderSchema, workspaceMailSchema } from '../modules/ovd-mail/backend/workspace-records';
import type { WorkspaceState } from '../shared/model';
import { memoryRecallSnapshotSchema } from '../shared/module-memory';
import { moduleReferenceSchema } from '../shared/references';
import { settingsPatchSchema } from '../shared/settings';

export type WorkspaceOpenReason = 'missing' | 'unreadable' | 'invalid' | 'unsupported' | 'sidecar';

export class WorkspaceOpenError extends Error {
  constructor(readonly reason: WorkspaceOpenReason) {
    super(`Workspace open failed (${reason})`);
  }
}

const id = z.string().min(1);
const text = z.string();
const count = z.number().int().nonnegative();
const timestamp = text.refine(value => Number.isFinite(Date.parse(value)));
const windowRecord = z.object({
  id, kind: z.enum(['mail', 'chat', 'draft', 'files', 'settings', 'sessions']), title: text,
  x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), z: z.number(), minimized: z.boolean()
});
const messageLink = z.object({ sessionId: id, messageId: id });
const message = z.object({
  id, role: z.enum(['user', 'assistant']), text, timestamp, status: z.enum(['streaming', 'completed', 'cancelled', 'failed', 'limited']).optional(),
  clientRequestId: z.uuid().optional(), emailRef: id.optional(), emailReference: workspaceEmailReferenceSchema.optional(),
  sessionRef: z.object({ id, title: text, excerpt: text, truncated: z.boolean().optional(), capturedAt: timestamp.optional(), sourceUpdatedAt: timestamp.optional(), messageCount: count.optional() }).optional(),
  references: z.array(moduleReferenceSchema).optional(), error: text.optional(),
  toolEvents: z.array(z.object({ name: id, status: z.enum(['completed', 'failed', 'cancelled', 'uncertain']), label: text.optional(), detail: text.optional() })).optional(),
  agentRunLimit: z.object({ status: z.literal('limit_reached'), reason: z.enum(['tool_rounds', 'tool_calls', 'timeout', 'context_budget']),
    toolRounds: count, toolCalls: count, discoveryCalls: count, actionCalls: count, elapsedMs: z.number().nonnegative(), limit: z.number().nonnegative(),
    nextToolType: z.enum(['discovery', 'action', 'mixed', 'none']), context: z.object({ requestBytes: count, estimatedInputTokens: count, inputTokenBudget: count, outputTokenReserve: count }).optional() }).optional(),
  evidence: z.unknown().refine(value => !!normalizeChatEvidence(value)).optional(), memory: memoryRecallSnapshotSchema.optional(),
  reformulationOf: messageLink.optional(), continuationOf: messageLink.extend({ rootRunId: id }).optional(), operationRunId: id.optional()
});
const uniqueIds = (items: readonly { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;
const messages = z.array(message).refine(uniqueIds);
const session = z.object({ id, title: text, placeholderTitle: z.boolean().optional(), createdAt: timestamp, updatedAt: timestamp, historyStart: count, messages });
const thinking = z.enum(['off', 'low', 'medium', 'high']);
const ai = z.object({
  baseUrl: text.optional(), model: text.optional(), thinking: thinking.optional(), smartModel: text.optional(), simpleModel: text.optional(),
  smartThinking: thinking.optional(), simpleThinking: thinking.optional(), workspaceTools: z.boolean().optional(),
  confirmationMode: z.enum(['ask', 'never']).optional(), provider: z.union([aiProviderSchema, z.literal('codex')]).optional(),
  authMode: aiAuthModeSchema.optional(), protocol: aiProtocolSchema.optional(), apiVersion: text.optional(), historyStart: count.optional()
});

// Version 1 originally supported a single chat. Absent later contributions are handled by the existing normalizers.
const snapshot = z.object({
  version: z.literal(1), windows: z.array(windowRecord).refine(uniqueIds), mails: z.array(workspaceMailSchema).refine(uniqueIds),
  drafts: z.array(workspaceDraftSchema).refine(uniqueIds), chat: messages, sessions: z.array(session).refine(uniqueIds).optional(),
  chatComposers: z.record(id, storedChatComposerSchema).optional(), activeSessionId: text.optional(), activeDraftId: id.optional(), selectedMailId: id.optional(),
  settings: settingsPatchSchema.optional(), agentSettings: agentSettingsPatchSchema.optional(), ai: ai.optional(),
  folder: workspaceMailFolderSchema, provider: text, mailLayoutRevision: count.optional()
});

export function decodeWorkspaceSnapshot(encoded: unknown): WorkspaceState {
  if (typeof encoded !== 'string') throw new WorkspaceOpenError('invalid');
  let raw: unknown;
  try { raw = JSON.parse(encoded); } catch { throw new WorkspaceOpenError('invalid'); }
  if (raw && typeof raw === 'object' && 'version' in raw && Number.isInteger(raw.version) && raw.version !== 1) throw new WorkspaceOpenError('unsupported');
  const result = snapshot.safeParse(raw);
  if (!result.success) throw new WorkspaceOpenError('invalid');
  const sessions = new Set(result.data.sessions?.map(item => item.id));
  for (const [key, composer] of Object.entries(result.data.chatComposers ?? {})) {
    if (key !== composer.sessionId || !sessions.has(key)) throw new WorkspaceOpenError('invalid');
  }
  // Parsing validates known fields. Return the original so unmodeled legacy metadata survives a checkpoint.
  return raw as WorkspaceState;
}

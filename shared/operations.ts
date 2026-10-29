/** Durable host records are separate from provider messages and bounded answer evidence. */
export type OperationEffect = 'none' | 'applied' | 'unknown';
export type OperationRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'limited' | 'uncertain';
export type OperationActionStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export interface OperationBinding {
  moduleId: string;
  /** Stable logical action, not a connection-specific offered tool name. */
  action: string;
  fingerprint: string;
  /** Assigned by a trusted host adapter; interaction flags are not proof of no effects. */
  effect: 'read' | 'write' | 'unknown';
  resource?: { id: string; version: string };
}
export interface OperationIdentity { runId: string; actionId: string; attemptId: string; argsHash: string; }
export interface OperationReconciliation { state: 'completed' | 'not_applied' | 'unknown'; result?: unknown; detail?: string; }
export interface OperationRun {
  id: string;
  rootRunId: string;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  status: OperationRunStatus;
  startedAt: string;
  finishedAt?: string;
}
/** Backend-only record. Never return args or the result through a summary/list endpoint. */
export interface OperationAction {
  id: string;
  runId: string;
  rootRunId: string;
  binding: OperationBinding;
  label: string;
  argsHash: string;
  args?: Record<string, unknown>;
  attemptId: string;
  attempt: number;
  status: OperationActionStatus;
  effect: OperationEffect;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  resultTruncated?: boolean;
  detail?: string;
}
export type OperationActionSummary = Omit<OperationAction, 'args' | 'result'> & { hasResult: boolean };
export interface OperationRunSummary { run: OperationRun; actions: OperationActionSummary[]; }

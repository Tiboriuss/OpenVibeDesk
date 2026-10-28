import type { WorkspaceState } from '../../../shared/model';
import type { DraftSaveState } from '../../../shared/drafts';

interface DraftRecord {
  fingerprint: string;
  state: DraftSaveState;
}

interface DraftPersistenceOptions {
  getState(): WorkspaceState;
  saveState(snapshot: WorkspaceState): Promise<void>;
  publish(state: DraftSaveState): void;
  debounceMs?: number;
}

/** Coordinates draft acknowledgements without persisting transient saving/error state. */
export class DraftPersistence {
  private readonly records = new Map<string, DraftRecord>();
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;

  constructor(private readonly options: DraftPersistenceOptions) {
    // These records came from the successfully loaded workspace. Its modification
    // timestamp is not necessarily the actual time the file was saved.
    for (const draft of options.getState().drafts) {
      const fingerprint = JSON.stringify(draft);
      this.records.set(draft.id, { fingerprint,
        state: { draftId: draft.id, contentUpdatedAt: draft.updatedAt, status: 'saved' } });
    }
  }

  onStateChanged(state = this.options.getState()): void {
    const existing = new Set<string>();
    let changed = false;
    for (const draft of state.drafts) {
      existing.add(draft.id);
      const fingerprint = JSON.stringify(draft);
      const record = this.records.get(draft.id);
      if (record?.fingerprint === fingerprint) continue;
      changed = true;
      const next: DraftRecord = { fingerprint,
        state: { draftId: draft.id, contentUpdatedAt: draft.updatedAt, status: 'saving',
          ...(record?.state.savedAt ? { savedAt: record.state.savedAt } : {}) } };
      this.records.set(draft.id, next);
      this.pending.add(draft.id);
      this.publish(next);
    }
    for (const id of this.records.keys()) if (!existing.has(id)) {
      this.records.delete(id);
      this.pending.delete(id);
    }
    if (changed && this.pending.size) this.schedule();
  }

  getStatus(id: string): DraftSaveState {
    this.onStateChanged();
    const record = this.records.get(id);
    if (!record) throw new Error('Der Entwurf wurde nicht gefunden.');
    return { ...record.state };
  }

  async save(id: string): Promise<DraftSaveState> {
    this.onStateChanged();
    const record = this.records.get(id);
    if (!record) throw new Error('Der Entwurf wurde nicht gefunden.');
    if (record.state.status === 'error') this.retry(record);
    this.cancelTimer();
    // Edits arriving during a write are kept pending and written in the next
    // snapshot. A completed older write never acknowledges those newer edits.
    while (this.records.get(id)?.state.status === 'saving' || this.active) {
      await this.drain();
      this.onStateChanged();
    }
    return this.getStatus(id);
  }

  async flush(): Promise<void> {
    this.onStateChanged();
    for (const record of this.records.values()) if (record.state.status === 'error') this.retry(record);
    this.cancelTimer();
    while (this.pending.size || this.active) {
      await this.drain();
      this.onStateChanged();
    }
    const failed = [...this.records.values()].find(record => record.state.status === 'error');
    if (failed) throw new Error(failed.state.error);
  }

  private retry(record: DraftRecord): void {
    record.state = { draftId: record.state.draftId, contentUpdatedAt: record.state.contentUpdatedAt,
      status: 'saving', ...(record.state.savedAt ? { savedAt: record.state.savedAt } : {}) };
    this.pending.add(record.state.draftId);
    this.publish(record);
  }

  private publish(record: DraftRecord): void {
    this.options.publish({ ...record.state });
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.active) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // The failure is published per draft and remains pending user retry.
      void this.drain().catch(() => {});
    }, this.options.debounceMs ?? 150);
  }

  private drain(): Promise<void> {
    if (this.active) return this.active;
    this.cancelTimer();
    const operation = this.writePending();
    this.active = operation.finally(() => { this.active = undefined; });
    return this.active;
  }

  private async writePending(): Promise<void> {
    while (this.pending.size) {
      // Clone at invocation, before joining the store's own write queue. No
      // renderer mutation or subsequent commit can change this acknowledgement.
      const snapshot = structuredClone(this.options.getState());
      const revisions = new Map<string, string>();
      for (const id of this.pending) {
        const draft = snapshot.drafts.find(item => item.id === id);
        if (draft) revisions.set(id, JSON.stringify(draft));
      }
      this.pending.clear();
      try {
        await this.options.saveState(snapshot);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        // Also stop newer edits that arrived during this failed attempt. They
        // remain in memory and visibly unsaved; do not loop on a broken disk.
        for (const [id, record] of this.records) if (revisions.has(id) || this.pending.has(id)) {
          record.state = { draftId: id, contentUpdatedAt: record.state.contentUpdatedAt,
            status: 'error', ...(record.state.savedAt ? { savedAt: record.state.savedAt } : {}),
            error: `Der Entwurf konnte nicht lokal gespeichert werden. ${detail}` };
          this.publish(record);
        }
        this.pending.clear();
        throw new Error(`Entwürfe konnten nicht lokal gespeichert werden. ${detail}`);
      }
      const savedAt = new Date().toISOString();
      for (const [id, fingerprint] of revisions) {
        const record = this.records.get(id);
        if (!record) continue;
        if (record.fingerprint !== fingerprint) continue;
        record.state = { draftId: id, contentUpdatedAt: record.state.contentUpdatedAt, status: 'saved', savedAt };
        this.publish(record);
      }
    }
  }
}

import type { WorkspaceSaveErrorCode, WorkspaceSaveStatus } from '../shared/workspace-save';

type SaveFailure = { error: string; errorCode?: WorkspaceSaveErrorCode; retryable: boolean };

interface CheckpointOptions {
  /** Capture the current immutable snapshot synchronously when called. */
  write(): Promise<void>;
  publish(status: WorkspaceSaveStatus): void;
  describeFailure(error: unknown): SaveFailure;
  debounceMs?: number;
  maxDelayMs?: number;
}

/** The store serializes writes. This coordinator tracks which canonical revision each write covers. */
export class WorkspaceCheckpoints {
  private revision = 0;
  private savedRevision = 0;
  private failure?: SaveFailure;
  private firstChangeAt?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private lastPublished?: WorkspaceSaveStatus;

  constructor(private readonly options: CheckpointOptions) {}

  status(): WorkspaceSaveStatus {
    const status = this.active ? 'saving' : this.failure ? 'error' : this.revision === this.savedRevision ? 'saved' : 'saving';
    return { status, revision: this.revision, savedRevision: this.savedRevision, ...this.failure };
  }

  changed(): void {
    this.revision++;
    this.firstChangeAt ??= performance.now();
    this.publish();
    this.schedule();
  }

  /** An explicit boundary may need its own atomic outbox transaction even for the same revision. */
  writeNow(write = this.options.write): Promise<void> {
    this.clearTimer();
    this.firstChangeAt = undefined;
    const revision = this.revision;
    // Invoke now: the store snapshots the state before it joins its write queue.
    let writing: Promise<void>;
    try { writing = write(); } catch (error) { writing = Promise.reject(error); }
    const operation = writing.then(() => {
      this.savedRevision = Math.max(this.savedRevision, revision);
      if (this.active === operation) this.failure = undefined;
    }, error => {
      if (this.active === operation) this.failure = this.options.describeFailure(error);
      throw error;
    }).finally(() => {
      if (this.active !== operation) return;
      this.active = undefined;
      this.publish();
      this.schedule();
    });
    this.active = operation;
    this.publish();
    return operation;
  }

  /** Wait at least for the revision at entry. Later edits have their own checkpoint. */
  async flush(): Promise<void> {
    const target = this.revision;
    if (this.failure?.retryable === false) throw new Error(this.failure.error);
    do {
      const writing = this.active ?? ((this.savedRevision < target || this.failure) ? this.writeNow() : undefined);
      if (!writing) return;
      try {
        await writing;
      } catch (error) {
        // A second, already queued transaction can still acknowledge our target.
        if (this.active && this.active !== writing) continue;
        if (!this.failure && this.savedRevision >= target) return;
        throw error;
      }
    } while (this.savedRevision < target || this.failure);
  }

  private schedule(): void {
    if (this.active || this.failure || this.revision === this.savedRevision) return;
    const elapsed = performance.now() - (this.firstChangeAt ?? performance.now());
    const delay = Math.min(this.options.debounceMs ?? 250, (this.options.maxDelayMs ?? 2000) - elapsed);
    this.clearTimer();
    this.timer = setTimeout(() => { void this.writeNow().catch(() => { /* published, awaits explicit recovery */ }); }, Math.max(0, delay));
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private publish(): void {
    const current = this.status();
    // A long answer can advance revisions with every token batch. Views only need phase changes.
    if (this.lastPublished?.status === current.status && this.lastPublished.error === current.error) return;
    this.lastPublished = current;
    this.options.publish(current);
  }
}

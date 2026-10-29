import { mailPreferences } from '../../../shared/mail-preferences';
import { imapConnectionIdentity, type InboxStatus, type MailAccountConfig } from './mail-service';

type Observation = { identity: string; due: number; interval: number; failures: number; status?: InboxStatus };
interface Dependencies {
  accounts(): MailAccountConfig[];
  check(account: MailAccountConfig, signal: AbortSignal): Promise<InboxStatus>;
  changed(account: MailAccountConfig): void;
  now?(): number;
}

/** A single background STATUS call at a time; mailbox content is never downloaded here. */
export class MailPolling {
  private enabled = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: { id: string; controller: AbortController; task: Promise<void> };
  private readonly observations = new Map<string, Observation>();
  constructor(private readonly deps: Dependencies) {}
  private now(): number { return this.deps.now?.() ?? Date.now(); }

  start(): void { if (this.enabled) return; this.enabled = true; this.refresh(); }
  stop(): void {
    this.enabled = false; this.generation++;
    clearTimeout(this.timer); this.timer = undefined;
    this.active?.controller.abort();
    this.observations.clear();
  }
  refresh(): void {
    if (!this.enabled) return;
    const accounts = this.deps.accounts(), present = new Set<string>();
    for (const account of accounts) {
      const interval = mailPreferences(account).pollIntervalSeconds;
      if (!interval) continue;
      present.add(account.id);
      const identity = imapConnectionIdentity(account), previous = this.observations.get(account.id);
      if (!previous || previous.identity !== identity) {
        if (this.active?.id === account.id) this.active.controller.abort();
        this.observations.set(account.id, { identity, due: this.now() + 1000, interval, failures: 0 });
      } else if (previous.interval !== interval) {
        previous.interval = interval; previous.due = this.now() + interval * 1000;
      }
    }
    for (const id of this.observations.keys()) if (!present.has(id)) {
      this.observations.delete(id);
      if (this.active?.id === id) this.active.controller.abort();
    }
    this.schedule();
  }
  private schedule(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.enabled || this.active || !this.observations.size) return;
    const due = Math.min(...[...this.observations.values()].map(value => value.due));
    this.timer = setTimeout(() => { this.timer = undefined; void this.runDue(); }, Math.max(0, due - this.now()));
    this.timer.unref?.();
  }
  /** Exposed for the host's controlled refresh and isolated scheduler checks. */
  async runDue(): Promise<void> {
    if (!this.enabled || this.active) return;
    const next = [...this.observations].filter(([, value]) => value.due <= this.now()).sort((a, b) => a[1].due - b[1].due)[0];
    if (!next) { this.schedule(); return; }
    const [id, observation] = next;
    const account = this.deps.accounts().find(value => value.id === id);
    if (!account || imapConnectionIdentity(account) !== observation.identity || !mailPreferences(account).pollIntervalSeconds) { this.refresh(); return; }
    const controller = new AbortController(), generation = this.generation;
    const task = (async () => {
      try {
        const status = await this.deps.check(account, controller.signal);
        controller.signal.throwIfAborted();
        const current = this.deps.accounts().find(value => value.id === id);
        if (!this.enabled || this.generation !== generation || this.observations.get(id) !== observation || !current || imapConnectionIdentity(current) !== observation.identity || !mailPreferences(current).pollIntervalSeconds) return;
        const previous = observation.status;
        observation.status = status; observation.failures = 0;
        // A first observation or changed UIDVALIDITY establishes a fresh baseline.
        if (previous?.uidValidity === status.uidValidity && status.uidNext > previous.uidNext) this.deps.changed(current);
      } catch { if (!controller.signal.aborted) observation.failures = Math.min(5, observation.failures + 1); }
      finally {
        observation.due = this.now() + Math.max(observation.interval, Math.min(900, observation.interval * 2 ** observation.failures)) * 1000;
      }
    })();
    this.active = { id, controller, task };
    try { await task; }
    finally { if (this.active?.task === task) this.active = undefined; this.schedule(); }
  }
}

import type { ModuleEventDelivery } from '../shared/module-events';
import { acknowledgeModuleEvent, failModuleEvent, pendingModuleEvents, moduleEventQueueStatus } from './store';

/** Infrastructure only: deliveries may repeat; business actions are never replayed here. */
export class ModuleEventDispatcher {
  private readonly active = new Map<string, { delivery: ModuleEventDelivery; controller: AbortController }>();
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private checking = false;
  constructor(private readonly options: {
    currentGrant(delivery: ModuleEventDelivery): boolean;
    allowed(delivery: ModuleEventDelivery): boolean;
    canDeliver(delivery: ModuleEventDelivery): boolean;
    deliver(delivery: ModuleEventDelivery, signal: AbortSignal): Promise<void>;
    changed(moduleId: string, error?: string): void;
  }) {}

  wake(): void {
    if (this.disposed) return;
    for (const item of this.active.values()) if (!this.options.allowed(item.delivery)) item.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, 0);
    this.timer.unref();
  }
  private async tick(): Promise<void> {
    if (this.disposed || this.checking) return;
    this.checking = true;
    let pending = false;
    try {
      pending = moduleEventQueueStatus().pending > 0;
      for (const delivery of pendingModuleEvents(500)) {
        if (this.active.size >= 2) break;
        const id = delivery.recipient.moduleId;
        // A publication captured before revocation can finish its durable write
        // after grant cleanup. Retire that exact stale delivery, never block a
        // later event for this recipient and never reactivate its old grant.
        if (!this.options.currentGrant(delivery)) { await acknowledgeModuleEvent(delivery); this.notify(id); continue; }
        if (this.active.has(id) || !this.options.allowed(delivery) || !this.options.canDeliver(delivery)) continue;
        const controller = new AbortController();
        this.active.set(id, { delivery, controller });
        void this.deliver(delivery, controller);
      }
    } catch {
      // A broken queue must not cause untracked module delivery.
      this.notify('', 'Die Ereigniswarteschlange ist nicht verfügbar.');
    } finally {
      this.checking = false;
      if (!this.disposed && !this.timer && pending) {
        this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, 1000);
        this.timer.unref();
      }
    }
  }
  private async deliver(delivery: ModuleEventDelivery, controller: AbortController): Promise<void> {
    const id = delivery.recipient.moduleId;
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      controller.signal.throwIfAborted();
      if (!this.options.allowed(delivery)) return;
      await this.options.deliver(delivery, controller.signal);
      controller.signal.throwIfAborted();
      await acknowledgeModuleEvent(delivery);
      this.notify(id);
    } catch {
      if (!this.disposed) {
        try { await failModuleEvent(delivery, 'Die Ereignisverarbeitung wurde nicht bestätigt. Ein erneuter Zustellversuch folgt mit derselben Ereignis-ID.'); }
        catch { /* Retain the original unacknowledged delivery on storage failure. */ }
        this.notify(id, 'Die Ereignisverarbeitung wurde nicht bestätigt.');
      }
    } finally {
      clearTimeout(timer); this.active.delete(id);
      if (!this.disposed) this.wake();
    }
  }
  private notify(moduleId: string, error?: string): void {
    try { this.options.changed(moduleId, error); } catch { /* Notification failure must not undo durable delivery or crash the host. */ }
  }
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const item of this.active.values()) item.controller.abort();
  }
}

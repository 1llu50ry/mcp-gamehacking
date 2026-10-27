/**
 * BuildQueue — per-asset-key serial execution queue.
 *
 * Each asset id gets its own SerialQueue → same asset never rebuilds
 * concurrently (git/SQLite/files don't conflict).
 * enqueue is fire-and-forget; onIdle() for tests / graceful shutdown.
 */

import { SerialQueue } from "./serial-queue.js";

export class BuildQueue {
  private readonly queues = new Map<string, SerialQueue>();

  /** Enqueue job to this key's serial queue; fire-and-forget. */
  enqueue(key: string, job: () => Promise<void>): void {
    let q = this.queues.get(key);
    if (!q) {
      q = new SerialQueue(key);
      this.queues.set(key, q);
    }
    void q.add(job).catch(() => {
      /* job already set failed status; swallow unhandled rejection */
    });
  }

  /** Wait for a key (or all) queue to be idle. Mainly for tests / shutdown. */
  async onIdle(key?: string): Promise<void> {
    if (key) {
      await this.queues.get(key)?.onIdle();
      return;
    }
    await Promise.all([...this.queues.values()].map((q) => q.onIdle()));
  }
}

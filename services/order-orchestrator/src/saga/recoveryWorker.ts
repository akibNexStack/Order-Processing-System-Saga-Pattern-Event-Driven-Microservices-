import type { BrokerOrderService } from './brokerOrders.js';
import type { LogSink } from '@saga/shared/messaging';
export class RecoveryWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private task?: Promise<void>;
  private stopped = true;
  private lastSuccess = 0;
  constructor(private readonly service: BrokerOrderService, private readonly intervalMs = 1000,
    private readonly log: LogSink = () => {}, private readonly batchSize = 10) {}
  isReady() { return !this.stopped && Date.now() - this.lastSuccess < Math.max(10000, this.intervalMs * 3); }
  async scan() {
    const claims = await this.service.claimRecovery(this.batchSize);
    for (const claim of claims) {
      try {
        await this.service.recoverClaim(claim.orderId, claim.token);
        this.log({ event: 'recovery_checked', orderId: claim.orderId, sagaId: claim.sagaId, messageId: claim.messageId, leaseToken: claim.token });
      } catch {
        // Keep the committed lease: another scan can retry after it expires.
        this.log({ event: 'recovery_failed', orderId: claim.orderId, sagaId: claim.sagaId, messageId: claim.messageId, leaseToken: claim.token });
        throw new Error('Recovery processing failed');
      }
    }
    this.lastSuccess = Date.now();
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      this.task = this.scan().catch(() => this.log({ event: 'recovery_scan_failed' })).finally(() => {
        if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
      });
    };
    tick();
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.task; }
}

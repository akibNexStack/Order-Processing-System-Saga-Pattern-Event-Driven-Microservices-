import type { BrokerOrderService } from './brokerOrders.js';
import type { LogSink } from '@saga/shared/messaging';

// The RecoveryWorker class is responsible for periodically scanning and recovering broker orders that may have failed or are in an inconsistent state. It interacts with the BrokerOrderService to claim recovery tasks, process them, and log the results. The worker can be started and stopped, and it maintains a timer to control the scanning interval. It also tracks the last successful recovery to determine if it is ready for further processing.
export class RecoveryWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private task?: Promise<void>;
  private stopped = true;
  private lastSuccess = 0;
  constructor(
    private readonly service: BrokerOrderService,
    private readonly intervalMs = 1000,
    private readonly log: LogSink = () => {},
    private readonly batchSize = 10,
  ) {}

  // The isReady method checks if the RecoveryWorker is ready to perform a recovery scan. It returns true if the worker is not stopped and the time since the last successful recovery is less than the maximum of 10 seconds or three times the configured interval. This ensures that the worker does not attempt to recover too frequently, allowing for proper handling of recovery tasks.
  isReady() {
    return !this.stopped && Date.now() - this.lastSuccess < Math.max(10000, this.intervalMs * 3);
  }

  // The scan method performs a recovery scan by claiming recovery tasks from the BrokerOrderService. It processes each claimed task by attempting to recover the associated order. If the recovery is successful, it logs the event; if it fails, it logs the failure and throws an error to indicate that recovery processing failed. The method updates the last successful recovery timestamp upon completion.
  async scan() {
    const claims = await this.service.claimRecovery(this.batchSize);
    for (const claim of claims) {
      try {
        await this.service.recoverClaim(claim.orderId, claim.token);
        this.log({
          event: 'recovery_checked',
          orderId: claim.orderId,
          sagaId: claim.sagaId,
          messageId: claim.messageId,
          leaseToken: claim.token,
        });
      } catch {
        // Keep the committed lease: another scan can retry after it expires.
        this.log({
          event: 'recovery_failed',
          orderId: claim.orderId,
          sagaId: claim.sagaId,
          messageId: claim.messageId,
          leaseToken: claim.token,
        });
        throw new Error('Recovery processing failed');
      }
    }
    this.lastSuccess = Date.now();
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      this.task = this.scan()
        .catch(() => this.log({ event: 'recovery_scan_failed' }))
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
        });
    };
    tick();
  }

  // The stop method stops the RecoveryWorker by setting the stopped flag to true, clearing the timer, and awaiting the completion of any ongoing recovery task. This ensures that the worker ceases its recovery operations gracefully and does not leave any tasks in an inconsistent state.
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.task;
  }
}

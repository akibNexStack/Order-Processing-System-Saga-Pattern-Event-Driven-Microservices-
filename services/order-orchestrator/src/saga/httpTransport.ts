import { ResultSchema, type Command, type Result } from '@saga/shared';

export interface CommandTransport {
  execute(command: Command): Promise<Result>;
}
export type ServiceUrls = { payment: string; inventory: string; shipping: string };

// The HttpTransport class implements the CommandTransport interface to facilitate communication with external services via HTTP. It sends commands to the appropriate service endpoints based on the operation type and handles the response, ensuring that the result matches the expected format and status. If the service is unavailable or the response is invalid, it returns an 'UNKNOWN' outcome with a retryable error.
export class HttpTransport implements CommandTransport {
  constructor(
    private readonly urls: ServiceUrls,
    private readonly timeoutMs = 10000,
  ) {}

  // The execute method sends a command to the appropriate service endpoint based on the operation type. It constructs the request, handles the response, and validates the result against the expected format and status. If the service is unavailable or the response is invalid, it returns an 'UNKNOWN' outcome with a retryable error message.
  async execute(command: Command): Promise<Result> {
    const { payload: _, ...metadata } = command;
    const unknown = (message: string): Result =>
      ResultSchema.parse({
        ...metadata,
        outcome: 'UNKNOWN',
        error: { code: 'PROVIDER_UNAVAILABLE', message, retryable: true },
      });
    const routes = {
      CHARGE_PAYMENT: [this.urls.payment, '/payments/charge'],
      REFUND_PAYMENT: [this.urls.payment, '/payments/refund'],
      RESERVE_INVENTORY: [this.urls.inventory, '/inventory/reserve'],
      RELEASE_INVENTORY: [this.urls.inventory, '/inventory/release'],
      FINALIZE_INVENTORY: [this.urls.inventory, '/inventory/finalize'],
      CREATE_SHIPMENT: [this.urls.shipping, '/shipments/create'],
      CANCEL_SHIPMENT: [this.urls.shipping, '/shipments/cancel'],
    } as const;
    const [base, path] = routes[command.operation];
    try {
      const response = await fetch(new URL(path, base), {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const result = ResultSchema.parse(await response.json());
      const validStatus =
        result.outcome === 'SUCCEEDED'
          ? response.status === 200
          : result.outcome === 'UNKNOWN'
            ? response.status === 202
            : [409, 422].includes(response.status);
      if (
        !validStatus ||
        result.operation !== command.operation ||
        result.orderId !== command.orderId ||
        result.sagaId !== command.sagaId ||
        result.idempotencyKey !== command.idempotencyKey
      ) {
        return unknown('Service response did not match the pending operation');
      }
      return result;
    } catch {
      return unknown('Service response unavailable; retry the same command');
    }
  }
}

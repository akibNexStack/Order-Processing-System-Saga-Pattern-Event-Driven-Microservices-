import { ResultSchema, type CommandFor, type FailureCode, type Result } from '@saga/shared';

export type ShippingCommand = CommandFor<'CREATE_SHIPMENT' | 'CANCEL_SHIPMENT'>;
export function resultFor(command: ShippingCommand, result: Result): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({ ...result, ...metadata });
}
export function failure(command: ShippingCommand, code: FailureCode, message: string): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({ ...metadata, outcome: 'FAILED', error: { code, message, retryable: false } });
}
export function unknown(command: ShippingCommand, message = 'Outcome is uncertain; retry this command with the same key'): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({ ...metadata, outcome: 'UNKNOWN', error: { code: 'PROVIDER_UNAVAILABLE', message, retryable: true } });
}
export function success(command: ShippingCommand, data: object): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({ ...metadata, outcome: 'SUCCEEDED', data });
}

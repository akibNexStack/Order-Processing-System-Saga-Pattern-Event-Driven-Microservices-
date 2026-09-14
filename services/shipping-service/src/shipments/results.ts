import { ResultSchema, type CommandFor, type FailureCode, type Result } from '@saga/shared';

export type ShippingCommand = CommandFor<'CREATE_SHIPMENT' | 'CANCEL_SHIPMENT'>;

// Helper functions to create Result objects for different outcomes of shipping commands, including success, failure, and unknown states. These functions ensure that the Result objects conform to the expected schema and include relevant metadata from the original command.
export function resultFor(command: ShippingCommand, result: Result): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({ ...result, ...metadata });
}

// Functions to create specific Result objects for different outcomes of shipping commands, including failure, unknown, and success states. Each function takes a ShippingCommand and relevant data or messages to construct a Result object that conforms to the expected schema.
export function failure(command: ShippingCommand, code: FailureCode, message: string): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({
    ...metadata,
    outcome: 'FAILED',
    error: { code, message, retryable: false },
  });
}

// Functions to create specific Result objects for different outcomes of shipping commands, including failure, unknown, and success states. Each function takes a ShippingCommand and relevant data or messages to construct a Result object that conforms to the expected schema.
export function unknown(
  command: ShippingCommand,
  message = 'Outcome is uncertain; retry this command with the same key',
): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({
    ...metadata,
    outcome: 'UNKNOWN',
    error: { code: 'PROVIDER_UNAVAILABLE', message, retryable: true },
  });
}

// Functions to create specific Result objects for different outcomes of shipping commands, including failure, unknown, and success states. Each function takes a ShippingCommand and relevant data or messages to construct a Result object that conforms to the expected schema.
export function success(command: ShippingCommand, data: object): Result {
  const { payload: _, ...metadata } = command;
  return ResultSchema.parse({ ...metadata, outcome: 'SUCCEEDED', data });
}

import { createHash } from 'node:crypto';
import { IdSchema, OperationSchema, type Command, type Operation } from './contracts.js';

export function commandKey(sagaId: string, operation: Operation): string {
  return `saga:${IdSchema.parse(sagaId).toLowerCase()}:${OperationSchema.parse(operation)}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Call after schema validation. Object key order is irrelevant; array order is significant.
export function commandFingerprint(command: Command): string {
  const { idempotencyKey: _, ...content } = command;
  return createHash('sha256').update(canonical(content)).digest('hex');
}

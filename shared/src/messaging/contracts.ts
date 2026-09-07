import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { CommandSchema, ResultSchema, type Command, type Result } from '../contracts.js';
const meta = { version: z.literal(1), messageId: z.uuid(), createdAt: z.iso.datetime() };
export const EnvelopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...meta, kind: z.literal('COMMAND'), body: CommandSchema }),
  z.strictObject({ ...meta, kind: z.literal('RESULT'), causationId: z.uuid(), body: ResultSchema }),
]);
export type Envelope = z.infer<typeof EnvelopeSchema>;
export type CommandEnvelope = Extract<Envelope, { kind: 'COMMAND' }>;
export type ResultEnvelope = Extract<Envelope, { kind: 'RESULT' }>;
export type Participant = 'payment' | 'inventory' | 'shipping';
export type Consumer = Participant | 'orders';
export function owner(operation: Command['operation']): Participant {
  if (operation === 'CHARGE_PAYMENT' || operation === 'REFUND_PAYMENT') return 'payment';
  if (operation === 'CREATE_SHIPMENT' || operation === 'CANCEL_SHIPMENT') return 'shipping';
  return 'inventory';
}
export const commandEnvelope = (body: Command): CommandEnvelope => ({ version: 1, messageId: randomUUID(), createdAt: new Date().toISOString(), kind: 'COMMAND', body });
export const resultEnvelope = (command: CommandEnvelope, body: Result): ResultEnvelope => ({ version: 1, messageId: randomUUID(), createdAt: new Date().toISOString(), kind: 'RESULT', causationId: command.messageId, body });
export function fingerprint(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export class InvalidMessage extends Error {}

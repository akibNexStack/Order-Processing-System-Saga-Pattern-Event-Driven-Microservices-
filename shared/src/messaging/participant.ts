import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { ResultSchema, type Command, type Result } from '../contracts.js';
import { fingerprint, InvalidMessage, owner, resultEnvelope, type Envelope, type Participant } from './contracts.js';
import { messageInbox } from './schema.js';
import { enqueue, remember } from './store.js';
export type ResultCommit = (db: NodePgDatabase, result: Result) => Promise<void>;
export function participantHandler(pool: pg.Pool, participant: Participant,
  execute: (command: Command, commit: ResultCommit) => Promise<Result>) {
  return async (envelope: Envelope) => {
    if (envelope.kind !== 'COMMAND' || owner(envelope.body.operation) !== participant) throw new InvalidMessage('Wrong command destination');
    // Participant operations already serialize by order and deduplicate business keys.
    const [saved] = await drizzle(pool).select().from(messageInbox).where(eq(messageInbox.id, envelope.messageId));
    if (saved) {
      if (saved.fingerprint !== fingerprint(envelope)) throw new InvalidMessage('Changed duplicate command');
      return;
    }
    const commit: ResultCommit = async (db, raw) => {
      const result = ResultSchema.parse(raw);
      const command = envelope.body;
      if (result.operation !== command.operation || result.orderId !== command.orderId || result.sagaId !== command.sagaId || result.idempotencyKey !== command.idempotencyKey) throw new InvalidMessage('Mismatched participant result');
      if (await remember(db, envelope)) await enqueue(db, 'orders', resultEnvelope(envelope, result));
    };
    const result = await execute(envelope.body, commit);
    // Early replay/UNKNOWN paths have no new completed business transaction. Persist
    // their result before acknowledging too; the commit hook is idempotent.
    await drizzle(pool).transaction(tx => commit(tx, result));
  };
}

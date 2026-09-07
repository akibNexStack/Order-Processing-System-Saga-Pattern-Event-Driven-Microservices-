import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { messageInbox, messageOutbox } from './schema.js';
import { fingerprint, InvalidMessage, type Envelope } from './contracts.js';
export async function enqueue(db: NodePgDatabase, route: string, envelope: Envelope, availableAt = new Date()) {
  await db.insert(messageOutbox).values({ id: envelope.messageId, route, envelope, availableAt }).onConflictDoNothing();
}
export async function remember(db: NodePgDatabase, envelope: Envelope): Promise<boolean> {
  const hash = fingerprint(envelope);
  const inserted = await db.insert(messageInbox).values({ id: envelope.messageId, fingerprint: hash }).onConflictDoNothing().returning();
  if (inserted.length) return true;
  const [saved] = await db.select().from(messageInbox).where(eq(messageInbox.id, envelope.messageId));
  if (saved.fingerprint !== hash) throw new InvalidMessage('Message ID reused with changed content');
  return false;
}

import amqp, { type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage, type Message } from 'amqplib';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, lte, asc } from 'drizzle-orm';
import type pg from 'pg';
import { EnvelopeSchema, InvalidMessage, type Consumer, type Envelope } from './contracts.js';
import { messageOutbox } from './schema.js';

export const consumers: Consumer[] = ['payment', 'inventory', 'shipping', 'orders'];
export async function topology(channel: Channel, prefix: string) {
  await channel.assertExchange(prefix, 'direct', { durable: true });
  await channel.assertExchange(`${prefix}.dead`, 'direct', { durable: true });
  for (const name of consumers) {
    await channel.assertQueue(`${prefix}.${name}.dead`, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await channel.bindQueue(`${prefix}.${name}.dead`, `${prefix}.dead`, name);
    const dead = { 'x-queue-type': 'quorum', 'x-dead-letter-exchange': `${prefix}.dead`,
      'x-dead-letter-routing-key': name, 'x-dead-letter-strategy': 'at-least-once', 'x-overflow': 'reject-publish', 'x-delivery-limit': 5 };
    await channel.assertQueue(`${prefix}.${name}`, { durable: true, arguments: dead });
    await channel.bindQueue(`${prefix}.${name}`, prefix, name);
    await channel.assertQueue(`${prefix}.${name}.retry`, { durable: true, arguments: {
      ...dead, 'x-message-ttl': 1000, 'x-dead-letter-exchange': prefix, 'x-dead-letter-routing-key': name,
    } });
    await channel.bindQueue(`${prefix}.${name}.retry`, prefix, `retry.${name}`);
  }
}

// A broker confirm alone also succeeds for an unroutable publish. Mandatory returns
// must therefore reject the publish before the outbox can be marked delivered.
export function confirmed(channel: ConfirmChannel, exchange: string, route: string, body: Buffer,
  options: amqp.Options.Publish = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    let returned = false;
    const onReturn = (message: Message) => { if (message.properties.messageId === options.messageId) returned = true; };
    const cleanup = () => { clearTimeout(timer); channel.off('return', onReturn); channel.off('close', onClose); };
    const onClose = () => { cleanup(); reject(new Error('Publisher channel closed')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Publisher confirmation timeout')); void channel.close().catch(() => {}); }, 5000);
    channel.on('return', onReturn); channel.on('close', onClose);
    try {
      channel.publish(exchange, route, body, { ...options, persistent: true, mandatory: true }, error => {
        cleanup();
        if (error || returned) reject(error ?? new Error('Unroutable message')); else resolve();
      });
    } catch (error) { cleanup(); reject(error); }
  });
}

export async function relayOnce(pool: pg.Pool, channel: ConfirmChannel, prefix: string): Promise<boolean> {
  return drizzle(pool).transaction(async tx => {
    const [row] = await tx.select().from(messageOutbox).where(and(isNull(messageOutbox.publishedAt), lte(messageOutbox.availableAt, new Date())))
      .orderBy(asc(messageOutbox.availableAt)).limit(1).for('update', { skipLocked: true });
    if (!row) return false;
    const dead = row.route.startsWith('dead.');
    await confirmed(channel, dead ? `${prefix}.dead` : prefix, dead ? row.route.slice(5) : row.route,
      Buffer.from(JSON.stringify(row.envelope)), { messageId: row.id, contentType: 'application/json' });
    await tx.update(messageOutbox).set({ publishedAt: new Date() }).where(eq(messageOutbox.id, row.id));
    return true;
  });
}

export interface RabbitOptions { url: string; prefix?: string; intervalMs?: number; onError?: (error: unknown) => void }
export class RabbitWorker {
  private connection?: ChannelModel;
  private publisher?: ConfirmChannel;
  private timer?: ReturnType<typeof setTimeout>;
  private task?: Promise<void>;
  private handling?: Promise<void>;
  private stopped = true;
  private consumerChannel?: Channel;
  private tag?: string;
  readonly prefix: string;
  constructor(private readonly pool: pg.Pool, private readonly consumer: Consumer,
    private readonly handler: (message: Envelope) => Promise<void>, private readonly options: RabbitOptions) {
    this.prefix = options.prefix ?? 'saga.v1';
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(this.prefix)) throw new Error('Invalid RabbitMQ prefix');
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      this.task = this.tick().catch(error => this.options.onError?.(error)).finally(() => {
        if (!this.stopped) this.timer = setTimeout(tick, this.options.intervalMs ?? 250);
      });
    };
    tick();
  }
  private async connect() {
    const connection = await amqp.connect(this.options.url, { timeout: 5000 });
    connection.on('error', error => this.options.onError?.(error));
    connection.on('close', () => { if (this.connection === connection) { this.connection = undefined; this.publisher = undefined; } });
    try {
      const publisher = await connection.createConfirmChannel();
      const channel = await connection.createChannel();
      const failures = await connection.createConfirmChannel();
      for (const c of [publisher, channel, failures]) {
        c.on('error', error => this.options.onError?.(error));
        c.on('close', () => { if (!this.stopped) void connection.close().catch(() => {}); });
      }
      await topology(channel, this.prefix);
      await channel.prefetch(1);
      this.connection = connection; this.publisher = publisher; this.consumerChannel = channel;
      const subscription = await channel.consume(`${this.prefix}.${this.consumer}`, message => {
        if (!message) { void connection.close().catch(() => {}); return; }
        this.handling = this.handle(channel, failures, message).catch(error => {
          this.options.onError?.(error); void connection.close().catch(() => {});
        });
      }, { noAck: false });
      this.tag = subscription.consumerTag;
    } catch (error) { await connection.close().catch(() => {}); throw error; }
  }
  private async handle(channel: Channel, failures: ConfirmChannel, message: ConsumeMessage) {
    let invalid = false;
    try {
      if (message.content.length > 65536 || message.properties.contentType !== 'application/json') throw new InvalidMessage('Invalid message size or content type');
      let envelope: Envelope;
      try { envelope = EnvelopeSchema.parse(JSON.parse(message.content.toString())); }
      catch { throw new InvalidMessage('Invalid message envelope'); }
      if (message.properties.messageId !== envelope.messageId) throw new InvalidMessage('AMQP message ID mismatch');
      await this.handler(envelope);
      channel.ack(message);
      return;
    } catch (error) {
      invalid = error instanceof InvalidMessage;
      this.options.onError?.(error);
    }
    const raw = message.properties.headers?.['saga-retries'];
    const retries = Number.isInteger(raw) && raw >= 0 ? Number(raw) : 0;
    const dead = invalid || retries >= 2;
    await confirmed(failures, dead ? `${this.prefix}.dead` : this.prefix,
      dead ? this.consumer : `retry.${this.consumer}`, message.content,
      { messageId: message.properties.messageId, contentType: message.properties.contentType,
        headers: { ...message.properties.headers, 'saga-retries': retries + 1 } });
    channel.ack(message);
  }
  private async tick() {
    if (this.stopped) return;
    try {
      if (!this.connection) await this.connect();
      for (let n = 0; n < 50 && !this.stopped; n++) {
        if (!this.publisher || !await relayOnce(this.pool, this.publisher, this.prefix)) break;
      }
    } catch (error) {
      await this.connection?.close().catch(() => {});
      this.connection = undefined; this.publisher = undefined;
      throw error;
    }
  }
  async stop() {
    this.stopped = true; clearTimeout(this.timer);
    await this.task;
    if (this.tag) await this.consumerChannel?.cancel(this.tag).catch(() => {});
    await this.handling;
    await this.connection?.close().catch(() => {});
    this.connection = undefined; this.publisher = undefined;
  }
}

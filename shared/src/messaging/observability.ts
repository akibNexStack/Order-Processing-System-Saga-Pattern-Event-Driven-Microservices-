import type pg from 'pg';
export type LogEvent = { event: string; orderId?: string; sagaId?: string; messageId?: string; operation?: string;
  outcome?: string; reason?: string; leaseToken?: string; route?: string };
export type LogSink = (entry: LogEvent) => void;
export function structuredLogger(service: string, write: (line: string) => void = console.log): LogSink {
  return entry => {
    // Explicit allowlist excludes payloads, addresses, credentials and raw SQL/errors.
    const { event, orderId, sagaId, messageId, operation, outcome, reason, leaseToken, route } = entry;
    write(JSON.stringify({ timestamp: new Date().toISOString(), service, event, orderId, sagaId, messageId, operation, outcome, reason, leaseToken, route }));
  };
}
export type Readiness = () => Promise<{ database: boolean; broker: boolean; recovery?: boolean }>;
export function readiness(pool: pg.Pool, broker: { isReady(): boolean }, recovery?: { isReady(): boolean }): Readiness {
  return async () => {
    let database = false;
    const probe: pg.QueryConfig & { query_timeout: number } = { text: 'SELECT 1', query_timeout: 2000 };
    try { await pool.query(probe); database = true; } catch {}
    return { database, broker: broker.isReady(), ...(recovery ? { recovery: recovery.isReady() } : {}) };
  };
}

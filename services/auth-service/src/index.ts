import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import pg from 'pg';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { bodyLimit } from 'hono/body-limit';
import { cleanupSql, clientIp, mutationError } from './security.js';
import { instrumentHttp, ServiceMetrics } from '@saga/shared';
import { structuredLogger } from '@saga/shared/messaging';

const scrypt = promisify(scryptCallback);
const log = structuredLogger('auth-service');
const metrics = new ServiceMetrics('auth-service');
const pool = new pg.Pool({ connectionString: z.string().min(1).parse(process.env.DATABASE_URL) });
const admins = new Set((process.env.ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean));
const publicUrl = new URL(process.env.AUTH_PUBLIC_URL ?? 'http://localhost:3004').origin;
const emailMode = z.enum(['log', 'smtp']).parse(process.env.AUTH_EMAIL_MODE ?? 'log');
const emailFrom = process.env.AUTH_EMAIL_FROM;
const smtpHost = process.env.SMTP_HOST;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpPort = z.coerce.number().int().min(1).max(65535).parse(process.env.SMTP_PORT ?? 465);
const smtpSecure = (process.env.SMTP_SECURE ?? 'true') === 'true';
// Keep the conservative production default, but permit a separate local
// development limit. Local Next.js requests may not include a client IP and
// would otherwise all share the same "unknown" rate-limit bucket.
const registerRateLimit = z.coerce.number().int().min(1).max(1000).parse(process.env.AUTH_REGISTER_RATE_LIMIT_MAX ?? 5);
if (process.env.NODE_ENV === 'production' && emailMode === 'log')
  throw new Error('AUTH_EMAIL_MODE=smtp is required in production');
if (emailMode === 'smtp' && (!emailFrom || !smtpHost || !smtpUser || !smtpPass))
  throw new Error('AUTH_EMAIL_FROM, SMTP_HOST, SMTP_USER, and SMTP_PASS are required for SMTP delivery');
const transporter = emailMode === 'smtp'
  ? nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpSecure, auth: { user: smtpUser, pass: smtpPass } })
  : null;
const credentials = z.object({ email: z.email().transform(v => v.trim().toLowerCase()), password: z.string().min(12).max(200) });
const tokenInput = z.object({ token: z.string().min(32).max(200) });
const resetInput = tokenInput.extend({ password: z.string().min(12).max(200) });
const emailInput = z.object({ email: z.email().transform(v => v.trim().toLowerCase()) });
const googleIdentity = z.object({ subject: z.string().min(1).max(255), email: z.email().transform(v => v.trim().toLowerCase()) });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const proxyToken = process.env.AUTH_PROXY_TOKEN;
const ipHash = (request: Request) => hash(clientIp(request, proxyToken));
const details = (request: Request) => ({ userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? 'unknown' });

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from((await scrypt(password, salt, 64)) as Uint8Array).toString('hex')}`;
}
async function matches(password: string, saved: string) {
  const [salt, expected] = saved.split(':');
  if (!salt || !expected) return false;
  const actual = Buffer.from((await scrypt(password, salt, 64)) as Uint8Array).toString('hex');
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
async function audit(db: pg.Pool | pg.PoolClient, event: string, request: Request, userId?: string, extra: Record<string, string | number | boolean> = {}) {
  await db.query('INSERT INTO auth_audit_logs(user_id,event,ip_hash,details) VALUES($1,$2,$3,$4)', [userId ?? null, event, ipHash(request), JSON.stringify({ ...details(request), ...extra })]);
}
async function limited(action: string, request: Request, maximum: number) {
  const { rows: [row] } = await pool.query("INSERT INTO auth_rate_limits(action,subject_hash,window_started_at,attempts) VALUES($1,$2,date_trunc('hour',now()),1) ON CONFLICT(action,subject_hash,window_started_at) DO UPDATE SET attempts=auth_rate_limits.attempts+1 RETURNING attempts", [action, ipHash(request)]);
  return Number(row.attempts) > maximum;
}
async function createSession(db: pg.Pool | pg.PoolClient, user: { id: string; email: string; role: string }) {
  const token = randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hash(token), user.id]);
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}
async function issueToken(table: 'email_verification_tokens' | 'password_reset_tokens', user: { id: string; email: string }, request: Request) {
  const token = randomBytes(32).toString('base64url');
  const hours = table === 'email_verification_tokens' ? 24 : 1;
  await pool.query(`DELETE FROM ${table} WHERE user_id=$1 AND consumed_at IS NULL`, [user.id]);
  await pool.query(`INSERT INTO ${table}(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 || ' hours')::interval)`, [hash(token), user.id, hours]);
  const path = table === 'email_verification_tokens' ? '/verify-email' : '/reset-password';
  const url = `${publicUrl}${path}?token=${token}`;
  if (emailMode === 'log') {
    // Local development only. Production startup rejects this mode.
    console.info(JSON.stringify({ event: `${table}_queued`, recipient: user.email, url }));
  } else {
    const subject = table === 'email_verification_tokens' ? 'Verify your Saga Order Workspace email' : 'Reset your Saga Order Workspace password';
    const action = table === 'email_verification_tokens' ? 'Verify email' : 'Reset password';
    await transporter!.sendMail({ from: emailFrom, to: user.email, subject,
      html: `<p>Use the secure link below to continue.</p><p><a href="${url}">${action}</a></p><p>This link expires soon and can be used once.</p>` });
  }
  await audit(pool, table === 'email_verification_tokens' ? 'EMAIL_VERIFICATION_SENT' : 'PASSWORD_RESET_SENT', request, user.id);
}

const app = new Hono();
app.use('/auth/*', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: 'Request body exceeds 32 KiB' }, 413) }));
app.use('/auth/*', async (c, next) => {
  const error = mutationError(c.req.raw, publicUrl, process.env.NODE_ENV === 'production');
  if (error) return c.json({ error: error.error }, error.status as 403 | 415);
  return next();
});
app.get('/health', c => c.json({ service: 'auth-service', status: 'ok' }));
app.get('/ready', async c => { try { await pool.query('SELECT 1'); return c.json({ status: 'ready' }); } catch { return c.json({ status: 'not_ready' }, 503); } });
app.get('/metrics', c => c.text(metrics.render(), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }));

app.post('/auth/register', async c => {
  if (await limited('register', c.req.raw, registerRateLimit)) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  const data = credentials.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ error: 'Use a valid email and a password of at least 12 characters' }, 400);
  try {
    const role = admins.has(data.data.email) ? 'ADMIN' : 'CUSTOMER';
    const { rows: [user] } = await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role', [data.data.email, await passwordHash(data.data.password), role]);
    await issueToken('email_verification_tokens', user, c.req.raw);
    await audit(pool, 'REGISTERED', c.req.raw, user.id, { role });
    return c.json(await createSession(pool, user), 201);
  } catch { return c.json({ error: 'Unable to create account' }, 409); }
});

app.post('/auth/login', async c => {
  if (await limited('login', c.req.raw, 10)) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  const data = credentials.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ error: 'Invalid email or password' }, 401);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [user] } = await client.query('SELECT id,email,role,password_hash,failed_login_attempts,locked_until FROM users WHERE email=$1 FOR UPDATE', [data.data.email]);
    const locked = user?.locked_until && new Date(user.locked_until).getTime() > Date.now();
    const valid = !!user && !locked && await matches(data.data.password, user.password_hash);
    if (!valid) {
      if (user && !locked) {
        const attempts = Number(user.failed_login_attempts) + 1;
        await client.query("UPDATE users SET failed_login_attempts=$2, locked_until=CASE WHEN $2 >= 5 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1", [user.id, attempts]);
        await audit(client, 'LOGIN_FAILED', c.req.raw, user.id, { locked: attempts >= 5 });
      } else await audit(client, 'LOGIN_FAILED', c.req.raw, undefined, { locked: !!locked });
      await client.query('COMMIT');
      return c.json({ error: 'Invalid email or password' }, 401);
    }
    await client.query('UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=$1', [user.id]);
    // A successful login rotates the session and revokes old browser sessions.
    await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    const session = await createSession(client, user);
    await audit(client, 'LOGIN_SUCCEEDED', c.req.raw, user.id);
    await client.query('COMMIT');
    return c.json(session);
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return c.json({ error: 'Authentication is temporarily unavailable' }, 503);
  } finally { client.release(); }
});

// Only the server-side Next.js OAuth callback may create a Google session.
// Never expose AUTH_PROXY_TOKEN to the browser.
app.post('/auth/google', async c => {
  if (!proxyToken || c.req.header('authorization') !== `Bearer ${proxyToken}`)
    return c.json({ error: 'Google sign-in is not configured' }, 503);
  const data = googleIdentity.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ error: 'Invalid Google identity' }, 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: bySubject } = await client.query('SELECT id,email,role FROM users WHERE google_subject=$1 FOR UPDATE', [data.data.subject]);
    let user = bySubject[0];
    if (!user) {
      const { rows: byEmail } = await client.query('SELECT id,email,role,google_subject FROM users WHERE email=$1 FOR UPDATE', [data.data.email]);
      if (byEmail[0]?.google_subject && byEmail[0].google_subject !== data.data.subject) {
        await client.query('ROLLBACK');
        return c.json({ error: 'This email is already linked to another sign-in method' }, 409);
      }
      if (byEmail[0]) {
        user = byEmail[0];
        await client.query('UPDATE users SET google_subject=$2,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1', [user.id, data.data.subject]);
      } else {
        const role = admins.has(data.data.email) ? 'ADMIN' : 'CUSTOMER';
        const generatedPassword = await passwordHash(randomBytes(32).toString('base64url'));
        const { rows } = await client.query('INSERT INTO users(email,password_hash,role,google_subject,email_verified_at) VALUES($1,$2,$3,$4,now()) RETURNING id,email,role', [data.data.email, generatedPassword, role, data.data.subject]);
        user = rows[0];
      }
    }
    await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    const session = await createSession(client, user);
    await audit(client, 'GOOGLE_LOGIN_SUCCEEDED', c.req.raw, user.id);
    await client.query('COMMIT');
    return c.json(session);
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return c.json({ error: 'Google sign-in is temporarily unavailable' }, 503);
  } finally { client.release(); }
});

app.post('/auth/logout', async c => {
  const token = c.req.header('x-session-token');
  if (token) {
    const { rows: [session] } = await pool.query('DELETE FROM sessions WHERE token_hash=$1 RETURNING user_id', [hash(token)]);
    if (session) await audit(pool, 'LOGOUT', c.req.raw, session.user_id);
  }
  return c.body(null, 204);
});

app.get('/auth/session', async c => {
  const token = c.req.header('x-session-token');
  if (!token) return c.json({ error: 'Unauthenticated' }, 401);
  const { rows: [user] } = await pool.query('SELECT u.id,u.email,u.role,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hash(token)]);
  return user ? c.json({ user: { ...user, emailVerified: !!user.email_verified_at } }) : c.json({ error: 'Unauthenticated' }, 401);
});

app.post('/auth/verify-email', async c => {
  if (await limited('verify_email', c.req.raw, 10)) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  const data = tokenInput.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ error: 'Invalid or expired verification link' }, 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query('SELECT user_id FROM email_verification_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE', [hash(data.data.token)]);
    if (!row) { await client.query('ROLLBACK'); return c.json({ error: 'Invalid or expired verification link' }, 400); }
    await client.query('UPDATE email_verification_tokens SET consumed_at=now() WHERE token_hash=$1', [hash(data.data.token)]);
    await client.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1', [row.user_id]);
    await audit(client, 'EMAIL_VERIFIED', c.req.raw, row.user_id);
    await client.query('COMMIT');
    return c.json({ status: 'verified' });
  } catch { await client.query('ROLLBACK').catch(() => {}); return c.json({ error: 'Verification is temporarily unavailable' }, 503); } finally { client.release(); }
});

app.post('/auth/password-reset/request', async c => {
  if (await limited('password_reset', c.req.raw, 5)) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  const data = emailInput.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ status: 'accepted' });
  const { rows: [user] } = await pool.query('SELECT id,email FROM users WHERE email=$1', [data.data.email]);
  if (user) await issueToken('password_reset_tokens', user, c.req.raw);
  return c.json({ status: 'accepted' });
});

app.post('/auth/password-reset/confirm', async c => {
  if (await limited('password_reset_confirm', c.req.raw, 5)) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  const data = resetInput.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ error: 'Invalid or expired reset link' }, 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE', [hash(data.data.token)]);
    if (!row) { await client.query('ROLLBACK'); return c.json({ error: 'Invalid or expired reset link' }, 400); }
    await client.query('UPDATE password_reset_tokens SET consumed_at=now() WHERE token_hash=$1', [hash(data.data.token)]);
    await client.query('UPDATE users SET password_hash=$2, failed_login_attempts=0, locked_until=NULL WHERE id=$1', [row.user_id, await passwordHash(data.data.password)]);
    await client.query('DELETE FROM sessions WHERE user_id=$1', [row.user_id]);
    await audit(client, 'PASSWORD_RESET_COMPLETED', c.req.raw, row.user_id);
    await client.query('COMMIT');
    return c.json({ status: 'password_updated' });
  } catch { await client.query('ROLLBACK').catch(() => {}); return c.json({ error: 'Password reset is temporarily unavailable' }, 503); } finally { client.release(); }
});

const cleanupEvery = z.coerce.number().int().min(60_000).max(86_400_000).parse(process.env.SESSION_CLEANUP_INTERVAL_MS ?? 3_600_000);
const retentionDays = z.coerce.number().int().min(1).max(3650).parse(process.env.AUTH_AUDIT_RETENTION_DAYS ?? 365);
const cleanup = () => pool.query(cleanupSql(retentionDays)).catch(() => {});
const cleanupTimer = setInterval(cleanup, cleanupEvery);
cleanupTimer.unref();
serve({ fetch: instrumentHttp('auth-service', metrics, log, app.fetch), port: Number(process.env.PORT ?? 3005) });

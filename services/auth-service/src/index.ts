import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import pg from 'pg';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

const scrypt = promisify(scryptCallback);
const pool = new pg.Pool({ connectionString: z.string().min(1).parse(process.env.DATABASE_URL) });
const admins = new Set((process.env.ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean));
const credentials = z.object({ email: z.email().transform(v => v.trim().toLowerCase()), password: z.string().min(12).max(200) });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${Buffer.from(await scrypt(password, salt, 64) as Uint8Array).toString('hex')}`; }
async function matches(password: string, saved: string) { const [salt, expected] = saved.split(':'); const actual = Buffer.from(await scrypt(password, salt, 64) as Uint8Array).toString('hex'); return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')); }
async function session(user: { id: string; email: string; role: string }) { const token = randomBytes(32).toString('base64url'); await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'7 days\')', [hash(token), user.id]); return { token, user: { id: user.id, email: user.email, role: user.role } }; }
const app = new Hono();
app.get('/health', c => c.json({ service: 'auth-service', status: 'ok' }));
app.get('/ready', async c => { try { await pool.query('SELECT 1'); return c.json({ status: 'ready' }); } catch { return c.json({ status: 'not_ready' }, 503); } });
app.post('/auth/register', async c => { const data = credentials.safeParse(await c.req.json().catch(() => null)); if (!data.success) return c.json({ error: 'Use a valid email and a password of at least 12 characters' }, 400); try { const role = admins.has(data.data.email) ? 'ADMIN' : 'CUSTOMER'; const { rows: [user] } = await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role', [data.data.email, await passwordHash(data.data.password), role]); return c.json(await session(user), 201); } catch { return c.json({ error: 'Unable to create account' }, 409); } });
app.post('/auth/login', async c => { const data = credentials.safeParse(await c.req.json().catch(() => null)); if (!data.success) return c.json({ error: 'Invalid email or password' }, 401); const { rows: [user] } = await pool.query('SELECT id,email,role,password_hash FROM users WHERE email=$1', [data.data.email]); if (!user || !await matches(data.data.password, user.password_hash)) return c.json({ error: 'Invalid email or password' }, 401); return c.json(await session(user)); });
app.post('/auth/logout', async c => { const token = c.req.header('x-session-token'); if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]); return c.body(null, 204); });
app.get('/auth/session', async c => { const token = c.req.header('x-session-token'); if (!token) return c.json({ error: 'Unauthenticated' }, 401); const { rows: [user] } = await pool.query("SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", [hash(token)]); return user ? c.json({ user }) : c.json({ error: 'Unauthenticated' }, 401); });
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3005) });

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import pg from 'pg';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

// Initialize the authentication service with configuration from environment variables, set up database connection, and define endpoints for user registration, login, logout, and session management.

const scrypt = promisify(scryptCallback);

const pool = new pg.Pool({ connectionString: z.string().min(1).parse(process.env.DATABASE_URL) });

const admins = new Set(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

const credentials = z.object({
  email: z.email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(12).max(200),
});

// Function to hash a password using a random salt and the scrypt algorithm, returning the salt and hashed password in a colon-separated format.
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from((await scrypt(password, salt, 64)) as Uint8Array).toString('hex')}`;
}

// Function to compare a provided password with a stored hashed password, using a timing-safe comparison to prevent timing attacks.
async function matches(password: string, saved: string) {
  const [salt, expected] = saved.split(':');
  const actual = Buffer.from((await scrypt(password, salt, 64)) as Uint8Array).toString('hex');
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

// Function to create a new user session by generating a random token, storing its hash in the database along with the user ID and expiration time, and returning the token and user information.
async function session(user: { id: string; email: string; role: string }) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [hash(token), user.id],
  );
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}

// Create a new Hono application instance and define endpoints for health checks, user registration, login, logout, and session management. Start the HTTP server to handle incoming requests.
const app = new Hono();

// Health check endpoints
app.get('/health', (c) => c.json({ service: 'auth-service', status: 'ok' }));

// Endpoint to check if the service is ready to accept requests
app.get('/ready', async (c) => {
  try {
    await pool.query('SELECT 1');
    return c.json({ status: 'ready' });
  } catch {
    return c.json({ status: 'not_ready' }, 503);
  }
});

// Endpoint to register a new user account
app.post('/auth/register', async (c) => {
  const data = credentials.safeParse(await c.req.json().catch(() => null));

  if (!data.success)
    return c.json({ error: 'Use a valid email and a password of at least 12 characters' }, 400);

  try {
    const role = admins.has(data.data.email) ? 'ADMIN' : 'CUSTOMER';
    const {
      rows: [user],
    } = await pool.query(
      'INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role',
      [data.data.email, await passwordHash(data.data.password), role],
    );

    return c.json(await session(user), 201);
  } catch {
    return c.json({ error: 'Unable to create account' }, 409);
  }
});

// Endpoint to log in an existing user account
app.post('/auth/login', async (c) => {
  const data = credentials.safeParse(await c.req.json().catch(() => null));
  if (!data.success) return c.json({ error: 'Invalid email or password' }, 401);
  const {
    rows: [user],
  } = await pool.query('SELECT id,email,role,password_hash FROM users WHERE email=$1', [
    data.data.email,
  ]);
  if (!user || !(await matches(data.data.password, user.password_hash)))
    return c.json({ error: 'Invalid email or password' }, 401);
  return c.json(await session(user));
});

// Endpoint to log out the current user session
app.post('/auth/logout', async (c) => {
  const token = c.req.header('x-session-token');
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]);
  return c.body(null, 204);
});

// Endpoint to retrieve the current user session information
app.get('/auth/session', async (c) => {
  const token = c.req.header('x-session-token');
  if (!token) return c.json({ error: 'Unauthenticated' }, 401);
  const {
    rows: [user],
  } = await pool.query(
    'SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
    [hash(token)],
  );
  return user ? c.json({ user }) : c.json({ error: 'Unauthenticated' }, 401);
});

// Start the HTTP server with the authentication service application, and listen for incoming requests on the specified port.
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3005) });

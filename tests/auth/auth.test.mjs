import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import pg from 'pg';
import { parse } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const hash = value => createHash('sha256').update(value).digest('hex');
const freePort = async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
const eventually = async (read, predicate, timeout = 10_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Timed out waiting for Auth Service');
};

test('Auth Service account lifecycle and one-time tokens', { timeout: 30_000 }, async t => {
  const envPath = new URL('../../services/auth-service/.env', import.meta.url);
  const configured = process.env.TEST_AUTH_DATABASE_URL ?? parse(readFileSync(envPath)).DATABASE_URL;
  if (!configured) throw new Error('Missing TEST_AUTH_DATABASE_URL or services/auth-service/.env DATABASE_URL');
  const url = new URL(configured);
  const admin = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5_000 });
  const databaseName = `saga_auth_test_${randomUUID().replaceAll('-', '')}`;
  let pool;
  let child;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5_000 });
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../services/auth-service/drizzle/', import.meta.url)) });
    const port = await freePort();
    child = fork(fileURLToPath(new URL('../../services/auth-service/dist/index.js', import.meta.url)), [], {
      stdio: 'ignore',
      env: { ...process.env, DATABASE_URL: url.href, PORT: String(port), AUTH_EMAIL_MODE: 'log', AUTH_PROXY_TOKEN: 'test-proxy', NODE_ENV: 'test' },
    });
    const base = `http://127.0.0.1:${port}`;
    await eventually(async () => {
      try { return await fetch(`${base}/health`); } catch { return undefined; }
    }, response => response?.ok);
    let sequence = 0;
    const post = (path, body, ip = `203.0.113.${++sequence}`) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-proxy', 'x-forwarded-for': ip }, body: JSON.stringify(body),
    });
    const createToken = async (token, expiresAt) => {
      const { rows: [user] } = await pool.query("INSERT INTO users(email,password_hash) VALUES($1,'not-used') RETURNING id", [`${randomUUID()}@example.test`]);
      await pool.query('INSERT INTO email_verification_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [hash(token), user.id, expiresAt]);
      return user.id;
    };
    await t.test('an expired token is rejected without verifying its user', async () => {
      const userId = await createToken('e'.repeat(32), new Date(Date.now() - 1_000));
      const response = await fetch(`${base}/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'e'.repeat(32) }) });
      assert.equal(response.status, 400);
      assert.equal((await pool.query('SELECT email_verified_at FROM users WHERE id=$1', [userId])).rows[0].email_verified_at, null);
    });
    await t.test('a valid token is consumed and cannot be reused', async () => {
      const token = 'v'.repeat(32);
      const userId = await createToken(token, new Date(Date.now() + 60_000));
      assert.equal((await fetch(`${base}/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).status, 200);
      assert.notEqual((await pool.query('SELECT email_verified_at FROM users WHERE id=$1', [userId])).rows[0].email_verified_at, null);
      assert.equal((await fetch(`${base}/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).status, 400);
      assert.notEqual((await pool.query('SELECT consumed_at FROM email_verification_tokens WHERE token_hash=$1', [hash(token)])).rows[0].consumed_at, null);
    });
    await t.test('registration rejects duplicates and login rotates sessions', async () => {
      const email = `account-${randomUUID()}@example.test`;
      const password = 'correct horse battery staple';
      const registered = await post('/auth/register', { email, password });
      assert.equal(registered.status, 201);
      const first = await registered.json();
      assert.match(first.token, /^[A-Za-z0-9_-]{32,}$/);
      assert.equal((await post('/auth/register', { email, password })).status, 409);
      assert.equal((await post('/auth/login', { email, password: 'wrong password value' })).status, 401);
      const loggedIn = await post('/auth/login', { email, password });
      assert.equal(loggedIn.status, 200);
      const second = await loggedIn.json();
      assert.equal((await fetch(`${base}/auth/session`, { headers: { 'x-session-token': first.token } })).status, 401);
      assert.equal((await fetch(`${base}/auth/session`, { headers: { 'x-session-token': second.token } })).status, 200);
      assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { authorization: 'Bearer test-proxy', 'x-session-token': second.token } })).status, 204);
      assert.equal((await fetch(`${base}/auth/session`, { headers: { 'x-session-token': second.token } })).status, 401);
    });
    await t.test('five invalid passwords lock an account and a reset revokes prior sessions', async () => {
      const email = `locked-${randomUUID()}@example.test`;
      const oldPassword = 'old correct horse battery';
      const { token } = await (await post('/auth/register', { email, password: oldPassword })).json();
      const ip = '198.51.100.9';
      for (let attempt = 0; attempt < 5; attempt++) assert.equal((await post('/auth/login', { email, password: 'incorrect password value' }, ip)).status, 401);
      assert.equal((await post('/auth/login', { email, password: oldPassword }, ip)).status, 401);
      const { rows: [user] } = await pool.query('SELECT id,locked_until FROM users WHERE email=$1', [email]);
      assert.notEqual(user.locked_until, null);
      const resetToken = 'r'.repeat(32);
      await pool.query('INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'1 hour\')', [hash(resetToken), user.id]);
      assert.equal((await post('/auth/password-reset/confirm', { token: resetToken, password: 'new correct horse battery' })).status, 200);
      assert.equal((await fetch(`${base}/auth/session`, { headers: { 'x-session-token': token } })).status, 401);
      assert.equal((await post('/auth/password-reset/confirm', { token: resetToken, password: 'another correct password' })).status, 400);
      assert.equal((await post('/auth/login', { email, password: 'new correct horse battery' })).status, 200);
    });
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    if (child) await new Promise(resolve => child.once('exit', resolve));
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => {});
    await admin.end();
  }
});

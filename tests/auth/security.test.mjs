import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { cleanupSql, clientIp, mutationError } from '../../services/auth-service/dist/security.js';

test('only authenticated proxy requests can choose the rate-limit client IP', () => {
  const forwarded = new Request('https://auth.test/auth/login', { headers: { 'x-forwarded-for': '203.0.113.9, attacker' } });
  assert.equal(clientIp(forwarded, 'proxy-secret'), 'unknown');
  const trusted = new Request('https://auth.test/auth/login', { headers: { authorization: 'Bearer proxy-secret', 'x-forwarded-for': '203.0.113.9, attacker' } });
  assert.equal(clientIp(trusted, 'proxy-secret'), '203.0.113.9');
  assert.notEqual(createHash('sha256').update(clientIp(forwarded, 'proxy-secret')).digest('hex'), createHash('sha256').update(clientIp(trusted, 'proxy-secret')).digest('hex'));
});

test('production auth mutations require JSON and the configured origin', () => {
  const publicUrl = 'https://shop.example';
  assert.deepEqual(mutationError(new Request('https://auth.test/auth/login', { method: 'POST', headers: { origin: publicUrl } }), publicUrl, true), { status: 415, error: 'Content-Type must be application/json' });
  assert.deepEqual(mutationError(new Request('https://auth.test/auth/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' } }), publicUrl, true), { status: 403, error: 'Cross-site request blocked' });
  assert.equal(mutationError(new Request('https://auth.test/auth/login', { method: 'POST', headers: { origin: publicUrl, 'content-type': 'application/json; charset=utf-8' } }), publicUrl, true), undefined);
  assert.equal(mutationError(new Request('https://auth.test/auth/logout', { method: 'POST', headers: { origin: publicUrl } }), publicUrl, true), undefined);
});

test('retention cleanup covers each sensitive data class with the configured audit period', () => {
  const sql = cleanupSql(180);
  for (const table of ['sessions', 'email_verification_tokens', 'password_reset_tokens', 'auth_rate_limits', 'auth_audit_logs']) assert.match(sql, new RegExp(`DELETE FROM ${table}`));
  assert.match(sql, /make_interval\(days => 180\)/);
});

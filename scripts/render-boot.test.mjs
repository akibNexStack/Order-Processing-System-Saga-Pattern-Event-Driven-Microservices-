import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t, migration) {
  const dir = await mkdtemp(join(tmpdir(), 'saga-boot-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await copyFile(new URL('./render-boot.mjs', import.meta.url), join(dir, 'render-boot.mjs'));
  await writeFile(join(dir, 'migrate-service.mjs'), migration);
  await writeFile(join(dir, 'render-start.mjs'), 'console.log("started:" + process.argv[2]);');
  return service => spawnSync(process.execPath, [join(dir, 'render-boot.mjs'), service], { encoding: 'utf8' });
}

for (const service of ['order-orchestrator', 'payment-service', 'inventory-service', 'shipping-service']) {
  test(`${service}: waits for migration before starting`, async t => {
    const run = await fixture(t, 'await new Promise(r => setTimeout(r, 10)); console.log("migrated:" + process.argv[2]);');
    const result = run(service);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [`migrated:${service}`, `started:${service}`]);
  });
}

test('migration failure prevents startup', async t => {
  const run = await fixture(t, 'throw new Error("migration failed");');
  const result = run('order-orchestrator');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /migration failed/);
  assert.equal(result.stdout, '');
});

test('unknown service is rejected before migration', async t => {
  const run = await fixture(t, 'console.log("migrated");');
  const result = run('unknown');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown service/);
  assert.equal(result.stdout, '');
});

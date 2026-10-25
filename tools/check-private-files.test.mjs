import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFile, privatePath } from './check-private-files.mjs';

const checker = fileURLToPath(new URL('./check-private-files.mjs', import.meta.url));

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'mirtar-private-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const write = (path, content) => {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  };
  const check = () => spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  try { git('init', '--quiet'); run({ root, git, write, check }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('allows placeholder templates and rejects private paths in any directory', () => {
  assert.equal(inspectFile('config/device.example.json', JSON.stringify({ template: true, wifiNetworks: [{ password: 'FILL_LOCALLY' }], targets: [{ secret: 'REPLACE_WITH_RANDOM_SECRET' }] })), null);
  for (const path of ['.private/device.config.json', 'bridge.Desktop.config.json', 'nested/device.config.json', 'firmware/build/generated.h', 'MirTar-full.bin', '.env.production', 'config/my-wifi.json']) {
    assert.equal(privatePath(path), true, path);
  }
});

test('accepts an index with placeholder templates', () => fixture(({ git, write, check }) => {
  write('config/device.example.json', JSON.stringify({ template: true, wifiNetworks: [{ password: 'FILL_LOCALLY' }] }));
  git('add', 'config/device.example.json');
  const result = check();
  assert.equal(result.status, 0, result.stderr);
}));

test('blocks force-added ignored configuration', () => fixture(({ git, write, check }) => {
  write('.gitignore', '.private/\n');
  write('.private/bridge.config.json', '{}');
  git('add', '-f', '.private/bridge.config.json');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private configuration/);
}));

test('blocks non-placeholder credentials in templates', () => fixture(({ git, write, check }) => {
  write('config/device.example.json', JSON.stringify({ template: true, wifiNetworks: [{ password: 'fixture-only-not-a-real-password' }] }));
  git('add', 'config/device.example.json');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-placeholder credential/);
  assert.doesNotMatch(result.stderr + result.stdout, /fixture-only-not-a-real-password/);
}));

test('checks staged content even when working copy has already been sanitized', () => fixture(({ git, write, check }) => {
  const token = ['fixture', 'private', 'token', '123456789'].join('-');
  write('.private/device.config.json', JSON.stringify({ wifiNetworks: [{ password: token }] }));
  write('notes.md', `accidentally copied ${token}`);
  git('add', 'notes.md');
  write('notes.md', 'sanitized working copy');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contains a local credential/);
  assert.equal((result.stderr + result.stdout).includes(token), false);
}));

test('blocks a force-added firmware image', () => fixture(({ git, write, check }) => {
  write('.gitignore', '*.bin\n');
  write('MirTar-full.bin', Buffer.from([0xe9, 0, 0, 0]));
  git('add', '-f', 'MirTar-full.bin');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generated artifact/);
}));

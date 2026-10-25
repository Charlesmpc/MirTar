import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const tool = resolve(import.meta.dirname, 'audit-repository.mjs');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mirtar-audit-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '--quiet'); git('config', 'user.name', 'Audit Fixture');
  git('config', 'user.email', '0+fixture@users.noreply.github.com');
  return { root, git, clean() { assert(resolve(root).startsWith(resolve(join(tmpdir(), 'mirtar-audit-')))); rmSync(root, { recursive: true, force: true }); } };
}
function audit(root) {
  const report = join(root, '.private', 'audit.json');
  const run = spawnSync(process.execPath, [tool, root, 'HEAD', report], { encoding: 'utf8' });
  return { run, report: JSON.parse(readFileSync(report, 'utf8')) };
}
test('privacy audit accepts clean history with GitHub noreply metadata', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'README.md'), 'Generic source only\n'); f.git('add', '.'); f.git('commit', '-qm', 'initial');
    const { run, report } = audit(f.root); assert.equal(run.status, 0); assert.equal(report.readyToMakePublic, true);
  } finally { f.clean(); }
});
test('privacy audit detects deleted historical token and personal metadata without echoing values', () => {
  const f = fixture(), token = 'ghp_' + 'A'.repeat(36), email = 'fixture' + '@' + 'private.invalid';
  try {
    f.git('config', 'user.email', email); writeFileSync(join(f.root, 'old.txt'), token);
    f.git('add', '.'); f.git('commit', '-qm', 'historical');
    f.git('rm', '-q', 'old.txt'); writeFileSync(join(f.root, 'README.md'), 'Clean current tree\n');
    f.git('config', 'user.email', '0+fixture@users.noreply.github.com'); f.git('add', '.'); f.git('commit', '-qm', 'clean snapshot');
    const { run, report } = audit(f.root); assert.equal(run.status, 1);
    assert.equal(report.currentTreePrivateInfoClean, true); assert.equal(report.credentialsClean, false);
    assert.equal(report.historyPrivateInfoClean, false); assert.equal(report.readyToMakePublic, false);
    const output = run.stdout + run.stderr + JSON.stringify(report);
    assert(!output.includes(token)); assert(!output.includes(email));
    assert(report.credentialFindings.some(f => f.where === 'history' && f.rule === 'github_token'));
  } finally { f.clean(); }
});

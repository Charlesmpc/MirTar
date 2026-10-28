import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession } from '../src/codex/session-setup.ts';
import { checkWorkspace, defaultWorkspace } from '../src/codex/workspace.ts';
import { CodexAdapter } from '../src/codex/adapter.ts';
import type { BridgeConfig } from '../src/contracts.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
class SetupRpc extends EventEmitter {
  calls: { method: string; params: any }[] = [];
  failBootstrap = false;
  beforeSave?: () => Promise<void>;
  async initialize() {}
  close() {}
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id } };
    if (method === 'turn/start') {
      if (this.failBootstrap) throw Error('disconnected');
      this.emit('notification', 'turn/completed', { threadId: params.threadId, turn: { status: 'completed' } });
    }
    if (method === 'thread/name/set') await this.beforeSave?.();
    return {};
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirtar-workspace-')), path = join(root, 'bridge.config.json');
  const config: BridgeConfig = { version: 1, server: { id: 'test-server', name: 'Test' },
    listen: { host: '127.0.0.1', port: 28743, allowLanPlaintext: true },
    devices: [{ id: 'test-card', secret: 'test-placeholder-value-not-a-real-key' }],
    codex: { bin: 'test-only', edgePath: '', sessions: [] } };
  await writeFile(path, JSON.stringify(config));
  return { root, path, config, async save() { await writeFile(path, JSON.stringify(config)); },
    async dispose() { await rm(root, { recursive: true, force: true }); } };
}

test('first startup creates a writable user workspace and persists the same session across restarts', async () => {
  const f = await fixture(), rpc = new SetupRpc();
  try {
    const result = await createAgentSession(f.path, { onlyIfEmpty: true }, { home: f.root, rpc: () => rpc });
    const cwd = defaultWorkspace(f.root);
    assert.deepEqual(result.codex.sessions, [{ id, name: 'MirTar Agent', cwd, execution: 'bridge' }]);
    assert.deepEqual(result.devices, f.config.devices); assert.deepEqual(result.server, f.config.server);
    assert.deepEqual(await readdir(cwd), []); // write probe is removed
    assert.equal(rpc.calls.find(c => c.method === 'thread/start')?.params.cwd, cwd);
    const saved = await readFile(f.path, 'utf8');
    const restarted = await createAgentSession(f.path, { onlyIfEmpty: true }, { home: join(f.root, 'different-home'), rpc: () => { throw Error('must not create another session'); } });
    assert.deepEqual(restarted, result); assert.equal(await readFile(f.path, 'utf8'), saved);
  } finally { await f.dispose(); }
});

test('explicit project overrides the host default; an existing desktop session and bindings stay intact', async () => {
  const f = await fixture(), rpc = new SetupRpc(), cwd = join(f.root, 'project');
  try {
    await mkdir(cwd); f.config.codex.defaultWorkingDirectory = join(f.root, 'unused');
    f.config.codex.sessions.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Desktop' }); await f.save();
    const result = await createAgentSession(f.path, { workingDirectory: cwd, name: 'Project' }, { rpc: () => rpc });
    assert.deepEqual(result.codex.sessions[0], f.config.codex.sessions[0]);
    assert.equal(result.codex.sessions[1].cwd, cwd); assert.equal(result.codex.sessions[1].name, 'Project');
    assert.deepEqual(result.devices, f.config.devices);
  } finally { await f.dispose(); }
});

test('configured host default is used; missing custom directories never fall back or get recreated', async () => {
  const f = await fixture(), rpc = new SetupRpc(), cwd = join(f.root, 'project');
  try {
    f.config.codex.defaultWorkingDirectory = cwd; await f.save();
    const saved = await readFile(f.path, 'utf8');
    await assert.rejects(createAgentSession(f.path, {}, { home: f.root, rpc: () => rpc }), /session_workspace_unavailable/);
    assert.equal(await readFile(f.path, 'utf8'), saved); assert.equal(rpc.calls.length, 0);
    assert.deepEqual((await readdir(f.root)).sort(), ['bridge.config.json']);
    await mkdir(cwd);
    const result = await createAgentSession(f.path, {}, { rpc: () => rpc });
    assert.equal(result.codex.sessions[0].cwd, cwd);
  } finally { await f.dispose(); }
});

test('default workspace creation failure does not call Codex or change configuration', async () => {
  const f = await fixture(), rpc = new SetupRpc();
  try {
    await writeFile(join(f.root, 'MirTar'), 'this is a file');
    const saved = await readFile(f.path, 'utf8');
    await assert.rejects(createAgentSession(f.path, {}, { home: f.root, rpc: () => rpc }), /session_workspace_unavailable/);
    assert.equal(rpc.calls.length, 0); assert.equal(await readFile(f.path, 'utf8'), saved);
    await assert.rejects(checkWorkspace('relative-project'), /session_workspace_unavailable/);
  } finally { await f.dispose(); }
});

test('failed bootstrap resumes its receipt on retry instead of creating a duplicate conversation', async () => {
  const f = await fixture(), failed = new SetupRpc(), retry = new SetupRpc();
  try {
    failed.failBootstrap = true;
    await assert.rejects(createAgentSession(f.path, {}, { home: f.root, rpc: () => failed }), /disconnected/);
    const pending = JSON.parse(await readFile(f.path + '.session-setup.local.json', 'utf8'));
    assert.equal(pending.sessionId, id);
    const result = await createAgentSession(f.path, {}, { home: f.root, rpc: () => retry });
    assert.equal(result.codex.sessions[0].id, id);
    assert.equal(retry.calls.filter(c => c.method === 'thread/start').length, 0);
    assert.equal(retry.calls.filter(c => c.method === 'thread/resume').length, 1);
  } finally { await f.dispose(); }
});

test('unknown creation and concurrent configuration edits preserve local state without automatic replay', async () => {
  const f = await fixture(), rpc = new SetupRpc();
  try {
    rpc.beforeSave = async () => { f.config.server!.name = 'Changed locally'; await f.save(); };
    await assert.rejects(createAgentSession(f.path, {}, { home: f.root, rpc: () => rpc }), /session_config_changed/);
    assert.equal(JSON.parse(await readFile(f.path, 'utf8')).server.name, 'Changed locally');
    const retry = new SetupRpc();
    await assert.rejects(createAgentSession(f.path, {}, { home: f.root, rpc: () => retry }), /session_setup_incomplete/);
    assert.equal(retry.calls.length, 0);
    const pendingPath = f.path + '.session-setup.local.json';
    const pending = JSON.parse(await readFile(pendingPath, 'utf8')); delete pending.sessionId;
    pending.configHash = createHash('sha256').update(await readFile(f.path)).digest('hex');
    await writeFile(pendingPath, JSON.stringify(pending));
    await assert.rejects(createAgentSession(f.path, {}, { home: f.root, rpc: () => retry }), /session_setup_incomplete/);
  } finally { await f.dispose(); }
});

test('simultaneous setup is blocked before a second native session is created', async () => {
  const f = await fixture(), rpc = new SetupRpc();
  try {
    rpc.beforeSave = async () => {
      await assert.rejects(createAgentSession(f.path, {}, { home: f.root, rpc: () => { throw Error('no second RPC'); } }), /session_setup_in_progress/);
    };
    await createAgentSession(f.path, {}, { home: f.root, rpc: () => rpc });
    assert.equal(rpc.calls.filter(c => c.method === 'thread/start').length, 1);
  } finally { await f.dispose(); }
});

test('a saved workspace removed after activation blocks later turns without switching or creating folders', async () => {
  const f = await fixture(), cwd = join(f.root, 'project'), rpc = new SetupRpc();
  try {
    await mkdir(cwd);
    rpc.request = async (method, params) => {
      rpc.calls.push({ method, params });
      if (method === 'thread/loaded/list') return { data: [] };
      if (method === 'thread/resume') return { thread: { id } };
      throw Error('unexpected native execution');
    };
    const adapter = new CodexAdapter({ bin: '', edgePath: '', sessions: [{ id, name: 'Project', execution: 'bridge', cwd }] },
      { async openWebRtc() { throw Error('unused'); } }, { rpc, transcribe: async () => '' });
    try {
      await adapter.activateSession(id); await rm(cwd, { recursive: true });
      await assert.rejects(adapter.submitText(id, 'Do not execute', 'input', new AbortController().signal), /session_workspace_unavailable/);
      assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 0);
      assert.deepEqual(await readdir(f.root), ['bridge.config.json']);
    } finally { await adapter.close(); }
  } finally { await f.dispose(); }
});

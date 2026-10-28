import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { runBridgeService } from '../src/service.ts';
import { startBridge } from '../src/server.ts';
import type { AgentAdapter, BridgeConfig } from '../src/contracts.ts';

async function waitState(directory: string, phase: string) {
  for (let i = 0; i < 600; i++) {
    try { const state = JSON.parse(await readFile(join(directory, 'runtime.local.json'), 'utf8')); if (state.phase === phase) return state; } catch {}
    await delay(25);
  }
  const last = JSON.parse(await readFile(join(directory, 'runtime.local.json'), 'utf8'));
  const log = await readFile(join(directory, 'bridge.log'), 'utf8');
  throw Error('Missing service state: ' + phase + '; actual=' + last.phase + '; log=' + log.slice(-1500));
}
async function requestStop(directory: string, nonce: string) {
  const path = join(directory, 'stop.local.json'), temp = path + '.tmp';
  await writeFile(temp, JSON.stringify({ nonce })); await rename(temp, path);
}
test('background service starts once, ignores stale stop requests, stops gracefully and restarts with the same config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirtar-service-')), stateDirectory = join(root, 'service');
  const entry = join(root, 'worker.mjs'), config = join(root, 'config.json'), events = join(root, 'events.txt');
  await writeFile(config, JSON.stringify({ events }));
  await writeFile(entry, `import {readFileSync,appendFileSync} from 'node:fs';
const c=JSON.parse(readFileSync(process.argv[2]));appendFileSync(c.events,'start\\n');
process.on('message',m=>{if(m.type==='mirtar_shutdown'){appendFileSync(c.events,'stop\\n');process.exit(0);}});
process.on('disconnect',()=>process.exit(0));process.send({type:'mirtar_ready'});setInterval(()=>{},1000);`);
  let running: Promise<number> | undefined;
  try {
    running = runBridgeService({ root, config, stateDirectory, entry });
    const first = await waitState(stateDirectory, 'running');
    assert.equal(await runBridgeService({ root, config, stateDirectory, entry }), 0);
    assert.equal(await readFile(events, 'utf8'), 'start\n');
    await requestStop(stateDirectory, 'obsolete-run'); await delay(350);
    assert.equal((await waitState(stateDirectory, 'running')).nonce, first.nonce);
    await requestStop(stateDirectory, first.nonce); assert.equal(await running, 0); running = undefined;
    assert.equal((await waitState(stateDirectory, 'stopped')).nonce, first.nonce);
    assert.equal(await readFile(events, 'utf8'), 'start\nstop\n');
    running = runBridgeService({ root, config, stateDirectory, entry });
    const second = await waitState(stateDirectory, 'running'); assert.notEqual(second.nonce, first.nonce);
    await delay(300); assert.equal((await waitState(stateDirectory, 'running')).nonce, second.nonce);
    await requestStop(stateDirectory, second.nonce); assert.equal(await running, 0); running = undefined;
    assert.equal(await readFile(events, 'utf8'), 'start\nstop\nstart\nstop\n');
  } finally {
    if (running) { const current = JSON.parse(await readFile(join(stateDirectory, 'runtime.local.json'), 'utf8')); await requestStop(stateDirectory, current.nonce); await running; }
    await rm(root, { recursive: true, force: true });
  }
});

test('worker failure is reported as failed rather than a healthy service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirtar-service-failure-')), stateDirectory = join(root, 'service');
  const entry = join(root, 'worker.mjs'); await writeFile(entry, 'setTimeout(()=>process.exit(3),50);');
  try {
    assert.equal(await runBridgeService({ root, config: join(root, 'unused'), stateDirectory, entry }), 3);
    await waitState(stateDirectory, 'failed');
    await assert.rejects(readFile(join(stateDirectory, 'instance.local.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('occupied bridge port rejects cleanly without an unhandled WebSocketServer error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirtar-port-')), occupied = createServer();
  await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address(); assert.ok(address && typeof address !== 'string');
  const config: BridgeConfig = { version: 1, listen: { host: '127.0.0.1', port: address.port, allowLanPlaintext: true },
    devices: [{ id: 'test', secret: 'a'.repeat(64) }], codex: { bin: '', edgePath: '', sessions: [] } };
  const adapter: AgentAdapter = { id: 'test', async sessions() { return []; }, async history() { return []; }, beginAudio() { throw Error('unused'); }, async close() {} };
  try { await assert.rejects(startBridge(config, adapter, root), { code: 'EADDRINUSE' }); }
  finally { await new Promise<void>(resolve => occupied.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

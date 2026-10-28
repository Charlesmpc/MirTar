import { fork, spawn, type ChildProcess, type ForkOptions } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

type ServiceOptions = { config: string; root: string; stateDirectory: string; entry?: string; stopTimeoutMs?: number };
type ServiceState = { nonce: string; supervisorPid: number; bridgePid?: number; phase: string; updatedAt: string; address?: unknown };
async function save(path: string, value: unknown) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value) + '\n', { flag: 'wx' }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}

export async function runBridgeService(options: ServiceOptions): Promise<number> {
  const directory = options.stateDirectory, lockPath = join(directory, 'instance.local.json');
  await mkdir(directory, { recursive: true });
  const state: ServiceState = { nonce: randomUUID(), supervisorPid: process.pid, phase: 'starting', updatedAt: new Date().toISOString() };
  for (let attempt = 0; ; attempt++) {
    try { await writeFile(lockPath, JSON.stringify(state), { flag: 'wx' }); break; }
    catch (error: any) {
      if (error.code !== 'EEXIST' || attempt) throw Error('service_instance_unavailable');
      const prior = JSON.parse(await readFile(lockPath, 'utf8'));
      if (!Number.isInteger(prior.supervisorPid) || prior.supervisorPid <= 0) throw Error('service_instance_unavailable');
      try { process.kill(prior.supervisorPid, 0); return 0; }
      catch (failure: any) { if (failure.code !== 'ESRCH') return 0; }
      await unlink(lockPath);
    }
  }
  const statePath = join(directory, 'runtime.local.json'), stopPath = join(directory, 'stop.local.json');
  let log: WriteStream | undefined, child: ChildProcess | undefined, stopping = false, failed = false;
  let monitor: NodeJS.Timeout | undefined, forced: NodeJS.Timeout | undefined;
  let updates = Promise.resolve();
  function update(phase: string) {
    state.phase = phase; state.updatedAt = new Date().toISOString();
    const snapshot = { ...state };
    updates = updates.then(() => save(statePath, snapshot)).catch(() => { failed = true; stop(); });
  }
  function stop() {
    if (stopping) return; stopping = true; update('stopping');
    if (!child) return;
    if (child.connected) child.send({ type: 'mirtar_shutdown' }, () => {});
    forced = setTimeout(() => {
      if (!child?.pid || child.exitCode !== null) return;
      if (process.platform === 'win32') {
        const kill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        kill.on('error', () => { child?.kill(); });
      } else child.kill('SIGKILL');
    }, options.stopTimeoutMs ?? 20000);
  }
  const onSignal = () => stop();
  try {
    const logPath = join(directory, 'bridge.log');
    try {
      if ((await stat(logPath)).size > 5 * 1024 * 1024) {
        await unlink(logPath + '.previous').catch((e: any) => { if (e.code !== 'ENOENT') throw e; });
        await rename(logPath, logPath + '.previous');
      }
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    log = createWriteStream(logPath, { flags: 'a' });
    log.on('error', () => { failed = true; stop(); });
    await new Promise<void>((resolve, reject) => { log!.once('open', () => resolve()); log!.once('error', reject); });
    log.write('\nMirTar service starting ' + state.updatedAt + '\n');
    const forkOptions: ForkOptions & { windowsHide: boolean } = {
      cwd: options.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    };
    child = fork(options.entry ?? join(options.root, 'bridge/src/main.ts'), [options.config], forkOptions);
    state.bridgePid = child.pid; update('starting');
    child.stdout!.pipe(log, { end: false }); child.stderr!.pipe(log, { end: false });
    child.on('message', (message: any) => {
      if (message?.type === 'mirtar_ready' && !stopping) { state.address = message.address; update('running'); }
    });
    process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
    let checking = false;
    monitor = setInterval(async () => {
      if (checking || stopping) return; checking = true;
      try {
        const request = JSON.parse(await readFile(stopPath, 'utf8'));
        if (request.nonce === state.nonce) stop();
      } catch (error: any) { if (error.code !== 'ENOENT') { failed = true; stop(); } }
      finally { checking = false; }
    }, 250);
    const code = await new Promise<number>(resolve => {
      child!.once('exit', code => resolve(code ?? 1));
      child!.once('error', () => resolve(1));
    });
    if (forced) clearTimeout(forced);
    update(stopping && !failed ? 'stopped' : 'failed'); await updates;
    return stopping && !failed ? 0 : code || 1;
  } finally {
    if (monitor) clearInterval(monitor); if (forced) clearTimeout(forced);
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    if (child?.connected) child.disconnect();
    if (log) await new Promise<void>(resolve => { log!.end(() => resolve()); });
    await unlink(lockPath).catch(() => {});
  }
}

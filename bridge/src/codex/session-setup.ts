import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CodexRpc } from './rpc.ts';
import { ASK_TOOL, ASK_INSTRUCTIONS } from './questions.ts';
import { checkWorkspace, defaultWorkspace } from './workspace.ts';
import type { BridgeConfig } from '../contracts.ts';

type SetupRpc = Pick<CodexRpc, 'initialize' | 'request' | 'close'> & {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
};
type Options = { workingDirectory?: string; name?: string; onlyIfEmpty?: boolean };
type Pending = { configHash: string; cwd: string; name: string; sessionId?: string };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function atomicWrite(path: string, text: string) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, text, { flag: 'wx' }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}

export async function createAgentSession(configPath: string, options: Options = {},
  runtime: { rpc?: (bin: string) => SetupRpc; home?: string } = {}): Promise<BridgeConfig> {
  const lock = resolve(configPath) + '.session-setup-lock.local.json';
  // A crashed setup may leave a lock. Only reclaim it when its process is gone.
  for (let attempt = 0; ; attempt++) {
    try { await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); break; }
    catch (error: any) {
      if (error.code !== 'EEXIST' || attempt) throw Error('session_setup_in_progress');
      const owner = JSON.parse(await readFile(lock, 'utf8'));
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw Error('session_setup_in_progress');
      try { process.kill(owner.pid, 0); throw Error('session_setup_in_progress'); }
      catch (failure: any) { if (failure.code !== 'ESRCH') throw Error('session_setup_in_progress'); }
      await unlink(lock);
    }
  }
  try { return await createUnlocked(configPath, options, runtime); }
  finally { await unlink(lock).catch(() => {}); }
}

async function createUnlocked(configPath: string, options: Options,
  runtime: { rpc?: (bin: string) => SetupRpc; home?: string } = {}): Promise<BridgeConfig> {
  const path = resolve(configPath), original = await readFile(path, 'utf8');
  const config = JSON.parse(original.replace(/^\uFEFF/, '')) as BridgeConfig;
  if (!config.codex?.bin || !Array.isArray(config.codex.sessions)) throw Error('invalid_session_configuration');
  if (options.onlyIfEmpty && config.codex.sessions.length) return config;
  const name = options.name ?? 'MirTar Agent';
  if (!name.trim() || Buffer.byteLength(name) > 60 || /[\x00-\x1f\x7f]/.test(name) || config.codex.sessions.length >= 8)
    throw Error('invalid_session_configuration');
  const configured = options.workingDirectory || config.codex.defaultWorkingDirectory;
  const cwd = configured || defaultWorkspace(runtime.home);
  await checkWorkspace(cwd, !configured);

  // Intent precedes the native creation request. An unknown creation outcome must
  // not create another conversation on every bridge restart.
  const pendingPath = path + '.session-setup.local.json';
  let pending: Pending = { configHash: hash(original), cwd, name };
  try { await writeFile(pendingPath, JSON.stringify(pending), { flag: 'wx' }); }
  catch (error: any) {
    if (error.code !== 'EEXIST') throw error;
    pending = JSON.parse(await readFile(pendingPath, 'utf8'));
    if (pending.configHash !== hash(original) || pending.cwd !== cwd || pending.name !== name ||
        !/^[a-f0-9-]{36}$/i.test(pending.sessionId ?? '')) throw Error('session_setup_incomplete');
  }
  let rpc: SetupRpc | undefined, creationStarted = !!pending.sessionId;
  try {
    rpc = (runtime.rpc ?? (bin => new CodexRpc(bin)))(config.codex.bin);
    await rpc.initialize();
    if (!pending.sessionId) {
      creationStarted = true;
      const result = await rpc.request('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never',
        dynamicTools: [ASK_TOOL], developerInstructions: ASK_INSTRUCTIONS });
      if (!/^[a-f0-9-]{36}$/i.test(result.thread?.id)) throw Error('invalid_session_receipt');
      pending.sessionId = result.thread.id;
      await atomicWrite(pendingPath, JSON.stringify(pending));
    } else {
      // A prior bootstrap/config write failed. Resume the same recorded thread.
      const result = await rpc.request('thread/resume', { threadId: pending.sessionId, cwd,
        sandbox: 'read-only', approvalPolicy: 'never', excludeTurns: true });
      if (result.thread?.id !== pending.sessionId) throw Error('session_setup_incomplete');
    }
    let timer: NodeJS.Timeout | undefined, completed!: (turn: any) => void;
    const completion = new Promise<any>((resolve, reject) => {
      completed = resolve; timer = setTimeout(() => reject(Error('session_bootstrap_timeout')), 120000);
    });
    completion.catch(() => {});
    const listener = (method: string, p: any) => {
      if (method === 'turn/completed' && p.threadId === pending.sessionId) completed(p.turn);
    };
    rpc.on('notification', listener);
    try {
      await rpc.request('turn/start', { threadId: pending.sessionId, input: [{ type: 'text', text:
        'Initialize this MirTar session. Reply only MIRTAR_READY. Do not use tools, read or write files, execute commands, or start any task. The real user request will follow later.' }] });
      if ((await completion).status !== 'completed') throw Error('session_bootstrap_failed');
    } finally { clearTimeout(timer); rpc.off('notification', listener); }
    await rpc.request('thread/name/set', { threadId: pending.sessionId, name });
    config.codex.sessions.push({ id: pending.sessionId!, name, cwd, execution: 'bridge' });
    if (await readFile(path, 'utf8') !== original) throw Error('session_config_changed');
    await atomicWrite(path, JSON.stringify(config, null, 2) + '\n');
    await unlink(pendingPath);
    return config;
  } finally {
    rpc?.close();
    if (!creationStarted) await unlink(pendingPath).catch(() => {});
  }
}

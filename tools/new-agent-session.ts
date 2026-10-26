import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexRpc } from '../bridge/src/codex/rpc.ts';
import { ASK_TOOL, ASK_INSTRUCTIONS } from '../bridge/src/codex/questions.ts';
import type { BridgeConfig } from '../bridge/src/contracts.ts';

async function main() {
const [pathArg, cwdArg, name = 'MirTar Agent'] = process.argv.slice(2);
if (!pathArg || !cwdArg || !name.trim() || Buffer.byteLength(name) > 60 || /[\x00-\x1f\x7f]/.test(name)) throw Error('Provide config path, existing workspace and a name of 1–60 UTF-8 bytes');
const path = resolve(pathArg), cwd = resolve(cwdArg), original = await readFile(path, 'utf8');
if (!(await stat(cwd)).isDirectory()) throw Error('Working directory must exist');
const config = JSON.parse(original.replace(/^\uFEFF/, '')) as BridgeConfig;
if (!config.codex?.bin || !Array.isArray(config.codex.sessions) || config.codex.sessions.length >= 8) throw Error('Existing bridge config needs a free session slot');
const rpc = new CodexRpc(config.codex.bin);
try {
  await rpc.initialize();
  const result = await rpc.request('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never', dynamicTools: [ASK_TOOL], developerInstructions: ASK_INSTRUCTIONS });
  if (!/^[a-f0-9-]{36}$/i.test(result.thread?.id)) throw Error('Invalid session receipt');
  // Keep recovery metadata locally even if a concurrent config edit prevents save.
  await mkdir('.private/receipts', { recursive: true });
  await writeFile(resolve('.private/receipts', 'agent-session-' + randomUUID() + '.local.json'),
    JSON.stringify({ sessionId: result.thread.id, cwd, name, execution: 'bridge' }), { flag: 'wx' });
  // A just-created empty thread has no rollout yet in some Codex versions.
  // Persist a harmless initial turn before closing this setup process.
  let timer: NodeJS.Timeout | undefined, completed!: (turn: any) => void;
  const completion = new Promise<any>((resolve, reject) => { completed = resolve; timer = setTimeout(() => reject(Error('Session bootstrap timed out')), 120000); });
  completion.catch(() => {});
  const listener = (method: string, p: any) => { if (method === 'turn/completed' && p.threadId === result.thread.id) completed(p.turn); };
  rpc.on('notification', listener);
  try {
    await rpc.request('turn/start', { threadId: result.thread.id, input: [{ type: 'text', text: 'Initialize this new MirTar session. Reply only MIRTAR_READY. Do not use tools, read or write files, execute commands, or start any task. The real user request will follow later.' }] });
    if ((await completion).status !== 'completed') throw Error('Session bootstrap failed');
  } finally { clearTimeout(timer); rpc.off('notification', listener); }
  await rpc.request('thread/name/set', { threadId: result.thread.id, name });
  config.codex.sessions.push({ id: result.thread.id, name, cwd, execution: 'bridge' });
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  if (await readFile(path, 'utf8') !== original) throw Error('Config changed during setup; original file was not replaced. Use the private receipt to recover the created session.');
  await rename(temporary, path);
  console.log('Bridge-owned session added. Restart the bridge, then select this new session on the card. Existing sessions and bindings are preserved.');
} finally { rpc.close(); }

}
main().catch(() => { console.error("Agent session setup failed; existing config was preserved. Check Codex login and the private setup receipt."); process.exitCode = 1; });

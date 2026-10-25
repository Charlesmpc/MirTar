// Read-only dependency probe. Never resumes a thread or submits a turn.
// Usage: node tools/validation/codex-readonly.mjs [--thread UUID] [--proxy] [--check-test-session]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
if (args.some((arg, i) => !['--thread', '--proxy', '--check-test-session'].includes(arg) && args[i - 1] !== '--thread')) {
  throw new Error('Only --thread UUID, --proxy and --check-test-session are supported');
}
const threadId = args.includes('--thread') ? args[args.indexOf('--thread') + 1] : undefined;
if (args.includes('--thread') && !threadId) throw new Error('--thread requires a UUID');
if (threadId && !/^[0-9a-f-]{36}$/i.test(threadId)) throw new Error('Invalid thread UUID');
if (args.includes('--check-test-session') && !threadId) throw new Error('Test-session read requires --thread');
let isTestSession = false;
const transport = args.includes('--proxy') ? 'desktop-control-proxy' : 'separate-stdio-process';
const child = spawn(process.env.MIRTAR_CODEX_BIN || 'codex',
  transport === 'desktop-control-proxy' ? ['app-server', 'proxy'] : ['app-server', '--listen', 'stdio://'],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const pending = new Map();
const events = new Map();
let sequence = 0;
let stderrBytes = 0;
child.stderr.on('data', bytes => { stderrBytes += bytes.length; });
child.on('error', error => {
  for (const { reject } of pending.values()) reject(error);
});
child.on('exit', code => {
  for (const { reject } of pending.values()) reject(new Error(`Codex exited: ${code}`));
});
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id !== undefined && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
  } else if (message.id !== undefined && message.method) {
    // This probe cannot approve operations or provide credentials/attestation.
    child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Read-only probe' } }) + '\n');
  } else if (message.method) {
    events.set(message.method, (events.get(message.method) || 0) + 1);
  }
});
function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function check(name, fn) {
  try { console.log(JSON.stringify({ check: name, ok: true, result: await fn() })); }
  catch (error) {
    process.exitCode = 1;
    console.log(JSON.stringify({ check: name, ok: false, error: error.message.slice(0, 700) }));
  }
}
try {
  console.log(JSON.stringify({ transport, node: process.version, startedAt: new Date().toISOString() }));
  const init = await request('initialize', {
    clientInfo: { name: 'mirtar_validation', title: 'MirTar dependency validation', version: '0.0.1' },
    capabilities: { experimentalApi: true },
  });
  console.log(JSON.stringify({ check: 'initialize', ok: true, result: init }));
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  await check('account/read', async () => {
    const r = await request('account/read', { refreshToken: false });
    return { authenticated: !!r.account, type: r.account?.type, planType: r.account?.planType,
      requiresOpenaiAuth: r.requiresOpenaiAuth };
  });
  await check('thread/loaded/list', async () => {
    const r = await request('thread/loaded/list', { limit: 100 });
    return { count: r.data?.length, hasMore: !!r.nextCursor, containsRequestedThread: threadId ? r.data?.includes(threadId) : undefined };
  });
  if (threadId) await check('thread/read', async () => {
    const r = await request('thread/read', { threadId, includeTurns: false });
    isTestSession = r.thread?.name === 'MirTar 验证';
    return { matchesRequestedId: r.thread?.id === threadId, status: r.thread?.status,
      source: r.thread?.source, returnedTurns: r.thread?.turns?.length };
  });
  if (threadId) await check('thread/items/list', async () => {
    const r = await request('thread/items/list', { threadId, limit: 10, sortDirection: 'desc' });
    // Read one bounded page, report types only. Never print conversation text.
    return { count: r.data?.length, itemTypes: r.data?.map(entry => entry.item?.type), hasMore: !!r.nextCursor };
  });
  if (args.includes('--check-test-session')) await check('test-session/turns', async () => {
    if (!isTestSession) throw new Error('Full test output allowed only for MirTar 验证');
    const r = await request('thread/turns/list', { threadId, limit: 3, sortDirection: 'desc', itemsView: 'full' });
    return { turns: r.data.map(t => ({ id: t.id, status: t.status, completedAt: t.completedAt,
      commands: t.items.filter(i => i.type === 'commandExecution').map(i => ({ command: i.command, exitCode: i.exitCode, output: i.aggregatedOutput })),
      replies: t.items.filter(i => i.type === 'agentMessage' && i.phase === 'final_answer').map(i => i.text),
    })) };
  });
  await check('model/list', async () => {
    const r = await request('model/list', { limit: 100, includeHidden: true });
    return { models: r.data?.map(m => ({ id: m.id, inputModalities: m.inputModalities, isDefault: m.isDefault })), hasMore: !!r.nextCursor };
  });
  await check('experimentalFeature/list', async () => {
    const features = [];
    let cursor;
    const seen = new Set();
    do {
      const r = await request('experimentalFeature/list', { limit: 100, cursor });
      features.push(...r.data);
      cursor = r.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Feature cursor repeated');
      if (cursor) seen.add(cursor);
      if (seen.size > 20) throw new Error('Feature page safety limit reached');
    } while (cursor);
    return { count: features.length, voiceFeatures: features.filter(f => /voice|audio|realtime/i.test(f.name)).map(f => ({ name: f.name, enabled: f.enabled, stage: f.stage })), hasMore: false };
  });
  await check('thread/realtime/listVoices', async () => {
    const r = await request('thread/realtime/listVoices');
    return { responseKeys: Object.keys(r), voices: r.voices };
  });
} catch (error) {
  console.log(JSON.stringify({ check: 'connection', ok: false, error: error.message.slice(0, 700) }));
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({ events: Object.fromEntries(events), stderrBytes }));
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  lines.close();
  // Terminate only the child owned by this probe, never the desktop/daemon.
  child.stdin.end();
  child.kill();
}

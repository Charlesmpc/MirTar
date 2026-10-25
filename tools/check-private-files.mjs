// Inspect Git's index, including forcibly added files; never print credential values.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const templates = new Set(['config/device.example.json', 'config/bridge.example.json']);
const placeholder = value => typeof value === 'string' &&
  (value === 'FILL_LOCALLY' || value.startsWith('REPLACE_WITH_') || value.startsWith('SAME_LOCAL_'));

export function privatePath(path) {
  return /(^|\/)(\.private|secrets|build|dist|node_modules)(\/|$)/i.test(path) ||
    /(^|\/)\.env(?:\.|$)/i.test(path) && !path.endsWith('/.env.example') && path !== '.env.example' ||
    /\.(?:bin|elf|map|log|key|pem)$/i.test(path) ||
    /(^|\/)(?:device|bridge)(?:\.[^/]*)?\.config\.json$/i.test(path) ||
    /\.local\.json$/i.test(path) ||
    path.startsWith('config/') && !templates.has(path);
}

function valuesIn(object, visit) {
  if (!object || typeof object !== 'object') return;
  for (const [key, value] of Object.entries(object)) {
    if (/^(password|secret)$/i.test(key)) visit(value);
    else valuesIn(value, visit);
  }
}

export function inspectFile(path, content, localSecrets = []) {
  if (privatePath(path)) return 'private configuration or generated artifact';
  if (localSecrets.some(secret => content.includes(secret))) return 'contains a local credential';
  if (templates.has(path)) {
    let object;
    try { object = JSON.parse(content); } catch { return 'invalid configuration template'; }
    let invalid = false;
    valuesIn(object, value => { if (!placeholder(value)) invalid = true; });
    if (invalid) return 'configuration template contains a non-placeholder credential';
    if (path === 'config/device.example.json' && object.template !== true) return 'device template flag must stay true';
  } else if (path.endsWith('.json')) {
    try {
      const object = JSON.parse(content);
      let credential = false;
      valuesIn(object, value => { if (typeof value === 'string' && value && !placeholder(value)) credential = true; });
      if (credential) return 'JSON contains a non-placeholder password or secret';
    } catch { /* Non-JSON content is handled by the normal build checks. */ }
  }
  return null;
}

function git(...args) {
  return execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
}

function localCredentials(root) {
  const secrets = new Set();
  const directory = resolve(root, '.private');
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !/^(device|bridge)(\..*)?\.config\.json$/i.test(entry.name)) continue;
    const object = JSON.parse(readFileSync(resolve(directory, entry.name), 'utf8').replace(/^\uFEFF/, ''));
    valuesIn(object, value => { if (typeof value === 'string' && value && !placeholder(value)) secrets.add(value); });
  }
  return [...secrets];
}

export function checkIndex() {
  const root = git('rev-parse', '--show-toplevel').toString().trim();
  process.chdir(root);
  const secrets = localCredentials(root);
  const entries = git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean);
  let failures = 0;
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    let reason = privatePath(path) ? 'private configuration or generated artifact' : null;
    if (!reason && stage !== '0') reason = 'unresolved merge entry';
    if (!reason && mode === '160000') reason = 'embedded Git repository requires explicit review';
    if (!reason) reason = inspectFile(path, git('cat-file', 'blob', oid).toString('utf8'), secrets);
    if (reason) { console.error(`Blocked: ${JSON.stringify(path)} (${reason})`); failures++; }
  }
  if (failures) throw Error(`Private-file check failed for ${failures} indexed file(s). Remove them from the index; keep real configuration in .private/.`);
  console.log(`Private-file check passed (${entries.length} indexed files; credential values hidden).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { checkIndex(); } catch { console.error('Private-file check failed. No credential values were printed.'); process.exitCode = 1; }
}

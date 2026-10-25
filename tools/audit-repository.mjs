// Read-only Git/content audit. Private values are loaded in memory, never printed.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { inspectFile, privatePath } from './check-private-files.mjs';

const project = resolve(import.meta.dirname, '..');
const [repository = project, tree = 'index', report = resolve(project, '.private/privacy-audit.json')] = process.argv.slice(2);
const git = (args, input) => execFileSync('git', ['-C', repository, ...args], { input, maxBuffer: 192 * 1024 * 1024 });
const credentials = new Set(), personal = new Set();
function addCredential(value) {
  if (typeof value !== 'string' || !value || /^(FILL_LOCALLY|REPLACE_WITH_|SAME_LOCAL_)/.test(value)) return;
  credentials.add(value); credentials.add(JSON.stringify(value).slice(1, -1));
  credentials.add(encodeURIComponent(value)); credentials.add(Buffer.from(value).toString('base64'));
}
function collect(value, key = '') {
  if (!value || typeof value !== 'object') return;
  for (const [name, item] of Object.entries(value)) {
    if (/^(password|secret)$/i.test(name)) addCredential(item);
    else if (/^(ssid|hostName|bluetoothName)$/i.test(name) && typeof item === 'string' && item.length > 2) personal.add(item);
    else if ((name === 'host' || name === 'url') && typeof item === 'string') {
      const ip = item.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
      if (ip && !ip.startsWith('127.')) personal.add(ip);
    } else if (name === 'id' && key === 'sessions' && typeof item === 'string') personal.add(item);
    else if (name === 'name' && key === 'targets' && typeof item === 'string' && item.length > 2) personal.add(item);
    if (item && typeof item === 'object') {
      if (Array.isArray(item)) for (const element of item) collect(element, name);
      else collect(item, name);
    }
  }
}
try {
  for (const name of readdirSync(resolve(project, '.private'))) {
    if (!/^(device|bridge)(\..*)?\.config\.json$/i.test(name)) continue;
    const value = JSON.parse(readFileSync(resolve(project, '.private', name), 'utf8').replace(/^\uFEFF/, ''));
    if (!value.template) collect(value);
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const tokenPatterns = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255})\b/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['openai_token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,255}\b/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/],
  ['google_api_key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}\b/],
  ['credential_url', /https?:\/\/[^\s/:]+:[^\s/@]+@/],
];
const privateFindings = [], personalFindings = [];
function scan(data, path, where, oid, validate = false) {
  const content = data.toString('utf8');
  const context = { where, path, object: oid };
  if ([...credentials].some(value => data.includes(Buffer.from(value)) || data.includes(Buffer.from(value, 'utf16le'))))
    privateFindings.push({ ...context, rule: 'known_local_credential' });
  for (const [rule, pattern] of tokenPatterns) if (pattern.test(content)) privateFindings.push({ ...context, rule });
  if (validate) {
    const reason = inspectFile(path, content);
    if (reason) privateFindings.push({ ...context, rule: reason });
  }
  if (/[A-Za-z]:\\{1,2}Users\\{1,2}(?!Public(?:\\|\b)|Default(?:\\|\b)|<)[^\\\s]+/i.test(content))
    personalFindings.push({ ...context, rule: 'personal_windows_path' });
  const emails = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (emails.some(email => !/@(?:users\.noreply\.github\.com|example\.(?:com|org|net))$/i.test(email)))
    personalFindings.push({ ...context, rule: 'email_address' });
  if ([...personal].some(value => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?<![A-Za-z0-9_-])' + escaped + '(?![A-Za-z0-9_-])', 'i').test(content);
  })) personalFindings.push({ ...context, rule: 'known_local_identifier' });
}
const current = [];
const entries = git(tree === 'index' ? ['ls-files', '--stage', '-z'] : ['ls-tree', '-r', '-z', tree]).toString().split('\0').filter(Boolean);
for (const entry of entries) {
  const tab = entry.indexOf('\t'), parts = entry.slice(0, tab).split(' '), path = entry.slice(tab + 1);
  const oid = tree === 'index' ? parts[1] : parts[2];
  if (parts[0] === '160000' || tree === 'index' && parts[2] !== '0') throw Error('unsupported_git_entry');
  current.push({ oid, path });
}
const historical = new Map();
for (const line of git(['rev-list', '--objects', '--all']).toString().split('\n').filter(Boolean)) {
  const space = line.indexOf(' '); historical.set(space < 0 ? line : line.slice(0, space), space < 0 ? '(metadata)' : line.slice(space + 1));
}
const ids = [...new Set([...historical.keys(), ...current.map(file => file.oid)])];
const raw = git(['cat-file', '--batch'], ids.join('\n') + '\n'), objects = new Map();
let cursor = 0;
while (cursor < raw.length) {
  const newline = raw.indexOf(10, cursor);
  const [oid, type, size] = raw.subarray(cursor, newline).toString().split(' ');
  const count = Number(size); if (!Number.isSafeInteger(count)) throw Error('invalid_git_object');
  objects.set(oid, { type, data: raw.subarray(newline + 1, newline + 1 + count) }); cursor = newline + 2 + count;
}
for (const { oid, path } of current) scan(objects.get(oid).data, path, 'current', oid, true);
let blobs = 0, metadata = 0;
for (const [oid, path] of historical) {
  const { type, data } = objects.get(oid);
  if (type === 'blob') {
    blobs++; if (privatePath(path)) privateFindings.push({ where: 'history', path, object: oid, rule: 'private_generated_path' });
    scan(data, path, 'history', oid, true);
  } else if (type === 'commit' || type === 'tag') { metadata++; scan(data, '(metadata)', 'metadata', oid); }
}
const currentPersonal = personalFindings.filter(f => f.where === 'current');
const result = { tree, files: current.length, historicalBlobs: blobs, metadataObjects: metadata,
  credentialFindings: privateFindings, personalFindings,
  credentialsClean: !privateFindings.length, currentTreePrivateInfoClean: !currentPersonal.length,
  historyPrivateInfoClean: !personalFindings.some(f => f.where !== 'current'),
  readyToMakePublic: !privateFindings.length && !personalFindings.length };
mkdirSync(dirname(resolve(report)), { recursive: true });
writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, credentialFindings: privateFindings.length, personalFindings: personalFindings.length,
  currentPersonalFindings: currentPersonal.length }));
if (privateFindings.length) process.exitCode = 1;

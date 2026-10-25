import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const page = readFileSync(new URL('../firmware/main/portal.html', import.meta.url), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
async function client(status = { csrf: 'f'.repeat(32), phase: 'ready', targets: 0 }) {
  const elements = new Map(), calls = [], timers = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', files: [], checked: false, disabled: false, open: false,
      addEventListener(type, fn) { this[type] = fn; } });
    return elements.get(id);
  };
  vm.runInNewContext(script, { document: { getElementById: element }, TextEncoder,
    setTimeout: fn => timers.push(fn),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/status') return { ok: true, json: async () => status };
      return { ok: true, json: async () => ({ accepted: true }) };
    } });
  await new Promise(setImmediate);
  return { element, calls, timers, async submit() { await element('setup').submit({ preventDefault() {} }); } };
}
test('portal starts disabled until local status arrives and guides an unconfigured card', async () => {
  const c = await client(); assert.equal(c.element('save').disabled, false); assert.equal(c.element('computer').open, true);
  assert.match(c.element('status').textContent, /尚未配置电脑/); assert.equal(c.calls[0].url, '/api/status');
});
test('portal sends imported config and network only in the CSRF-protected JSON body', async () => {
  const c = await client(); c.element('ssid').value = 'LabNetwork'; c.element('password').value = 'test-pass-1'; c.element('replace').checked = true;
  c.element('config').files = [{ size: 100, text: async () => JSON.stringify({ version: 1, deviceId: 'demo-card' }) }];
  await c.submit(); const post = c.calls.find(call => call.options?.method === 'POST');
  assert.equal(post.url, '/api/config'); assert.equal(post.options.headers['X-MirTar-Setup'], 'f'.repeat(32));
  const payload = JSON.parse(post.options.body); assert.equal(payload.wifi.ssid, 'LabNetwork');
  assert.equal(payload.replaceNetworks, true); assert.equal(payload.deviceConfig.deviceId, 'demo-card');
  assert.doesNotMatch(c.element('status').textContent, /test-pass-1/);
});
test('multibyte SSID byte limit is checked before transmitting', async () => {
  const c = await client(); c.element('ssid').value = '网'.repeat(11); c.element('password').value = 'test-pass-1';
  await c.submit(); assert.equal(c.calls.length, 1); assert.match(c.element('status').textContent, /32/);
});
test('oversize imported config is rejected locally', async () => {
  const c = await client(); c.element('ssid').value = 'LabNetwork'; c.element('password').value = 'test-pass-1';
  c.element('config').files = [{ size: 4097, text: async () => '{}' }];
  await c.submit(); assert.equal(c.calls.length, 1); assert.match(c.element('status').textContent, /过大/);
});
test('connected response clears the password and stops polling', async () => {
  const c = await client({ csrf: 'f'.repeat(32), phase: 'connected', targets: 1 });
  assert.equal(c.timers.length, 0); assert.equal(c.element('save').disabled, true);
  assert.equal(c.element('password').value, ''); assert.match(c.element('status').textContent, /已连接/);
});
test('Bluetooth-only setup imports the local file without requiring a home Wi-Fi', async () => {
  const c = await client(); c.element('config').files = [{ size: 100, text: async () => '{"version":1}' }];
  await c.element('bluetooth').click();
  const post = c.calls.find(call => call.options?.method === 'POST'); assert.ok(post);
  assert.equal(JSON.parse(post.options.body).mode, 'bluetooth');
});
test('Bluetooth-only setup without a local config never transmits', async () => {
  const c = await client(); await c.element('bluetooth').click(); assert.equal(c.calls.length, 1);
  assert.match(c.element('status').textContent, /请选择电脑生成/);
});
test('Windows PowerShell UTF-8 BOM config imports correctly', async () => {
  const c = await client(); c.element('config').files = [{ size: 100, text: async () => '\uFEFF{"version":1}' }];
  await c.element('bluetooth').click(); assert.ok(c.calls.find(call => call.options?.method === 'POST'));
});

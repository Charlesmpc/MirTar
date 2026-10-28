import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BridgeConfig } from './contracts.ts';
import { CodexAdapter } from './codex/adapter.ts';
import { startBridge } from './server.ts';
import { WindowsMediaHost } from './host/windows.ts';
import { startWindowsBle } from './transport/windows-ble.ts';
import { networkInterfaces } from 'node:os';
import { createAgentSession } from './codex/session-setup.ts';
import { WORKSPACE_ERROR } from './codex/workspace.ts';
import { stat } from 'node:fs/promises';

const path = resolve(process.argv[2] || '.private/bridge.config.json');
let config = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as BridgeConfig;
const backendOverride = process.env.MIRTAR_CODEX_BIN;
if (backendOverride) {
  if (!(await stat(backendOverride)).isFile()) throw Error('Native Codex backend is unavailable');
  config = { ...config, codex: { ...config.codex, bin: backendOverride } };
}
if (config.bluetooth?.hostName && !/^[a-zA-Z0-9_-]{1,20}$/.test(config.bluetooth.hostName)) throw Error('Bluetooth hostName must be 1–20 ASCII letters, digits, underscore or hyphen');
if (!Array.isArray(config.codex?.sessions) || config.codex.sessions.length > 8 ||
    config.codex.sessions.some(s => !/^[a-f0-9-]{36}$/i.test(s.id) || !s.name || Buffer.byteLength(s.name) > 60 ||
      s.execution != null && !['desktop', 'bridge'].includes(s.execution))) throw Error('Configure up to 8 sessions with valid IDs and execution modes');
let setupError: string | undefined;
if (!config.codex.sessions.length) {
  try {
    const { CodexRpc } = await import('./codex/rpc.ts');
    config = await createAgentSession(path, { onlyIfEmpty: true }, backendOverride ? { rpc: () => new CodexRpc(backendOverride) } : {});
    if (backendOverride) config = { ...config, codex: { ...config.codex, bin: backendOverride } };
  }
  catch (error: any) {
    setupError = error.message === WORKSPACE_ERROR ? WORKSPACE_ERROR : 'session_setup_failed';
    console.error(setupError === WORKSPACE_ERROR
      ? 'Configure the bridge session default working directory: set codex.defaultWorkingDirectory to an existing writable folder, then restart.'
      : 'Agent session initialization failed. Check Codex login and the local session-setup receipt, then restart. Existing bindings were preserved.');
  }
}
const adapter = new CodexAdapter(config.codex, new WindowsMediaHost(config.codex.edgePath));
if (setupError) adapter.setSetupError(setupError);
try {
  try { await adapter.initialize(); } catch (error) { if (!setupError) throw error; }
  const bluetoothEnabled = config.bluetooth?.enabled !== false;
  // A laptop away from its original LAN must still start its Bluetooth bridge.
  const available = config.listen.host.startsWith('127.') || Object.values(networkInterfaces()).flat().some(a => a?.address === config.listen.host);
  const runtimeConfig = bluetoothEnabled && !available ? { ...config, listen: { ...config.listen, host: '127.0.0.1' } } : config;
  const bridge = await startBridge(runtimeConfig, adapter);
  const bluetooth = bluetoothEnabled ? startWindowsBle(config.bluetooth?.hostName, bridge.acceptPeer) : undefined;
  console.log('MirTar bridge ready:', JSON.stringify(bridge.address));
  console.log('Native sessions:', config.codex.sessions.length, '| Bluetooth:', bluetoothEnabled, '| TTS off');
  console.log('Bridge-owned sessions:', config.codex.sessions.filter(s => s.execution === 'bridge').length, '| Questions supported in bridge-owned sessions');
  console.log('Voice: live native stream | max 10 min | submit only after end and finalization');
  if (!available && bluetoothEnabled) console.log('Configured Wi-Fi IP is unavailable; listener uses loopback. Bluetooth is independent of the LAN.');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await bluetooth?.close(); await bridge.close(); process.exit(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  process.on('message', (message: any) => { if (message?.type === 'mirtar_shutdown') void stop(); });
  process.on('disconnect', () => { void stop(); });
  if (process.connected) process.send?.({ type: 'mirtar_ready', address: bridge.address }, undefined, undefined, () => {});
} catch (error: any) {
  await adapter.close();
  console.error(error.code === 'EADDRINUSE'
    ? 'Bridge port is already in use. Check the existing MirTar background service before starting another instance.'
    : 'Bridge could not start; check configuration, Codex login and port availability.');
  process.exitCode = 1;
}

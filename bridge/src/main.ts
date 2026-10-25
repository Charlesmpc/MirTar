import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BridgeConfig } from './contracts.ts';
import { CodexAdapter } from './codex/adapter.ts';
import { startBridge } from './server.ts';
import { WindowsMediaHost } from './host/windows.ts';
import { startWindowsBle } from './transport/windows-ble.ts';
import { networkInterfaces } from 'node:os';

const path = resolve(process.argv[2] || '.private/bridge.config.json');
const config = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as BridgeConfig;
if (config.bluetooth?.hostName && !/^[a-zA-Z0-9_-]{1,20}$/.test(config.bluetooth.hostName)) throw Error('Bluetooth hostName must be 1–20 ASCII letters, digits, underscore or hyphen');
if (!config.codex?.sessions?.length || config.codex.sessions.length > 8 ||
    config.codex.sessions.some(s => !/^[a-f0-9-]{36}$/i.test(s.id) || Buffer.byteLength(s.name) > 60)) throw Error('Configure 1–8 existing desktop sessions, with names at most 60 UTF-8 bytes');
const adapter = new CodexAdapter(config.codex, new WindowsMediaHost(config.codex.edgePath));
try {
  await adapter.initialize();
  const bluetoothEnabled = config.bluetooth?.enabled !== false;
  // A laptop away from its original LAN must still start its Bluetooth bridge.
  const available = config.listen.host.startsWith('127.') || Object.values(networkInterfaces()).flat().some(a => a?.address === config.listen.host);
  const runtimeConfig = bluetoothEnabled && !available ? { ...config, listen: { ...config.listen, host: '127.0.0.1' } } : config;
  const bridge = await startBridge(runtimeConfig, adapter);
  const bluetooth = bluetoothEnabled ? startWindowsBle(config.bluetooth?.hostName, bridge.acceptPeer) : undefined;
  console.log('MirTar bridge ready:', JSON.stringify(bridge.address));
  console.log('Native sessions:', config.codex.sessions.length, '| Bluetooth:', bluetoothEnabled, '| TTS off');
  if (!available && bluetoothEnabled) console.log('Configured Wi-Fi IP is unavailable; listener uses loopback. Bluetooth is independent of the LAN.');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await bluetooth?.close(); await bridge.close(); process.exit(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch { await adapter.close(); console.error('Bridge could not start; check configuration, Codex login and port availability.'); process.exitCode = 1; }

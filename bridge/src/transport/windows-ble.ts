import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import type { DevicePeer } from './peer.ts';
import { BleAssembler, fragmentBle } from './ble-framing.ts';

export function startWindowsBle(hostName: string | undefined, accept: (peer: DevicePeer) => void) {
  const name = hostName || hostname();
  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(name)) throw Error('invalid_bluetooth_host_name');
  const worker = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tools/Start-Bluetooth.ps1'), '-HostName', name],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
      // Node may inherit PS7's module path. Windows PowerShell needs its own
      // built-in modules (Get-FileHash, file operations), without changing globals.
      PSModulePath: resolve(process.env.WINDIR || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } });
  let peer: BlePeer | undefined, closed = false, writeId = 0;
  const writes = new Map<number, { resolve: () => void; reject: () => void; timer: NodeJS.Timeout }>();
  const send = (value: unknown) => { if (!closed && worker.stdin.writable) worker.stdin.write(JSON.stringify(value) + '\n'); };
  function discard() {
    peer?.finish(); peer = undefined;
    for (const pending of writes.values()) { clearTimeout(pending.timer); pending.reject(); }
    writes.clear();
  }
  async function write(packet: Buffer) {
    const id = ++writeId;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { writes.delete(id); reject(Error('ble_write_timeout')); }, 5000);
      writes.set(id, { resolve, reject: () => reject(Error('ble_closed')), timer });
      send({ type: 'write', id, data: packet.toString('base64') });
    });
  }
  class BlePeer extends EventEmitter implements DevicePeer {
    readyState = 1;
    bufferedAmount = 0;
    private sequence = 0;
    private queue = Promise.resolve();
    readonly assembler = new BleAssembler();
    valueSize: number;
    constructor(size: number) { super(); this.valueSize = Math.max(20, Math.min(size, 244)); }
    send(text: string) {
      const data = Buffer.from(text);
      if (this.readyState !== 1) return;
      this.bufferedAmount += data.length;
      if (this.bufferedAmount > 32768) { this.close(); return; }
      const packets = fragmentBle(data, false, this.sequence++, this.valueSize);
      this.queue = this.queue.then(async () => {
        for (const packet of packets) { if (this.readyState !== 1) return; await write(packet); }
      }).catch(() => this.close()).finally(() => { this.bufferedAmount -= data.length; });
    }
    finish() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
    close() { this.finish(); if (peer === this) send({ type: 'disconnect' }); }
    terminate() { this.close(); }
    ping() { send({ type: 'ping' }); }
  }
  const lines = createInterface({ input: worker.stdout });
  lines.on('line', line => {
    if (line.length > 16000) { discard(); send({ type: 'disconnect' }); return; }
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'connected') { discard(); peer = new BlePeer(Number(msg.valueSize) || 20); accept(peer); }
      else if (msg.type === 'mtu' && peer && Number.isInteger(msg.valueSize) && msg.valueSize >= 20 && msg.valueSize <= 244) peer.valueSize = msg.valueSize;
      else if (msg.type === 'disconnected') discard();
      else if (msg.type === 'written') {
        const pending = writes.get(msg.id); if (pending) { clearTimeout(pending.timer); writes.delete(msg.id); pending.resolve(); }
      } else if (msg.type === 'pong') peer?.emit('pong');
      else if (msg.type === 'packet' && peer?.readyState === 1) {
        const result = peer.assembler.append(Buffer.from(msg.data, 'base64'));
        if (result) peer.emit('message', result.data, result.binary);
      } else if (msg.type === 'status' && typeof msg.code === 'string' && /^[a-z0-9_]{1,160}$/.test(msg.code)) console.log('Bluetooth:', msg.code);
    } catch { peer?.close(); }
  });
  worker.stderr.on('data', () => console.error('Bluetooth helper unavailable; check Windows Bluetooth and run tools/Start-Bluetooth.ps1 -CompileOnly.'));
  worker.once('error', () => { closed = true; discard(); console.error('Bluetooth helper could not start.'); });
  worker.once('exit', () => { closed = true; discard(); });
  return { async close() {
    closed = true; discard(); worker.stdin.end();
    if (worker.exitCode !== null || !worker.pid) return;
    await new Promise<void>(done => {
      const timer = setTimeout(() => {
        // Only this bridge's helper process tree, including its native child.
        const kill = spawn('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        kill.once('exit', () => done()); kill.once('error', () => done());
      }, 3000);
      worker.once('exit', () => { clearTimeout(timer); done(); });
    });
  } };
}

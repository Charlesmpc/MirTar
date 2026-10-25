import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class CodexRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;
  constructor(bin: string) {
    super();
    this.child = spawn(bin, ['app-server', '--listen', 'stdio://'], { windowsHide: true });
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(Error('codex_disconnected')));
    this.child.stdin.on('error', error => this.fail(error));
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
      else if (m.id !== undefined && m.method) {
        // The desktop owns approvals. A bridge must never grant them.
        this.child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: 'Handle this request on the Codex desktop' } }) + '\n');
      } else if (m.method) this.emit('notification', m.method, m.params);
    });
  }
  private fail(error: Error) {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('unavailable');
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'mirtar_bridge', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  }
  request(method: string, params: unknown = {}, timeoutMs = 20000): Promise<any> {
    if (this.closed) return Promise.reject(Error('codex_disconnected'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('codex_timeout')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  close() { this.fail(Error('bridge_closed')); this.child.stdin.end(); this.child.kill(); }
}

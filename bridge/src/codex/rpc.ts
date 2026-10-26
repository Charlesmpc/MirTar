import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class CodexRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { method: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;
  private incoming = new Set<string | number>();
  constructor(bin: string, runtime?: { child: ChildProcessWithoutNullStreams }) {
    super();
    this.child = runtime?.child ?? spawn(bin, ['app-server', '--listen', 'stdio://'], { windowsHide: true });
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(Error('codex_disconnected')));
    this.child.stdin.on('error', error => this.fail(error));
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      // Request IDs are independent in each direction. Classify method FIRST.
      if (m.method && m.id !== undefined) {
        if ((typeof m.id !== 'string' && typeof m.id !== 'number') || this.incoming.has(m.id) || this.incoming.size >= 32) { this.close(); return; }
        this.incoming.add(m.id);
        if (this.listenerCount('request')) this.emit('request', { id: m.id, method: m.method, params: m.params });
        else void this.rejectRequest(m.id).catch(() => {});
      } else if (m.method) {
        if (m.method === 'serverRequest/resolved') this.incoming.delete(m.params?.requestId);
        this.emit('notification', m.method, m.params);
      } else {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id); clearTimeout(p.timer);
          if (m.error) { this.emit('rpc-diagnostic', { method: p.method, error: m.error }); p.reject(Error('codex_rpc_error')); }
          else p.resolve(m.result);
        }
      }
    });
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.incoming.clear(); this.emit('unavailable');
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'mirtar_bridge', version: '0.5.4' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  }
  private writeResponse(id: string | number, payload: unknown): Promise<void> {
    if (this.closed || !this.incoming.delete(id)) return Promise.reject(Error('question_expired'));
    return new Promise((resolve, reject) => {
      this.child.stdin.write(JSON.stringify({ id, ...payload as object }) + '\n', error => error ? reject(Error('submission_unknown')) : resolve());
    });
  }
  respond(id: string | number, result: unknown) { return this.writeResponse(id, { result }); }
  rejectRequest(id: string | number) { return this.writeResponse(id, { error: { code: -32601, message: 'This client does not handle this request' } }); }
  request(method: string, params: unknown = {}, timeoutMs = 20000): Promise<any> {
    if (this.closed) return Promise.reject(Error('codex_disconnected'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('codex_timeout')); }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  close() { this.fail(Error('bridge_closed')); this.child.stdin.end(); this.child.kill(); }
}

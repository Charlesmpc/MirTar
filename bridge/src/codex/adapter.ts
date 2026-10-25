import { CodexRpc } from './rpc.ts';
import { transcribeNative } from './voice.ts';
import type { AgentAdapter, BridgeConfig, Reply, Session } from '../contracts.ts';
import type { MediaHost } from '../host/contracts.ts';

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  private rpc: CodexRpc;
  private config: BridgeConfig['codex'];
  private voiceBusy = false;
  private mediaHost: MediaHost;
  private submitted = new Map<string, { sessionId: string; text: string }>();
  constructor(config: BridgeConfig['codex'], mediaHost: MediaHost) { this.config = config; this.mediaHost = mediaHost; this.rpc = new CodexRpc(config.bin); }
  async initialize() { await this.rpc.initialize(); }
  private allowed(id: string) { if (!this.config.sessions.some(s => s.id === id)) throw Error('session_not_allowed'); }
  async sessions(): Promise<Session[]> {
    const result: Session[] = [];
    for (const entry of this.config.sessions) {
      try { const r = await this.rpc.request('thread/read', { threadId: entry.id, includeTurns: false }); if (r.thread?.id === entry.id) result.push(entry); }
      catch { /* Unavailable configured sessions are not silently replaced. */ }
    }
    return result;
  }
  async history(sessionId: string): Promise<Reply[]> {
    this.allowed(sessionId);
    const page = await this.rpc.request('thread/turns/list', { threadId: sessionId, limit: 4, sortDirection: 'desc', itemsView: 'full' });
    return page.data.filter((turn: any) => turn.status === 'completed' && turn.completedAt != null).map((turn: any) => {
      const user = turn.items.find((item: any) => item.type === 'userMessage');
      const text = user?.content?.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n').trim();
      const matched = [...this.submitted].reverse().find(([_id, entry]) => entry.sessionId === sessionId && entry.text === text)?.[0];
      return { turnId: turn.id, completed: true, inputId: this.submitted.has(user?.clientId) ? user.clientId : matched,
        text: turn.items.filter((item: any) => item.type === 'agentMessage' && item.phase === 'final_answer').map((item: any) => item.text).join('\n\n') };
    }).filter((reply: Reply) => reply.text.length > 0).reverse();
  }
  async submitAudio(sessionId: string, pcm: Buffer, inputId: string, signal: AbortSignal, progress: (state: string) => void) {
    this.allowed(sessionId); if (this.voiceBusy) throw Error('bridge_busy'); this.voiceBusy = true;
    try {
      progress('recognizing');
      const text = await transcribeNative(this.config.bin, this.mediaHost, pcm, signal);
      signal.throwIfAborted(); progress('submitting');
      if (this.submitted.size >= 32) this.submitted.delete(this.submitted.keys().next().value!);
      this.submitted.set(inputId, { sessionId, text });
      // Queue belongs to Codex and retains the desktop's original thread writer.
      // Once this call starts, a connection loss cannot prove non-acceptance.
      let result;
      try { result = await this.rpc.request('thread/queue/add', { threadId: sessionId, clientUserMessageId: inputId, input: [{ type: 'text', text }] }); }
      catch { throw Error('submission_unknown'); }
      if (!result.queuedSubmission?.id) throw Error('submission_unknown');
      return { submissionId: result.queuedSubmission.id as string };
    } finally { this.voiceBusy = false; }
  }
  async close() { this.rpc.close(); }
}

import { CodexRpc } from './rpc.ts';
import { transcribeNative, drainVoiceCleanup } from './voice.ts';
import { PcmStream } from '../audio-stream.ts';
import type { AgentAdapter, BridgeConfig, Reply, Session } from '../contracts.ts';
import type { MediaHost } from '../host/contracts.ts';

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  private rpc: Pick<CodexRpc, 'initialize' | 'request' | 'close'>;
  private config: BridgeConfig['codex'];
  private voiceBusy = false;
  private voiceController?: AbortController;
  private voiceTask?: Promise<string>;
  private mediaHost: MediaHost;
  private transcribe: typeof transcribeNative;
  private submitted = new Map<string, { sessionId: string; text: string }>();
  constructor(config: BridgeConfig['codex'], mediaHost: MediaHost,
    runtime?: { rpc: Pick<CodexRpc, 'initialize' | 'request' | 'close'>; transcribe: typeof transcribeNative }) {
    this.config = config; this.mediaHost = mediaHost;
    this.rpc = runtime?.rpc ?? new CodexRpc(config.bin); this.transcribe = runtime?.transcribe ?? transcribeNative;
  }
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
  beginAudio(sessionId: string, signal: AbortSignal, onFailure: (error: unknown) => void = () => {}) {
    this.allowed(sessionId); signal.throwIfAborted();
    if (this.voiceBusy) throw Error('bridge_busy'); this.voiceBusy = true;
    const input = new PcmStream(), controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    this.voiceController = controller;
    const transcript = this.transcribe(this.config.bin, this.mediaHost, input, controller.signal).finally(() => {
      signal.removeEventListener('abort', abort); this.voiceBusy = false;
      if (this.voiceController === controller) { this.voiceController = undefined; this.voiceTask = undefined; }
    });
    this.voiceTask = transcript; transcript.catch(onFailure);
    let committed = false;
    return {
      append(pcm: Buffer) { input.append(pcm); },
      commit: async (inputId: string, progress: (state: string) => void) => {
        signal.throwIfAborted();
        if (committed) throw Error('audio_closed'); committed = true;
        input.end(); progress('recognizing');
        const text = await transcript;
        signal.throwIfAborted(); progress('submitting');
        if (this.submitted.size >= 32) this.submitted.delete(this.submitted.keys().next().value!);
        this.submitted.set(inputId, { sessionId, text });
        // Exactly one queue mutation, after explicit commit and confirmed native
        // session.closed. The desktop remains the original thread writer.
        let result;
        try { result = await this.rpc.request('thread/queue/add', { threadId: sessionId, clientUserMessageId: inputId, input: [{ type: 'text', text }] }); }
        catch { throw Error('submission_unknown'); }
        if (!result.queuedSubmission?.id) throw Error('submission_unknown');
        return { submissionId: result.queuedSubmission.id as string };
      },
    };
  }
  async close() { this.voiceController?.abort(); await this.voiceTask?.catch(() => {}); await drainVoiceCleanup(); this.rpc.close(); }
}

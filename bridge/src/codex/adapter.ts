import { CodexRpc } from './rpc.ts';
import { transcribeNative, drainVoiceCleanup } from './voice.ts';
import { PcmStream } from '../audio-stream.ts';
import type { AgentAdapter, AgentActivity, AnswerTarget, BridgeConfig, Reply, Session } from '../contracts.ts';
import type { MediaHost } from '../host/contracts.ts';
import { QuestionStore } from './questions.ts';
import { checkWorkspace } from './workspace.ts';

type Rpc = Pick<CodexRpc, 'initialize' | 'request' | 'close'> & Partial<Pick<CodexRpc, 'respond' | 'rejectRequest'>> & {
  on?(event: string, listener: (...args: any[]) => void): unknown;
};

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  private rpc: Rpc;
  private config: BridgeConfig['codex'];
  private voiceBusy = false;
  private voiceController?: AbortController;
  private voiceTask?: Promise<string>;
  private mediaHost: MediaHost;
  private transcribe: typeof transcribeNative;
  private submitted = new Map<string, { sessionId: string; text: string; turnId?: string }>();
  private owned = new Map<string, Promise<void>>();
  private starting = new Map<string, string>();
  private activities = new Map<string, AgentActivity>();
  private questions: QuestionStore;
  private setupFailure?: string;
  constructor(config: BridgeConfig['codex'], mediaHost: MediaHost,
    runtime?: { rpc: Rpc; transcribe: typeof transcribeNative }) {
    this.config = config; this.mediaHost = mediaHost;
    this.rpc = runtime?.rpc ?? new CodexRpc(config.bin); this.transcribe = runtime?.transcribe ?? transcribeNative;
    this.questions = new QuestionStore(async (id, result) => {
      if (!this.rpc.respond) throw Error('questions_unavailable'); await this.rpc.respond(id, result);
    });
    this.rpc.on?.('request', (r: any) => {
      const p = r.params, entry = this.config.sessions.find(s => s.id === p?.threadId && s.execution === 'bridge');
      const active = entry && this.activities.get(entry.id);
      try {
        if (!entry || !this.owned.has(entry.id) || !active || active.state !== 'running' || active.turnId !== p.turnId) throw Error('unowned_request');
        if (r.method === 'item/tool/requestUserInput') this.questions.accept(r.id, 'native', p);
        else if (r.method === 'item/tool/call' && p.tool === 'mirtar_ask_user' && !p.namespace) this.questions.accept(r.id, 'dynamic', p);
        else throw Error('unsupported_request');
      } catch { void this.rpc.rejectRequest?.(r.id).catch(() => {}); }
    });
    this.rpc.on?.('notification', (method: string, p: any) => {
      if (!this.config.sessions.some(s => s.id === p?.threadId && s.execution === 'bridge')) return;
      if (method === 'turn/started' && this.starting.has(p.threadId))
        this.activities.set(p.threadId, { turnId: p.turn.id, inputId: this.starting.get(p.threadId), state: 'running' });
      if (method === 'turn/completed') {
        const old = this.activities.get(p.threadId);
        if (!old || old.turnId !== p.turn.id) return;
        this.activities.set(p.threadId, { turnId: p.turn.id, inputId: old && old.turnId === p.turn.id ? old.inputId : undefined,
          state: ['failed', 'interrupted'].includes(p.turn.status) ? p.turn.status : 'completed' });
        this.questions.clear(p.threadId, p.turn.id);
      }
      if (method === 'serverRequest/resolved') this.questions.resolved(p.threadId, p.requestId);
      if (method === 'item/completed') this.questions.completedItem(p.threadId, p.item?.id, p.turnId);
    });
    this.rpc.on?.('unavailable', () => {
      this.questions.clear(); this.owned.clear();
      for (const activity of this.activities.values()) if (activity.state === 'running') activity.state = 'interrupted';
    });
  }
  async initialize() { await this.rpc.initialize(); }
  setupError() { return this.setupFailure; }
  setSetupError(code: string) { this.setupFailure = code; }
  private allowed(id: string) { if (!this.config.sessions.some(s => s.id === id)) throw Error('session_not_allowed'); }
  async activateSession(id: string) {
    this.allowed(id); const entry = this.config.sessions.find(s => s.id === id)!;
    if (entry.execution !== 'bridge') return;
    await checkWorkspace(entry.cwd ?? '');
    if (!this.owned.has(id)) {
      const ready = (async () => {
        const loaded = await this.rpc.request('thread/loaded/list', { limit: 100 });
        if (loaded.data?.includes(id)) return;
        const r = await this.rpc.request('thread/resume', { threadId: id, excludeTurns: true, sandbox: 'workspace-write', approvalPolicy: 'on-request', ...(entry.cwd ? { cwd: entry.cwd } : {}) });
        if (r.thread?.id !== id) throw Error('session_unavailable');
      })();
      this.owned.set(id, ready); ready.catch(() => { if (this.owned.get(id) === ready) this.owned.delete(id); });
    }
    await this.owned.get(id);
  }
  question(id: string) { this.allowed(id); return this.questions.current(id); }
  activity(id: string) { this.allowed(id); const value = this.activities.get(id); return value && { ...value }; }
  async answer(id: string, target: AnswerTarget, action: { option: number } | { skip: true }, signal: AbortSignal) {
    this.allowed(id); return this.questions.answer(id, target, action, signal);
  }
  async sessions(): Promise<Session[]> {
    const result: Session[] = [];
    for (const entry of this.config.sessions) {
      try { const r = await this.rpc.request('thread/read', { threadId: entry.id, includeTurns: false }); if (r.thread?.id === entry.id) result.push({ id: entry.id, name: entry.name }); }
      catch { /* Unavailable configured sessions are not silently replaced. */ }
    }
    return result;
  }
  async history(sessionId: string): Promise<Reply[]> {
    this.allowed(sessionId);
    const page = await this.rpc.request('thread/turns/list', { threadId: sessionId, limit: 4, sortDirection: 'desc', itemsView: 'full' });
    const managed = this.config.sessions.find(s => s.id === sessionId)?.execution === 'bridge';
    return page.data.filter((turn: any) => turn.status === 'completed' && (managed || turn.completedAt != null)).map((turn: any) => {
      const user = turn.items.find((item: any) => item.type === 'userMessage');
      const text = user?.content?.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n').trim();
        const matched = [...this.submitted].reverse().find(([_id, entry]) => entry.sessionId === sessionId && (entry.turnId === turn.id || entry.text === text))?.[0];
      return { turnId: turn.id, completed: true, inputId: this.submitted.has(user?.clientId) ? user.clientId : matched,
        text: turn.items.filter((item: any) => item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase == null)).map((item: any) => item.text).join('\n\n') };
    }).filter((reply: Reply) => reply.text.length > 0).reverse();
  }
  beginAudio(sessionId: string, signal: AbortSignal, onFailure: (error: unknown) => void = () => {}) {
    if (this.questions.current(sessionId) || this.activities.get(sessionId)?.state === 'running' || this.starting.has(sessionId)) throw Error('busy');
    return this.capture(sessionId, signal, onFailure, (text, id) => this.submitText(sessionId, text, id, signal));
  }
  beginAnswerAudio(sessionId: string, target: AnswerTarget, signal: AbortSignal, onFailure: (error: unknown) => void = () => {}) {
    this.allowed(sessionId); this.questions.require(sessionId, target);
    return this.capture(sessionId, signal, onFailure, text => this.questions.answer(sessionId, target, { text }, signal));
  }
  async submitText(sessionId: string, text: string, inputId: string, signal: AbortSignal) {
    this.allowed(sessionId); signal.throwIfAborted();
    if (this.submitted.size >= 32) this.submitted.delete(this.submitted.keys().next().value!);
    const entry = this.config.sessions.find(s => s.id === sessionId)!;
    if (entry.execution === 'bridge') {
      await this.activateSession(sessionId); signal.throwIfAborted();
      if (this.activities.get(sessionId)?.state === 'running' || this.questions.current(sessionId) || this.starting.has(sessionId)) throw Error('busy');
      this.submitted.set(inputId, { sessionId, text }); this.starting.set(sessionId, inputId);
      try {
        const result = await this.rpc.request('turn/start', { threadId: sessionId, clientUserMessageId: inputId, input: [{ type: 'text', text }] });
        if (!result.turn?.id) throw Error('submission_unknown');
        this.submitted.get(inputId)!.turnId = result.turn.id;
        const old = this.activities.get(sessionId);
        if (!old || old.turnId !== result.turn.id) this.activities.set(sessionId, { turnId: result.turn.id, inputId, state: 'running' });
        return { submissionId: result.turn.id as string };
      } catch { throw Error('submission_unknown'); }
      finally { this.starting.delete(sessionId); }
    }
    this.submitted.set(inputId, { sessionId, text });
    try {
      const result = await this.rpc.request('thread/queue/add', { threadId: sessionId, clientUserMessageId: inputId, input: [{ type: 'text', text }] });
      if (!result.queuedSubmission?.id) throw Error('submission_unknown'); return { submissionId: result.queuedSubmission.id as string };
    } catch { throw Error('submission_unknown'); }
  }
  private capture(sessionId: string, signal: AbortSignal, onFailure: (error: unknown) => void,
    submit: (text: string, id: string) => Promise<{ submissionId: string }>) {
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
        return submit(text, inputId);
      },
    };
  }
  async close() { this.voiceController?.abort(); await this.voiceTask?.catch(() => {}); await drainVoiceCleanup(); this.rpc.close(); }
}

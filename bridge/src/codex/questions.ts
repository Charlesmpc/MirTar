import { randomUUID } from 'node:crypto';
import type { AgentQuestion, AnswerTarget } from '../contracts.ts';

export const ASK_INSTRUCTIONS = 'When you need clarification from the user, call mirtar_ask_user and wait for their answer. The user uses a small card, not the computer keyboard. Ask concise questions. Never collect passwords, keys or other secrets through voice. Do not use this tool to bypass permission or execution approvals.';
export const ASK_TOOL = { name: 'mirtar_ask_user', description: 'Ask the human on their MirTar card for clarification, then wait for answers. This is not an execution approval tool.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['questions'], properties: {
    questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false,
      required: ['id', 'question'], properties: { id: { type: 'string' }, header: { type: 'string' }, question: { type: 'string' },
        isSecret: { type: 'boolean' }, options: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false,
          required: ['label', 'description'], properties: { label: { type: 'string' }, description: { type: 'string' } } } } } } } } } };

type NativeQuestion = { id: string; header?: string; question: string; isSecret?: boolean; options?: { label: string; description: string }[] | null };
type Entry = { id: string; rpcId: string | number; sessionId: string; turnId: string; itemId: string;
  kind: 'native' | 'dynamic'; questions: NativeQuestion[]; index: number; answers: Map<string, { answers: string[] }>;
  state: 'pending' | 'responding' | 'unknown' };
const fits = (v: unknown, size: number, empty = false): v is string => typeof v === 'string' && (empty || v.trim().length > 0) && !v.includes('\0') && Buffer.byteLength(v) <= size;

export class QuestionStore {
  private entries = new Map<string, Entry>();
  private respond: (id: string | number, result: unknown) => Promise<void>;
  constructor(respond: (id: string | number, result: unknown) => Promise<void>) { this.respond = respond; }
  accept(rpcId: string | number, kind: Entry['kind'], p: any) {
    const questions = kind === 'native' ? p?.questions : p?.arguments?.questions;
    if (!fits(p?.threadId, 64) || !fits(p?.turnId, 128) || !fits(kind === 'native' ? p?.itemId : p?.callId, 256) ||
      !Array.isArray(questions) || !questions.length || questions.length > 3 || this.entries.size >= 32 ||
      [...this.entries.values()].filter(e => e.sessionId === p.threadId).length >= 4) throw Error('unsupported_question');
    const ids = new Set<string>();
    for (const q of questions) {
      if (!fits(q?.id, 256) || ids.has(q.id) || !fits(q.question, 2048) || q.header != null && !fits(q.header, 64, true) ||
        q.isSecret != null && typeof q.isSecret !== 'boolean' ||
        q.options != null && (!Array.isArray(q.options) || q.options.length > 4 || q.options.some((o: any) => !fits(o?.label, 96) || !fits(o.description, 192, true)))) throw Error('unsupported_question');
      ids.add(q.id);
    }
    const id = randomUUID();
    this.entries.set(id, { id, rpcId, sessionId: p.threadId, turnId: p.turnId, itemId: kind === 'native' ? p.itemId : p.callId,
      kind, questions: structuredClone(questions), index: 0, answers: new Map(), state: 'pending' });
  }
  current(sessionId: string): AgentQuestion | undefined {
    const e = [...this.entries.values()].find(e => e.sessionId === sessionId); if (!e) return;
    const q = e.questions[e.index], blocked = q.isSecret === true;
    return { interactionId: e.id, questionId: 'q' + e.index, sessionId, turnId: e.turnId,
      index: e.index + 1, count: e.questions.length, header: blocked ? '需要安全输入' : q.header || '需要你的回答',
      text: blocked ? '此问题需要安全输入，卡片不收集答案。可跳过这组问题。' : q.question,
      options: blocked ? [] : structuredClone(q.options || []), status: blocked && e.state === 'pending' ? 'blocked' : e.state };
  }
  require(sessionId: string, target: AnswerTarget, allowBlocked = false): Entry {
    const e = this.entries.get(target.interactionId), current = this.current(sessionId);
    if (!e || e.sessionId !== sessionId || e.state !== 'pending' || current?.interactionId !== e.id || current.questionId !== target.questionId) throw Error('question_expired');
    if (!allowBlocked && e.questions[e.index].isSecret) throw Error('secret_input_required');
    return e;
  }
  async answer(sessionId: string, target: AnswerTarget, action: { text: string } | { option: number } | { skip: true }, signal: AbortSignal) {
    signal.throwIfAborted(); const e = this.require(sessionId, target, 'skip' in action), q = e.questions[e.index];
    const receipt = { submissionId: e.id + ':' + target.questionId };
    if ('skip' in action) {
      for (const question of e.questions) if (!e.answers.has(question.id)) e.answers.set(question.id, { answers: [] });
    } else {
      const text = 'text' in action ? action.text : Number.isInteger(action.option) ? q.options?.[action.option]?.label : undefined;
      if (!fits(text, 64000)) throw Error('invalid_answer');
      e.answers.set(q.id, { answers: [text.trim()] });
      if (e.index + 1 < e.questions.length) { e.index++; return receipt; }
    }
    e.state = 'responding';
    const answers = Object.fromEntries(e.answers);
    try {
      await this.respond(e.rpcId, e.kind === 'native' ? { answers } : {
        success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ answers, skipped: 'skip' in action }) }],
      });
      return receipt;
    } catch { if (this.entries.has(e.id)) e.state = 'unknown'; throw Error('submission_unknown'); }
  }
  resolved(sessionId: string, requestId: string | number) {
    for (const [id, e] of this.entries) if (e.sessionId === sessionId && e.rpcId === requestId) this.entries.delete(id);
  }
  completedItem(sessionId: string, itemId: string, turnId?: string) {
    for (const [id, e] of this.entries) if (e.sessionId === sessionId && e.itemId === itemId && (!turnId || e.turnId === turnId)) this.entries.delete(id);
  }
  clear(sessionId?: string, turnId?: string) {
    for (const [id, e] of this.entries) if ((!sessionId || e.sessionId === sessionId) && (!turnId || e.turnId === turnId)) this.entries.delete(id);
  }
}

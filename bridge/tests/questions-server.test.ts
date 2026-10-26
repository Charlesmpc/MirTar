import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { startBridge } from '../src/server.ts';
import { authProof } from '../src/protocol.ts';
import { QuestionStore } from '../src/codex/questions.ts';
import type { AgentAdapter, AgentActivity, AnswerTarget, BridgeConfig } from '../src/contracts.ts';

test('pending card question survives reconnect; voice cancel, stale session and duplicate answer never queue another task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirtar-questions-')), secret = randomBytes(32).toString('hex');
  let taskStarts = 0, responses = 0, sourceInput = '', activity: AgentActivity | undefined, active: WebSocket | undefined;
  const store = new QuestionStore(async (id, result: any) => {
    assert.equal(id, 'request-a'); assert.equal(result.answers.color.answers[0], 'Blue'); assert.equal(result.answers.word.answers[0], 'ORBIT'); responses++;
    activity = { turnId: 'turn-a', inputId: sourceInput, state: 'completed' }; store.resolved('session-a', id);
  });
  const adapter: AgentAdapter = {
    id: 'questions-fixture', sessions: async () => [{ id: 'session-a', name: 'Card' }, { id: 'session-b', name: 'Other' }],
    history: async session => activity?.state === 'completed' && session === 'session-a' ? [{ turnId: 'turn-a', text: 'DONE ORBIT', completed: true, inputId: sourceInput }] : [],
    activity: () => activity, question: session => store.current(session),
    beginAudio(session, signal) { let bytes = 0; return { append(pcm) { signal.throwIfAborted(); bytes += pcm.length; }, async commit(inputId) {
      signal.throwIfAborted(); assert.equal(bytes, 3200); taskStarts++; sourceInput = inputId; activity = { turnId: 'turn-a', inputId, state: 'running' };
      store.accept('request-a', 'native', { threadId: session, turnId: 'turn-a', itemId: 'item-a', questions: [
        { id: 'color', question: 'Test color?', options: [{ label: 'Blue', description: '' }] }, { id: 'word', question: 'Test word?' }] });
      return { submissionId: 'turn-a' };
    } }; },
    beginAnswerAudio(session, target, signal) { store.require(session, target); return { append() { signal.throwIfAborted(); },
      async commit() { signal.throwIfAborted(); return store.answer(session, target, { text: 'ORBIT' }, signal); } }; },
    answer: (session, target, action, signal) => store.answer(session, target, action, signal), close: async () => {},
  };
  const config: BridgeConfig = { version: 1, listen: { host: '127.0.0.1', port: 0, allowLanPlaintext: true }, devices: [{ id: 'test', secret }], codex: { bin: '', edgePath: '', sessions: [] } };
  const bridge = await startBridge(config, adapter, root), address = bridge.address; assert.ok(address && typeof address === 'object');
  const port = address.port;
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/device`), messages: any[] = []; active = ws;
    ws.on('message', raw => messages.push(JSON.parse(raw.toString()))); await once(ws, 'open');
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    async function wait(type: string, predicate = (_m: any) => true) {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) { const i = messages.findIndex(m => m.type === type && predicate(m)); if (i >= 0) return messages.splice(i, 1)[0]; await delay(10); }
      throw Error('missing ' + type);
    }
    send({ type: 'hello', version: 1, questions: true, deviceId: 'test', bootId: 'b'.repeat(32) });
    const challenge = await wait('challenge'); send({ type: 'auth', proof: authProof(secret, challenge.challenge) }); await wait('bound');
    return { ws, send, wait, frame(id: number) { for(let i=0;i<5;i++){const frame = Buffer.alloc(652); frame.write('MTA1'); frame.writeUInt32LE(id, 4);frame.writeUInt32LE(i,8); ws.send(frame);} } };
  }
  try {
    let peer = await connect(); peer.send({ type: 'select', sessionId: 'session-a' }); await peer.wait('selected');
    peer.send({ type: 'begin', id: 1 }); await peer.wait('state', m => m.state === 'recording'); peer.frame(1); peer.send({ type: 'commit', id: 1, frames: 5 });
    const question = await peer.wait('question'); assert.equal(taskStarts, 1); assert.equal(question.text, 'Test color?');
    peer.ws.terminate(); await once(peer.ws, 'close'); await delay(20); peer = await connect();
    peer.send({ type: 'select', sessionId: 'session-b' }); await peer.wait('selected');
    // Explicit target on wrong session cannot start an answer capture.
    peer.send({ type: 'answer_begin', id: 2, interactionId: question.interactionId, questionId: question.questionId });
    assert.equal((await peer.wait('error')).code, 'question_expired');
    peer.send({ type: 'select', sessionId: 'session-a' }); await peer.wait('selected');
    const restored = await peer.wait('question'); assert.equal(restored.interactionId, question.interactionId);
    const choiceTarget: AnswerTarget = { interactionId: restored.interactionId, questionId: restored.questionId };
    peer.send({ type: 'answer_choice', id: 3, ...choiceTarget, option: 0 }); await peer.wait('state', m => m.state === 'answer_accepted');
    peer.send({ type: 'answer_choice', id: 3, ...choiceTarget, option: 0 }); await peer.wait('state', m => m.state === 'answer_accepted'); assert.equal(responses, 0);
    const second=await peer.wait('question',m=>m.index===2);assert.equal(second.text,'Test word?');
    const target: AnswerTarget = { interactionId: second.interactionId, questionId: second.questionId };
    peer.send({ type: 'answer_begin', id: 4, ...target }); await peer.wait('state', m => m.state === 'recording'); peer.frame(4);
    peer.send({ type: 'cancel' }); await peer.wait('state', m => m.state === 'cancelled'); assert.equal(responses, 0); assert.ok(store.current('session-a'));
    peer.send({ type: 'answer_begin', id: 5, ...target }); await peer.wait('state', m => m.state === 'recording'); peer.frame(5); peer.send({ type: 'answer_commit', id: 5, frames: 5 });
    await peer.wait('state', m => m.state === 'answer_accepted'); assert.equal((await peer.wait('reply')).text, 'DONE ORBIT');
    peer.send({ type: 'answer_commit', id: 5, frames: 5 }); assert.equal((await peer.wait('error')).code, 'protocol_error');
    peer.send({ type: 'answer_skip', id: 6, ...target }); assert.equal((await peer.wait('error')).code, 'question_expired');
    assert.equal(taskStarts, 1); assert.equal(responses, 1); assert.equal(store.current('session-a'), undefined);
  } finally { active?.terminate(); await bridge.close(); await rm(root, { recursive: true, force: true }); }
});

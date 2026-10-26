import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionStore } from '../src/codex/questions.ts';

const params = (questions: any[] = [{ id: 'color', header: 'Color', question: 'Choose a color', options: [{ label: 'Blue', description: 'Test option' }] }]) =>
  ({ threadId: 'session-a', turnId: 'turn-a', itemId: 'item-a', questions });
test('native multi-question answers are scoped, ordered and emitted once to the original request', async () => {
  const sent: any[] = [], store = new QuestionStore(async (id, result) => { sent.push({ id, result }); });
  store.accept(7, 'native', params([{ id: 'color', question: 'Color?', options: [{ label: 'Blue', description: '' }] }, { id: 'word', question: 'Word?' }]));
  const first = store.current('session-a')!; assert.equal(store.current('session-b'), undefined);
  await assert.rejects(store.answer('session-b', first, { text: 'wrong' }, new AbortController().signal), /question_expired/);
  await store.answer('session-a', first, { option: 0 }, new AbortController().signal); assert.equal(sent.length, 0);
  await assert.rejects(store.answer('session-a', first, { text: 'duplicate' }, new AbortController().signal), /question_expired/);
  const second = store.current('session-a')!; assert.equal(second.index, 2);
  await store.answer('session-a', second, { text: 'ORBIT' }, new AbortController().signal);
  assert.deepEqual(sent, [{ id: 7, result: { answers: { color: { answers: ['Blue'] }, word: { answers: ['ORBIT'] } } } }]);
  assert.equal(store.current('session-a')?.status, 'responding');
  await assert.rejects(store.answer('session-a', second, { text: 'duplicate' }, new AbortController().signal), /question_expired/);
  store.resolved('session-b', 7); assert.ok(store.current('session-a'));
  store.resolved('session-a', '7'); assert.ok(store.current('session-a')); // numeric/string IDs are distinct
  store.resolved('session-a', 7); assert.equal(store.current('session-a'), undefined);
});
test('dynamic tools use the native tool response envelope; skip and completion release only their own item', async () => {
  const sent: any[] = [], store = new QuestionStore(async (_id, result) => { sent.push(result); });
  store.accept('rpc-a', 'dynamic', { threadId: 'session-a', turnId: 'turn-a', callId: 'call-a', arguments: { questions: params().questions } });
  store.accept('rpc-b', 'native', { ...params(), threadId: 'session-b', itemId: 'other-item' });
  await store.answer('session-a', store.current('session-a')!, { skip: true }, new AbortController().signal);
  assert.deepEqual(JSON.parse(sent[0].contentItems[0].text), { answers: { color: { answers: [] } }, skipped: true });
  assert.equal(sent[0].success, true); store.completedItem('session-a', 'other-item'); assert.ok(store.current('session-a'));
  store.completedItem('session-a', 'call-a'); assert.equal(store.current('session-a'), undefined); assert.ok(store.current('session-b'));
});
test('secrets are redacted and never accepted as audio/text answers; expired and cancelled answers do not mutate', async () => {
  let sends = 0; const store = new QuestionStore(async () => { sends++; });
  store.accept('secret', 'native', params([{ id: 'secret', question: 'Sensitive prompt marker', header: 'Sensitive header', isSecret: true, options: [{ label: 'Sensitive option', description: '' }] }]));
  const q = store.current('session-a')!; assert.equal(q.status, 'blocked'); assert.ok(!JSON.stringify(q).includes('Sensitive')); assert.deepEqual(q.options, []);
  await assert.rejects(store.answer('session-a', q, { text: 'do not collect' }, new AbortController().signal), /secret_input_required/);
  const cancel = new AbortController(); cancel.abort(); await assert.rejects(store.answer('session-a', q, { skip: true }, cancel.signal)); assert.equal(sends, 0);
  store.clear('session-a', 'other-turn'); assert.ok(store.current('session-a')); store.clear('session-a', 'turn-a');
  await assert.rejects(store.answer('session-a', q, { skip: true }, new AbortController().signal), /question_expired/); assert.equal(sends, 0);
});
test('unknown native delivery is frozen and never retried; malformed/oversized questions cannot consume storage', async () => {
  let sends = 0; const store = new QuestionStore(async () => { sends++; throw Error('write failed'); });
  for (const questions of [[], [{ id: 'x', question: 'x'.repeat(2049) }], [{ id: 'x', question: 'a' }, { id: 'x', question: 'b' }]])
    assert.throws(() => store.accept(1, 'native', params(questions)), /unsupported_question/);
  store.accept(2, 'native', params()); const q = store.current('session-a')!;
  await assert.rejects(store.answer('session-a', q, { option: 9 }, new AbortController().signal), /invalid_answer/); assert.equal(sends, 0);
  await assert.rejects(store.answer('session-a', q, { text: 'Blue' }, new AbortController().signal), /submission_unknown/);
  assert.equal(store.current('session-a')?.status, 'unknown');
  await assert.rejects(store.answer('session-a', q, { text: 'Blue' }, new AbortController().signal), /question_expired/); assert.equal(sends, 1);
});

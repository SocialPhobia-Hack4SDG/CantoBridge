import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpApi } from '../../src/services/httpApi.js';
import { createMemoryStorage, createStore } from '../../src/app/store.js';
import { createFetchStub, ok, fail } from '../helpers/http-stub.mjs';
import { sampleTopicCards, sampleTutorReply } from '../../src/services/tutorSample.js';
import { createSampleGenAiProvider } from '../../../backend/src/services/genai.js';

test('导师HTTP方法调用现有两接口，沿用Bearer与幂等键，不上传音频', async () => {
  const store = createStore({ storage: createMemoryStorage() });
  const args = { learnerInterests: ['food'], buddyInterests: ['food'], cantoneseLevel: 'beginner', count: 3 };
  const sample = sampleTopicCards(args);
  let reject = false;
  const fetchImpl = createFetchStub(call => {
    if (call.url.endsWith('/api/auth/session')) return ok({ token: 'tutor-test-token', role: 'learner' });
    assert.equal(call.method, 'POST'); assert.equal(call.headers.authorization, 'Bearer tutor-test-token');
    assert.equal(typeof call.body.requestId, 'string'); assert.ok(call.body.requestId);
    if (reject) return fail('internal', 'sample unavailable', { status: 500 });
    if (call.url.endsWith('/api/genai/topic-cards')) return ok(sample);
    if (call.url.endsWith('/api/genai/tutor/reply')) return ok(sampleTutorReply(call.body));
    assert.fail('unexpected endpoint');
  });
  const api = createHttpApi({ store, fetchImpl });
  await api.signIn('learner');
  assert.deepEqual(await api.generateTopicCards(args), sample);
  const currentCard = sample.cards[0];
  const reply = await api.replyToTutor({ text: '你好', currentCard });
  assert.equal(reply.mode, 'mock'); assert.equal(reply.cardId, currentCard.id);
  const { requestId, ...sent } = fetchImpl.calls[2].body;
  assert.deepEqual(sent, { text: '你好', currentCard });
  assert.notEqual(requestId, fetchImpl.calls[1].body.requestId);
  reject = true;
  await assert.rejects(api.replyToTutor({ text: '你好', currentCard }), error => error.code === 'internal');
});

test('离线卡片和回复示例与后端提供方同格式同内容', async () => {
  const provider = createSampleGenAiProvider();
  for (const cantoneseLevel of ['beginner', 'elementary', 'intermediate', 'advanced']) {
    for (const interests of [['food'], ['travel'], ['shopping'], ['anime', 'music'], ['茶文化'], []]) {
      const input = { learnerInterests: interests, buddyInterests: interests, cantoneseLevel, count: 3 };
      const frontend = sampleTopicCards(input);
      const backend = await provider.generateCards(frontend.context);
      assert.deepEqual(frontend.cards, backend.cards);
      const currentCard = frontend.cards[0];
      const reply = await provider.tutorReply({ text: '你好', currentCard });
      assert.deepEqual(sampleTutorReply({ currentCard }), { mode: 'mock', provider: 'sample', model: null, cardId: currentCard.id, ...reply });
    }
  }
});

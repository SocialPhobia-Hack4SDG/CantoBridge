import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestServer } from './helpers/server.mjs';
import { createSampleGenAiProvider } from '../src/services/genai.js';

const cardsPath = '/api/genai/topic-cards';
const tutorPath = '/api/genai/tutor/reply';
const input = { learnerInterests: ['anime', 'food'], buddyInterests: ['food', 'travel'], cantoneseLevel: 'beginner', count: 2 };

async function setup(t, options) {
  const ui = await startTestServer({ devRoutes: false, ...options });
  t.after(() => ui.close());
  const token = await ui.signIn();
  return { ...ui, token, post: (path, body, auth = token) => ui.request('POST', path, { token: auth, body }) };
}

async function sampleCard(ui) {
  return (await ui.post(cardsPath, input)).json.data.cards[0];
}

test('生成卡片：正式路由可用，标准信封、明确模拟来源、三语粤拼句型和双方兴趣上下文', async t => {
  const ui = await setup(t);
  const before = ui.db.snapshot();
  const result = await ui.post(cardsPath, input);
  assert.equal(result.status, 200); assert.equal(result.json.ok, true);
  const data = result.json.data;
  assert.equal(data.mode, 'mock'); assert.equal(data.provider, 'sample'); assert.equal(data.model, null);
  assert.deepEqual(data.context, { ...input, sharedInterests: ['food'] });
  assert.equal(data.cards.length, 2); assert.equal(new Set(data.cards.map(card => card.id)).size, 2);
  for (const card of data.cards) {
    assert.equal(card.topic, 'food'); assert.equal(card.difficulty, 'beginner');
    for (const key of ['id', 'cantonese', 'jyutping', 'mandarin', 'english']) assert.ok(card[key]);
    assert.ok(card.expressions.length);
  }
  assert.deepEqual(ui.db.snapshot(), before, '不创建房间、不改正式存档或积分');
});

test('自定义兴趣去空格去重、无交集和空兴趣均能返回示例；count默认3并支持8张', async t => {
  const ui = await setup(t);
  for (const args of [
    { learnerInterests: [' 茶文化 ', '茶文化'], buddyInterests: ['茶文化'], cantoneseLevel: 'advanced' },
    { learnerInterests: [], buddyInterests: [], cantoneseLevel: 'elementary' },
    { learnerInterests: ['food'], buddyInterests: ['anime'], cantoneseLevel: 'intermediate', count: 8 },
  ]) {
    const result = await ui.post(cardsPath, args); assert.equal(result.status, 200);
    assert.equal(result.json.data.cards.length, args.count ?? 3);
    assert.ok(result.json.data.cards.every(card => card.difficulty === args.cantoneseLevel));
  }
  const custom = await ui.post(cardsPath, { ...input, learnerInterests: [' 茶文化 ', '茶文化'], buddyInterests: ['茶文化'] });
  assert.deepEqual(custom.json.data.context.learnerInterests, ['茶文化']);
  assert.deepEqual(custom.json.data.context.sharedInterests, ['茶文化']);
});

test('AI导师：接收生成卡片与文字，返回模拟回复和练习建议，不冒充实际纠错也不保存聊天', async t => {
  const ui = await setup(t);
  const currentCard = await sampleCard(ui);
  const before = ui.db.snapshot();
  const response = await ui.post(tutorPath, { text: '我今日去咗食点心', currentCard });
  assert.equal(response.status, 200);
  const data = response.json.data;
  assert.equal(data.mode, 'mock'); assert.equal(data.provider, 'sample'); assert.equal(data.model, null);
  assert.equal(data.cardId, currentCard.id);
  assert.ok(data.reply.cantonese.includes(currentCard.cantonese));
  assert.deepEqual(data.suggestions, currentCard.expressions.slice(0, 2));
  assert.deepEqual(ui.db.snapshot(), before);
});

test('合法边界：每方5个40长度兴趣、单张卡、2000长度文字和500长度卡片可用', async t => {
  const ui = await setup(t);
  const tags = Array.from({ length: 5 }, (_, index) => String(index).padEnd(40, 'x'));
  const generated = await ui.post(cardsPath, { learnerInterests: tags, buddyInterests: tags, cantoneseLevel: 'advanced', count: 1 });
  assert.equal(generated.status, 200); assert.equal(generated.json.data.cards.length, 1);
  const currentCard = generated.json.data.cards[0];
  for (const key of ['cantonese', 'mandarin', 'english', 'jyutping']) currentCard[key] = '字'.repeat(500);
  const reply = await ui.post(tutorPath, { text: '字'.repeat(2000), currentCard });
  assert.equal(reply.status, 200); assert.ok(reply.json.data.reply.cantonese.length > 500);
});

test('两接口缺少、无效和已注销令牌均401；错误HTTP方法405', async t => {
  const ui = await setup(t);
  const currentCard = await sampleCard(ui);
  await ui.post('/api/auth/logout', {});
  for (const [path, body] of [[cardsPath, input], [tutorPath, { text: '你好', currentCard }]]) {
    for (const token of [null, 'invalid', ui.token]) {
      const result = await ui.post(path, body, token);
      assert.equal(result.status, 401); assert.equal(result.json.error.code, 'not_authorized');
    }
    assert.equal((await ui.request('GET', path)).status, 405);
  }
});

test('话题卡输入校验：必填、类型、空白、数量、长度、难度和未知字段逐一拒绝', async t => {
  const ui = await setup(t);
  const cases = [
    {}, { ...input, learnerInterests: undefined }, { ...input, buddyInterests: null },
    { ...input, learnerInterests: 'food' }, { ...input, buddyInterests: [12] },
    { ...input, learnerInterests: [' '] }, { ...input, learnerInterests: ['a'.repeat(41)] },
    { ...input, buddyInterests: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ...[undefined, null, 'native', 1].map(cantoneseLevel => ({ ...input, cantoneseLevel })),
    ...[0, 9, 1.5, '2', null].map(count => ({ ...input, count })),
    { ...input, model: 'paid-model' }, { ...input, requestId: 42 }, { ...input, requestId: ' ' },
  ];
  for (const body of cases) {
    const result = await ui.post(cardsPath, body);
    assert.equal(result.status, 400, JSON.stringify(body)); assert.equal(result.json.error.code, 'bad_request');
  }
});

test('导师输入校验：不接音频，拒绝缺失文字、过长文字、坏卡片、嵌套未知字段与坏JSON', async t => {
  const ui = await setup(t); const currentCard = await sampleCard(ui);
  const valid = { text: '你好', currentCard };
  const cases = [
    {}, ...[undefined, null, '', ' ', 12, 'a'.repeat(2001)].map(text => ({ ...valid, text })),
    ...[undefined, null, [], {}, { ...currentCard, jyutping: '' }, { ...currentCard, difficulty: 'native' },
      { ...currentCard, expressions: [] }, { ...currentCard, expressions: [{ cantonese: '你好' }] },
      { ...currentCard, expressions: Array(5).fill(currentCard.expressions[0]) },
      { ...currentCard, expressions: [{ ...currentCard.expressions[0], secret: 'unexpected' }] },
      { ...currentCard, secret: 'unexpected' }].map(currentCard => ({ ...valid, currentCard })),
    { ...valid, audio: 'base64' }, '{bad-json', [],
  ];
  for (const body of cases) {
    const result = await ui.post(tutorPath, body);
    assert.equal(result.status, 400, JSON.stringify(body)); assert.equal(result.json.error.code, 'bad_request');
  }
});

test('同一requestId回放且不同账号隔离；无requestId也可请求', async t => {
  let calls = 0;
  const sample = createSampleGenAiProvider();
  const ui = await setup(t, { genAiProvider: { ...sample, generateCards: async args => { calls++; return sample.generateCards(args); } } });
  const body = { ...input, requestId: 'generate-once' };
  const first = await ui.post(cardsPath, body);
  const second = await ui.post(cardsPath, body);
  assert.deepEqual(first.json, second.json); assert.equal(calls, 1);
  const other = await ui.signIn('buddy', { deviceId: 'another-device' });
  assert.equal((await ui.post(cardsPath, body, other)).status, 200); assert.equal(calls, 2);
  assert.equal((await ui.post(cardsPath, input)).status, 200); assert.equal(calls, 3);
  const currentCard = first.json.data.cards[0];
  const tutorBody = { text: '你好', currentCard, requestId: 'tutor-once' };
  assert.deepEqual((await ui.post(tutorPath, tutorBody)).json, (await ui.post(tutorPath, tutorBody)).json);
});

test('提供方接入位置收到规范化输入；无效请求不调用提供方', async t => {
  const calls = [];
  const sample = createSampleGenAiProvider();
  const ui = await setup(t, { genAiProvider: { ...sample,
    generateCards: async args => { calls.push(args); return sample.generateCards(args); },
    tutorReply: async args => { calls.push(args); return sample.tutorReply(args); },
  } });
  const currentCard = await sampleCard(ui);
  await ui.post(tutorPath, { text: ' 你好 ', currentCard });
  assert.deepEqual(calls[0], { ...input, sharedInterests: ['food'] });
  assert.deepEqual(calls[1], { text: '你好', currentCard });
  await ui.post(cardsPath, {}); await ui.post(tutorPath, {}); assert.equal(calls.length, 2);
});

test('提供方异常、缺少字段、数量不符或重复卡片统一500，隐藏提供方细节且不缓存失败', async t => {
  const sample = createSampleGenAiProvider();
  for (const bad of [null, { cards: [] }, { cards: [{}] }, 'throws', 'duplicate']) {
    let broken = true;
    const ui = await setup(t, { genAiProvider: { ...sample,
      generateCards: async args => {
        if (!broken) return sample.generateCards(args);
        if (bad === 'throws') throw Error('private-provider-key');
        if (bad === 'duplicate') { const result = await sample.generateCards(args); return { cards: [result.cards[0], result.cards[0]] }; }
        return bad;
      },
      tutorReply: async () => ({ reply: { cantonese: 'missing translations' }, suggestions: [] }),
    } });
    const body = { ...input, requestId: 'retry-failure' };
    const response = await ui.post(cardsPath, body);
    assert.equal(response.status, 500); assert.equal(response.json.error.code, 'internal');
    assert.ok(!response.text.includes('private-provider-key'));
    broken = false;
    const recovered = await ui.post(cardsPath, body); assert.equal(recovered.status, 200);
    assert.equal((await ui.post(tutorPath, { text: '你好', currentCard: recovered.json.data.cards[0] })).status, 500);
  }
});

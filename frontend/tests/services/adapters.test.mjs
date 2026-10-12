/** 适配层：后端契约形状 → 页面期望形状（纯函数，逐个差异点都钉住）。 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isoToMs,
  toCandidate,
  toEntries,
  toMatchRequest,
  toProfile,
  toQueueEntry,
  toRoom,
  toRoomRecord,
  toSettings,
  toSettingsPatch,
  toSettlement,
} from '../../src/services/adapters.js';

test('toEntries：后端给 {entries}，页面要裸数组', () => {
  assert.deepEqual(toEntries({ entries: [{ peerId: 'lucas' }] }), [{ peerId: 'lucas' }]);
  assert.deepEqual(toEntries([{ peerId: 'a' }]), [{ peerId: 'a' }], '已经是数组就原样返回');
  assert.deepEqual(toEntries(undefined), [], '字段缺失也不能让页面拿到 undefined');
  assert.deepEqual(toEntries({ entries: null }), []);
});

test('toCandidate：摊平 + reasons→reason + roomAvailable 搬进人对象', () => {
  // 后端真实响应（契约 4.4）：人、标签、分数、理由、房间可用性分在两层
  const wire = {
    candidate: {
      peerId: 'lucas',
      anonymous: false,
      displayName: 'lucas',
      nativeLanguage: 'english',
      cantoneseLevel: 'intermediate',
      identity: 'working_professional',
      interests: ['movies', 'technology', 'gaming'],
      intent: 'learn',
      goal: 'workplace_cantonese',
      nativeLanguages: ['english'],
      matchScore: 68,
      matchedTags: ['movies', 'gaming'],
      topics: ['movies', 'technology', 'gaming'],
      complement: false,
      complementLanguage: null,
    },
    matchedTags: ['movies', 'gaming'],
    matchScore: 68,
    reasons: ['movies', 'gaming'],
    roomAvailable: false,
  };
  const candidate = toCandidate(wire);

  assert.equal(candidate.peerId, 'lucas', '人的字段要摊平到顶层');
  assert.deepEqual(candidate.reason, ['movies', 'gaming'], '页面读 reason（单数）');
  assert.deepEqual(candidate.reasons, ['movies', 'gaming'], '契约的叫法也留着，方便逐步收敛');
  assert.equal(candidate.roomAvailable, false, 'roomAvailable 必须在人对象里（预览页读 candidate.roomAvailable）');
  assert.equal(candidate.matchScore, 68);
  assert.equal(candidate.interests.length, 3);
});

test('toProfile / toSettings：解包一层，字段缺失时退回原对象', () => {
  assert.deepEqual(toProfile({ learnerProfile: { userId: 'learner-demo-01' } }, 'learnerProfile'), {
    userId: 'learner-demo-01',
  });
  assert.deepEqual(toProfile({ userId: 'x' }, 'learnerProfile'), { userId: 'x' });
  assert.equal(toProfile(null, 'learnerProfile'), null);

  assert.deepEqual(toSettings({ settings: { anonymous: false } }), { anonymous: false });
  assert.deepEqual(toSettings({ anonymous: true }), { anonymous: true });
  assert.equal(toSettings(undefined), null);
});

test('isoToMs：ISO 字符串 → 毫秒数（弹窗倒计时必须是数字）', () => {
  assert.equal(isoToMs('2026-09-29T06:45:57.291Z'), Date.parse('2026-09-29T06:45:57.291Z'));
  assert.equal(isoToMs(null), null, 'null 原样透传（房间没有 expiresAt）');
  assert.equal(isoToMs(undefined), null);
  assert.equal(isoToMs(1759100000000), 1759100000000, '本来就是数字就原样返回');
  assert.equal(isoToMs('不是时间'), null, '解析不了给 null，不能给 NaN');
});

test('toQueueEntry / toRoom / toMatchRequest：joinedAt 与 expiresAt 都转毫秒', () => {
  assert.deepEqual(toQueueEntry({ queueEntryId: 'q-1', joinedAt: '2026-09-29T06:00:00.000Z' }), {
    queueEntryId: 'q-1',
    joinedAt: Date.parse('2026-09-29T06:00:00.000Z'),
  });

  assert.deepEqual(toRoom({ roomId: 'r-1', peer: { peerId: 'ka-ho' }, expiresAt: null }), {
    roomId: 'r-1',
    peer: { peerId: 'ka-ho' },
    expiresAt: null,
  });

  const request = toMatchRequest({
    requestId: 'req-1',
    roomId: 'r-2',
    peer: { peerId: 'ka-ho' },
    expiresAt: '2026-09-29T06:00:10.000Z',
    acceptSeconds: 10,
  });
  assert.equal(request.requestId, 'req-1');
  assert.equal(request.expiresAt, Date.parse('2026-09-29T06:00:10.000Z'));
  assert.equal(request.acceptSeconds, 10);
});

test('toRoomRecord：房间元信息摊成前端 runtime.room 的样子', () => {
  const record = toRoomRecord({
    room: { roomId: 'r-1', peerUserId: 'lucas', peerRole: 'learner', status: 'active', createdAt: '2026-09-29T06:00:00.000Z' },
    peer: { peerId: 'lucas' },
    status: 'active',
    startedAt: '2026-09-29T06:00:00.000Z',
  });
  assert.equal(record.roomId, 'r-1');
  assert.equal(record.role, 'buddy', '对方是学习者 ⇒ 我是母语者');
  assert.equal(record.status, 'active');
  assert.equal(record.startedAt, Date.parse('2026-09-29T06:00:00.000Z'));
});

test('toSettingsPatch：只挑服务端认识的字段，locale 映射成 interfaceLanguage', () => {
  const patch = toSettingsPatch({
    anonymous: false,
    visibility: { interests: false },
    leaderboardVisible: true,
    theme: 'warm',
    signalMode: 'local',
    mockDelayMs: 0,
    matchCriteria: ['anime'],
  });
  assert.deepEqual(patch, {
    anonymous: false,
    visibility: { interests: false },
    leaderboardVisible: true,
  });
  assert.equal('theme' in patch, false, '前端本地偏好不该发给服务端（会被判未知字段 400）');

  assert.deepEqual(toSettingsPatch({ locale: 'en' }), { interfaceLanguage: 'en' });
  assert.deepEqual(toSettingsPatch({ interfaceLanguage: 'zh-Hant' }), { interfaceLanguage: 'zh-Hant' });
});

test('toSettlement：透传结算，字段缺失时用本地估算兜底', () => {
  assert.deepEqual(
    toSettlement({ durationSec: 90, cardsUsed: 5, xpEarned: 34, unlocked: ['first_conversation'], topics: ['anime'] }),
    { durationSec: 90, cardsUsed: 5, xpEarned: 34, unlocked: ['first_conversation'], topics: ['anime'] },
  );
  assert.deepEqual(toSettlement(undefined, { durationSec: 60, cardsUsed: 2, topics: ['food'] }), {
    durationSec: 60,
    cardsUsed: 2,
    xpEarned: 0,
    unlocked: [],
    topics: ['food'],
  });
});

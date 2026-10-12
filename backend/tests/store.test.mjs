/**
 * 数据层用例：JSON 快照落盘 / 坏文件兜底 / 令牌过期 / 一键重置 / 两份资料互不覆盖。
 * 「重启不丢数据」是现场演示的底线，必须有用例。
 *
 * 出厂是**空的**：没有任何预置账号。所以每个用例先 `db.createAccount()` 造一个人，
 * 再去验它——这本身就是「有谁注册了就看见谁」在数据层的体现。
 *
 * 双身份模型下的两个要点：
 *   - 资料是**一行一个人格**：`getProfile(userId, role)` 必须带 role 才定位得到；
 *   - 令牌里带着身份（切身份＝换令牌），`createSession({ userId, role })`。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROLES } from '../src/data/vocabularies.js';
import { createDb } from '../src/store/db.js';
import { createProgress, createSeed, profileIdFor } from '../src/store/seed.js';

function tempFile(name = 'db.json') {
  const dir = mkdtempSync(join(tmpdir(), 'cantobridge-'));
  return { dir, file: join(dir, name) };
}

test('出厂空：没有账号、没有资料、没有队列——一切由注册现场长出来', () => {
  const db = createDb();
  assert.deepEqual(db.listUsers(), []);
  assert.equal(db.count('users'), 0);
  assert.equal(db.count('profiles'), 0);
  assert.equal(db.count('queue'), 0, '队列出厂是空的：列表里不该有编出来的人');
  assert.equal(db.count('rooms'), 0);
  assert.equal(db.getProfile('u-nobody', 'learner'), null);
});

test('createAccount：五张表一起写，资料 id 从账号派生', () => {
  const db = createDb();
  const user = db.createAccount({ deviceId: 'device-a' });
  assert.match(user.userId, /^u-/, '账号 id 是 u- 开头');
  assert.equal(user.deviceId, 'device-a');
  assert.ok(user.displayName.length > 0, '账号要有默认显示名，列表里才分得清谁是谁');

  // 一个账号两份资料，各自一个 id，两份都出厂全空
  for (const role of ROLES) {
    const profile = db.getProfile(user.userId, role);
    assert.ok(profile, `${role} 资料应当一起建出来`);
    assert.equal(profile.userId, profileIdFor(user.userId, role));
    assert.equal(profile.onboarded, false);
    assert.deepEqual(profile.interests, []);
  }
  assert.ok(db.getSettings(user.userId));
  assert.ok(db.getProgress(user.userId));
  assert.ok(db.getRelations(user.userId));
  assert.equal(db.count('profiles'), ROLES.length, '一个账号两份资料');

  // 按 deviceId 找得到；重复建同一个 id 会被拦下
  assert.equal(db.findUserByDeviceId('device-a').userId, user.userId);
  assert.equal(db.findUserByDeviceId('device-unknown'), null);
  assert.throws(() => db.createAccount({ accountId: user.userId }), /已存在/);
});

test('JSON 快照：写操作落盘，重开一个 db 还能读到（两份资料各存各的）', () => {
  const { dir, file } = tempFile();
  try {
    const first = createDb({ filePath: file });
    const { userId } = first.createAccount({ deviceId: 'device-a' });
    first.updateProfile(userId, 'learner', { interests: ['anime', 'food'], cantoneseLevel: 'beginner' });
    first.updateProfile(userId, 'buddy', { languagesSpoken: ['yue'], preferredTopics: ['hong_kong_food'] });
    first.updateSettings(userId, { anonymous: false });

    const onDisk = readFileSync(file, 'utf8');
    assert.ok(onDisk.includes('anime'), '写完之后文件里应当有数据');
    assert.ok(onDisk.includes('hong_kong_food'), '两份资料都要落盘');

    const second = createDb({ filePath: file });
    const learner = second.getProfile(userId, 'learner');
    const buddy = second.getProfile(userId, 'buddy');
    assert.deepEqual(learner.interests, ['anime', 'food']);
    assert.equal(learner.cantoneseLevel, 'beginner');
    assert.equal(learner.onboarded, true, '写成功即视为这份资料填完了');
    assert.deepEqual(buddy.languagesSpoken, ['yue']);
    assert.deepEqual(buddy.preferredTopics, ['hong_kong_food']);
    assert.equal(buddy.onboarded, true);
    assert.deepEqual(buddy.interests, [], '读回来时两份资料依旧是分开的');
    assert.equal(second.getSettings(userId).anonymous, false);
    assert.equal(second.count('profiles'), ROLES.length);
    // 账号也一起活过来了：重启之后同一台设备还是同一个人
    assert.equal(second.findUserByDeviceId('device-a').userId, userId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('两份资料互不覆盖：按 (userId, role) 定位，写一份不动另一份', () => {
  const db = createDb();
  const { userId } = db.createAccount({ deviceId: 'device-a' });
  const buddyBefore = db.getProfile(userId, 'buddy');

  db.updateProfile(userId, 'learner', { interests: ['movies'], nativeLanguage: 'english' });
  assert.deepEqual(db.getProfile(userId, 'buddy'), buddyBefore, '写学习者资料不许碰母语者那一行');

  db.updateProfile(userId, 'buddy', { interests: ['gaming'] });
  assert.deepEqual(db.getProfile(userId, 'learner').interests, ['movies'], '反过来也一样');
  assert.deepEqual(db.getProfile(userId, 'buddy').interests, ['gaming']);

  // 两份资料的 userId 不同：切身份时前端拿到的 profile id 也不一样
  assert.equal(db.getProfile(userId, 'learner').userId, profileIdFor(userId, 'learner'));
  assert.equal(db.getProfile(userId, 'buddy').userId, profileIdFor(userId, 'buddy'));

  // 不认识的 role / 账号取不到资料，而不是顺手回一份错的
  assert.equal(db.getProfile(userId, 'teacher'), null);
  assert.equal(db.getProfile('u-nobody', 'learner'), null);
  assert.equal(db.updateProfile('u-nobody', 'learner', { interests: ['movies'] }), null);
});

test('updateProfile：markOnboarded:false 时只写数据、不把资料标成已填', () => {
  const db = createDb();
  const { userId } = db.createAccount({ deviceId: 'device-a' });
  db.updateProfile(userId, 'learner', { nativeLanguage: 'english' }, { markOnboarded: false });
  const learner = db.getProfile(userId, 'learner');
  assert.equal(learner.nativeLanguage, 'english', '数据要写进去');
  assert.equal(learner.onboarded, false, '选身份这类操作不算「填过资料」');
});

test('坏快照不影响启动：当成出厂状态（空的），而不是抛错', () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, '{ 这不是 JSON', 'utf8');
    const db = createDb({ filePath: file });
    assert.equal(db.count('users'), 0, '坏文件退回出厂：出厂就是空的');
    assert.equal(db.count('profiles'), 0);
    assert.equal(db.count('queue'), 0);
    // 退回出厂之后照样能正常注册
    const { userId } = db.createAccount({ deviceId: 'device-a' });
    assert.equal(db.getProfile(userId, 'learner').onboarded, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('令牌：带着身份签发，过期即失效，且会被清掉', () => {
  let clock = Date.parse('2026-09-25T10:00:00+08:00');
  const db = createDb({ now: () => clock });
  const { userId } = db.createAccount({ deviceId: 'device-a' });
  const session = db.createSession({ userId, role: 'learner', ttlMs: 1000 });
  assert.equal(session.role, 'learner', '身份进令牌：服务端据此裁剪下发内容');

  const stored = db.getSession(session.token);
  assert.ok(stored, '刚签发就能用');
  assert.equal(stored.role, 'learner');
  assert.equal(stored.userId, userId);

  clock += 2000;
  assert.equal(db.getSession(session.token), null, '过期之后取不到');
  assert.equal(db.snapshot().sessions.length, 0, '过期的令牌顺手清掉');
});

test('reset()：回到出厂状态——账号也一起清掉，进度归零', () => {
  const db = createDb();
  const { userId } = db.createAccount({ deviceId: 'device-a' });
  db.updateProfile(userId, 'learner', { nativeLanguage: 'english', interests: ['food'] });
  db.updateProfile(userId, 'buddy', { interests: ['movies'], wantToLearn: ['mandarin'] });
  db.updateProgress(userId, { xp: 200 });
  db.createSession({ userId, role: 'buddy' });
  assert.equal(db.getProgress(userId).xp, 200);

  db.reset();

  assert.equal(db.count('users'), 0, '出厂没有账号');
  assert.equal(db.getProfile(userId, 'learner'), null);
  assert.deepEqual(db.snapshot(), { ...createSeed(), users: [], profiles: [], settings: [], progress: [], relations: [], sessions: [] });
  assert.equal(db.snapshot().sessions.length, 0, '令牌也一起清掉');

  // 重新注册：新账号从 0 分开始，而不是继承旧进度
  const next = db.createAccount({ deviceId: 'device-a' });
  assert.deepEqual(db.getProgress(next.userId).xp, createProgress().xp);
});

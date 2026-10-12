/**
 * 一键冒烟：起一个**真服务**（临时数据文件 + 随机端口），把 Phase 0~3 的验收路径
 * 从头走一遍，最后打印一份人能读的报告。
 *
 * Phase 2 起剧本多了三步硬要求：匹配队列的 409/410、取消等待的**连坐作废**、成房的**原子性**。
 * Phase 3 又加了现场三步：**取卡**（张数 + 难度窗口）、**结算幂等**（换 requestId 也不许加两次 XP）、
 * **反馈与收藏**（评价挂到那次会话上、句型收藏落库）。
 *
 * 和 `npm test` 的分工：
 *   - `npm test` 是细粒度用例（每个失败点都有单独断言，方便定位回归）；
 *   - `npm run smoke` 是**现场验收剧本**：一条命令回答「后端现在能不能用」，
 *     也用来看清「一次请求到底发生了什么」（健康 → 字典 → 登录 → 拿两份资料 →
 *     写 learner → 写 buddy → 越界 400 → 没令牌 401 → 幂等回放 → CORS →
 *     入队 / 取消 / 连坐 / 成房 → 取卡 / 结算幂等 / 反馈 / 收藏 → 重启不丢 → 一键重置）。
 *
 * 双身份模型是这一版的重点：**两份资料分开存、分开改，谁都不覆盖谁**，
 * 所以剧本里专门有三步在盯这件事（第 7 / 8 步）。
 *
 * **出厂是空的**：没有任何演示账号、假学习者、假母语者。剧本里所有「对面那个人」
 * 都是现场注册出来的——`device-smoke` 是主角，另外两台对端设备（一位有空的母语者、
 * 一位在等的中级学习者）在开演前先注册好。这也正是现场两台手机的走法。
 *
 * 数据写在系统临时目录，**不碰 backend/.data/**，所以随时可以跑。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUDDY_FEEDBACK_TAGS, publicTags } from '../src/data/vocabularies.js';
import { xpFor } from '../src/lib/scoring.js';
import { difficultyWindow } from '../src/lib/topics.js';
import { createServer } from '../src/server.js';
import { createDb } from '../src/store/db.js';
import { createProgress } from '../src/store/seed.js';

/** 主角设备。刷新 / 重启之后还是同一个人（账号由 deviceId 决定）。 */
const MY_DEVICE = 'device-smoke';
/** 对端：一位有空的母语者（第 14 步的演示口子要按「相反身份」找他）。 */
const BUDDY_DEVICE = 'device-smoke-buddy';
/** 对端：一位在等的中级学习者（第 15~17 步摘他成房、按他的水平发卡）。 */
const PEER_DEVICE = 'device-smoke-peer';

async function listen(app) {
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${app.server.address().port}`;
}

async function close(app) {
  await new Promise((done) => app.server.close(done));
}

async function call(base, method, path, { token = null, body, headers = {} } = {}) {
  const hasBody = body !== undefined;
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, headers: response.headers };
}

export async function runSmoke() {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const dir = mkdtempSync(join(tmpdir(), 'cantobridge-smoke-'));
  const file = join(dir, 'db.json');
  const expectedTagKeys = Object.keys(publicTags()).sort();
  let app = createServer({ db: createDb({ filePath: file }) });
  let base = await listen(app);

  try {
    /* 1. 骨架活着，五张表都在——而且**出厂全空** */
    let res = await call(base, 'GET', '/api/health');
    const tables = res.json?.data?.tables ?? {};
    add(
      'GET /api/health：服务活着 + 五张表计数，出厂全空（没有编出来的人）',
      res.status === 200 &&
        res.json?.ok === true &&
        res.json.data.status === 'ok' &&
        tables.profiles === 0 &&
        tables.users === 0 &&
        tables.queue === 0,
      `status=${res.status} tables=${JSON.stringify(tables)}`,
    );

    /* 2. 字典：六张公开词表，interests 13 个取值 */
    res = await call(base, 'GET', '/api/tags');
    const tagKeys = Object.keys(res.json?.data ?? {}).sort();
    add(
      'GET /api/tags：六张公开词表一次全给',
      res.status === 200 &&
        JSON.stringify(tagKeys) === JSON.stringify(expectedTagKeys) &&
        res.json.data.interests.length === publicTags().interests.length,
      `keys=${tagKeys.join(',')} interests=${res.json?.data?.interests?.length}`,
    );

    /* 3. 一键进入（选身份）：另一条身份捷径已经退场，role 与 deviceId 都必填 */
    res = await call(base, 'POST', '/api/auth/session', { body: { role: 'learner', deviceId: MY_DEVICE } });
    const token = res.json?.data?.token ?? '';
    const myAccountId = res.json?.data?.userId ?? '';
    add(
      'POST /api/auth/session：按 deviceId 现场建账号，拿到令牌与身份',
      res.status === 201 &&
        token.length > 0 &&
        /^u-[a-z0-9]{8}$/.test(myAccountId) &&
        res.json.data.role === 'learner',
      `status=${res.status} userId=${myAccountId} role=${res.json?.data?.role}`,
    );

    /* 3b. 两台对端设备：一位有空的母语者 + 一位在等的中级学习者。
       后面几步要「有人可配、有人可摘」，人得先真的注册出来（出厂是空的）。 */
    const buddyPeer = await call(base, 'POST', '/api/auth/session', {
      body: { role: 'buddy', deviceId: BUDDY_DEVICE },
    });
    const buddyToken = buddyPeer.json?.data?.token ?? '';
    await call(base, 'PUT', '/api/me/profile/buddy', {
      token: buddyToken,
      body: { languagesSpoken: ['yue', 'english'], identity: 'university_student', interests: ['movies'], preferredTopics: ['hong_kong_food'] },
    });
    await call(base, 'POST', '/api/match/queue', { token: buddyToken, body: {} });

    const peerSession = await call(base, 'POST', '/api/auth/session', {
      body: { role: 'learner', deviceId: PEER_DEVICE },
    });
    const peerToken = peerSession.json?.data?.token ?? '';
    const peerProfile = await call(base, 'PUT', '/api/me/profile/learner', {
      token: peerToken,
      body: { nativeLanguage: 'english', cantoneseLevel: 'intermediate', interests: ['movies', 'gaming'] },
    });
    const peerId = peerProfile.json?.data?.learnerProfile?.userId ?? '';
    await call(base, 'POST', '/api/match/queue', { token: peerToken, body: {} });

    const roster = await call(base, 'GET', '/api/health');
    add(
      '两台对端设备现场注册：三个账号（主角 + 母语者 + 中级学习者），队列里两个人',
      buddyPeer.status === 201 &&
        peerSession.status === 201 &&
        peerProfile.status === 200 &&
        roster.json?.data?.tables?.users === 3 &&
        roster.json?.data?.tables?.queue === 2,
      `users=${roster.json?.data?.tables?.users} queue=${roster.json?.data?.tables?.queue} peerId=${peerId}`,
    );

    /* 4. 拿账号：两份资料一次回全、都还是出厂全空 */
    res = await call(base, 'GET', '/api/me', { token });
    const me = res.json?.data;
    add(
      'GET /api/me：两份资料 + 设置 + 进度一次拿齐',
      res.status === 200 &&
        Object.keys(me ?? {}).sort().join(',') === 'buddyProfile,learnerProfile,progress,settings,userId' &&
        me?.learnerProfile?.interests?.length === 0 &&
        me?.buddyProfile?.interests?.length === 0 &&
        me?.learnerProfile?.onboarded === false &&
        me?.progress?.xp === createProgress().xp,
      `learner.onboarded=${me?.learnerProfile?.onboarded} buddy.onboarded=${me?.buddyProfile?.onboarded} xp=${me?.progress?.xp}`,
    );

    /* 5. 没令牌要 401 */
    res = await call(base, 'GET', '/api/me');
    add(
      'GET /api/me（不带令牌）：401 not_authorized',
      res.status === 401 && res.json?.error?.code === 'not_authorized',
      `status=${res.status}`,
    );

    /* 6. 写学习者资料 */
    res = await call(base, 'PUT', '/api/me/profile/learner', {
      token,
      body: { nativeLanguage: 'english', cantoneseLevel: 'beginner', interests: ['anime', 'food'] },
    });
    add(
      'PUT /api/me/profile/learner：部分更新写入成功，写完即完成注册',
      res.status === 200 &&
        res.json?.data?.learnerProfile?.onboarded === true &&
        res.json.data.learnerProfile.interests.length === 2 &&
        res.json.data.learnerProfile.nativeLanguage === 'english',
      `interests=${JSON.stringify(res.json?.data?.learnerProfile?.interests)} onboarded=${res.json?.data?.learnerProfile?.onboarded}`,
    );

    /* 7. 写 learner 不许碰到 buddy（双身份模型的核心约束之一） */
    res = await call(base, 'GET', '/api/me', { token });
    add(
      '两份资料互不覆盖：写完 learner，buddy 那份原样不动',
      res.status === 200 &&
        res.json.data.buddyProfile.interests.length === 0 &&
        res.json.data.buddyProfile.onboarded === false &&
        res.json.data.learnerProfile.interests.length === 2,
      `buddy.interests=${JSON.stringify(res.json?.data?.buddyProfile?.interests)} buddy.onboarded=${res.json?.data?.buddyProfile?.onboarded}`,
    );

    /* 8. 写母语者资料：另一套字段，且不许把 learner 那份改掉 */
    res = await call(base, 'PUT', '/api/me/profile/buddy', {
      token,
      body: {
        languagesSpoken: ['yue', 'english'],
        identity: 'working_professional',
        interests: ['movies'],
        preferredTopics: ['hong_kong_food'],
        wantToLearn: ['mandarin'],
      },
    });
    const buddy = res.json?.data?.buddyProfile;
    const afterBuddyWrite = await call(base, 'GET', '/api/me', { token });
    add(
      'PUT /api/me/profile/buddy：另一套字段写入成功，且 learner 那份没被动',
      res.status === 200 &&
        buddy?.onboarded === true &&
        buddy.languagesSpoken.length === 2 &&
        buddy.wantToLearn.includes('mandarin') &&
        afterBuddyWrite.json?.data?.learnerProfile?.nativeLanguage === 'english' &&
        afterBuddyWrite.json.data.learnerProfile.interests.length === 2,
      `buddy.languagesSpoken=${JSON.stringify(buddy?.languagesSpoken)} learner.interests=${JSON.stringify(afterBuddyWrite.json?.data?.learnerProfile?.interests)}`,
    );

    /* 9. 越界 400：兴趣超过 5 个、回礼里出现粤语 */
    const tooManyInterests = await call(base, 'PUT', '/api/me/profile/learner', {
      token,
      body: { interests: ['movies', 'anime', 'gaming', 'music', 'food', 'travel'] },
    });
    const yueAsGift = await call(base, 'PUT', '/api/me/profile/buddy', { token, body: { wantToLearn: ['yue'] } });
    add(
      '越界一律 400：interests 超 5 个、wantToLearn 里出现 yue',
      tooManyInterests.status === 400 &&
        tooManyInterests.json?.error?.code === 'bad_request' &&
        /interests/.test(tooManyInterests.json.error.message) &&
        yueAsGift.status === 400 &&
        /wantToLearn/.test(yueAsGift.json.error.message),
      `interests=${tooManyInterests.status} wantToLearn=${yueAsGift.status}`,
    );

    /* 10. 幂等回放 */
    const body = { anonymous: false, requestId: 'smoke-idem-1' };
    const first = await call(base, 'PUT', '/api/me/settings', { token, body });
    const second = await call(base, 'PUT', '/api/me/settings', { token, body });
    add(
      'requestId 幂等：重复提交原样回放第一次的结果',
      first.status === 200 && JSON.stringify(first.json) === JSON.stringify(second.json),
      '第二次响应与第一次逐字节一致',
    );

    /* 11. 405 / 404 */
    const wrongMethod = await call(base, 'DELETE', '/api/me');
    const unknown = await call(base, 'GET', '/api/nope');
    add(
      '405 / 404：方法不对与路径不存在分得清',
      wrongMethod.status === 405 &&
        wrongMethod.json?.error?.code === 'method_not_allowed' &&
        unknown.status === 404 &&
        unknown.json?.error?.code === 'not_found',
      `405=${wrongMethod.status} 404=${unknown.status}`,
    );

    /* 12. CORS */
    const allowed = await call(base, 'OPTIONS', '/api/me', {
      headers: { origin: 'http://localhost:4173', 'access-control-request-method': 'GET' },
    });
    const blocked = await call(base, 'OPTIONS', '/api/me', {
      headers: { origin: 'http://evil.example.com', 'access-control-request-method': 'GET' },
    });
    add(
      'CORS：localhost:4173 预检 204、陌生 Origin 403',
      allowed.status === 204 &&
        allowed.headers.get('access-control-allow-origin') === 'http://localhost:4173' &&
        blocked.status === 403,
      `allowed=${allowed.status} blocked=${blocked.status}`,
    );

    /* 13. 匹配队列：入队 → 重复 409 → 取消 → 再取消 410 */
    const joined = await call(base, 'POST', '/api/match/queue', { token, body: {} });
    const duplicate = await call(base, 'POST', '/api/match/queue', { token, body: {} });
    const cancelled = await call(base, 'DELETE', '/api/match/queue', { token });
    const cancelAgain = await call(base, 'DELETE', '/api/match/queue', { token });
    add(
      '匹配队列：入队 200 → 重复 409 already_queued → 取消 200 → 再取消 410 queue_expired',
      joined.status === 200 &&
        Boolean(joined.json?.data?.queueEntryId) &&
        Boolean(joined.json?.data?.joinedAt) &&
        duplicate.status === 409 &&
        duplicate.json?.error?.code === 'already_queued' &&
        cancelled.status === 200 &&
        cancelled.json?.data?.ok === true &&
        cancelAgain.status === 410 &&
        cancelAgain.json?.error?.code === 'queue_expired',
      `join=${joined.status} dup=${duplicate.status} cancel=${cancelled.status} again=${cancelAgain.status}`,
    );

    /* 14. 取消等待要连坐：待接受的请求在同一次动作里作废，随后 accept 拿 410 */
    await call(base, 'POST', '/api/match/queue', { token, body: {} });
    const pending = await call(base, 'POST', '/api/dev/match-request', { token, body: { acceptSeconds: 10 } });
    const cascade = await call(base, 'DELETE', '/api/match/queue', { token });
    const afterCascade = await call(base, 'POST', `/api/match/requests/${pending.json?.data?.requestId}/accept`, {
      token,
      body: {},
    });
    add(
      '取消等待连坐：待接受请求被作废（invalidatedRequests=1），随后 accept 拿 410',
      pending.status === 201 &&
        cascade.status === 200 &&
        cascade.json?.data?.invalidatedRequests === 1 &&
        afterCascade.status === 410 &&
        afterCascade.json?.error?.code === 'match_request_expired',
      `pending=${pending.status} invalidated=${cascade.json?.data?.invalidatedRequests} accept=${afterCascade.status}`,
    );

    /* 15. 成房必须原子：摘走对端那位学习者，第二次必须 409 */
    const room = await call(base, 'POST', '/api/rooms', { token, body: { learnerId: peerId } });
    const roomAgain = await call(base, 'POST', '/api/rooms', { token, body: { learnerId: peerId } });
    const roomState = await call(base, 'GET', `/api/rooms/${room.json?.data?.roomId}`, { token });
    add(
      '成房原子：挑人 201 → 第二次 409 room_taken → GET /api/rooms/:id 200 active',
      room.status === 201 &&
        room.json?.data?.peer?.peerId === peerId &&
        roomAgain.status === 409 &&
        roomAgain.json?.error?.code === 'room_taken' &&
        roomState.status === 200 &&
        roomState.json?.data?.status === 'active',
      `room=${room.status} again=${roomAgain.status} get=${roomState.status}`,
    );

    /* 16. 话题卡：对方是学习者 → level 取他的水平，张数与难度窗口都对 */
    const cards = await call(base, 'GET', `/api/rooms/${room.json?.data?.roomId}/cards`, { token });
    const cardWindow = difficultyWindow('intermediate'); // 对端那位是 intermediate
    add(
      'GET /api/rooms/:id/cards：8 张卡，level 取学习者的水平，全部落在该难度窗口内',
      cards.status === 200 &&
        cards.json?.data?.level === 'intermediate' &&
        cards.json.data.cards.length === 8 &&
        cards.json.data.cards.every((card) => cardWindow.includes(card.difficulty)),
      `level=${cards.json?.data?.level} count=${cards.json?.data?.cards?.length} 难度=${JSON.stringify([
        ...new Set(cards.json?.data?.cards?.map((card) => card.difficulty) ?? []),
      ])}`,
    );

    /* 17. 结算 + 幂等：换一个 requestId 也只拿同一份，XP 绝不加两次 */
    const beforeEnd = await call(base, 'GET', '/api/me', { token });
    const endBody = { durationSec: 125, cardsUsed: 3, topics: ['anime', 'food'], requestId: 'smoke-end-1' };
    const ended = await call(base, 'POST', `/api/rooms/${room.json?.data?.roomId}/end`, { token, body: endBody });
    const afterEnd = await call(base, 'GET', '/api/me', { token });
    const replayed = await call(base, 'POST', `/api/rooms/${room.json?.data?.roomId}/end`, { token, body: endBody });
    const retried = await call(base, 'POST', `/api/rooms/${room.json?.data?.roomId}/end`, {
      token,
      body: { ...endBody, requestId: 'smoke-end-2' },
    });
    const afterRetry = await call(base, 'GET', '/api/me', { token });
    const expectedXp = xpFor(endBody.durationSec, endBody.cardsUsed);
    add(
      'POST /api/rooms/:id/end：积分等于 xpFor，且同 / 换 requestId 都不会把 XP 加两次',
      ended.status === 200 &&
        ended.json?.data?.xpEarned === expectedXp &&
        afterEnd.json?.data?.progress?.xp === beforeEnd.json?.data?.progress?.xp + expectedXp &&
        afterEnd.json?.data?.progress?.conversations === beforeEnd.json?.data?.progress?.conversations + 1 &&
        replayed.status === 200 &&
        JSON.stringify(replayed.json) === JSON.stringify(ended.json) &&
        JSON.stringify(retried.json) === JSON.stringify(ended.json) &&
        afterRetry.json?.data?.progress?.xp === afterEnd.json?.data?.progress?.xp,
      `xpEarned=${ended.json?.data?.xpEarned}（期望 ${expectedXp}）xp=${beforeEnd.json?.data?.progress?.xp}→${afterEnd.json?.data?.progress?.xp} 重试后=${afterRetry.json?.data?.progress?.xp}`,
    );

    /* 18. 反馈与收藏：评价挂到那次会话上，句型收藏落库 */
    const feedback = await call(base, 'POST', `/api/rooms/${room.json?.data?.roomId}/feedback`, {
      token,
      body: { tags: [BUDDY_FEEDBACK_TAGS[0]], requestId: 'smoke-fb-1' },
    });
    const savedPhrase = await call(base, 'POST', '/api/me/saved-phrases', {
      token,
      body: { cantonese: '你最近睇緊咩動漫？', phrase: 'What anime have you been watching lately?', roomId: room.json?.data?.roomId, requestId: 'smoke-sp-1' },
    });
    add(
      '反馈 + 收藏：评价返回 ok，句型收藏 201 且带 savedPhraseId',
      feedback.status === 200 &&
        feedback.json?.data?.ok === true &&
        savedPhrase.status === 201 &&
        String(savedPhrase.json?.data?.savedPhrase?.savedPhraseId ?? '').startsWith('sp-'),
      `feedback=${feedback.status} savedPhrase=${savedPhrase.status}`,
    );

    /* 19. 重启不丢：换一个进程实例读同一个快照文件 */
    await close(app);
    app = createServer({ db: createDb({ filePath: file }) });
    base = await listen(app);
    // 同一台设备（同一个 deviceId）回来还是同一个账号
    const relogin = await call(base, 'POST', '/api/auth/session', {
      body: { role: 'learner', deviceId: MY_DEVICE },
    });
    const after = await call(base, 'GET', '/api/me', { token: relogin.json.data.token });
    add(
      'JSON 快照：重启服务后账号、两份资料、设置都还在（同一台设备认回同一个账号）',
      after.status === 200 &&
        relogin.json.data.userId === myAccountId &&
        after.json.data.learnerProfile.interests.length === 2 &&
        after.json.data.buddyProfile.languagesSpoken.length === 2 &&
        after.json.data.settings.anonymous === false,
      `userId=${relogin.json?.data?.userId} learner.interests=${JSON.stringify(after.json?.data?.learnerProfile?.interests)} buddy.languagesSpoken=${JSON.stringify(after.json?.data?.buddyProfile?.languagesSpoken)}`,
    );

    /* 20. 一键重置 */
    const reset = await call(base, 'POST', '/api/dev/reset', { body: {} });
    // 重置会连令牌表一起清掉（旧令牌立刻失效），而且**账号也没了**——先看空表
    const afterWipe = await call(base, 'GET', '/api/health');
    const stale = await call(base, 'GET', '/api/me', { token: relogin.json.data.token });
    // 同一台设备再进来就是**新人**（旧账号已经不存在了），出厂资料全空
    const afterReset = await call(base, 'POST', '/api/auth/session', {
      body: { role: 'learner', deviceId: MY_DEVICE },
    });
    const cleared = await call(base, 'GET', '/api/me', { token: afterReset.json.data.token });
    add(
      'POST /api/dev/reset：一键回到出厂状态（旧令牌失效，账号清空，重新注册是新人）',
      reset.status === 200 &&
        afterWipe.json?.data?.tables?.users === 0 &&
        afterWipe.json?.data?.tables?.profiles === 0 &&
        afterWipe.json?.data?.tables?.queue === 0 &&
        stale.status === 401 &&
        afterReset.status === 201 &&
        afterReset.json?.data?.userId !== myAccountId &&
        cleared.json?.data?.learnerProfile?.interests?.length === 0 &&
        cleared.json?.data?.buddyProfile?.interests?.length === 0 &&
        cleared.json.data.learnerProfile.onboarded === false &&
        cleared.json.data.buddyProfile.onboarded === false,
      `旧令牌=${stale.status} users=${afterWipe.json?.data?.tables?.users} queue=${afterWipe.json?.data?.tables?.queue} learner=${JSON.stringify(cleared.json?.data?.learnerProfile?.interests)} buddy=${JSON.stringify(cleared.json?.data?.buddyProfile?.interests)}`,
    );
  } finally {
    await close(app);
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = checks.filter((check) => !check.ok);
  return { checks, passed: checks.length - failed.length, failed: failed.length };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const { checks, passed, failed } = await runSmoke();
  console.log('CantoBridge 后端冒烟（临时数据文件，不碰 backend/.data）\n');
  for (const check of checks) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}`);
    if (check.detail) console.log(`      ${check.detail}`);
  }
  console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${passed} / ${checks.length}`);
  if (failed > 0) process.exitCode = 1;
}

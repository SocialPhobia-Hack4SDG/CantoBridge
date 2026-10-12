/**
 * 测试场景助手：把「一台设备」变成一条可复用的准备流程。
 *
 * 出厂是**空的**（没有账号、没有队列、没有编出来的人），所以每个需要「有人可匹配」
 * 的用例都得自己把人造出来。造法就是现场那套：一台设备一个 `deviceId` →
 * 注册 → 填资料 → 入队。
 *
 * 顺序很要紧：**先填资料再入队**。队列行是入队那一刻从资料里快照出来的，
 * 反过来（先入队再改资料）列表里还是旧的空画像。
 *
 * 取值都走词表校验：`interests` 取 INTERESTS，`preferredTopics` 取 BUDDY_TOPICS，
 * 写错一个值 PUT 会当场 400——这比在断言里对着一份不会被校验的假数据要可靠。
 */

/** 学习者画像：覆盖三种母语、不同水平与身份，好让排序 / 互补 / 匿名裁剪都有东西可验。 */
export const LEARNER_SPECS = [
  {
    key: 'anon-english',
    anonymous: true,
    nativeLanguage: 'english',
    cantoneseLevel: 'beginner',
    identity: 'exchange_student',
    interests: ['anime', 'food'],
    goal: 'daily_conversation',
  },
  {
    key: 'mandarin',
    anonymous: false,
    nativeLanguage: 'mandarin',
    cantoneseLevel: 'elementary',
    identity: 'university_student',
    interests: ['food', 'travel', 'hong_kong_culture'],
    goal: 'make_local_friends',
  },
  {
    key: 'lucas',
    anonymous: false,
    nativeLanguage: 'english',
    cantoneseLevel: 'intermediate',
    identity: 'working_professional',
    interests: ['movies', 'technology', 'gaming'],
    goal: 'workplace_cantonese',
  },
  {
    key: 'anon-other',
    anonymous: true,
    nativeLanguage: 'other',
    cantoneseLevel: 'beginner',
    identity: 'new_to_hong_kong',
    interests: ['travel', 'photography'],
    goal: 'university_life',
  },
];

/** 母语者画像：`siu-fung` 刻意没填回礼，用来对照「互补徽标不是人人都有」。 */
export const BUDDY_SPECS = [
  {
    key: 'ka-ho',
    interests: ['movies', 'music'],
    preferredTopics: ['hong_kong_food', 'sports'],
    languagesSpoken: ['yue', 'english'],
    identity: 'university_student',
    wantToLearn: ['english'],
  },
  {
    key: 'wai-ling',
    interests: ['food', 'travel'],
    preferredTopics: ['local_culture'],
    languagesSpoken: ['yue', 'mandarin', 'english'],
    identity: 'working_professional',
    wantToLearn: ['mandarin'],
  },
  {
    key: 'siu-fung',
    interests: ['music', 'gaming'],
    preferredTopics: ['sports'],
    languagesSpoken: ['yue', 'english'],
    identity: 'university_student',
    wantToLearn: [],
  },
];

/** 注册一台设备并填好资料；返回 `{ token, accountId, userId, role, peerId, profile }`。 */
export async function registerWithProfile(ui, role, deviceId, patch = {}) {
  const session = await ui.signInAs(role, { deviceId });
  const key = role === 'buddy' ? 'buddyProfile' : 'learnerProfile';
  const res = await ui.request('PUT', `/api/me/profile/${role}`, { token: session.token, body: patch });
  if (res.status !== 200) {
    throw new Error(`准备数据失败：写 ${role} 资料 ${deviceId} → ${res.status} ${res.text}`);
  }
  return {
    ...session,
    accountId: session.userId,
    peerId: res.json.data[key].userId,
    profile: res.json.data[key],
  };
}

/** 造一批正在等的学习者（注册 → 填资料 → 入队）。 */
export async function seedWaitingLearners(ui, specs = LEARNER_SPECS) {
  const out = [];
  for (const [index, spec] of specs.entries()) {
    const patch = {};
    for (const field of ['nativeLanguage', 'cantoneseLevel', 'identity', 'interests']) {
      if (spec[field] !== undefined) patch[field] = spec[field];
    }
    if (spec.goal !== undefined) patch.learningGoal = spec.goal;

    const person = await registerWithProfile(ui, 'learner', `device-${spec.key}-${index}`, patch);
    const joined = await ui.request('POST', '/api/match/queue', {
      token: person.token,
      body: spec.anonymous === undefined ? {} : { anonymous: spec.anonymous },
    });
    if (joined.status !== 200) {
      throw new Error(`准备数据失败：${spec.key} 入队 → ${joined.status} ${joined.text}`);
    }
    out.push({ ...spec, ...person });
  }
  return out;
}

/** 造一批有空的母语者（注册 → 填资料 → 入队）。 */
export async function seedWaitingBuddies(ui, specs = BUDDY_SPECS) {
  const out = [];
  for (const [index, spec] of specs.entries()) {
    const person = await registerWithProfile(ui, 'buddy', `device-${spec.key}-${index}`, {
      interests: spec.interests,
      preferredTopics: spec.preferredTopics,
      languagesSpoken: spec.languagesSpoken,
      identity: spec.identity,
      wantToLearn: spec.wantToLearn,
    });
    const joined = await ui.request('POST', '/api/match/queue', { token: person.token, body: {} });
    if (joined.status !== 200) {
      throw new Error(`准备数据失败：${spec.key} 入队 → ${joined.status} ${joined.text}`);
    }
    out.push({ ...spec, ...person });
  }
  return out;
}

/** 一次把两个方向的人都造好（成房 / 结算 / 信令这类用例的通用前置）。 */
export async function seedBothSides(ui) {
  const learners = await seedWaitingLearners(ui);
  const buddies = await seedWaitingBuddies(ui);
  return { learners, buddies };
}

#!/usr/bin/env node
/**
 * 真数据端到端：**一条命令把 app 跑在真后端上并走完 5 分钟主链路**。
 *
 *   cd frontend && npm run e2e:real
 *
 * 与 `npm test` 的区别：单测/集成测试跑在 mock 数据源上，这个脚本跑在**真后端**上——
 * 用的就是浏览器里默认档位那条链路（DOM stub + 真 `fetch` + `createHttpApi`）。
 *
 * 它替我们盯着三类只有真链路才会暴露的问题：
 *   1. **注册前不建号、点「注册」才建号**：落地页与注册页都是「注册前路由」，启动时**不该有令牌**；
 *      令牌只能由用户在注册页按下去之后出现。脚本**绝不自己调 `api.signIn()`**，必须由 app 完成；
 *   2. **形状适配**：适配层漏字段 → 页面读到 undefined、白屏、渲染不出卡片；
 *   3. **状态同步**：写完接口后本地镜像与服务端不一致（例如伙伴关系"打开即准"）。
 *
 * **对手是本脚本自己注册出来的**（`seedRealPeer`）：后端出厂种子全空，脚本不再
 * 依赖任何假人；不先造出那个人，第 ⑨ 步就配不到对手。这条同时也是「谁注册了就
 * 看见谁」的活体检查 —— 第 ⑭ 步的榜单行数就等于真账号数。
 *
 * 后端由脚本自己管，**默认自己起一个**（临时快照的端口）：跑完只杀自己起的那个、
 * 删掉临时快照，`backend/.data/` 永远不被污染，别人正在跑的服务也不动。
 *
 * **为什么不复用已经在跑的 8787**（`shouldReuseBackend()` 有单测）：复用 = 拿一个
 * **脏基线**去跑一条要求干净基线的断言。第 ⑪ 项断言「store 的 xp 与服务端一致」，
 * 而一个开发用的后端快照跑了一整天之后 xp 早就涨到种子值之上了；脚本又承诺不动别人的
 * 数据，没法把两边对齐 —— 结果是「后端好好的，e2e 却红」。所以默认挑一个空闲端口
 * 自己起（8787 空着就用 8787，被占就换一个），只有**显式**给了 `E2E_BASE_URL`
 * 才认为「你就是要用这个后端」，那时才复用。
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boot, flush, restoreGlobalTimers } from '../tests/helpers/app-harness.mjs';
import { labelOf } from '../src/data/labels.js';
import { createTranslator } from '../src/i18n/i18n.js';
import { xpFor } from '../src/lib/logic.js';
import { createApi } from '../src/services/index.js';
import { TOKEN_KEY } from '../src/services/http.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const REPO = resolve(FRONTEND, '..');
const BACKEND_ENTRY = join(REPO, 'backend', 'src', 'server.js');

/** 后端端口与 `src/services/index.js` 的 `BACKEND_PORT` 是同一个约定。 */
export const DEFAULT_PORT = 8787;

/** 显式指定后端地址（`E2E_BASE_URL=http://host:port npm run e2e:real`）。只有这时才复用已在跑的服务。 */
const EXPLICIT_BASE_URL = process.env.E2E_BASE_URL ?? null;

/** 跑起来之后才知道最终端口（默认端口被占时会换一个），所以是 `let`。 */
let BASE_URL = EXPLICIT_BASE_URL ?? 'http://localhost:' + DEFAULT_PORT;

const HEALTH_TIMEOUT_MS = 10_000;

const zh = createTranslator('zh-Hans');
const label = (group, value) => labelOf(group, value, 'zh-Hans');

/* ------------------------------------------------------------------ *
 * 结果收集与断言
 * ------------------------------------------------------------------ */

const results = [];

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** 跑一个步骤：失败不吞掉，如实记下来继续走后面（最后一起汇报）。 */
async function step(name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, ok: true });
    console.log('PASS  ' + name + (evidence ? '\n        ' + evidence : ''));
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log('FAIL  ' + name + '\n        ' + (error?.message ?? String(error)));
  }
}

/* ------------------------------------------------------------------ *
 * 后端：探活 / 自起 / 收尾
 * ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 等到条件成立（真 sleep 轮询）。
 *
 * **为什么不能只用 `flush()`**：`flush()` 只转 `setImmediate`（check 阶段），真网络的
 * TCP 连接建不起来 —— 实测启动登录的 `fetch` 在 50 轮 `setImmediate` 之后仍未完成，
 * 换 `sleep(150)` 立刻就有令牌。真数据脚本必须按"真时间"等。
 */
async function waitFor(predicate, { label: what, timeout = 6000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let value = false;
    try {
      value = await predicate();
    } catch {
      value = false;
    }
    if (value) return value;
    if (Date.now() >= deadline) throw new Error('等待超时（' + timeout + 'ms）：' + what);
    await sleep(interval);
  }
}

async function probeHealth(timeoutMs = 800) {
  try {
    const response = await fetch(BASE_URL + '/api/health', { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

/**
 * 要不要复用别人已经在跑的后端？
 *
 * **只有显式给了 `E2E_BASE_URL` 才复用**（那是用户点名「就跑这个后端」）。
 * 默认一律自己起：复用本地那个跑了一整天的开发后端，等于拿一个**脏基线**去跑
 * 第 ⑪ 项那条「store 的 xp 与服务端一致」—— 那个快照里的 xp 早就被之前的调试
 * 累积到种子值之上，而脚本承诺不动别人的数据，没法把两边对齐，于是「后端好好的、
 * e2e 却红」。这条纯函数有单测（`tools/e2e-real.test.mjs`）。
 */
export function shouldReuseBackend({ explicitBaseUrl = null } = {}) {
  return Boolean(explicitBaseUrl);
}

/**
 * 这个端口现在空着吗？—— **用「连一下」判断，不要用「能不能 bind」**。
 *
 * macOS(BSD) 允许在别人已经 bind 了通配地址 `*:8787` 之后，再 bind `127.0.0.1:8787`，
 * 于是 bind 探测会骗你说「空着」，脚本就会去 8787 跟你的开发后端撞车（实测踩过：
 * 子进程抢到了 127.0.0.1:8787，`localhost:8787` 的请求全被它接走）。连得上就说明有人。
 */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const socket = connect({ port: Number(port), host: '127.0.0.1' });
    const done = (free) => {
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(false));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(true)); // ECONNREFUSED / EHOSTUNREACH：没人听
  });
}

/** 向系统要一个空闲端口（`listen(0)`）。默认端口被自己的开发后端占着时用它换一个。 */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * 选端口：显式指定就照用；否则约定端口 8787 空着就用它，被占就换一个空闲端口。
 *
 * 探测函数可注入（默认是上面两个真实现），这样这条决策能在单测里穷举三种情况。
 */
export async function pickPort({
  explicitBaseUrl = EXPLICIT_BASE_URL,
  defaultPort = DEFAULT_PORT,
  isFree = portIsFree,
  freePort = findFreePort,
} = {}) {
  if (explicitBaseUrl) return new URL(explicitBaseUrl).port || String(defaultPort);
  if (await isFree(defaultPort)) return String(defaultPort);
  return String(await freePort());
}

/** 自己起一个用临时快照的后端（默认路径）；显式 `E2E_BASE_URL` 且探活成功时才复用。 */
async function ensureBackend() {
  if (shouldReuseBackend({ explicitBaseUrl: EXPLICIT_BASE_URL }) && (await probeHealth())) {
    return { reused: true, child: null, dataFile: null };
  }

  if (!existsSync(BACKEND_ENTRY)) {
    throw new Error('找不到后端入口：' + BACKEND_ENTRY + '（请在仓库里跑）');
  }

  const port = await pickPort();
  BASE_URL = EXPLICIT_BASE_URL ?? 'http://localhost:' + port;

  const dataFile = join(tmpdir(), 'cantobridge-e2e-' + Math.random().toString(36).slice(2, 10) + '.json');
  const child = spawn(process.execPath, [BACKEND_ENTRY, port], {
    cwd: join(REPO, 'backend'),
    env: { ...process.env, CANTOBRIDGE_DATA: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await probeHealth(400)) return { reused: false, child, dataFile };
    await sleep(200);
  }

  child.kill();
  throw new Error('后端 ' + HEALTH_TIMEOUT_MS / 1000 + 's 内没起来（' + BASE_URL + '）。进程日志：\n' + (log || '(空)'));
}

/** 只清理**自己起的**那个后端：别人正在跑的服务不动，别人的数据不删。 */
function stopBackend(backend) {
  if (!backend || backend.reused) return;
  backend.child?.kill();
  for (const file of [backend.dataFile, backend.dataFile + '.tmp']) {
    if (file && existsSync(file)) rmSync(file, { force: true });
  }
}

/* ------------------------------------------------------------------ *
 * 交互小工具（真脚本里按"用户看到的字"点，比类名稳）
 * ------------------------------------------------------------------ */

/**
 * 找按钮：**先找文字完全相等的**，再退回「包含」。
 *
 * 为什么要这个顺序：身份卡是个大按钮（标题+副标题+示例标签都算它的文字），
 * 只能"包含"匹配；而资料页的「暂时跳过」和隐私页的「完成设置」都含"跳"字时，"包含"会点错人。
 * 先精确、后包含，两种情况都对。
 */
function findClickable(root, text) {
  const buttons = root.walk().filter((node) => node.tagName === 'BUTTON');
  return (
    buttons.find((node) => node.textContent.trim() === text) ??
    buttons.find((node) => node.textContent.includes(text)) ??
    null
  );
}

async function click(ui, text) {
  const button = findClickable(ui.root, text);
  expect(button, '点不到按钮「' + text + '」；当前页面：' + ui.text().slice(0, 200));
  button.click();
  await flush();
}

/** 装一个最小 localStorage（真机上是浏览器给的；令牌落在这里，用于断言启动登录） */
function installLocalStorage() {
  const map = new Map();
  const stub = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
  } catch {
    globalThis.localStorage = stub;
  }
  return stub;
}

/* ------------------------------------------------------------------ *
 * 造一个**真**对手
 * ------------------------------------------------------------------ */

/**
 * 后端出厂种子现在是**空的**（「谁注册了就看见谁」），所以脚本不能再指望后端自带假人。
 *
 * 第 ⑨ 步的演示口子（`POST /api/dev/match-request`）要在**队列里**找一个对手，
 * 空世界里它会回 404 `not_found`（前端映射成 `no_candidate`）。这里就用真接口
 * 先造出那个人：真注册 → 真填资料 → 真入队。全程不碰数据库内部，走的就是两台
 * 真设备会走的那条路。
 *
 * 返回的 `peerId` 是资料 id（`buddy-<accountId>`），与队列行、成房用的是同一个。
 */
async function seedRealPeer() {
  const post = async (path, body, token) => {
    const response = await fetch(BASE_URL + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(path + ' → ' + response.status + ' ' + JSON.stringify(json));
    return json.data;
  };
  const put = async (path, body, token) => {
    const response = await fetch(BASE_URL + path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(path + ' → ' + response.status + ' ' + JSON.stringify(json));
    return json.data;
  };

  const session = await post('/api/auth/session', { role: 'buddy', deviceId: 'device-e2e-peer' });
  await put(
    '/api/me/profile/buddy',
    { languagesSpoken: ['yue', 'english'], interests: ['anime'] },
    session.token,
  );
  const me = await fetch(BASE_URL + '/api/me', { headers: { authorization: 'Bearer ' + session.token } });
  const peerId = (await me.json()).data.buddyProfile.userId;
  await post('/api/match/queue', {}, session.token);
  return { peerId, accountId: session.userId };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  const backend = await ensureBackend();
  console.log('== 真数据端到端（app + 真后端） ==');
  console.log('后端：' + BASE_URL + (backend.reused ? '（复用你显式指定的服务，不动它的数据）' : '（本脚本新起，快照 ' + backend.dataFile + '）'));
  console.log('');

  installLocalStorage();
  let ui = null;
  const failures = [];

  // 出厂空世界：先造出那个「对面的人」，第 ⑨ 步才配得到对手。
  // 放在 try 里 —— 它要是抛错，也得走到 finally 把自己起的后端收掉，不能留孤儿进程。
  try {
    const peer = await seedRealPeer();
    console.log('对手（真账号）：' + peer.peerId + ' 已入队 —— 出厂种子是空的，这个人由本脚本真注册出来');
    console.log('');

    // (b) 用真 api 启动 app —— 这一步**故意不自己调 signIn**：建号必须由用户在注册页按下去
    ui = await boot({
      apiFactory: (store) => createApi({ store, useMock: false, baseUrl: BASE_URL }),
      storagePreset: { learnerProfile: { onboarded: false }, buddyProfile: { onboarded: false } },
      // 走真 fetch 就必须留真定时器：undici 内部要用 setTimeout(...).unref()
      installTimers: false,
    });

    await step('① 注册前不建号：落地页启动不登录（没有令牌）', async () => {
      // 落地页与注册页是「注册前路由」（app.js 的 PRE_AUTH_ROUTES）：启动不许建账号。
      // 以前 app.start() 一上来就 POST /api/auth/session，用户从头到尾没按过「注册」。
      await flush(20);
      const token = globalThis.localStorage.getItem(TOKEN_KEY);
      expect(token === null, '落地页竟然已经登录了（' + TOKEN_KEY + '=' + token + '）——注册前路由不该建号');
      expect(ui.win.location.hash === '#/' || ui.win.location.hash === '', '启动没停在落地页，实际 ' + ui.win.location.hash);
      return 'hash=' + ui.win.location.hash + ' | ' + TOKEN_KEY + '=(空)';
    });

    await step('② 落地页渲染（有「开始使用」）', async () => {
      expect(ui.has('.landing'), '落地页没渲染');
      expect(ui.text().includes(zh('landing.getStarted')), '落地页缺少「开始使用」');
      return 'hash=' + ui.win.location.hash;
    });

    await step('③ 点「开始使用」→ 注册页（仍然没有令牌）', async () => {
      await click(ui, zh('landing.getStarted'));
      expect(ui.win.location.hash === '#/register', '没跳到注册页，实际 ' + ui.win.location.hash);
      await flush(10);
      expect(globalThis.localStorage.getItem(TOKEN_KEY) === null, '注册页不该自动建号——要等用户点「注册」');
      expect(ui.text().includes(zh('register.submit')), '注册页没有「' + zh('register.submit') + '」按钮');
      return 'hash=' + ui.win.location.hash + ' | 仍未建号';
    });

    await step('④ 点「注册并开始」→ 真建号 → 身份选择页', async () => {
      await click(ui, zh('register.submit'));
      const token = await waitFor(() => globalThis.localStorage.getItem(TOKEN_KEY), {
        label: '注册写入 ' + TOKEN_KEY + '（RegisterPage → auth.ensure() → POST /api/auth/session）',
      });
      expect(token.length > 0, '令牌为空');
      await waitFor(() => ui.win.location.hash === '#/onboarding/role', { label: '注册成功后进身份选择页' });
      // 真 GET /api/me：没令牌会 401 抛错 —— 顺带证明令牌真能用、且资料灌进了 store
      const me = await ui.api.getMe();
      expect(me?.learnerProfile?.userId, 'GET /api/me 没回 learnerProfile');
      const stored = ui.store.getState().learnerProfile;
      expect(stored.userId === me.learnerProfile.userId, 'store 的资料不是服务端那份（' + stored.userId + ' ≠ ' + me.learnerProfile.userId + '）');
      return 'token=' + token.slice(0, 12) + '… | userId=' + me.learnerProfile.userId + ' | hash=' + ui.win.location.hash;
    });

    await step('⑤ 选学习者 → 下一步 → 资料页', async () => {
      await click(ui, zh('role.learnerTitle'));
      await click(ui, zh('action.next'));
      expect(ui.win.location.hash === '#/onboarding/profile', '没跳到资料页，实际 ' + ui.win.location.hash);
      return 'hash=' + ui.win.location.hash;
    });

    await step('⑥ 资料页：选择答案 → 「暂时跳过」→ 真后端写入', async () => {
      await waitFor(() => ui.has('.question-pager'), { label: '资料页从真接口拿到词表、渲染出分页问卷' });
      await click(ui, label('nativeLanguages', 'english'));
      await click(ui, zh('setup.nextItem'));
      await click(ui, label('levels', 'beginner'));
      await click(ui, zh('setup.nextItem'));
      await click(ui, label('interests', 'anime'));
      await click(ui, zh('setup.skipForNow'));
      await click(ui, zh('setup.nextStep'));
      await waitFor(() => ui.win.location.hash === '#/onboarding/privacy', {
        label: '真 PUT /api/me/profile/learner 完成后跳到隐私页',
      });

      const me = await ui.api.getMe(); // 真读回，证明写进了服务端
      expect(me.learnerProfile.nativeLanguage === 'english', '服务端没存下 nativeLanguage，实际 ' + me.learnerProfile.nativeLanguage);
      expect((me.learnerProfile.interests ?? []).includes('anime'), '服务端没存下 interests');
      expect(ui.win.location.hash === '#/onboarding/privacy', '完成之后没到隐私页，实际 ' + ui.win.location.hash);
      return 'PUT /api/me/profile/learner → nativeLanguage=english, interests 含 anime';
    });

    await step('⑦ 点「完成设置」→ 回首页（不是去匹配）', async () => {
      await click(ui, zh('privacy.finishSetup'));
      await waitFor(() => ui.win.location.hash === '#/home', { label: '「完成设置」之后回首页' });
      // 首页会拉真进度与真记录：等它渲染出来（有主 CTA 就说明 load 回来了）
      await waitFor(() => ui.has('.home-action') || ui.text().includes(zh('home.practiceTime')), {
        label: '首页用真数据渲染出统计',
      });
      return 'hash=' + ui.win.location.hash;
    });

    await step('⑧ 匹配页：点「开始匹配」→ 真 POST 入队 → 等待面板', async () => {
      await ui.goto('/match');
      await click(ui, zh('match.start'));
      await waitFor(() => ui.has('.waiting-panel'), {
        label: '真 POST /api/match/queue 回来后切到等待面板（失败会留在开始卡片）',
      });
      expect(ui.has('.waiting-elapsed'), '等待面板没有计时');
      return 'POST /api/match/queue → 等待面板已渲染';
    });

    let roomId = null;
    await step('⑨ 演示口子造待接受请求 → 接受 → 进房', async () => {
      ui.advance(9000); // 越过 8 秒阈值
      // 页面的秒级 ticker 是**真 interval**：等它在"已等待 ≥ 8s"时自己重渲染出演示入口。
      // （不能靠 ui.goto('/match') 触发重渲染：已经在这个 hash 上，赋同值不会发 hashchange）
      await waitFor(() => findClickable(ui.root, zh('match.demoBuddy')), {
        timeout: 4000,
        label: '等待面板在「已等待 ≥ 8s」后露出「使用演示伙伴」入口',
      });
      await click(ui, zh('match.demoBuddy'));
      await waitFor(() => ui.has('.match-toast'), {
        label: '真 POST /api/dev/match-request 之后弹出接受弹窗',
      });
      await click(ui, zh('match.accept'));
      await waitFor(() => /^#\/room\/r-/.test(ui.win.location.hash), {
        label: '真 POST accept 成房后进入 #/room/:roomId',
      });
      roomId = ui.store.getState().runtime.room?.roomId ?? null;
      expect(roomId, 'store 里没有房间');
      // 关键：房间必须在**服务端真的存在**（accept 走的是 api 层，不是本地挪状态）
      const room = await ui.api.getRoom(roomId);
      expect(room?.room?.roomId === roomId || room?.roomId === roomId, '服务端查不到这个房间：' + JSON.stringify(room).slice(0, 120));
      return 'roomId=' + roomId + '（真 POST accept 成房，服务端已确认）';
    });

    await step('⑩ 房间页：真话题卡（张数 > 0、三语齐全、与接口一致）', async () => {
      expect(roomId, '上一步没拿到 roomId，跳过不了——如实报错');
      await waitFor(() => ui.has('.topic-card'), {
        label: '真 GET /api/rooms/:id/cards 回来后渲染出话题卡',
      });
      const yue = ui.one('.topic-line.is-yue')?.textContent ?? '';
      const mandarin = ui.one('.topic-line.is-mandarin')?.textContent ?? '';
      const english = ui.one('.topic-line.is-english')?.textContent ?? '';
      expect(yue.length > 0 && mandarin.length > 0 && english.length > 0, '话题卡三语不全');
      const remote = await ui.api.getCards(roomId, {}); // 再打一次真接口做交叉核对
      expect(remote.cards.length > 0, 'GET /api/rooms/:id/cards 返回 0 张');
      const position = ui.one('.topic-stack') ? ui.text() : '';
      expect(position.includes('1 / ' + remote.cards.length) || position.includes('/ ' + remote.cards.length), '页面没显示「第 1 / N 张」');
      return '卡池 ' + remote.cards.length + ' 张 | 首张：' + yue.slice(0, 14) + ' / ' + english.slice(0, 24);
    });

    let reward = null;
    await step('⑪ 点「结束」→ 结算页，XP = 时长规则 + 卡片 × 5', async () => {
      ui.advance(120_000); // 拨快 2 分钟，让时长参与积分（真结算用页面算出的 durationSec）
      await click(ui, zh('room.hangup'));
      await waitFor(() => /^#\/room\/r-.+\/summary$/.test(ui.win.location.hash), {
        label: '真 POST /api/rooms/:id/end 完成后进入结算页',
      });
      reward = ui.store.getState().runtime.reward ?? null;
      expect(reward, 'store 里没有结算结果');
      expect(reward.offline !== true, '结算走了离线兜底（offline=true）——真 POST /api/rooms/:id/end 失败了');
      const expected = xpFor(reward.durationSec, reward.cardsUsed);
      expect(reward.xpEarned === expected, 'XP 不对：服务端 ' + reward.xpEarned + ' ≠ xpFor(' + reward.durationSec + 's, ' + reward.cardsUsed + ' 张) = ' + expected);
      expect(ui.text().includes('+' + reward.xpEarned), '结算页没显示 +' + reward.xpEarned);
      return 'durationSec=' + reward.durationSec + ' | cardsUsed=' + reward.cardsUsed + ' | XP=' + reward.xpEarned;
    });

    await step('⑫ 结算页：给评价 + 发出伙伴申请（都走真接口）', async () => {
      expect(reward, '上一步没拿到结算结果');
      await click(ui, label('feedback', 'friendly'));
      await click(ui, zh('action.save'));
      const latest = await waitFor(
        async () => {
          const history = await ui.api.getHistory(); // 真读回：反馈挂在最近一条记录上
          return history[0]?.feedback ? history[0] : null;
        },
        { label: '真 POST /api/rooms/:id/feedback 之后，history[0] 上出现这条评价' },
      );
      expect(latest.sessionId, 'GET /api/me/history 没有记录');
      expect((latest.feedback?.tags ?? []).includes('friendly'), '服务端没记下这次评价');
      const feedbackEvidence = 'POST feedback → history[0].feedback.tags=' + JSON.stringify(latest.feedback.tags);

      await click(ui, zh('summary.sendRequest'));
      // 两种合法结果：对方还没申请过我 → 「等 ta 确认」；对方早先申请过我 → 双向确认，直接成为伙伴。
      // 这里走的是前者（对手是本脚本刚注册的真人，还没申请过我）。
      const stateText = await waitFor(
        () => {
          const text = ui.one('.buddy-request-state')?.textContent ?? '';
          return text.includes(zh('summary.requested')) || text.includes(zh('summary.alreadyBuddy')) ? text : null;
        },
        { label: '真 POST /api/me/buddy-requests 之后界面切到「等确认 / 已是伙伴」' },
      );

      const peerId = reward.peer?.peerId ?? null;
      const [buddies, requests] = await Promise.all([ui.api.listBuddies(), ui.api.listBuddyRequests()]);
      const becameBuddy = buddies.some((row) => row.peerId === peerId);
      const pendingOutgoing = requests.some((row) => row.peerId === peerId && row.direction === 'outgoing');
      expect(becameBuddy || pendingOutgoing, '服务端既没成为伙伴、也没有我发出的申请（peerId=' + peerId + '）');
      const outcome = becameBuddy
        ? '双向申请 → 直接成为伙伴（对方申请过我）'
        : 'outgoing 待确认（requests=' + requests.length + ' 条）';
      return feedbackEvidence + ' | POST buddy-requests → ' + outcome;
    });

    await step('⑬ 「我的」页：资料与统计来自真后端', async () => {
      await ui.goto('/me');
      // 等**统计瓦片**渲染出来（`.tile-grid` 只在 load 成功后出现；成就墙标题在骨架屏阶段
      // 就已经在页面上了，用它当"加载完成"的信号会等早）
      await waitFor(() => ui.has('.tile-grid'), { label: '「我的」页用真 progress 渲染出统计瓦片' });
      const progress = await ui.api.getProgress(); // 真 GET /api/me/progress
      const practiceText = zh('duration.minutes', { minutes: progress.practiceMinutesThisWeek });
      expect(ui.text().includes(practiceText), '我的页没有显示服务端的练习时长「' + practiceText + '」');
      expect(ui.text().includes(zh('me.achievements')), '我的页没有成就墙');
      expect(ui.store.getState().progress.xp === progress.xp, 'store 的 xp 与服务端不一致：' + ui.store.getState().progress.xp + ' ≠ ' + progress.xp);
      const stored = ui.store.getState().learnerProfile;
      expect((stored.interests ?? []).includes('anime'), 'store 的资料没带上服务端的兴趣');
      return 'xp=' + progress.xp + ' | 本周 ' + practiceText + ' | 资料 interests 含 anime';
    });

    await step('⑭ 排行榜：行数来自真后端', async () => {
      await ui.goto('/leaderboard');
      await waitFor(() => ui.all('.leaderboard-row').length > 0, {
        label: '真 GET /api/leaderboard 回来后榜单渲染出行',
      });
      const rows = await ui.api.getLeaderboard('weekly', 'learner'); // 真 GET /api/leaderboard
      const rendered = ui.all('.leaderboard-row').length;
      expect(rows.length > 0, '真接口返回 0 行');
      expect(rendered >= rows.length, '渲染行数（' + rendered + '）少于服务端返回（' + rows.length + '）');
      const first = rows.find((row) => !row.anonymous);
      if (first) expect(ui.text().includes(first.userId), '榜单页缺少第一名 ' + first.userId);
      return 'GET /api/leaderboard → ' + rows.length + ' 行 | 页面渲染 ' + rendered + ' 行';
    });

    await step('⑮ 伙伴关系「打开即准」：store 与服务端一致', async () => {
      await ui.goto('/me'); // 我的页会拉伙伴关系，同时 socialSync 早已在启动时对齐过
      await waitFor(() => ui.text().includes(zh('buddy.slot')), { label: '「我的」页渲染出伙伴插槽' });
      const [buddies, requests] = await Promise.all([ui.api.listBuddies(), ui.api.listBuddyRequests()]);
      const key = (row) => (row.peerId ?? row.requestId) + ':' + (row.direction ?? 'buddy');
      const localBuddies = ui.store.getState().social.buddies ?? [];
      const localRequests = ui.store.getState().social.buddyRequests ?? [];
      expect(
        localBuddies.map((row) => row.peerId).sort().join(',') === buddies.map((row) => row.peerId).sort().join(','),
        '本地伙伴列表与服务端不一致：' + JSON.stringify(localBuddies.map((row) => row.peerId)) + ' ≠ ' + JSON.stringify(buddies.map((row) => row.peerId)),
      );
      expect(
        localRequests.map(key).sort().join(',') === requests.map(key).sort().join(','),
        '本地申请列表与服务端不一致：' + JSON.stringify(localRequests.map(key)) + ' ≠ ' + JSON.stringify(requests.map(key)),
      );
      return 'buddies=' + buddies.length + ' | requests=' + requests.length + '（本地镜像与服务端逐条一致）';
    });

    // 这一步钉住「页面绕开 api 层只改本地」那类回归：匿名/可见范围是**服务端同步**的设置项
    await step('⑯ 设置同步：匿名开关真的进了服务端（不是只改本地）', async () => {
      await ui.goto('/me');
      await waitFor(() => ui.one('.switch'), { label: '「我的」页渲染出匿名开关' });
      const before = (await ui.api.getMe()).settings.anonymous;
      ui.one('.switch').click();
      const flipped = await waitFor(
        async () => {
          const me = await ui.api.getMe(); // 真 GET /api/me，服务端说了才算
          return me.settings.anonymous === !before ? { anonymous: me.settings.anonymous } : false;
        },
        { label: '服务端 settings.anonymous 翻转为 ' + !before + '（PUT /api/me/settings）' },
      );
      expect(flipped.anonymous === !before, '服务端没跟着变：' + before + ' → ' + flipped.anonymous);
      expect(ui.store.getState().settings.anonymous === !before, '本地镜像与服务端不一致');
      return 'PUT /api/me/settings → anonymous ' + before + ' → ' + flipped.anonymous;
    });

    // 这一步钉住「退出并换人」走的是**真接口**：服务端那条会话必须真的作废，
    // 本机设备 id 必须真的换掉（否则下一个人注册出来的还是同一个账号）。
    await step('⑰ 退出并换人：真 POST /api/auth/logout + 本机设备 id 轮换', async () => {
      await ui.goto('/me');
      await waitFor(() => findClickable(ui.root, zh('account.signOut')), {
        label: '「我的」页渲染出「' + zh('account.signOut') + '」入口',
      });
      const oldToken = globalThis.localStorage.getItem(TOKEN_KEY);
      // 设备 id 落在 store 自己的存档适配器里（harness 用的是内存存档，不是全局 localStorage）
      const oldDevice = ui.store.deviceId();
      const oldAccount = ui.store.getState().learnerProfile?.userId ?? null;
      expect(oldToken && oldDevice, '退出前应当有令牌与设备 id');

      await click(ui, zh('account.signOut')); // 第一步：展开二次确认
      await click(ui, zh('account.confirmYes')); // 第二步：真的退出
      await waitFor(() => ui.win.location.hash === '#/' || ui.win.location.hash === '', {
        label: '退出后回到落地页',
      });

      expect(globalThis.localStorage.getItem(TOKEN_KEY) === null, '退出后本地令牌没清掉');
      const newDevice = ui.store.deviceId();
      expect(newDevice && newDevice !== oldDevice, '退出后设备 id 没轮换（下一个人会注册成同一个人）：' + oldDevice + ' → ' + newDevice);

      // 服务端那一条会话必须真的没了：拿旧令牌打真接口应当 401
      const stale = await fetch(BASE_URL + '/api/me', { headers: { authorization: 'Bearer ' + oldToken } });
      expect(stale.status === 401, '旧令牌竟然还能用（status=' + stale.status + '）——POST /api/auth/logout 没生效');

      // 这台设备现在回到「没注册过」：注册页给的是「注册并开始」，不是「继续使用」
      await ui.goto('/register');
      await waitFor(() => ui.text().includes(zh('register.submit')), {
        label: '退出后注册页回到「' + zh('register.submit') + '」',
      });
      expect(!ui.text().includes(zh('register.continue')), '退出后注册页还显示「' + zh('register.continue') + '」——本机账号没清干净');
      return 'token 已清 | 设备 id ' + oldDevice + ' → ' + newDevice + ' | 旧令牌 401 | 旧账号 ' + oldAccount + ' 仍在服务端';
    });
  } catch (error) {
    // 连"跑起来"都没做到（例如 boot 抛错）：如实记一条，别假装通过
    results.push({ name: '启动 app（真数据）', ok: false, error });
    console.log('FAIL  启动 app（真数据）\n        ' + (error?.message ?? String(error)));
  } finally {
    restoreGlobalTimers();
    stopBackend(backend);
  }

  const passed = results.filter((row) => row.ok).length;
  const failed = results.filter((row) => !row.ok);
  console.log('');
  console.log('== 汇总 ==');
  console.log(passed + '/' + results.length + ' 通过' + (failed.length === 0 ? ' 🎉' : ''));
  for (const row of failed) {
    console.log('  ✗ ' + row.name + ' —— ' + (row.error?.message ?? '').split('\n')[0]);
  }
  if (failed.length > 0) process.exitCode = 1;

  // undici 的连接池可能让进程多赖一会儿，这里显式收尾（exitCode 已经设好）
  process.exit(process.exitCode ?? 0);
}

// 只在**被直接执行**时跑主流程。`node --test` 会 import 这个文件拿 `shouldReuseBackend`
// 这类纯函数，那时绝不能让整条链路顺手跑起来（会真的起后端、真的发请求）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('e2e:real 起步就失败了：' + (error?.message ?? String(error)));
    process.exitCode = 1;
    process.exit(1);
  });
}

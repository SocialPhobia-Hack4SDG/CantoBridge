/**
 * 文档一致性校验的测试。运行：node --test frontend/tools
 *
 * 除了跑真实文档的全量校验，也用合成输入验证每个解析器的正反例，
 * 避免「校验永远返回空错误」这种假绿。
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  API_CONTRACT_DOC,
  DOC_FILES,
  NON_CONTRACT_APIS,
  NON_ROUTE_EXACT,
  REQUIRED_DATES,
  checkDocs,
  checkMermaid,
  checkRouteStates,
  extractApiPaths,
  extractRouteRefs,
  isComponentName,
  parseApiTable,
  parseComponentTable,
  parseRouteTable,
  splitSections,
  stripCodeFences,
} from './check-docs.mjs';

const frontendDir = resolve(import.meta.dirname, '..');

const readDoc = (relativePath) => readFileSync(join(frontendDir, relativePath), 'utf8');

test('全部规划文档存在且非空', () => {
  for (const relativePath of DOC_FILES) {
    const absolute = join(frontendDir, relativePath);
    assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
    assert.ok(readDoc(relativePath).trim().length > 500, `${relativePath} 内容过短，可能是占位文件`);
  }
  assert.ok(existsSync(join(frontendDir, 'README.md')), '缺少 README.md');
});

test('路由表可解析、格式合法且无重复', () => {
  const routes = parseRouteTable(readDoc('docs/03-ia-and-pages.md'));
  assert.ok(routes.length >= 10, `路由数量偏少：${routes.length}`);
  const names = routes.map((item) => item.route);
  assert.equal(new Set(names).size, names.length, '路由存在重复');
  for (const { route, page } of routes) {
    assert.match(page, /^[A-Z][A-Za-z]+Page$/, `路由 ${route} 的页面组件命名不符合约定`);
  }
  assert.ok(names.includes('/room/:roomId'), '缺少会话房间路由');
  assert.ok(names.includes('/home'), '缺少首页路由，Home 是产品提示词要求的页面');
  assert.ok(names.includes('/match/:learnerId'), '缺少资料预览路由');
});

test('组件清单可解析且无重复', () => {
  const components = parseComponentTable(readDoc('docs/05-design-system.md'));
  assert.ok(components.length >= 20, `组件数量偏少：${components.length}`);
  assert.equal(new Set(components).size, components.length, '组件清单存在重复');
  for (const name of components) {
    assert.ok(isComponentName(name), `清单中的 ${name} 不是合法组件名`);
  }
});

test('真实文档整体校验通过', () => {
  const { errors, stats } = checkDocs({ frontendDir });
  assert.deepEqual(errors, [], `文档校验未通过：\n${errors.join('\n')}`);
  assert.ok(stats.routeCount >= 10);
  assert.ok(stats.componentCount >= 20);
  assert.ok(stats.apiCount >= 20, `接口清单条目偏少：${stats.apiCount}`);
  assert.ok(stats.mermaidBlockCount >= 4, '关键流程图数量不足，应包含主流程、状态机与时序图');
});

test('CLI：node tools/check-docs.mjs 真的会跑校验并打印统计', () => {
  // 回归守卫：这个文件曾经只有导出、没有 CLI —— `npm run check` 里的这一段一直在空转，
  // 无论文档多乱都静默退出 0。所以这里必须断言「有输出」而不只是「退出码是 0」。
  const script = join(frontendDir, 'tools', 'check-docs.mjs');
  const output = execFileSync(process.execPath, [script], { cwd: frontendDir, encoding: 'utf8' });
  assert.match(output, /文档一致性校验通过/);
  const stats = JSON.parse(output.slice(output.indexOf('{')));
  assert.ok(stats.routeCount >= 10, 'CLI 输出的统计里应当带上真实路由数');
  assert.ok(stats.docCount >= 10, 'CLI 输出的统计里应当带上真实文档数');
});

test('路由引用：裸写的 `/api` / `/ws` 不算前端路由', () => {
  for (const value of NON_ROUTE_EXACT) {
    assert.equal(extractRouteRefs('见 `' + value + '` 与 `/api/health` 两处').size, 0, value + ' 被误判成前端路由');
  }
  // 但真·前端路由仍然要被抓出来
  assert.deepEqual([...extractRouteRefs('跳到 `/match/:learnerId`')], ['/match/:learnerId']);
});

test('关键日期全部落在里程碑文档中', () => {
  const roadmap = readDoc('docs/06-roadmap.md');
  for (const date of REQUIRED_DATES) {
    assert.ok(roadmap.includes(date), `06 缺少关键日期 ${date}`);
  }
});

test('stripCodeFences 会屏蔽围栏内的内容', () => {
  const input = ['说明', '```text', '`/not-a-real-route`', '```', '结尾'].join('\n');
  const stripped = stripCodeFences(input);
  assert.ok(!stripped.includes('/not-a-real-route'));
  assert.ok(stripped.includes('说明'));
  assert.ok(stripped.includes('结尾'));
});

test('extractRouteRefs 只认以斜杠开头的反引号路径，并放过接口前缀', () => {
  const refs = extractRouteRefs('见 `/match`、`/room/:roomId`、`/api/queue`、`src/app/x.tsx`、`node --test`');
  assert.deepEqual([...refs].sort(), ['/match', '/room/:roomId']);
});

test('checkMermaid 能识别合法图类型并拦截未闭合的围栏', () => {
  const good = ['```mermaid', 'flowchart TD', 'A --> B', '```'].join('\n');
  assert.deepEqual(checkMermaid(good), []);

  const unknownType = ['```mermaid', 'notadiagram TD', 'A --> B', '```'].join('\n');
  assert.equal(checkMermaid(unknownType).length, 1);

  const unbalanced = ['```mermaid', 'flowchart TD', 'A --> B'].join('\n');
  assert.ok(checkMermaid(unbalanced).some((message) => message.includes('奇数')));
});

test('isComponentName 不会把技术名词当成组件', () => {
  assert.ok(isComponentName('TopicCardStack'));
  assert.ok(isComponentName('EmptyState'));
  assert.equal(isComponentName('Tailwind'), false);
  assert.equal(isComponentName('Zustand'), false);
  assert.equal(isComponentName('WebRTC'), false);
  assert.equal(isComponentName('PDF'), false);
  assert.equal(isComponentName('sessionStore'), false);
});

test('splitSections 能按标题切分小节', () => {
  const sections = splitSections('### 5.1 落地页 — 路由 `/`\n\n- 加载中：x\n- 空：y\n- 失败：z\n\n### 5.2 下一节\n\n正文');
  assert.equal(sections.length, 2);
  assert.ok(sections[0].heading.includes('`/`'));
  assert.ok(sections[0].body.includes('加载中'));
  assert.ok(!sections[0].body.includes('下一节'));
});

test('checkRouteStates 对完整的三态小节放行', () => {
  const doc = ['### 5.1 页面 — 路由 `/match`', '', '- 加载中：骨架', '- 空：没有数据', '- 失败：可重试'].join('\n');
  assert.deepEqual(checkRouteStates(doc, [{ route: '/match' }]), []);
});

test('checkRouteStates 会抓出缺状态、假状态与缺小节', () => {
  // 缺少「空」与「失败」两条
  const missing = '### 5.1 页面 — 路由 `/match`\n\n- 加载中：有\n';
  const missingErrors = checkRouteStates(missing, [{ route: '/match' }]);
  assert.equal(missingErrors.length, 2);
  assert.ok(missingErrors.every((message) => message.includes('缺少')));

  // 正文里出现「空」字但并不是状态条目，不应被当成通过
  const fake = '### 5.2 页面 — 路由 `/me`\n\n- 加载中：有\n- 这是空的一段说明\n- 失败：有\n';
  const fakeErrors = checkRouteStates(fake, [{ route: '/me' }]);
  assert.equal(fakeErrors.length, 1);
  assert.ok(fakeErrors[0].includes('- 空：'));

  // 完全没有小节
  const noSection = checkRouteStates('## 没有小节\n', [{ route: '/leaderboard' }]);
  assert.equal(noSection.length, 1);
  assert.ok(noSection[0].includes('缺少路由'));

  // 通配路由豁免
  assert.deepEqual(checkRouteStates('## 无小节\n', [{ route: '*' }]), []);
});

/** 把真实文档复制到临时目录并注入一处改动，用于验证校验规则真的会拦人。 */
function withMutatedDocs(relativePath, mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'cantobridge-docs-'));
  cpSync(frontendDir, dir, { recursive: true });
  const target = join(dir, relativePath);
  writeFileSync(target, mutate(readFileSync(target, 'utf8')));
  return checkDocs({ frontendDir: dir }).errors;
}

test('基线文档保持零错误', () => {
  assert.deepEqual(checkDocs({ frontendDir }).errors, []);
});

test('校验规则会拦住各类不一致，而不是永远返回空错误', () => {
  const injections = [
    {
      name: '幽灵路由',
      doc: 'docs/02-frontend-scope.md',
      mutate: (text) => text + '\n\n见 `/ghost/route`。\n',
      expect: '路由表中不存在的路由',
    },
    {
      name: '信息架构里的幽灵组件',
      doc: 'docs/03-ia-and-pages.md',
      mutate: (text) => text + '\n\n使用 `GhostWidget`。\n',
      expect: '组件清单里没有的组件',
    },
    {
      name: 'APK 文档里的幽灵组件',
      doc: 'docs/08-apk-and-backend-asks.md',
      mutate: (text) => text + '\n\n使用 `NativePermissionGate`。\n',
      expect: '组件清单里没有的组件',
    },
    {
      name: '清单里的孤儿组件',
      doc: 'docs/05-design-system.md',
      // 必须插进组件清单表内部，才是「清单里有、但信息架构里没用」的孤儿场景
      mutate: (text) => {
        const anchor =
          '| `MockControlPanel` | `src/components/MockControlPanel.tsx` | Demo 控制台 | state、onChange | 各开关状态 |';
        return text.replace(anchor, `${anchor}\n| \`OrphanBadge\` | \`src/x.tsx\` | 孤儿 | a | b |`);
      },
      expect: '未被 03 使用',
    },
    {
      name: '里程碑缺日期',
      doc: 'docs/06-roadmap.md',
      mutate: (text) => text.replaceAll('2026-10-09', 'XXXX-XX-XX'),
      expect: '缺少关键日期',
    },
    {
      name: 'README 漏收录文档',
      doc: 'README.md',
      mutate: (text) => text.replaceAll('docs/04-tech-stack.md', 'docs/xx.md'),
      expect: 'README 导航未收录',
    },
    {
      name: '链接指向不存在的文件',
      doc: 'docs/04-tech-stack.md',
      mutate: (text) => text + '\n见 [x](09-nope.md)。\n',
      expect: '链接指向不存在的文件',
    },
    {
      name: '引用未声明的接口',
      doc: 'docs/02-frontend-scope.md',
      mutate: (text) => text + '\n调用 `/api/ghost/endpoint` 拿数据。\n',
      expect: '接口清单里没有声明',
    },
    {
      name: '接口被改名导致引用断裂',
      doc: 'docs/09-frontend-logic-and-api.md',
      mutate: (text) => text.replace('/api/me/progress', '/api/me/progress-renamed'),
      expect: '接口清单里没有声明的接口',
    },
  ];

  for (const { name, doc, mutate, expect: expected } of injections) {
    const errors = withMutatedDocs(doc, mutate);
    assert.ok(errors.length > 0, `注入「${name}」后校验竟然通过，说明规则失效`);
    assert.ok(
      errors.some((message) => message.includes(expected)),
      `注入「${name}」后没有报出期望的错误「${expected}」，实际为：${errors.join(' | ')}`,
    );
  }
});

test('接口清单可解析，且都是 /api/ 路径', () => {
  const apis = parseApiTable(readDoc(API_CONTRACT_DOC));
  assert.ok(apis.length >= 20, `接口数量偏少：${apis.length}`);
  for (const apiPath of apis) {
    assert.match(apiPath, /^\/api\/[A-Za-z0-9/:_-]+$/, `接口路径格式非法：${apiPath}`);
  }
  const unique = new Set(apis);
  assert.ok(unique.has('/api/match/queue'), '缺少匹配排队接口');
  assert.ok(unique.has('/api/rooms'), '缺少成房接口');
  assert.ok(unique.has('/api/rtc/ice-servers'), '缺少 APK 路线要用的 ICE 凭证接口');
  assert.ok(unique.has('/api/app/version-policy'), '缺少版本策略接口');
});

test('extractApiPaths 只认反引号里的 /api/ 路径，并排除裸前缀', () => {
  const found = extractApiPaths('见 `/api/me`、`/api/rooms/:roomId`、`/api/`、`/match`，裸写的 /api/ghost 不算。');
  assert.deepEqual([...found].sort(), ['/api/me', '/api/rooms/:roomId']);
});

test('08 与 03 里引用的接口都在 09 的清单里', () => {
  const contract = readDoc(API_CONTRACT_DOC);
  for (const docPath of ['docs/08-apk-and-backend-asks.md', 'docs/03-ia-and-pages.md']) {
    for (const apiPath of extractApiPaths(readDoc(docPath))) {
      assert.ok(contract.includes(apiPath), `${docPath} 提到的接口 ${apiPath} 没有写进 09`);
    }
  }
});

const BT = String.fromCharCode(96);
const LNL = String.fromCharCode(10);
const ticker = (value) => BT + value + BT;

test('结构性数字写错会被拦下（路由 / 组件 / 文档数量、测试数量声明）', () => {
  const cases = [
    { name: '路由数量写错', doc: 'README.md', mutate: (text) => text.replace('17 个路由', '99 个路由'), expect: '实际是 17 个路由' },
    { name: '文档数量写错', doc: 'README.md', mutate: (text) => text.replace('10 份规划文档', '9 份规划文档'), expect: '实际是 10 份规划文档' },
    { name: '组件数量写错', doc: 'README.md', mutate: (text) => text.replace('38 个组件', '32 个组件'), expect: '实际是 38 个组件' },
    // 变异源用正则而不是写死 `433 个测试`：写死的话，只要真数字涨一次（433 → 441），
    // 这里就替换不中、`errors.length` 变 0，测试自己假红——而它想验的规则其实没坏。
    { name: '测试数量声明互相矛盾', doc: 'docs/06-roadmap.md', mutate: (text) => text.replace(/\d+\s*个测试/, '1234 个测试'), expect: '测试数量声明不一致' },
  ];
  for (const { name, doc, mutate, expect: expected } of cases) {
    const errors = withMutatedDocs(doc, mutate);
    assert.ok(errors.length > 0, '注入「' + name + '」后校验竟然通过，说明规则失效');
    assert.ok(
      errors.some((message) => message.includes(expected)),
      '注入「' + name + '」后没有报出期望的错误「' + expected + '」，实际为：' + errors.join(' | '),
    );
  }
});

test('带方法前缀的接口写法同样受校验（PUT / POST /api/...）', () => {
  const found = extractApiPaths('先 ' + ticker('/api/match/criteria') + ' 再 ' + ticker('/api/match/queue') + '。');
  assert.deepEqual([...found].sort(), ['/api/match/criteria', '/api/match/queue']);
  const errors = withMutatedDocs('docs/02-frontend-scope.md', (text) => text + LNL + '实际调用 ' + ticker('POST /api/ghost/prefixed') + '。' + LNL);
  assert.ok(
    errors.some((message) => message.includes('接口清单里没有声明') && message.includes('/api/ghost/prefixed')),
    errors.join(' | '),
  );
});

test('本地专用口子（探活 / 演示重置 / 演示辅助）不需要写进接口契约', () => {
  const declared = parseApiTable(readDoc(API_CONTRACT_DOC));
  for (const apiPath of NON_CONTRACT_APIS) {
    assert.ok(!declared.includes(apiPath), apiPath + ' 不该出现在产品接口清单里');
  }
  // README 里有指向 ../TODO.md 的链接，临时仓库要把根目录文件一起摆好，否则链接校验会先报错
  const base = mkdtempSync(join(tmpdir(), `cantobridge-docs-`));
  const dir = join(base, `frontend`);
  cpSync(frontendDir, dir, { recursive: true });
  copyFileSync(join(frontendDir, '..', 'TODO.md'), join(base, 'TODO.md'));
  const mutated = join(dir, `docs/04-tech-stack.md`);
  // 把**每一个**豁免口子都写进文档：漏掉一个，下面这行就会报「引用了未声明的接口」。
  // 用 `NON_CONTRACT_APIS` 现算而不是写死，新增豁免时这条测试自动跟上。
  const mentions = [...NON_CONTRACT_APIS];
  writeFileSync(
    mutated,
    readFileSync(mutated, `utf8`) + LNL + mentions.map((apiPath) => ticker(apiPath)).join(`、`) + `。` + LNL,
  );
  assert.deepEqual([...extractApiPaths(mentions.map((apiPath) => ticker(apiPath)).join(`、`))].sort(), mentions.slice().sort());
  assert.deepEqual(checkDocs({ frontendDir: dir }).errors, []);
});

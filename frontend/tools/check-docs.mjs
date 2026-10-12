/**
 * 文档一致性校验（零依赖，Node 内置能力即可运行）。
 *
 * 把 03 的路由表与 05 的组件清单当成可执行契约，保证文档之间不会互相矛盾。
 * 校验 11 条不变量：
 *   1. 文档齐全且非空
 *   2. README 导航覆盖全部文档
 *   3. 03 的路由表格式合法且无重复
 *   4. 所有文档中出现的路由引用都能在路由表里找到
 *   5. 每个路由（除通配路由）在 03 中都有小节，且小节写清了加载中 / 空 / 失败三态
 *   6. 组件引用与组件清单双向闭合
 *   7. mermaid 代码块成对闭合且以合法图类型开头
 *   8. 文档内的相对 Markdown 链接指向真实存在的文件
 *   9. 里程碑文档包含全部关键日期
 *  10. 所有文档里出现的 /api/ 接口路径都在 09 的接口清单里声明过（字段级契约见 docs/10-api-v1.md，由 check-api.mjs 校验；
 *      方法前缀写法 `POST /api/...` 也算，本地专用口子见 NON_CONTRACT_APIS）
 *  11. 文档里写死的结构性数字（路由 / 组件 / 文档数量、测试数量声明）与实际一致
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOC_FILES = [
  'docs/01-product-brief.md',
  'docs/02-frontend-scope.md',
  'docs/03-ia-and-pages.md',
  'docs/04-tech-stack.md',
  'docs/05-design-system.md',
  'docs/06-roadmap.md',
  'docs/07-open-questions.md',
  'docs/08-apk-and-backend-asks.md',
  'docs/09-frontend-logic-and-api.md',
  'docs/10-api-v1.md',
];

export const ROUTE_TABLE_DOC = 'docs/03-ia-and-pages.md';
export const COMPONENT_TABLE_DOC = 'docs/05-design-system.md';
export const ROADMAP_DOC = 'docs/06-roadmap.md';
export const API_CONTRACT_DOC = 'docs/09-frontend-logic-and-api.md';

/** 里程碑文档必须出现的日期，对应《框架规划》与赛道页的关键时间点。 */
export const REQUIRED_DATES = ['2026-09-24', '2026-10-09', '2026-10-18'];

/** 以这些前缀开头的反引号路径是后端接口，不是前端路由。 */
export const NON_ROUTE_PREFIXES = ['/api/', '/ws/'];

/** 裸写的后端根路径同样不是前端路由（写 `/api` 比写 `/api/health` 更容易被误判）。 */
export const NON_ROUTE_EXACT = new Set(['/api', '/ws']);

/**
 * 只在本地开的口子：不进产品契约，09 的接口清单里不需要声明。
 *
 * 判据是后端注册时写了 `contract: false`（见 `backend/src/server.js` 的 `devRoutes` 分支）——
 * 探活、演示数据重置，以及两个「演示辅助」口子（`match-request` 手动造一条待接受请求、
 * `buddy-request` 手动造一条伙伴申请），真实环境分别由匹配引擎 + `/ws/match` 推送、
 * 伙伴申请的推送产出。
 */
export const NON_CONTRACT_APIS = new Set([
  '/api/health',
  '/api/dev/reset',
  '/api/dev/match-request',
  '/api/dev/buddy-request',
]);

/** 形如组件名但其实是产品或技术名词，不参与组件校验。 */
export const IGNORED_IDENTIFIERS = new Set([
  'AndroidManifest',
  'AudioContext',
  'BroadcastChannel',
  'WebRTC',
  'WebSocket',
  'WebView',
  'JavaScript',
  'NotAllowedError',
  'RTCPeerConnection',
  'SameSite',
  'TypeScript',
  'CantoBridge',
  'PowerShell',
  'GitHub',
  'Netlify',
  'WhatsApp',
  'iPhone',
  'iPad',
  'X509Certificate',
]);

const MERMAID_KEYWORDS = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'classDiagram',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
];

const IDENTIFIER_PATTERN = /`([^`\n]+)`/g;
const COMPONENT_NAME_PATTERN = /^[A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;
const ROUTE_REF_PATTERN = /^\/[A-Za-z0-9_\-/:]*$/;

/** 每个路由小节必须逐条写清的三种状态。 */
export const REQUIRED_STATES = ['加载中', '空', '失败'];

function stateBulletPattern(state) {
  return new RegExp(`(^|\\n)\\s*-\\s*${state}\\s*[:：]`);
}

export function unbacktick(value) {
  return value.replace(/^`/, '').replace(/`$/, '');
}

/** 反引号里被选中的 PascalCase 标识符，至少含两个小写字母，排除全大写缩写。 */
export function isComponentName(value) {
  if (IGNORED_IDENTIFIERS.has(value)) return false;
  if (!COMPONENT_NAME_PATTERN.test(value)) return false;
  const lowercase = value.match(/[a-z]/g);
  return lowercase !== null && lowercase.length >= 2;
}

/** 去掉围栏代码块内容，避免把示例代码里的路径当成真实引用。 */
export function stripCodeFences(markdown) {
  let inFence = false;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  return trimmed
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => cell === '' || /^-{2,}$/.test(cell));
}

/** 找到第一列表头等于 headerCell 的 Markdown 表格并返回其数据行。 */
export function parseTable(markdown, headerCell) {
  const rows = [];
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (cells === null) {
      inTable = false;
      continue;
    }
    if (!inTable) {
      if (cells[0] === headerCell) inTable = true;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    rows.push(cells);
  }
  return rows;
}

/** 03 的路由表：第一列是路由，第二列是页面组件。 */
export function parseRouteTable(markdown) {
  return parseTable(markdown, 'Route').map((cells) => ({
    route: unbacktick(cells[0] ?? ''),
    page: unbacktick(cells[1] ?? ''),
  }));
}

/** 05 的组件清单：第一列是组件名。 */
export function parseComponentTable(markdown) {
  return parseTable(markdown, '组件')
    .map((cells) => unbacktick(cells[0] ?? ''))
    .filter((name) => name.length > 0);
}

/** 09 的接口清单：第一列是接口路径。 */
export function parseApiTable(markdown) {
  return parseTable(markdown, '接口')
    .map((cells) => unbacktick(cells[0] ?? ''))
    .filter((apiPath) => apiPath.length > 0);
}

/** 反引号里形如 /api/... 的接口路径（至少两级，排除裸前缀）。 */
export function extractApiPaths(markdown) {
  const found = new Set();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const value = unbacktick(match[1])
      // `POST /api/match/queue` 这种「方法 + 路径」的写法也要认，否则散文里的幽灵接口会漏网
      .replace(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/, '')
      .replace(/[.,;)]+$/, '');
    if (!/^\/api\/[a-z0-9]/i.test(value)) continue;
    if (ROUTE_REF_PATTERN.test(value)) found.add(value);
  }
  return found;
}

export function extractIdentifiers(markdown) {
  const found = new Set();
  for (const match of markdown.matchAll(IDENTIFIER_PATTERN)) {
    if (isComponentName(match[1])) found.add(match[1]);
  }
  return found;
}

/** 所有文档中出现的路由引用（反引号包裹、以斜杠开头的路径）。 */
export function extractRouteRefs(markdown) {
  const found = new Set();
  for (const match of markdown.matchAll(IDENTIFIER_PATTERN)) {
    const value = match[1];
    if (!ROUTE_REF_PATTERN.test(value)) continue;
    if (NON_ROUTE_PREFIXES.some((prefix) => value.startsWith(prefix))) continue;
    if (NON_ROUTE_EXACT.has(value)) continue;
    found.add(value);
  }
  return found;
}

/** 按 `### ` 标题切分小节，用于逐页校验三态描述。 */
export function splitSections(markdown) {
  const sections = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#{2,4}\s/.test(line)) {
      current = { heading: line, body: [] };
      sections.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return sections.map((section) => ({
    heading: section.heading,
    body: section.body.join('\n'),
  }));
}

export function checkMermaid(markdown) {
  const errors = [];
  const lines = markdown.split(/\r?\n/);
  const fenceCount = lines.filter((line) => /^\s*```/.test(line)).length;
  if (fenceCount % 2 !== 0) {
    errors.push(`代码围栏数量为奇数（${fenceCount}），存在未闭合的代码块`);
  }
  for (let i = 0; i < lines.length; i += 1) {
    const opener = lines[i].match(/^\s*```(\S*)/);
    if (opener === null || opener[1] !== 'mermaid') continue;
    const firstLine = (lines[i + 1] ?? '').trim();
    const keyword = firstLine.split(/\s+/)[0];
    if (!MERMAID_KEYWORDS.includes(keyword)) {
      errors.push(`第 ${i + 2} 行的 mermaid 块以 "${keyword}" 开头，不是已知图类型`);
    }
  }
  return errors;
}

/** 文档内的相对 Markdown 链接必须指向真实文件。 */
export function checkLinks(docPath, markdown, frontendDir) {
  const errors = [];
  const baseDir = dirname(resolve(frontendDir, docPath));
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (clean.length === 0) continue;
    if (!existsSync(join(baseDir, clean))) {
      errors.push(`${docPath} 的链接指向不存在的文件：${target}`);
    }
  }
  return errors;
}

function readDoc(frontendDir, relativePath) {
  return readFileSync(join(frontendDir, relativePath), 'utf8');
}

/**
 * 校验 03 中每个路由都有 ### 小节，且小节里逐条写了 `- 加载中：` / `- 空：` / `- 失败：`。
 * 只匹配小节正文里的项目符号，避免用无关文字里的「空」字蒙混过关。
 */
export function checkRouteStates(markdown, routes) {
  const errors = [];
  const sections = splitSections(markdown);
  for (const { route } of routes) {
    if (route === '*') continue;
    const token = '`' + route + '`';
    const section = sections.find(
      (item) => item.heading.startsWith('### ') && item.heading.includes(token),
    );
    if (section === undefined) {
      errors.push(`03 中缺少路由 ${route} 的 ### 小节，或小节标题未包含 ${token}`);
      continue;
    }
    for (const state of REQUIRED_STATES) {
      if (!stateBulletPattern(state).test(section.body)) {
        errors.push(`03 中路由 ${route} 的小节缺少「- ${state}：」状态描述`);
      }
    }
  }
  return errors;
}

export function checkDocs({ frontendDir }) {
  const errors = [];
  const stats = {};
  const docs = {};

  // 1. 文档齐全且非空
  for (const relativePath of DOC_FILES) {
    const absolute = join(frontendDir, relativePath);
    if (!existsSync(absolute)) {
      errors.push(`缺少文档：${relativePath}`);
      continue;
    }
    const content = readDoc(frontendDir, relativePath);
    if (content.trim().length === 0) {
      errors.push(`文档为空：${relativePath}`);
      continue;
    }
    docs[relativePath] = content;
  }

  const readmePath = join(frontendDir, 'README.md');
  if (!existsSync(readmePath)) {
    errors.push('缺少 frontend/README.md');
    return { errors, stats };
  }
  const readme = readFileSync(readmePath, 'utf8');
  docs['README.md'] = readme;

  // 2. README 导航覆盖全部文档
  for (const relativePath of DOC_FILES) {
    if (!readme.includes(relativePath)) {
      errors.push(`README 导航未收录：${relativePath}`);
    }
  }

  if (!docs[ROUTE_TABLE_DOC] || !docs[COMPONENT_TABLE_DOC]) {
    return { errors, stats };
  }

  // 3. 路由表格式与去重
  const routes = parseRouteTable(docs[ROUTE_TABLE_DOC]);
  if (routes.length === 0) {
    errors.push('未能从 03 解析出任何路由，请检查路由表的表头是否为 Route');
  }
  const routeNames = new Set();
  for (const { route, page } of routes) {
    if (route !== '*' && !ROUTE_REF_PATTERN.test(route)) {
      errors.push(`路由格式非法：${route}`);
    }
    if (page.length === 0) {
      errors.push(`路由缺少页面组件：${route}`);
    }
    if (routeNames.has(route)) {
      errors.push(`路由重复定义：${route}`);
    }
    routeNames.add(route);
  }

  // 4. 跨文档路由引用闭合
  const referencedRoutes = new Set();
  for (const [docPath, content] of Object.entries(docs)) {
    for (const ref of extractRouteRefs(stripCodeFences(content))) {
      referencedRoutes.add(ref);
      if (!routeNames.has(ref)) {
        errors.push(`${docPath} 引用了路由表中不存在的路由：${ref}`);
      }
    }
  }

  // 5. 每个路由都有小节，且写清三态
  for (const message of checkRouteStates(docs[ROUTE_TABLE_DOC], routes)) {
    errors.push(message);
  }

  // 6. 组件引用与清单双向闭合
  const inventory = parseComponentTable(docs[COMPONENT_TABLE_DOC]);
  const inventorySet = new Set(inventory);
  if (inventorySet.size === 0) {
    errors.push('未能从 05 解析出任何组件，请检查组件清单的表头是否为 组件');
  }
  if (inventorySet.size !== inventory.length) {
    const seen = new Set();
    for (const name of inventory) {
      if (seen.has(name)) errors.push(`组件清单存在重复项：${name}`);
      seen.add(name);
    }
  }
  const pageNames = new Set(routes.map((item) => item.page));

  // 6a. 任意文档里提到的组件都必须在清单里（防止引用不存在的组件或拼错名字）
  for (const [docPath, content] of Object.entries(docs)) {
    for (const name of extractIdentifiers(stripCodeFences(content))) {
      if (pageNames.has(name)) continue;
      if (!inventorySet.has(name)) {
        errors.push(`${docPath} 引用了组件清单里没有的组件：${name}`);
      }
    }
  }

  // 6b. 清单里的每个组件都必须在 03 的信息架构里有落点（防止设计出没人用的组件）
  const usedInIa = new Set();
  for (const name of extractIdentifiers(stripCodeFences(docs[ROUTE_TABLE_DOC]))) {
    if (pageNames.has(name)) continue;
    usedInIa.add(name);
  }
  for (const name of inventorySet) {
    if (!usedInIa.has(name)) {
      errors.push(`05 的组件清单里有组件未被 03 使用：${name}`);
    }
  }

  // 7. mermaid 与代码围栏
  for (const [docPath, content] of Object.entries(docs)) {
    for (const message of checkMermaid(content)) {
      errors.push(`${docPath}：${message}`);
    }
  }

  // 8. 站内链接可解析
  for (const [docPath, content] of Object.entries(docs)) {
    for (const message of checkLinks(docPath, content, frontendDir)) {
      errors.push(message);
    }
  }

  // 9. 里程碑日期齐全
  const roadmap = docs[ROADMAP_DOC];
  if (roadmap !== undefined) {
    for (const date of REQUIRED_DATES) {
      if (!roadmap.includes(date)) {
        errors.push(`06 缺少关键日期：${date}`);
      }
    }
  }

  // 10. 接口路径必须在 09 的接口清单里声明
  const apiContract = docs[API_CONTRACT_DOC];
  if (apiContract === undefined) {
    errors.push(`缺少接口清单文档：${API_CONTRACT_DOC}`);
  } else {
    const declaredApis = new Set(parseApiTable(apiContract));
    if (declaredApis.size === 0) {
      errors.push('未能从 09 解析出任何接口，请检查接口清单的表头是否为 接口');
    }
    for (const [docPath, content] of Object.entries(docs)) {
      for (const apiPath of extractApiPaths(stripCodeFences(content))) {
        if (NON_CONTRACT_APIS.has(apiPath)) continue;
        if (!declaredApis.has(apiPath)) {
          errors.push(`${docPath} 引用了接口清单里没有声明的接口：${apiPath}`);
        }
      }
    }
    stats.apiCount = declaredApis.size;
  }

  // 11. 文档里写死的结构性数字必须和实际一致（README 的文件地图也算；围栏里的数字同样要准）
  const testCountClaims = new Map();
  const numberRules = [
    { unit: '个测试', pattern: /(\d+)\s*个测试/g, expected: null },
    { unit: '个路由', pattern: /(\d+)\s*个路由/g, expected: routes.length },
    { unit: '个组件', pattern: /(\d+)\s*个(?:纯展示)?组件/g, expected: inventorySet.size },
    { unit: '份规划文档', pattern: /(\d+)\s*份规划文档/g, expected: DOC_FILES.length },
  ];
  for (const [docPath, content] of Object.entries(docs)) {
    for (const { unit, pattern, expected } of numberRules) {
      for (const match of content.matchAll(pattern)) {
        const claimed = Number(match[1]);
        if (expected === null) {
          const files = testCountClaims.get(claimed) ?? [];
          files.push(docPath);
          testCountClaims.set(claimed, files);
          continue;
        }
        if (claimed !== expected) {
          errors.push(`${docPath} 写的是「${match[0]}」，实际是 ${expected} ${unit}`);
        }
      }
    }
  }
  // 测试的真实数量只能靠 node --test 跑出来，这里只拦「改一处、漏一处」
  if (testCountClaims.size > 1) {
    const detail = [...testCountClaims.entries()]
      .map(([claimed, files]) => `${claimed}（${files.join('、')}）`)
      .join(' 与 ');
    errors.push(`测试数量声明不一致：${detail}；请统一成 node --test 的真实数量`);
  }
  stats.testCountClaim = [...testCountClaims.keys()][0] ?? null;
  stats.routeCount = routes.length;
  stats.componentCount = inventorySet.size;
  stats.referencedRouteCount = referencedRoutes.size;
  stats.docCount = Object.keys(docs).length;
  stats.mermaidBlockCount = Object.values(docs)
    .flatMap((content) => content.split(/\r?\n/))
    .filter((line) => /^\s*```mermaid/.test(line)).length;

  return { errors, stats };
}

/* ------------------------------------------------------------------ *
 * 命令行
 * ------------------------------------------------------------------ */

/**
 * `node tools/check-docs.mjs` 的入口。
 *
 * 以前这个文件**只有导出、没有 CLI** —— `npm run check` 里的这一段其实一直在空转，
 * 无论文档多乱都静默退出 0，真正拦得住错的只有 `tools/check-docs.test.mjs`。
 * 补上之后 `npm run check` 才名副其实。
 */
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { errors, stats } = checkDocs({ frontendDir });
  if (errors.length > 0) {
    console.error('文档一致性校验未通过（' + errors.length + ' 条）：');
    for (const error of errors) console.error('  - ' + error);
    process.exitCode = 1;
  } else {
    console.log('文档一致性校验通过：' + JSON.stringify(stats));
  }
}

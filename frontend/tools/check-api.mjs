/**
 * 契约一致性校验：把「前端现在真的存了哪些属性」与「后端接口 v1 契约」钉在一起。
 *
 * 三个脚本各管一件事，合起来才叫「文档与代码一致」：
 *   - check-docs.mjs：文档之间不矛盾（路由表、组件清单、接口路径引用）
 *   - check-ui.mjs：代码与文档不矛盾（路由、组件、页面、文案 key）
 *   - check-api.mjs：**属性汇总完整、接口契约与代码一一对应**（本文件）
 *
 * 校验 10 条不变量：
 *   1. docs/10 的端点集合 == docs/09 第 3.2 节的端点集合（方法 + 路径，双向、无重复）
 *   2. docs/10 的每个端点都写清了请求字段与响应字段，且字段是反引号里的具体名字
 *   3. docs/10 的「属性字段」字典 == store 默认值的叶子字段 ∪ 运行时字段（双向）
 *   4. 属性字典里每一行都有类型
 *   5. docs/10 的「词表」表 == src/data/tags.js 的字符串数组（双向）
 *   6. docs/10 的「成就」表 == src/data/achievements.js 的 ACHIEVEMENT_CATALOG
 *   7. docs/10 的「mock 方法」表 == createMockApi() 暴露的方法（双向），
 *      且表里引用的接口都在 09 的清单里声明过
 *   8. docs/09 与 docs/10 里的 json 示例都能 JSON.parse
 *   9. 仓库根目录的 TODO.md（后端任务清单）提到的每个 /api/ 端点都在 09 的清单里声明过
 *      （`POST /api/...` 这种带方法前缀的写法同样校验；探活与演示重置口子见 NON_CONTRACT_APIS），
 *      并且它确实指向字段级契约 docs/10-api-v1.md
 *  10. frontend/tasks/ 下的交接提示词里出现的 /api/ 路径同样必须在 09 的清单里声明过；
 *      只要它提到了接口，就必须指向字段级契约 docs/10-api-v1.md（仓库里没有 tasks/ 目录时不报错）
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NON_CONTRACT_APIS, extractApiPaths, stripCodeFences, unbacktick } from './check-docs.mjs';
import { createDefaultState, createMemoryStorage, createStore } from '../src/app/store.js';
import { createMockApi } from '../src/services/mockApi.js';
import { createHttpApi } from '../src/services/httpApi.js';
import * as TAGS from '../src/data/tags.js';
import { ACHIEVEMENT_CATALOG } from '../src/data/achievements.js';

/** 接口路径的唯一真源（索引级）。 */
export const API_INDEX_DOC = 'docs/09-frontend-logic-and-api.md';
/** 字段级契约（属性汇总 + 请求 / 响应字段 + 示例）。 */
export const API_V1_DOC = 'docs/10-api-v1.md';

/** 各张机器可校验表格的表头首列，改表格结构必须同步改这里。 */
export const ENDPOINT_HEADER = '接口';
export const FIELD_TABLE_HEADER = '属性字段';
export const VOCABULARY_HEADER = '词表';
export const ACHIEVEMENT_HEADER = '成就';
export const MOCK_MAPPING_HEADER = 'mock 方法';

/** 词表表必须覆盖的 tags.js 导出（都是字符串数组）。 */
export const VOCABULARY_EXPORTS = [
  'ROLES',
  'LEVELS',
  'NATIVE_LANGUAGES',
  'IDENTITIES',
  'INTERESTS',
  'LEARNING_GOALS',
  'BUDDY_TOPICS',
  'MATCH_INTENTS',
  'LEARNER_FEEDBACK_TAGS',
  'BUDDY_FEEDBACK_TAGS',
];

/** 表示「这个接口本来就没有字段」的写法，允许不写反引号。 */
const EMPTY_CELL = new Set(['无', '—', '-', '不适用']);

/** 把一份 Markdown 切成「行数组」的列表：每个表格是一个行数组，第 0 行是表头。 */
export function tables(markdown) {
  const out = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      current = null;
      continue;
    }
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (current === null) {
      current = [];
      out.push(current);
    }
    if (cells.every((cell) => cell === '' || /^-{2,}$/.test(cell))) continue;
    current.push(cells);
  }
  return out;
}

/** 所有首列表头等于 headerCell 的表格的数据行（不含表头）。 */
export function rowsWithHeader(markdown, headerCell) {
  const rows = [];
  for (const table of tables(markdown)) {
    if (table.length === 0 || table[0][0] !== headerCell) continue;
    rows.push(...table.slice(1));
  }
  return rows;
}

/** 端点表：09 与 10 共用一套解析，列名定位而不是写死列号。 */
export function endpointRows(markdown) {
  const rows = [];
  for (const table of tables(markdown)) {
    if (table.length === 0 || table[0][0] !== ENDPOINT_HEADER) continue;
    const header = table[0];
    const at = (name) => header.indexOf(name);
    const read = (cells, name) => {
      const index = at(name);
      return index >= 0 ? (cells[index] ?? '').trim() : '';
    };
    for (const cells of table.slice(1)) {
      const path = unbacktick(cells[0] ?? '');
      if (path.length === 0) continue;
      rows.push({
        path,
        method: unbacktick(read(cells, '方法')).toUpperCase(),
        request: read(cells, '请求字段'),
        response: read(cells, '响应字段'),
      });
    }
  }
  return rows;
}

export function endpointKey(row) {
  return row.method + ' ' + row.path;
}

/** 属性字典：第一列是「资源.字段」形式的点号路径。 */
export function fieldRows(markdown) {
  return rowsWithHeader(markdown, FIELD_TABLE_HEADER).map((cells) => ({
    field: unbacktick(cells[0] ?? ''),
    type: (cells[1] ?? '').trim(),
  }));
}

/** 反引号里的 token，用于把「字段名 / 词表取值」变成可比较的集合。 */
export function extractTokens(cell) {
  const out = [];
  for (const match of (cell ?? '').matchAll(/`([^`\n]+)`/g)) out.push(match[1]);
  return out;
}

export function vocabularyRows(markdown) {
  return rowsWithHeader(markdown, VOCABULARY_HEADER).map((cells) => ({
    name: unbacktick(cells[0] ?? ''),
    values: extractTokens(cells[1] ?? ''),
  }));
}

/** 对象里的叶子字段路径；数组整体算一个叶子（不展开元素结构）。 */
export function leafPaths(value, prefix = '') {
  const out = [];
  for (const [key, item] of Object.entries(value ?? {})) {
    const path = prefix.length > 0 ? prefix + '.' + key : key;
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      out.push(...leafPaths(item, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/** 代码里真实存在的属性：持久化默认值的叶子 + 运行时顶层键。 */
export function expectedFieldPaths() {
  const defaults = leafPaths(createDefaultState());
  const store = createStore({ storage: createMemoryStorage() });
  const runtime = Object.keys(store.getState().runtime).map((key) => 'runtime.' + key);
  return [...defaults, ...runtime];
}

/**
 * 两个实现的方法名集合。**必须逐个相等**：页面只认方法名，
 * 少一个（页面在真数据档位下拿到 undefined）或多一个（文档没跟上）都要红。
 */
export function implementationMethodNames() {
  const store = createStore({ storage: createMemoryStorage() });
  return {
    mock: Object.keys(createMockApi({ store })),
    http: Object.keys(createHttpApi({ baseUrl: 'http://localhost:8787', store, fallback: createMockApi({ store }) })),
  };
}

export function mockMethodNames() {
  const store = createStore({ storage: createMemoryStorage() });
  return Object.keys(createMockApi({ store }));
}

/** 取出所有 ```json 围栏的正文（用于验证示例真的是合法 JSON）。 */
export function jsonBlocks(markdown) {
  const out = [];
  let buffer = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (buffer === null) {
      if (/^\s*```json\s*$/.test(line)) buffer = [];
      continue;
    }
    if (/^\s*```\s*$/.test(line)) {
      out.push(buffer.join('\n'));
      buffer = null;
      continue;
    }
    buffer.push(line);
  }
  return out;
}

function readIfExists(frontendDir, relativePath) {
  const absolute = join(frontendDir, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

export function checkApi({ frontendDir }) {
  const errors = [];
  const stats = {};

  const indexText = readIfExists(frontendDir, API_INDEX_DOC);
  const v1Text = readIfExists(frontendDir, API_V1_DOC);
  if (indexText === null) errors.push('缺少接口索引文档：' + API_INDEX_DOC);
  if (v1Text === null) errors.push('缺少接口契约文档：' + API_V1_DOC);
  if (indexText === null || v1Text === null) return { errors, stats };

  /* 1. 端点集合双向一致 */
  const indexRows = endpointRows(indexText);
  const v1Rows = endpointRows(v1Text);
  const indexKeys = new Set(indexRows.map(endpointKey));
  const v1Keys = new Set(v1Rows.map(endpointKey));
  if (indexKeys.size === 0) errors.push('未能从 ' + API_INDEX_DOC + ' 解析出任何端点，请检查表头是否为「接口」');
  if (v1Keys.size === 0) errors.push('未能从 ' + API_V1_DOC + ' 解析出任何端点，请检查表头是否为「接口」');
  if (indexRows.length !== indexKeys.size) errors.push(API_INDEX_DOC + ' 的端点表存在重复行');
  if (v1Rows.length !== v1Keys.size) errors.push(API_V1_DOC + ' 的端点表存在重复行');
  for (const key of indexKeys) {
    if (!v1Keys.has(key)) errors.push(API_V1_DOC + ' 缺少 09 已声明的端点：' + key);
  }
  for (const key of v1Keys) {
    if (!indexKeys.has(key)) errors.push(API_V1_DOC + ' 声明了 09 清单里没有的端点：' + key);
  }
  stats.endpointCount = indexKeys.size;

  /* 2. 每个端点都写清请求 / 响应字段，且是反引号里的具体名字 */
  for (const row of v1Rows) {
    const key = endpointKey(row);
    if (row.method.length === 0) errors.push(API_V1_DOC + ' 的端点缺少方法：' + row.path);
    const cells = [
      ['请求字段', row.request],
      ['响应字段', row.response],
    ];
    for (const [label, cell] of cells) {
      const value = (cell ?? '').trim();
      if (value.length === 0) {
        errors.push(API_V1_DOC + ' 的端点 ' + key + ' 缺少' + label);
        continue;
      }
      if (EMPTY_CELL.has(value)) continue;
      if (extractTokens(value).length === 0) {
        errors.push(API_V1_DOC + ' 的端点 ' + key + ' 的' + label + '必须是反引号里的字段名：' + value);
      }
    }
  }

  /* 3 + 4. 属性字典 == 代码里真实存在的属性 */
  const expected = expectedFieldPaths();
  const expectedSet = new Set(expected);
  const declaredRows = fieldRows(v1Text);
  const declared = declaredRows.map((row) => row.field).filter((field) => field.length > 0);
  const declaredSet = new Set(declared);
  if (declaredSet.size === 0) errors.push('未能从 ' + API_V1_DOC + ' 解析出属性字典，请检查表头是否为「属性字段」');
  if (declared.length !== declaredSet.size) errors.push(API_V1_DOC + ' 的属性字典存在重复行');
  for (const path of expectedSet) {
    if (!declaredSet.has(path)) errors.push('属性字典漏了代码里真实存在的属性：' + path);
  }
  for (const path of declaredSet) {
    if (!expectedSet.has(path)) errors.push('属性字典列了代码里不存在的属性：' + path);
  }
  for (const row of declaredRows) {
    if (row.field.length === 0) continue;
    if (row.type.length === 0) errors.push('属性字典缺少类型：' + row.field);
  }
  stats.fieldCount = declaredSet.size;
  stats.runtimeFieldCount = expected.filter((path) => path.startsWith('runtime.')).length;

  /* 5. 词表表 == tags.js */
  const vocabulary = vocabularyRows(v1Text);
  const vocabularyByName = new Map(vocabulary.map((row) => [row.name, row.values]));
  for (const name of VOCABULARY_EXPORTS) {
    const values = TAGS[name];
    if (!Array.isArray(values)) {
      errors.push('src/data/tags.js 里找不到词表：' + name);
      continue;
    }
    const listed = vocabularyByName.get(name);
    if (listed === undefined) {
      errors.push(API_V1_DOC + ' 的词表表缺少 ' + name);
      continue;
    }
    const listedSet = new Set(listed);
    for (const value of values) {
      if (!listedSet.has(value)) errors.push('词表 ' + name + ' 漏了取值：' + value);
    }
    for (const value of listedSet) {
      if (!values.includes(value)) errors.push('词表 ' + name + ' 多出代码里没有的取值：' + value);
    }
  }
  for (const row of vocabulary) {
    if (!VOCABULARY_EXPORTS.includes(row.name)) {
      errors.push(API_V1_DOC + ' 的词表表出现了未登记的词表：' + row.name);
    }
  }
  stats.vocabularyCount = VOCABULARY_EXPORTS.length;

  /* 6. 成就表 == ACHIEVEMENT_CATALOG */
  const achievements = rowsWithHeader(v1Text, ACHIEVEMENT_HEADER).map((cells) => unbacktick(cells[0] ?? ''));
  const achievementSet = new Set(achievements.filter((id) => id.length > 0));
  for (const item of ACHIEVEMENT_CATALOG) {
    if (!achievementSet.has(item.id)) errors.push(API_V1_DOC + ' 的成就表漏了：' + item.id);
  }
  for (const id of achievementSet) {
    if (!ACHIEVEMENT_CATALOG.some((item) => item.id === id)) {
      errors.push(API_V1_DOC + ' 的成就表多出代码里没有的成就：' + id);
    }
  }
  stats.achievementCount = achievementSet.size;

  /* 7. mock 方法表 == createMockApi()，且引用的接口都声明过 */
  const declaredPaths = new Set(indexRows.map((row) => row.path));
  const mockRows = rowsWithHeader(v1Text, MOCK_MAPPING_HEADER).map((cells) => ({
    method: unbacktick(cells[0] ?? ''),
    endpoint: cells[1] ?? '',
  }));
  const mockNames = mockMethodNames();
  const listedMethods = new Set(mockRows.map((row) => row.method).filter((name) => name.length > 0));
  if (listedMethods.size === 0) {
    errors.push('未能从 ' + API_V1_DOC + ' 解析出 mock 对照表，请检查表头是否为「mock 方法」');
  }
  for (const name of mockNames) {
    if (!listedMethods.has(name)) errors.push(API_V1_DOC + ' 的 mock 对照表漏了方法：' + name);
  }
  for (const name of listedMethods) {
    if (!mockNames.includes(name)) errors.push(API_V1_DOC + ' 的 mock 对照表多出代码里没有的方法：' + name);
  }
  for (const row of mockRows) {
    for (const token of extractTokens(row.endpoint)) {
      if (!token.startsWith('/api/')) continue;
      if (!declaredPaths.has(token)) {
        errors.push(API_V1_DOC + ' 的 mock 对照表引用了 09 未声明的接口：' + token);
      }
    }
  }
  stats.mockMethodCount = listedMethods.size;

  /* 7b. 两个实现的方法名集合必须一致（切档位不该让某个方法凭空消失） */
  const { mock: mockImplNames, http: httpImplNames } = implementationMethodNames();
  for (const name of mockImplNames) {
    if (!httpImplNames.includes(name)) errors.push('httpApi 少了 mock 里的方法：' + name);
  }
  for (const name of httpImplNames) {
    if (!mockImplNames.includes(name)) errors.push('httpApi 多出 mock 里没有的方法：' + name);
  }
  stats.httpMethodCount = httpImplNames.length;

  /* 8. json 示例必须真的是合法 JSON */
  let jsonCount = 0;
  for (const [docPath, text] of [
    [API_INDEX_DOC, indexText],
    [API_V1_DOC, v1Text],
  ]) {
    for (const block of jsonBlocks(text)) {
      jsonCount += 1;
      try {
        JSON.parse(block);
      } catch (error) {
        errors.push(docPath + ' 里的 json 示例不是合法 JSON：' + error.message);
      }
    }
  }
  stats.jsonBlockCount = jsonCount;
  if (jsonCount === 0) errors.push(API_V1_DOC + ' 里没有任何 json 示例，接口契约应当给出字段级示例');

  /* 9. 根目录的后端 TODO 不能指向不存在的接口，也不能忘了指向字段级契约 */
  const todoPath = resolve(frontendDir, '..', 'TODO.md');
  if (existsSync(todoPath)) {
    const todoText = readFileSync(todoPath, 'utf8');
    let mentions = 0;
    for (const apiPath of extractApiPaths(stripCodeFences(todoText))) {
      if (NON_CONTRACT_APIS.has(apiPath)) continue;
      mentions += 1;
      if (!declaredPaths.has(apiPath)) {
        errors.push('TODO.md 引用了 09 未声明的接口：' + apiPath);
      }
    }
    if (mentions === 0) errors.push('TODO.md 没有点名任何接口，后端照着它没法开工');
    if (!todoText.includes('frontend/docs/10-api-v1.md')) {
      errors.push('TODO.md 没有指向字段级契约 frontend/docs/10-api-v1.md');
    }
    stats.rootTodoEndpointMentions = mentions;
  }

  /* 10. frontend/tasks/ 的交接提示词：接口引用必须声明过，且提到接口就要指向字段级契约 */
  const tasksDir = join(frontendDir, 'tasks');
  const taskFiles = existsSync(tasksDir)
    ? readdirSync(tasksDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name)
        .sort()
    : [];
  stats.tasksFileCount = taskFiles.length;
  for (const name of taskFiles) {
    const relative = 'tasks/' + name;
    const text = readFileSync(join(tasksDir, name), 'utf8');
    let mentions = 0;
    for (const apiPath of extractApiPaths(stripCodeFences(text))) {
      if (NON_CONTRACT_APIS.has(apiPath)) continue;
      mentions += 1;
      if (!declaredPaths.has(apiPath)) {
        errors.push(relative + ' 引用了 09 未声明的接口：' + apiPath);
      }
    }
    if (mentions > 0 && !text.includes(API_V1_DOC)) {
      errors.push(relative + ' 提到了接口但没有指向字段级契约 ' + API_V1_DOC);
    }
  }  return { errors, stats };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const { errors, stats } = checkApi({ frontendDir: resolve(fileURLToPath(new URL('..', import.meta.url))) });
  if (errors.length > 0) {
    console.error('接口契约校验失败：');
    for (const error of errors) console.error(' - ' + error);
    process.exitCode = 1;
  } else {
    console.log('接口契约校验通过：' + JSON.stringify(stats));
  }
}
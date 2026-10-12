/**
 * 代码与文档的一致性校验（零依赖，Node 内置能力即可运行）。
 *
 * 文档里的路由表与组件清单是可执行契约。check-docs.mjs 保证「文档之间」不矛盾，
 * 这个脚本保证「代码与文档」不矛盾，两条一起才叫一致：
 *   1. src/app/routes.js 的路由集合与顺序 == docs/03 的路由表
 *   2. 每个路由的页面组件名 == docs/03 的「页面组件」列
 *   3. src/pages/ 导出的页面名集合 == docs/03 里的页面组件集合（双向）
 *   4. src/components/ 导出的组件名集合 == docs/05 的组件清单（双向）
 *   5. src/ 里所有 t('key') 都在语言包里，且三种 locale 都有值
 *   6. 动态拼接的文案 key（前缀 + 值）也必须在语言包里
 *   7. src/ 里出现的路径字面量必须是路由表里的路由（或其前缀）
 *   8. data/tags.js 的词表与 data/labels.js 的枚举文案必须一一对应
 *   9. data/themes.js 的每个主题在语言包里都有对应文案
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseComponentTable, parseRouteTable, stripCodeFences } from './check-docs.mjs';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const FRONTEND = resolve(HERE, '..');

export const ROUTES_FILE = 'src/app/routes.js';
export const TAGS_FILE = 'src/data/tags.js';
export const THEMES_FILE = 'src/data/themes.js';
export const LABELS_FILE = 'src/data/labels.js';
export const I18N_FILE = 'src/i18n/i18n.js';

/** 由代码动态拼接的 key 家族，无法用正则直接扫到，显式列出。 */
export const DYNAMIC_KEY_FAMILIES = [
  { prefix: 'leaderboard.', values: ['weekly', 'monthly'] },
  { prefix: 'dev.mode.', values: ['sim', 'local', 'remote'] },
];

/** 词表 <-> 枚举文案的映射：tags.js 的导出名 -> labels.js 的枚举名。 */
export const TAG_GROUPS = [
  { exportName: 'LEVELS', group: 'levels' },
  { exportName: 'NATIVE_LANGUAGES', group: 'nativeLanguages' },
  { exportName: 'IDENTITIES', group: 'identities' },
  { exportName: 'INTERESTS', group: 'interests' },
  { exportName: 'LEARNING_GOALS', group: 'goals' },
  { exportName: 'BUDDY_TOPICS', group: 'buddyTopics' },
  { exportName: 'MATCH_INTENTS', group: 'matchIntents' },
];

function read(root, relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function listFiles(root, relativeDir) {
  const out = [];
  for (const entry of readdirSync(join(root, relativeDir), { withFileTypes: true })) {
    const relativePath = relativeDir + '/' + entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, relativePath));
    else if (entry.name.endsWith('.js')) out.push(relativePath);
  }
  return out;
}

/** 收集 export function X / export const X = 里的 PascalCase 名字。 */
export function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/g)) names.add(match[1]);
  return [...names].filter((name) => /^[A-Z][A-Za-z0-9]*$/.test(name) && name.match(/[a-z]/g));
}

export function exportedStringArrays(source) {
  const groups = {};
  for (const match of source.matchAll(/export\s+const\s+([A-Z0-9_]+)\s*=\s*\[([^\]]*)\]/g)) {
    groups[match[1]] = [...match[2].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  }
  return groups;
}

export function translateKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) {
    // 以 '.' 结尾的是动态拼接前缀，例如 t('dev.mode.' + value)，由 DYNAMIC_KEY_FAMILIES 覆盖
    if (match[1].endsWith('.')) continue;
    keys.add(match[1]);
  }
  return [...keys];
}

export function labelGroups(source) {
  const groups = new Set();
  for (const match of source.matchAll(/\blabelOf\(\s*'([A-Za-z0-9_]+)'/g)) groups.add(match[1]);
  for (const match of source.matchAll(/\blabel\(\s*'([A-Za-z0-9_]+)'/g)) groups.add(match[1]);
  return [...groups];
}

/** 路径字面量：形如 '/room'、'/room/:roomId'，排除 '/api/' 与 '/ws/'。 */
export function pathLiterals(source) {
  const paths = new Set();
  for (const match of source.matchAll(/'(\/[A-Za-z0-9_\-/:]*)'/g)) {
    const value = match[1];
    if (value.startsWith('/api/') || value.startsWith('/ws/')) continue;
    if (value.includes(':')) continue;
    paths.add(value);
  }
  return [...paths];
}

export function segmentsOf(path) {
  return String(path).split('/').filter(Boolean);
}

/** 路径是否命中某条路由模板（字面量可以是模板的前缀，例如 '/room' -> '/room/:roomId'）。 */
export function matchesRoutePrefix(literal, pattern) {
  const target = segmentsOf(literal);
  const template = segmentsOf(pattern);
  if (target.length > template.length) return false;
  return target.every((segment, index) => template[index].startsWith(':') || template[index] === segment);
}

/** 字面量也可以是路由模板的后缀（例如 '/summary' 属于 '/room/:roomId/summary'）。 */
export function matchesRouteAffix(literal, pattern) {
  if (matchesRoutePrefix(literal, pattern)) return true;
  const target = segmentsOf(literal).reverse();
  const template = segmentsOf(pattern).reverse();
  if (target.length > template.length) return false;
  return target.every((segment, index) => template[index].startsWith(':') || template[index] === segment);
}

export function routePathsFromSource(source) {
  return [...source.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
}

export function pageNamesFromSource(source) {
  return [...source.matchAll(/page:\s*([A-Za-z0-9_$]+)/g)].map((match) => match[1]);
}

export function collectExports(root) {
  const components = [];
  const pages = [];
  for (const file of listFiles(root, 'src/components')) {
    for (const name of exportedNames(read(root, file))) components.push({ name, file });
  }
  for (const file of listFiles(root, 'src/pages')) {
    for (const name of exportedNames(read(root, file))) pages.push({ name, file });
  }
  return { components, pages };
}

export function checkFrontend(root = FRONTEND) {
  const errors = [];
  const stats = {};

  const routesSource = read(root, ROUTES_FILE);
  const codeRoutes = routePathsFromSource(routesSource);
  const codePages = pageNamesFromSource(routesSource);
  const docRoutes = parseRouteTable(read(root, 'docs/03-ia-and-pages.md'));
  const docComponents = parseComponentTable(read(root, 'docs/05-design-system.md'));

  // 1 + 2. 路由集合、顺序与页面组件名
  const docRoutePaths = docRoutes.map((item) => item.route);
  if (codeRoutes.join('|') !== docRoutePaths.join('|')) {
    const missing = docRoutePaths.filter((path) => !codeRoutes.includes(path));
    const extra = codeRoutes.filter((path) => !docRoutePaths.includes(path));
    if (missing.length > 0) errors.push('routes.js 缺少文档里的路由：' + missing.join('、'));
    if (extra.length > 0) errors.push('routes.js 多出文档里没有的路由：' + extra.join('、'));
    if (missing.length === 0 && extra.length === 0) errors.push('routes.js 的路由顺序与 docs/03 不一致');
  }
  for (let index = 0; index < Math.min(codePages.length, docRoutes.length); index += 1) {
    if (codePages[index] !== docRoutes[index].page) {
      errors.push('第 ' + (index + 1) + ' 条路由的页面组件不一致：代码 ' + codePages[index] + ' vs 文档 ' + docRoutes[index].page);
    }
  }
  stats.routeCount = codeRoutes.length;

  // 3 + 4. 页面与组件双向闭合
  const { components, pages } = collectExports(root);
  const codeComponentNames = components.map((item) => item.name).sort();
  const docComponentNames = [...new Set(docComponents)].sort();
  for (const name of docComponentNames) {
    if (!codeComponentNames.includes(name)) errors.push('docs/05 声明了但代码没实现的组件：' + name);
  }
  for (const name of codeComponentNames) {
    if (!docComponentNames.includes(name)) errors.push('代码里多出未登记的组件：' + name);
  }
  const codePageNames = pages.map((item) => item.name).sort();
  const docPageNames = [...new Set(docRoutes.map((item) => item.page))].sort();
  for (const name of docPageNames) {
    if (!codePageNames.includes(name)) errors.push('docs/03 声明了但代码没实现的页面：' + name);
  }
  for (const name of codePageNames) {
    if (!docPageNames.includes(name)) errors.push('代码里多出未登记的页面：' + name);
  }
  stats.componentCount = codeComponentNames.length;
  stats.pageCount = codePageNames.length;

  // 5 + 6. 文案 key
  const i18nSource = read(root, I18N_FILE);
  const locales = ['zh-Hans', 'zh-Hant', 'en'];
  const usedKeys = new Set();
  for (const file of listFiles(root, 'src')) {
    for (const key of translateKeys(read(root, file))) usedKeys.add(key);
  }
  for (const key of usedKeys) {
    if (!i18nSource.includes("'" + key + "'")) {
      errors.push('代码里用到了语言包里没有的 key：' + key);
      continue;
    }
    const entry = new RegExp("'" + key.replace(/\./g, '\\.') + "':\\s*U\\(([^)]*)\\)").exec(i18nSource);
    if (!entry) {
      errors.push('key 的文案格式不是 U(...) 三语写法：' + key);
      continue;
    }
    const parts = entry[1].split("', '").length;
    if (parts !== 3) errors.push('key 缺少某一种语言的文案：' + key);
  }
  for (const family of DYNAMIC_KEY_FAMILIES) {
    for (const value of family.values) {
      if (!i18nSource.includes("'" + family.prefix + value + "'")) {
        errors.push('动态拼接的 key 在语言包里不存在：' + family.prefix + value);
      }
    }
  }
  for (const locale of locales) {
    if (!i18nSource.includes("'" + locale + "'")) errors.push('语言包缺少 locale：' + locale);
  }
  stats.usedKeyCount = usedKeys.size;

  // 9. 主题词表 <-> 主题文案。主题 id 是动态拼进 key 的（t('theme.' + id)），
  //    正则扫不到，所以在这里按 themes.js 的词表逐个点名校验，漏一个就报错。
  const themeIds = exportedStringArrays(read(root, THEMES_FILE)).THEMES ?? [];
  if (themeIds.length === 0) errors.push('src/data/themes.js 里找不到主题词表：THEMES');
  for (const id of themeIds) {
    if (!i18nSource.includes("'theme." + id + "'")) errors.push('语言包里缺少主题文案：theme.' + id);
  }
  stats.themeCount = themeIds.length;

  // 7. 路径字面量
  const staticPaths = new Set(routePathsFromSource(routesSource));
  for (const file of listFiles(root, 'src')) {
    if (file === ROUTES_FILE) continue;
    for (const literal of pathLiterals(read(root, file))) {
      const hit = [...staticPaths].some((pattern) => matchesRouteAffix(literal, pattern));
      if (!hit) errors.push(file + ' 里出现了路由表之外的路径：' + literal);
    }
  }

  // 8. 词表与枚举文案
  const tagGroups = exportedStringArrays(read(root, TAGS_FILE));
  const labelsSource = read(root, LABELS_FILE);
  for (const { exportName, group } of TAG_GROUPS) {
    const values = tagGroups[exportName] ?? [];
    if (values.length === 0) {
      errors.push('tags.js 里找不到词表：' + exportName);
      continue;
    }
    const block = new RegExp('\\n  ' + group + ':\\s*\\{([\\s\\S]*?)\\n  \\},').exec(labelsSource);
    if (!block) {
      errors.push('labels.js 里找不到枚举组：' + group);
      continue;
    }
    const declared = new Set([...block[1].matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((match) => match[1]));
    for (const value of values) {
      if (!declared.has(value)) errors.push('labels.js 的 ' + group + ' 缺少文案：' + value);
    }
    for (const value of declared) {
      if (!values.includes(value)) errors.push('labels.js 的 ' + group + ' 多出词表里没有的值：' + value);
    }
  }

  // 附加：labelOf / label 用到的枚举组必须存在
  for (const file of listFiles(root, 'src')) {
    for (const group of labelGroups(read(root, file))) {
      if (!new RegExp('\\n  ' + group + ':').test(labelsSource)) {
        errors.push(file + ' 里用到了不存在的枚举组：' + group);
      }
    }
  }

  return { errors, stats };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const { errors, stats } = checkFrontend();
  if (errors.length > 0) {
    console.error('前端一致性校验失败：');
    for (const error of errors) console.error(' - ' + error);
    process.exitCode = 1;
  } else {
    console.log('前端一致性校验通过：' + JSON.stringify(stats));
  }
}
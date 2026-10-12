import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  DYNAMIC_KEY_FAMILIES,
  checkFrontend,
  exportedNames,
  exportedStringArrays,
  matchesRouteAffix,
  matchesRoutePrefix,
  pathLiterals,
  routePathsFromSource,
  segmentsOf,
  translateKeys,
} from '../tools/check-ui.mjs';

const FRONTEND = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('代码与文档一致性：16 条路由、38 个组件、16 个页面全部对得上', () => {
  const { errors, stats } = checkFrontend();
  assert.deepEqual(errors, [], '存在不一致：\n' + errors.join('\n'));
  assert.equal(stats.routeCount, 16);
  assert.equal(stats.componentCount, 38);
  assert.equal(stats.themeCount, 5);
  assert.equal(stats.pageCount, 16);
  assert.ok(stats.usedKeyCount > 100);
});

test('导出的组件/页面名可以被识别', () => {
  const names = exportedNames("export function Alpha() {}`nexport const BetaB = 1;`nexport const lower = 2;`nconst hidden = 3;");
  assert.deepEqual(names.sort(), ['Alpha', 'BetaB']);
});

test('词表解析：只取字符串数组', () => {
  const groups = exportedStringArrays("export const LEVELS = ['a', 'b'];`nexport const MAP = { x: 1 };");
  assert.deepEqual(groups.LEVELS, ['a', 'b']);
  assert.equal(groups.MAP, undefined);
});

test('translateKeys：跳过动态拼接前缀，只收完整 key', () => {
  const keys = translateKeys("t('home.title'); t('dev.mode.' + value); translate('en', 'x.y');");
  assert.deepEqual([...keys].sort(), ['home.title']);
});

test('pathLiterals：忽略后端接口与带参数的模板', () => {
  const paths = pathLiterals("navigate('/home'); fetch('/api/me'); open('ws://x'); push('/room/:roomId');");
  assert.deepEqual(paths, ['/home']);
});

test('路由前缀与后缀匹配：/room 与 /summary 都能对上 /room/:roomId/summary，/nope 对不上', () => {
  assert.equal(matchesRoutePrefix('/room', '/room/:roomId/summary'), true);
  assert.equal(matchesRoutePrefix('/room/x/y', '/room/:roomId'), false);
  assert.equal(matchesRouteAffix('/summary', '/room/:roomId/summary'), true);
  assert.equal(matchesRouteAffix('/nope', '/room/:roomId/summary'), false);
  assert.equal(matchesRouteAffix('/', '/me'), true);
  assert.deepEqual(segmentsOf('/room/:roomId'), ['room', ':roomId']);
});

test('routes.js 的路由顺序与 docs/03 路由表完全一致', () => {
  const source = readFileSync(join(FRONTEND, 'src/app/routes.js'), 'utf8');
  assert.deepEqual(routePathsFromSource(source), [
    '/',
    '/register',
    '/onboarding/role',
    '/onboarding/profile',
    '/onboarding/privacy',
    '/home',
    '/match',
    '/match/:learnerId',
    '/room/:roomId',
    '/room/:roomId/summary',
    '/me',
    '/leaderboard',
    '/shop',
    '/history',
    '/dev/mock',
    '*',
  ]);
});

test('主题：themes.js 里的每个主题在语言包里都有对应文案', () => {
  const source = readFileSync(join(FRONTEND, 'src/data/themes.js'), 'utf8');
  const ids = exportedStringArrays(source).THEMES ?? [];
  assert.deepEqual(ids, ['mint', 'warm', 'blue', 'night', 'eye'], '主题词表本身变了就要同步这条断言');
  const i18n = readFileSync(join(FRONTEND, 'src/i18n/i18n.js'), 'utf8');
  for (const id of ids) {
    assert.ok(i18n.includes("'theme." + id + "'"), '语言包缺少 theme.' + id);
  }
});

test('动态拼接的文案 key 在语言包里都有对应条目', () => {
  const i18n = readFileSync(join(FRONTEND, 'src/i18n/i18n.js'), 'utf8');
  assert.ok(DYNAMIC_KEY_FAMILIES.length >= 2);
  for (const family of DYNAMIC_KEY_FAMILIES) {
    for (const value of family.values) {
      assert.ok(i18n.includes("'" + family.prefix + value + "'"), family.prefix + value);
    }
  }
});

test('文档里提到的组件和页面都必须真的实现（反向也成立）', async () => {
  const { collectExports } = await import('../tools/check-ui.mjs');
  const { components, pages } = collectExports(FRONTEND);
  assert.equal(components.length, 38);
  assert.equal(pages.length, 16);
  assert.ok(components.every((item) => item.file.startsWith('src/components/')));
  assert.ok(pages.every((item) => item.file.startsWith('src/pages/')));
});
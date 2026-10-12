/**
 * 冒烟脚本自己的测试：它必须**真的全过**，否则现场验收的第一条命令就是假的。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runSmoke } from './smoke.mjs';

test('npm run smoke：Phase 0+1 的验收剧本全部通过', async () => {
  const { checks, passed, failed } = await runSmoke();
  assert.equal(failed, 0, '失败的冒烟项：' + JSON.stringify(checks.filter((check) => !check.ok), null, 2));
  assert.equal(passed, checks.length);
  assert.ok(checks.length >= 12, '冒烟项太少了，验收覆盖不够：' + checks.length);
  // 每一项都要有名字，失败时能直接看出是哪一步
  for (const check of checks) assert.ok(check.name.length > 0);
});

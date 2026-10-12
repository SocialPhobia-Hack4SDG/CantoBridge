import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentConfig } from '../deploy/config.mjs';
import { createWindowLimiter } from '../deploy/limits.mjs';

const env = { RENDER_EXTERNAL_URL: 'https://test.onrender.com', RENDER: 'true', SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-only', CLOUDFLARE_TURN_KEY_ID: 'test-only', CLOUDFLARE_TURN_API_TOKEN: 'test-only',
  CANTOBRIDGE_INVITE_CODE: 'test-only-invite-code' };

test('Render 自动域名可直接使用；缺少密钥、弱口令、无效端口和非 HTTPS 域名拒绝启动', () => {
  const config = deploymentConfig(env);
  assert.equal(config.origin, env.RENDER_EXTERNAL_URL);
  assert.equal(config.trustProxy, true);
  assert.equal(config.maxAccounts, 50);
  for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN', 'CANTOBRIDGE_INVITE_CODE']) {
    assert.throws(() => deploymentConfig({ ...env, [name]: '' }), new RegExp(name));
  }
  for (const PUBLIC_ORIGIN of ['http://example.test', 'https://example.test/path', 'https://user:pass@example.test', 'https://example.test?x=1']) {
    assert.throws(() => deploymentConfig({ ...env, PUBLIC_ORIGIN }), /HTTPS origin/);
  }
  assert.throws(() => deploymentConfig({ ...env, CANTOBRIDGE_INVITE_CODE: '123' }), /16/);
  assert.throws(() => deploymentConfig({ ...env, PORT: 'NaN' }), /PORT/);
  assert.throws(() => deploymentConfig({ ...env, CANTOBRIDGE_MAX_ACCOUNTS: '0' }), /account limit/);
});

test('限流器拒绝超额与身份池溢出，窗口过期后恢复', () => {
  let clock = 0;
  const allow = createWindowLimiter({ max: 2, maxKeys: 2, windowMs: 1000, now: () => clock });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('b'), true);
  assert.equal(allow('c'), false);
  assert.equal(allow('a'), false);
  clock = 1001;
  assert.equal(allow('a'), true);
  assert.equal(allow('c'), true);
});

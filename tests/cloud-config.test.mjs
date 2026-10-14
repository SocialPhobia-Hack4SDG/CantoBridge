import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { deploymentConfig } from '../deploy/config.mjs';
import { createWindowLimiter } from '../deploy/limits.mjs';

const env = { RENDER_EXTERNAL_URL: 'https://test.onrender.com', RENDER: 'true', SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-only', CLOUDFLARE_TURN_KEY_ID: 'test-only', CLOUDFLARE_TURN_API_TOKEN: 'test-only',
  CANTOBRIDGE_TURN_PROVIDER: 'cloudflare', CANTOBRIDGE_INVITE_REQUIRED: 'true', CANTOBRIDGE_INVITE_CODE: 'test-only-invite-code' };

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

test('Metered 静态凭证部署不要求 Cloudflare key，保留所有 UDP、TCP 和 TLS 地址', () => {
  const configured = { ...env, CANTOBRIDGE_TURN_PROVIDER: 'static', CLOUDFLARE_TURN_KEY_ID: '', CLOUDFLARE_TURN_API_TOKEN: '',
    CANTOBRIDGE_TURN_URL: 'turn:relay.example.test:80,turn:relay.example.test:80?transport=tcp,turns:relay.example.test:443?transport=tcp',
    CANTOBRIDGE_TURN_USERNAME: 'test-user', CANTOBRIDGE_TURN_CREDENTIAL: 'test-password' };
  const config = deploymentConfig(configured);
  assert.equal(config.turnProvider, 'static');
  assert.equal(config.turnKeyId, null);
  assert.deepEqual(config.turn, { urls: configured.CANTOBRIDGE_TURN_URL.split(','), username: 'test-user', credential: 'test-password' });
  for (const name of ['CANTOBRIDGE_TURN_URL', 'CANTOBRIDGE_TURN_USERNAME', 'CANTOBRIDGE_TURN_CREDENTIAL']) {
    assert.throws(() => deploymentConfig({ ...configured, [name]: '' }), new RegExp(name));
  }
  for (const url of ['https://example.test', 'stun:example.test', 'turn:user:password@example.test:443', 'turn:example.test/path']) {
    assert.throws(() => deploymentConfig({ ...configured, CANTOBRIDGE_TURN_URL: url }), /TURN_URL/);
  }
});


test('默认开放网站入口，旧邀请口令不再启用保护，也无需设置口令', () => {
  for (const CANTOBRIDGE_INVITE_CODE of [undefined, '', 'old-code']) {
    const config = deploymentConfig({ ...env, CANTOBRIDGE_INVITE_REQUIRED: undefined, CANTOBRIDGE_INVITE_CODE });
    assert.equal(config.inviteRequired, false);
    assert.equal(config.inviteCode, null);
  }
});

test('环境示例覆盖部署配置读取的每个变量，平台注入与可选适配除外', async () => {
  const [source, example] = await Promise.all([
    readFile(new URL('../deploy/config.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  ]);
  const names = new Set([
    ...[...source.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map(match => match[1]),
    ...[...source.matchAll(/required\('([A-Z][A-Z0-9_]*)'\)/g)].map(match => match[1]),
  ]);
  const platformProvided = new Set(['RENDER', 'RENDER_EXTERNAL_URL']);
  const optionalAdapter = new Set(['CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN']);
  const documented = new Set([...example.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map(match => match[1]));
  for (const name of names) {
    if (platformProvided.has(name) || optionalAdapter.has(name)) continue;
    assert.ok(documented.has(name), '.env.example 缺少 ' + name);
  }
});

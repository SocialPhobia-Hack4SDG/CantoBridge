/**
 * `serve.mjs` 的测试。
 *
 * 这个文件补得比较晚，但补的每一块恰好都是「错了会很难看」的地方：
 *   1. **私钥不能发出去**。`tools/.certs/` 落在 `frontend/` 这棵静态树里，
 *      不显式拦掉就等于把 `key.pem` 发给同网段的任何人。
 *   2. **证书下载入口的类型要对**。`application/octet-stream` 会让 iOS 只是
 *      把文件存进「文件」App，用户以为装完了其实没装进信任库。
 *   3. **证书要会自愈**。SAN 里必须写明局域网 IP，而 IP 会随 Wi-Fi / DHCP 变；
 *      不自动重签的话，每换一次网络用户就得手动删掉 `.certs/` 再重启。
 *
 * 另一半 `serve.mjs` 的测试（纯函数 / MIME / 路由 / 反代）在 `tests/serve.test.mjs`，
 * 两个文件 `npm test` 都会跑。这里放的是需要**真证书 + 临时目录**的用例。
 *
 * 所有集成用例都用临时目录（自己造 root 与 certDir），不碰仓库里真实的证书；
 * 证书里的地址一律是 `10.0.0.5` / `192.168.1.9` 这类**通用假 IP**，
 * 绝不写本机真实 IP 或主机名。
 */

import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';

import {
  certProblem,
  CERT_DOWNLOAD_PATHS,
  createStaticServer,
  ensureCertificates,
  ipv4Hosts,
  isCertDownloadPath,
  isInsideDir,
  keyMatchesCert,
  opensslConfig,
  resolveRequestPath,
  sanIpsOf,
} from './serve.mjs';

const FAKE_CERT = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIBfake\n-----END PRIVATE KEY-----\n';

/** 造一个临时站点（root + certDir），跑完自动清掉。 */
async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), 'cantobridge-serve-'));
  const certDir = join(root, 'tools', '.certs');
  await mkdir(certDir, { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>root</title>');
  await writeFile(join(root, 'app.js'), 'export const x = 1;');
  await writeFile(join(certDir, 'cert.pem'), FAKE_CERT);
  await writeFile(join(certDir, 'key.pem'), FAKE_KEY);

  const server = createStaticServer({ root, certDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    await run({ base, root, certDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

/* ---------- 纯函数 ---------- */

test('任何 URL 路径都跑不出静态根目录', () => {
  const root = resolve('/srv/frontend');
  const attempts = [
    '/../../etc/passwd',
    '/..%2f..%2fetc/passwd',
    '/a/../../../../etc/passwd',
    '/./../../etc/passwd',
    '/src/../../../secret',
    // 绝对路径注入：Windows 上唯一真能跑到守卫的向量。上面那些 POSIX 风格的 `..`
    // 会被 win32 的 normalize 折叠回根目录内，看着在测越界，其实连守卫都没碰到。
    '/C:/Windows/System32',
  ];
  for (const attempt of attempts) {
    const resolved = resolveRequestPath(attempt, root);
    if (resolved === null) continue;
    assert.ok(
      resolved === root || resolved.startsWith(root + sep),
      attempt + ' 跑出根目录了：' + resolved,
    );
  }
});

test('正常路径照常映射，查询串不参与', () => {
  const root = resolve('/srv/frontend');
  assert.equal(resolveRequestPath('/src/app.js', root), join(root, 'src', 'app.js'));
  assert.equal(resolveRequestPath('/?api=http', root), root);
});

test('证书入口认路径、不认查询串，也不认更长的路径', () => {
  assert.equal(isCertDownloadPath('/cert.crt'), true);
  assert.equal(isCertDownloadPath('/cert.pem'), true);
  assert.equal(isCertDownloadPath('/cert.crt?from=phone'), true);
  assert.equal(isCertDownloadPath('/cert.crt/extra'), false);
  assert.equal(isCertDownloadPath('/index.html'), false);
  assert.equal(isCertDownloadPath('/'), false);
});

test('isInsideDir 认目录本身，也认子路径，不认同前缀的兄弟目录', () => {
  const dir = resolve('/a/b/.certs');
  assert.equal(isInsideDir(dir, dir), true);
  assert.equal(isInsideDir(join(dir, 'key.pem'), dir), true);
  assert.equal(isInsideDir(join(resolve('/a/b/.certs-other'), 'key.pem'), dir), false);
  assert.equal(isInsideDir(resolve('/a/b/certs'), dir), false);
});

/* ---------- 集成 ---------- */

test('手机装证书的入口：每个 /cert.* 都发证书本体，且类型是 iOS 认的那个', async () => {
  await withServer(async ({ base }) => {
    for (const path of CERT_DOWNLOAD_PATHS) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('content-type'), 'application/x-x509-ca-cert', path);
      const body = await response.text();
      assert.match(body, /BEGIN CERTIFICATE/, path + ' 发的不是证书');
      assert.ok(!body.includes('PRIVATE KEY'), path + ' 竟然把私钥也发出去了');
    }
  });
});

test('私钥不参与静态分发：直接摸 key.pem 必须被拦下', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(base + '/tools/.certs/key.pem');
    assert.equal(response.status, 403);
    const body = await response.text();
    assert.ok(!body.includes('PRIVATE KEY'), '私钥泄漏了');
    assert.ok(!body.includes('BEGIN'), '响应体里不该有任何 PEM 内容');
  });
});

test('整个 .certs 目录都不给静态访问，证书只能走 /cert.crt', async () => {
  await withServer(async ({ base }) => {
    for (const path of ['/tools/.certs/cert.pem', '/tools/.certs/', '/tools/.certs/key.pem.bak']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 403, path + ' 应该是 403，实际 ' + response.status);
    }
  });
});

test('证书还没生成时给一句人话，而不是 500', async () => {
  await withServer(async ({ base, certDir }) => {
    await rm(join(certDir, 'cert.pem'));
    const response = await fetch(base + '/cert.crt');
    assert.equal(response.status, 404);
    assert.match(await response.text(), /证书还没生成/);
  });
});

test('静态文件照常发，类型对得上', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(base + '/app.js');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(await response.text(), /export const x = 1/);
  });
});

test('找不到的路径回退 index.html（哈希路由靠它）', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(base + '/room/r-1');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<!doctype html>/i);
  });
});

/* ------------------------------------------------------------------ *
 * 证书自愈：SAN 跟着当前局域网地址走
 * ------------------------------------------------------------------ */

/** 用例里的地址一律用通用假 IP —— 别把本机真实 IP 写进仓库。 */
const HOME = '10.0.0.5';
const CAFE = '192.168.1.9';
/** 形状像 IPv4、但 openssl 会拒绝的地址，用来注出「重签失败」。 */
const BAD = '999.999.999.999';

const ipPattern = (address) => new RegExp(address.replace(/\./g, '\\.'));

/** 造一个临时证书目录，跑完清掉。 */
async function withCertDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cantobridge-cert-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readPairBytes(dir) {
  return {
    key: await readFile(join(dir, 'key.pem')),
    cert: await readFile(join(dir, 'cert.pem')),
  };
}

/**
 * 这些用例全要真签名，得靠 openssl。探一次并缓存结果 —— 机器上没有 openssl 时
 * 用例自己 `t.skip()`，而不是把整个测试套件拖红。
 */
let opensslReady = null;
async function hasOpenssl() {
  if (opensslReady === null) {
    await withCertDir(async (dir) => {
      try {
        await ensureCertificates({ dir, hosts: [HOME] });
        opensslReady = true;
      } catch {
        opensslReady = false;
      }
    });
  }
  return opensslReady;
}

/** 没 openssl 就跳过并说明原因；返回 true 表示调用方该直接 `return`。 */
async function skipWithoutOpenssl(t) {
  if (await hasOpenssl()) return false;
  t.skip('这台机器上找不到可用的 openssl');
  return true;
}

/* ---------- 纯函数 ---------- */

test('sanIpsOf：从真证书里把 SAN 的 IP 抽出来', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    const { cert } = await ensureCertificates({ dir, hosts: [HOME, CAFE] });
    const ips = sanIpsOf(new X509Certificate(cert));
    assert.ok(ips.includes('127.0.0.1'), 'SAN 里少了回环地址');
    assert.ok(ips.includes(HOME), 'SAN 里少了 ' + HOME);
    assert.ok(ips.includes(CAFE), 'SAN 里少了 ' + CAFE);
  });
});

test('sanIpsOf：没有 SAN 扩展或传空值都回空数组，不抛', () => {
  // 真证书没有 SAN 扩展时 subjectAltName 是 undefined（不是空串），实测过 ——
  // 这里不设防的话会把字符串 "undefined" 拿去匹配。
  assert.deepEqual(sanIpsOf({ subjectAltName: undefined }), []);
  assert.deepEqual(sanIpsOf({}), []);
  assert.deepEqual(sanIpsOf(undefined), []);
  assert.deepEqual(sanIpsOf(null), []);
});

test('ipv4Hosts：只放行 IPv4 形状，挡住会让 SAN 永远对不上的写法', () => {
  // 挡这个是为了防「无限重签」：证书里根本放不下的主机（IPv6 / 域名 / 乱写的串）
  // 一旦混进来，missing 就永不为空 —— 每次启动都重签、手机上每次都要重装证书。
  // 顺带也把「hosts 被直接拼进 openssl.cnf」的注入面关掉了。
  assert.deepEqual(ipv4Hosts([HOME, CAFE]), [HOME, CAFE]);
  assert.deepEqual(ipv4Hosts([HOME, HOME, CAFE]), [HOME, CAFE], '重复要去掉');
  assert.deepEqual(ipv4Hosts(['fe80::1']), [], 'IPv6 不该进 SAN 的 IP 槽位');
  assert.deepEqual(ipv4Hosts(['cantobridge.local']), [], '域名不该混进 IP 列表');
  assert.deepEqual(ipv4Hosts([null, undefined, '', 42, {}]), []);
  // 刻意只查形状、不查范围：合法性交给 openssl 判（见下面「重签失败」用例）
  assert.deepEqual(ipv4Hosts([BAD]), [BAD]);
});

test('certProblem：SAN 覆盖全部地址时回 null（不用动它）', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    const { cert } = await ensureCertificates({ dir, hosts: [HOME, CAFE] });
    const pem = cert.toString();
    assert.equal(certProblem(pem, { hosts: [HOME, CAFE] }), null);
    assert.equal(certProblem(pem, { hosts: [CAFE, HOME] }), null, '顺序不该有影响');
    assert.equal(certProblem(pem, { hosts: [HOME, HOME] }), null, '重复不该有影响');
    assert.equal(certProblem(pem, { hosts: [] }), null, '没连网时不该要求重签');
  });
});

test('certProblem：缺地址时要点名缺的是哪个', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    const { cert } = await ensureCertificates({ dir, hosts: [HOME] });
    const problem = certProblem(cert.toString(), { hosts: [HOME, CAFE] });
    assert.equal(problem.code, 'san_missing');
    assert.match(problem.message, ipPattern(CAFE), '要能一眼看出缺的是哪个地址');
  });
});

test('certProblem：临期看阈值判定，不依赖真实时钟', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    const { cert } = await ensureCertificates({ dir, hosts: [HOME] });
    const pem = cert.toString();
    // 同一张 825 天的证书：阈值 30 天时还早，抬到 900 天就变成「临期」。
    // 用**调阈值**而不是伪造一张快过期的证书，是因为 macOS 自带的是 LibreSSL，
    // 没有 `-not_before` 没法往回签；而 `-days 0` 会静默给 30 天（是个坑）。
    assert.equal(certProblem(pem, { hosts: [HOME], minValidDays: 30 }), null);
    assert.equal(certProblem(pem, { hosts: [HOME], minValidDays: 900 }).code, 'expiring');
  });
});

test('certProblem：已经过期的证书', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    const { cert } = await ensureCertificates({ dir, hosts: [HOME] });
    const pem = cert.toString();
    const validTo = new Date(new X509Certificate(pem).validTo).getTime();
    const problem = certProblem(pem, { hosts: [HOME], now: new Date(validTo + 86_400_000) });
    assert.equal(problem.code, 'expired');
  });
});

test('certProblem：读不出来的 PEM 回 unreadable，不抛', () => {
  const problem = certProblem('-----BEGIN CERTIFICATE-----\n这不是证书\n-----END CERTIFICATE-----\n', {
    hosts: [HOME],
  });
  assert.equal(problem.code, 'unreadable');
  assert.ok(problem.message.length > 0);
});

test('keyMatchesCert：配对为真、张冠李戴为假、垃圾输入也不抛', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dirA) => {
    await withCertDir(async (dirB) => {
      const a = await ensureCertificates({ dir: dirA, hosts: [HOME] });
      const b = await ensureCertificates({ dir: dirB, hosts: [CAFE] });
      assert.equal(keyMatchesCert(a.key, a.cert), true);
      assert.equal(keyMatchesCert(b.key, b.cert), true);
      assert.equal(keyMatchesCert(a.key, b.cert), false, '拿 A 的私钥对 B 的证书必须为假');
      assert.equal(keyMatchesCert('乱写的', a.cert), false, '解析不了要回 false，不能抛');
      assert.equal(keyMatchesCert(a.key, '乱写的'), false);
    });
  });
});

/* ---------- ensureCertificates ---------- */

test('ensureCertificates：首次生成一对能用的证书', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    const result = await ensureCertificates({ dir, hosts: [HOME] });
    assert.equal(result.generated, true);
    assert.equal(result.reason.code, 'missing', '第一次应当是「没有证书」而不是「过时」');
    assert.equal(result.warning, null);
    assert.ok(sanIpsOf(new X509Certificate(result.cert)).includes(HOME));
    assert.equal(keyMatchesCert(result.key, result.cert), true, '落盘的私钥与证书要配对');
  });
});

test('ensureCertificates：SAN 跟得上时一个字都不动（防抖动核心回归）', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME, CAFE] });
    const before = await readPairBytes(dir);

    const again = await ensureCertificates({ dir, hosts: [HOME, CAFE] });
    assert.equal(again.generated, false);
    assert.equal(again.reason, null);
    assert.equal(again.warning, null);

    // 每次启动都重签 = 手机每次都要重装证书。这条用例就是钉死这件事。
    const after = await readPairBytes(dir);
    assert.ok(before.cert.equals(after.cert), '证书不该被重签');
    assert.ok(before.key.equals(after.key), '私钥不该被换掉');
  });
});

test('ensureCertificates：多了一个局域网地址就重签，新 SAN 带上它', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME] });
    const before = await readPairBytes(dir);

    const result = await ensureCertificates({ dir, hosts: [HOME, CAFE] });
    assert.equal(result.generated, true);
    assert.equal(result.reason.code, 'san_missing');
    assert.match(result.reason.message, ipPattern(CAFE));
    assert.ok(sanIpsOf(new X509Certificate(result.cert)).includes(CAFE), '新 SAN 要含新地址');
    assert.ok(!before.cert.equals(await readFile(join(dir, 'cert.pem'))), '应当是真换了证书');
  });
});

test('ensureCertificates：地址缩减不重签（判定是「包含」不是「相等」）', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME, CAFE] });
    const before = await readPairBytes(dir);

    // VPN 关掉、拔掉网线都会让地址消失。一消失就重签的话，手机会被反复要求重装证书。
    const result = await ensureCertificates({ dir, hosts: [HOME] });
    assert.equal(result.generated, false);
    assert.ok((await readPairBytes(dir)).cert.equals(before.cert));
  });
});

test('ensureCertificates：没连网（hosts 为空）时，即使 force 也不重签', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME] });
    const before = await readPairBytes(dir);

    // 这个组合是被**刻意拒绝**的：没地址可写时强签只会得到一张更差的
    // （只剩 localhost 的）证书，下次连上网还得再签一遍。
    const result = await ensureCertificates({ dir, hosts: [], force: true });
    assert.equal(result.generated, false);
    assert.ok((await readPairBytes(dir)).cert.equals(before.cert));
  });
});

test('ensureCertificates：force + 有地址时确实重签', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME] });
    const result = await ensureCertificates({ dir, hosts: [HOME], force: true });
    assert.equal(result.generated, true);
    assert.equal(result.reason.code, 'forced');
  });
});

test('ensureCertificates：临期阈值能在启动期触发重签', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME] });
    const result = await ensureCertificates({ dir, hosts: [HOME], minValidDays: 900 });
    assert.equal(result.generated, true);
    assert.equal(result.reason.code, 'expiring');
  });
});

test('ensureCertificates：重签失败时保留旧证书，且不留临时文件', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME] });
    const before = await readPairBytes(dir);

    // 形状像 IPv4、openssl 会拒绝（实测退出码 1）。用它注失败比「把目录设成只读」可靠：
    // 不依赖运行用户的权限，root 跑也一样会失败。
    const result = await ensureCertificates({ dir, hosts: [BAD] });
    assert.equal(result.generated, false);
    assert.match(result.warning ?? '', /重签失败/);

    // 「不能把一张还能用的证书打烂」的直接证据
    const after = await readPairBytes(dir);
    assert.ok(before.cert.equals(after.cert), '旧证书被打烂了');
    assert.ok(before.key.equals(after.key), '旧私钥被打烂了');
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith('.tmp')),
      [],
      '临时文件没清干净',
    );
  });
});

test('ensureCertificates：一张证书都没有时，重签失败要抛错（交给调用方退回 HTTP）', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await assert.rejects(() => ensureCertificates({ dir, hosts: [BAD] }), /openssl/);
  });
});

test('ensureCertificates：证书被写坏时自愈 —— 即使没连网', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME] });
    await writeFile(
      join(dir, 'cert.pem'),
      '-----BEGIN CERTIFICATE-----\n坏掉的\n-----END CERTIFICATE-----\n',
    );

    // 这条是「没连网就什么都不修」那个坑的回归：坏证书会一路走到 createHttpsServer，
    // 而那行在 main() 的 try/catch **之外**，表现成「服务根本起不来」。
    // 所以「结构性损坏」必须无条件重签，跟有没有网无关。
    const result = await ensureCertificates({ dir, hosts: [] });
    assert.equal(result.generated, true);
    assert.equal(result.reason.code, 'missing');
    assert.doesNotThrow(() => new X509Certificate(result.cert));
    assert.equal(keyMatchesCert(result.key, result.cert), true);
  });
});

test('ensureCertificates：私钥缺失、或与证书不配对，都自愈', async (t) => {
  if (await skipWithoutOpenssl(t)) return;
  await withCertDir(async (dir) => {
    await ensureCertificates({ dir, hosts: [HOME] });

    // ① 私钥整个丢了
    await rm(join(dir, 'key.pem'));
    let result = await ensureCertificates({ dir, hosts: [HOME] });
    assert.equal(result.generated, true, '私钥缺失应当重签');
    assert.equal(keyMatchesCert(result.key, result.cert), true);

    // ② 私钥与证书张冠李戴（手改过，或者从别的机器拷来的）。
    // 不拦的话 createHttpsServer 会抛 ERR_OSSL_X509_KEY_VALUES_MISMATCH，而且抛在
    // main() 的 try/catch 外面 —— 用户看到的是「服务起不来」而不是一句有用的错。
    await withCertDir(async (otherDir) => {
      const other = await ensureCertificates({ dir: otherDir, hosts: [CAFE] });
      await writeFile(join(dir, 'key.pem'), other.key);

      result = await ensureCertificates({ dir, hosts: [HOME] });
      assert.equal(result.generated, true, '私钥与证书对不上应当重签');
      assert.equal(keyMatchesCert(result.key, result.cert), true);
      assert.ok(
        sanIpsOf(new X509Certificate(result.cert)).includes(HOME),
        '重签后 SAN 要回到当前地址',
      );
    });
  });
});

test('opensslConfig：只写调用方给的地址，绝不掺本机主机名', () => {
  // 本机信息（真实 IP、主机名）不得进入仓库里的任何代码 / 测试 / 文档；
  // 证书内容全部是运行时生成、只落在 gitignore 掉的 tools/.certs/ 里。
  // 这条把「哪天顺手把 os.hostname() 加进来」钉死。
  const config = opensslConfig([HOME]);
  assert.ok(!config.includes(hostname()), '证书配置里混进了本机主机名');
  assert.match(config, /^IP\.2 = 10\.0\.0\.5$/m);
  assert.match(config, /subjectAltName = @alt/);

  assert.ok(!opensslConfig([]).includes('IP.2'), '没有局域网地址时不该凭空多一个 IP 槽位');
  assert.ok(!opensslConfig(['fe80::1']).includes('fe80'), 'IPv6 不该进配置');
});

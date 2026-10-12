#!/usr/bin/env node
/**
 * 局域网开机自检：**走同 Wi-Fi 这条备用路之前先跑这一条**，它替你回答「现在能不能连」。
 *
 *   cd backend && npm run preflight:lan
 *
 * ⚠️ 真机联调的**默认做法是公网隧道**（真证书、无警告、手机不用装任何东西，见根 README 第 6 节）。
 * 这个脚本管的是**备用路**：不方便起隧道时，两台设备同 Wi-Fi 直连局域网地址。
 * 走这条路必须先把自签证书装进手机的信任库——**不要**点掉浏览器那句「不安全」，
 * 那等于关掉整条链路的加密保护。
 *
 * 它按手机访问的真实路径逐层验，共十项，每一层都给出「怎么修」：
 *   1. 本机有哪些局域网地址（多网卡时不止一个）
 *   2. 自签证书读不读得出来
 *   3. 证书 SAN 覆不覆盖当前所有局域网地址 —— `serve.mjs` 启动时会自动重签，这条是复核
 *   4. 前端 HTTPS 从**局域网地址**能不能访问（不是从 localhost）
 *   5. 运行中的服务递出来的证书，跟磁盘上的是不是同一张 —— 抓「改了证书但忘了重启」
 *   6. 局域网 Origin 是否在后端 CORS 白名单里（手机上 REST 走的是这个 Origin）
 *   7. 手机装证书的入口 `/cert.crt` 通不通、类型对不对（iOS 只认 application/x-x509-ca-cert）
 *   8. 私钥有没有被静态分发出去（`.certs/` 落在 frontend/ 静态树里，必须显式拦）
 *   9. 局域网地址上能不能拿到令牌（下面那条 wss 的前置）
 *  10. `wss://<局域网地址>:4173/ws/...` 握手能不能过 —— 手机上信令走的就是这个地址
 *
 * 第 5 项为什么单列：上面第 3 项读的是**磁盘上的文件**，第 4 项的探活又关掉了证书校验
 * （见 `insecure-tls.mjs` 与运行时的 NODE_TLS_REJECT_UNAUTHORIZED 警告），
 * 两条都过也可能是在对着一张错证书。
 * 「证书换好了、但服务还是启动时读进内存的旧那张」是这台机器上真实踩过的坑。
 *
 * 为什么不能只跑 `smoke:ws`：那个脚本连的是 `https://localhost:4173`，证书 SAN 里
 * 必然有 localhost，所以「IP 变了证书过期」这类最常踩的坑它验不出来。
 *
 * 第 0 项先判「前端跑在 HTTPS 还是 HTTP」：Windows 上 `serve.mjs` 找不到 openssl 时会**退回 HTTP**，
 * 那种模式下证书与 wss 都不存在，与其刷一屏红字，不如直接说清原因与修法。
 *
 * 前置（两个都要在跑）：
 *   cd backend  && npm start
 *   cd frontend && npm run serve
 */

import './insecure-tls.mjs';

import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';

import { WebSocket } from 'ws';

import { CERT_DIR, lanAddresses, sanIpsOf } from '../../frontend/tools/serve.mjs';

const PORT = Number(process.env.PORT ?? 4173);
/**
 * 自检专用设备 id：`POST /api/auth/session` 现在按 `deviceId` 现场建号，
 * 所以探针必须自己带一个（以前写死演示账号，不需要这个字段）。
 * 用固定值而不是随机值，是为了**反复自检只长出一个账号**，不给开发快照添垃圾。
 */
const PROBE_DEVICE = 'device-preflight-lan';
const results = [];
function check(ok, label, fix = '') {
  results.push({ ok, label, fix });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
  if (!ok && fix) console.log('        修：' + fix);
  return ok;
}

const addresses = lanAddresses();
console.log('== 局域网开机自检 ==');
console.log('本机局域网地址：' + (addresses.length > 0 ? addresses.join(', ') : '（一个都没有，先连上 Wi-Fi）'));
console.log('');

check(addresses.length > 0, '拿到局域网地址', '先让这台机器连上 Wi-Fi / 有线网，再重跑');

/* ---------- 0. 前端跑在 HTTPS 还是 HTTP ---------- */
// 下面每一项都建立在「前端跑 HTTPS」之上（证书 SAN / 探活 / /cert.crt / wss）。
// Windows 上 `serve.mjs` 找不到 openssl 时会**退回 HTTP**（见 `serve.mjs` 的
// `opensslCandidates`），那时真正的原因只有一个 —— 与其刷一屏红字让人去猜，不如先说清楚。
const HTTPS_UP = addresses.length > 0
  ? (await probe('https://' + addresses[0] + ':' + PORT + '/api/health')).ok
  : false;
const HTTP_ONLY = !HTTPS_UP && addresses.length > 0
  ? (await probe('http://' + addresses[0] + ':' + PORT + '/api/health')).ok
  : false;

if (HTTP_ONLY) {
  check(
    false,
    '前端跑在 HTTPS 模式（现在是 HTTP，没有证书）',
    '这台机器上没找到可用的 openssl，`npm run serve` 退回了 HTTP —— 没有证书，'
      + '手机用局域网 IP 打开拿不到麦克风（getUserMedia 只在安全上下文可用）。'
      + '装 Git for Windows（自带 openssl）后重开一个终端再跑 `npm run serve`；'
      + '或者改走公网隧道（根 README 第六节，推荐、且手机不用装任何东西）',
  );
}

/* ---------- 1. 证书 SAN ---------- */
let sanIps = [];
// 留着给下面第 5 项比指纹用；读不出来时是 null，那一项会跳过。
let diskCert = null;
// HTTP 模式下压根没有证书文件，这几项跳过 —— 上面第 0 项已经把原因说清楚了。
if (!HTTP_ONLY) {
  try {
    // 这个 try/catch 要留着：`sanIpsOf` 收的是证书实例、不负责报「读不出来」，
    // 「读得到证书」本身就是下面一条要单独验的检查项。
    diskCert = new X509Certificate(readFileSync(join(CERT_DIR, 'cert.pem')));
    sanIps = sanIpsOf(diskCert);
    check(true, '读得到自签证书 ' + join('tools', '.certs', 'cert.pem'));
  } catch (error) {
    check(false, '读自签证书失败：' + error.message, '跑一次 `cd frontend && npm run serve` 会自动生成');
  }

  if (addresses.length > 0) {
    const missing = addresses.filter((address) => !sanIps.includes(address));
    check(
      missing.length === 0,
      '证书 SAN 覆盖当前所有局域网地址（SAN：' + (sanIps.join(', ') || '空') + '）',
      '重启一次 `cd frontend && npm run serve` 就会自动重签（启动时比对 SAN 与当前地址，'
        + '不用再手动删 `.certs/`）；手机上要按新链接重装一次证书。'
        + '若重启后仍失败，说明这台机器上找不到可用的 openssl',
    );
    if (missing.length > 0) console.log('        缺：' + missing.join(', ') + '（浏览器只认 SAN，不认 CN）');
  }
}

/* ---------- 2~4. 逐层探活 ---------- */
// HTTP 模式下 base 置空：下面每一项验的都是 HTTPS 才有的东西（证书、/cert.crt、wss），
// 硬跑只会得到一串没有信息量的红字。
const base = addresses.length > 0 && !HTTP_ONLY ? 'https://' + addresses[0] + ':' + PORT : null;

/**
 * 抓一下运行中的服务**实际递出来**的那张证书。
 * `rejectUnauthorized: false` 是故意的：我们要看的是「它递了什么」，不是「它可不可信」——
 * 校验由上面第 3 项（读磁盘文件比对 SAN）负责，这里只比指纹。
 */
function peekServedCert(address, port) {
  return new Promise((resolve) => {
    // 不发 SNI：这里连的是裸 IP，RFC 6066 不允许把 IP 当 ServerName（浏览器也不发）。
    const socket = tlsConnect({ host: address, port, rejectUnauthorized: false });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, why: '5 秒没握上手' });
    }, 5_000);
    socket.on('secureConnect', () => {
      clearTimeout(timer);
      const peer = socket.getPeerCertificate();
      socket.end();
      if (peer?.fingerprint256) resolve({ ok: true, fingerprint256: peer.fingerprint256 });
      else resolve({ ok: false, why: '握手成功，但对方没递证书上来' });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, why: error.message });
    });
  });
}

async function probe(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: true, status: response.status, headers: response.headers, json, text };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

if (!base) {
  check(
    false,
    HTTP_ONLY
      ? '跳过局域网探活：前端当前是 HTTP 模式（原因见上面第 0 项）'
      : '跳过局域网探活（没有局域网地址）',
  );
} else {
  const health = await probe(base + '/api/health');
  check(
    health.ok && health.status === 200 && health.json?.ok === true,
    '从局域网地址探活：GET ' + base + '/api/health → ' + (health.ok ? health.status : health.error),
    '确认前端在跑（npm run serve）且没被防火墙拦住（'
      + (process.platform === 'win32'
        ? 'Windows：首次启动会弹「允许访问」的授权框，点了取消就局域网不可达'
        : 'macOS：系统设置 → 网络 → 防火墙')
      + '）',
  );

  // 服务活着 ≠ 它递的是磁盘上那张证书。上面第 3 项只读文件、第 4 项又关掉了校验，
  // 所以「证书换好了但忘了重启」这两条都拦不住 —— 而手机上恰恰就是这个症状。
  if (diskCert) {
    const served = await peekServedCert(addresses[0], PORT);
    const matches = served.ok && served.fingerprint256 === diskCert.fingerprint256;
    check(
      matches,
      '运行中的服务递出的证书与磁盘上的一致'
        + (served.ok ? '' : '（抓取失败：' + served.why + '）'),
      '磁盘上的证书已经换过，但 4173 上跑的还是启动时读进内存的旧证书 —— '
        + '重启一次 `cd frontend && npm run serve` 即可（新版本启动时也会自己比对 SAN 并重签）',
    );
    if (served.ok && !matches) {
      console.log('        运行中：' + served.fingerprint256);
      console.log('        磁盘上：' + diskCert.fingerprint256);
    }
  }

  const origin = base;
  const cors = await probe(base + '/api/health', { headers: { origin } });
  const allow = cors.headers?.get?.('access-control-allow-origin');
  check(
    allow === origin,
    '局域网 Origin 在后端 CORS 白名单里（Origin: ' + origin + ' → allow-origin: ' + (allow ?? '（没回）') + '）',
    '后端 cors.js 只放行 localhost 与私有网段 IP；如果这台机器用的是公网 / 4G 网段，需要把它加进白名单',
  );

  // 手机装证书走的就是下面这个入口。类型必须是 application/x-x509-ca-cert ——
  // 退成 application/octet-stream 时 iOS 只会把文件存进「文件」App，用户以为装完了其实没装。
  const certDownload = await probe(base + '/cert.crt');
  const certType = certDownload.headers?.get?.('content-type') ?? '';
  check(
    certDownload.ok &&
      certDownload.status === 200 &&
      certType === 'application/x-x509-ca-cert' &&
      certDownload.text.includes('BEGIN CERTIFICATE'),
    '手机装证书的入口可用：GET ' + base + '/cert.crt → ' + (certDownload.ok ? certDownload.status + ' ' + certType : certDownload.error),
    '重启一次 `cd frontend && npm run serve`（这个入口是 2026-09-29 才加的）',
  );

  // 顺带确认私钥没被发出去。`.certs/` 落在 frontend/ 这棵静态树里，
  // 少了拦截，同网段任何人都能把 key.pem 拉走。
  const keyLeak = await probe(base + '/tools/.certs/key.pem');
  check(
    keyLeak.status === 403,
    '私钥没有参与静态分发（GET /tools/.certs/key.pem → ' + keyLeak.status + '）',
    '拦截失效了：serve.mjs 的 .certs 保护被绕过，私钥正暴露给同网段的每个人',
  );
}

/* ---------- 5. 局域网地址上的 wss 握手 ---------- */
if (base) {
  const session = await probe(base + '/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'learner', deviceId: PROBE_DEVICE }),
  });
  const token = session.json?.data?.token;
  check(Boolean(token), '局域网地址上能拿到令牌', 'REST 都过不去，先修上面两条');

  if (token) {
    const url = base.replace(/^http/, 'ws') + '/ws/match?token=' + encodeURIComponent(token);
    const handshake = await new Promise((resolve) => {
      const socket = new WebSocket(url, { origin: base });
      const timer = setTimeout(() => resolve({ ok: false, why: '10 秒没握上手' }), 10_000);
      socket.on('open', () => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: true });
      });
      socket.on('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        resolve({ ok: false, why: 'HTTP ' + response.statusCode });
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        resolve({ ok: false, why: error.message });
      });
    });
    check(
      handshake.ok,
      '从局域网地址握手 wss：' + base.replace(/^http/, 'ws') + '/ws/match',
      '这一条过了，信令路径就和手机一致了；失败原因：' + (handshake.why ?? '') + '（多半是证书 SAN 或防火墙）',
    );
  }
}

/* ---------- 汇总 ---------- */
const failed = results.filter((item) => !item.ok);
console.log('');
if (failed.length === 0) {
  console.log('== 自检通过：局域网这条备用路是通的（地址 + 证书 + CORS + wss 全绿）==');
  console.log('');
  // 真机联调的**默认**做法是公网隧道：真证书、浏览器不报「不安全」、手机不用装任何东西。
  // 这里刻意把它排在前面 —— 让脚本自己推着人去点掉自签证书的警告，等于把整条链路的
  // 加密保护关掉，是踩过的坑（见根 README 第 6 节）。
  console.log('   真机联调默认走**公网隧道**（推荐，两台设备都适用）：');
  // 二进制名按平台给：Windows 下是 cloudflared.exe，`./cloudflared` 跑不起来。
  console.log('     ' + (process.platform === 'win32' ? 'cloudflared.exe' : './cloudflared')
    + ' tunnel --url http://127.0.0.1:4174 --no-autoupdate');
  console.log('     cd frontend && node tools/serve.mjs 4174 --http --backend http://127.0.0.1:8788');
  console.log('   然后两台设备都打开隧道域名 https://<随机>.trycloudflare.com/ —— 没有证书提示。');
  console.log('');
  console.log('   局域网地址只在**起不了隧道**时用，而且必须先把证书装进信任库，');
  console.log('   **不要点掉浏览器那句「不安全」** —— 那等于关掉整条链路的加密保护：');
  for (const address of addresses) {
    console.log('     手机打开 https://' + address + ':' + PORT + '/cert.crt 装证书，再打开 https://' + address + ':' + PORT + '/');
  }
  console.log('     （iOS 装完还要去「设置 > 通用 > 关于本机 > 证书信任设置」打开完全信任，少这步等于没装）');
  console.log('');
  console.log('   然后：进房 → 对着麦克风说话（默认档位下通话档位自动是「远端信令」，不用手动切）');
  console.log('   也可以先跑 `npm run rehearse:rtc -- --base <隧道域名>` 把除媒体栈之外的每一步先验一遍');
} else {
  console.log('== 自检未通过 ' + (results.length - failed.length) + '/' + results.length + ' ==');
  for (const item of failed) console.log('  ✗ ' + item.label);
  process.exitCode = 1;
}

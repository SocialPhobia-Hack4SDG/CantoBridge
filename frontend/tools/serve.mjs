/**
 * 零依赖前端服务器：**一个端口同时干三件事**。
 *
 *   1. 发静态文件（`index.html` / `src/**`）；哈希路由用不到的其他路径回退到 index.html；
 *   2. 把 `/api/*` 反向代理到后端（默认 `http://127.0.0.1:8787`）；
 *   3. 把 `/ws/*` 的 upgrade 握手隧道到同一个后端（Step 2 的信令走这里）。
 *
 * **为什么必须同源**：手机要开麦克风就必须走 HTTPS —— `getUserMedia` 只在安全上下文可用，
 * 而 `http://192.168.x.x` 这种局域网 IP **不算**安全上下文（只有 `localhost` 算）。
 * 可页面一旦是 https，`http://<ip>:8787` 的接口调用会被浏览器按 mixed content 拦掉，
 * `ws://` 信令也会被拒。把后端藏在同一个源后面，一次消掉 mixed content、CORS 白名单
 * 和 ws/wss 三件事 —— 这就是这个文件存在的理由。
 *
 * 用法：
 *   node tools/serve.mjs                       # 默认 4173，HTTPS（证书缺失或过时都会自动补）
 *   node tools/serve.mjs 4173 --http           # 强制纯 HTTP（本机 localhost 调试足够）
 *   node tools/serve.mjs --backend http://127.0.0.1:9999
 *
 * 自签证书落在 `tools/.certs/`（已 gitignore）。浏览器首次访问会提示不受信任，
 * 选「继续访问」即可；手机上想让提示彻底消失，就在手机上打开 `/cert.crt` 把证书装进系统信任库
 * （iOS 装完还要去「设置 > 通用 > 关于本机 > 证书信任设置」手动打开完全信任）。
 * `tools/.certs/` **整个目录都不参与静态分发**——里面有私钥。
 *
 * **自签证书会自愈**：浏览器只认 SAN 不认 CN，而 SAN 里必须写明本机局域网 IP ——
 * 换 Wi-Fi、换 DHCP 租约之后旧证书就对不上新地址了，表现成手机报「不安全」甚至打不开。
 * 启动时会比对「证书 SAN ⊇ 当前局域网地址」，不满足就重签，不需要手动删目录。
 *
 * **本机信息的边界**：证书里出现的局域网 IP 是**运行时**生成的，只落在 gitignore 掉的
 * `tools/.certs/` 里。这个文件、测试与文档里不得出现任何本机 IP 或主机名 ——
 * 所以这里不碰 `os.hostname()`，也请别往后加。
 */

import { spawn } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 后端端口与 `src/services/index.js` 的 `BACKEND_PORT` 是同一个约定（前端 4173 / 后端 8787）。 */
export const DEFAULT_BACKEND_PORT = 8787;

/** 自签证书目录。不进版本管理：每台机器的局域网 IP 不一样。 */
export const CERT_DIR = resolve(ROOT, 'tools', '.certs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  // 证书的专用类型。不能退回 `application/octet-stream`：iOS Safari 只认这个类型
  // 才会弹「安装描述文件」，否则只是默默存进「文件」App，用户以为装完了其实没装。
  '.pem': 'application/x-x509-ca-cert',
  '.crt': 'application/x-x509-ca-cert',
};

export function contentTypeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** 手机装证书的下载入口。`.crt` 后缀是给系统看的，两个路径等价，念哪个都行。 */
export const CERT_DOWNLOAD_PATHS = new Set(['/cert.crt', '/cert.pem']);

/** 判断一个磁盘路径是不是落在某个目录里（含目录本身）。 */
export function isInsideDir(filePath, dir) {
  return filePath === dir || filePath.startsWith(dir + sep);
}

export function isCertDownloadPath(urlPath) {
  return CERT_DOWNLOAD_PATHS.has(String(urlPath ?? '/').split('?')[0]);
}

/** 把 URL 路径映射成磁盘路径；越界返回 null。 */
export function resolveRequestPath(urlPath, root = ROOT) {
  const clean = decodeURIComponent(String(urlPath).split('?')[0]);
  const relative = normalize(clean).replace(/^([/\\])+/g, '');
  const absolute = resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + sep)) return null;
  return absolute;
}

/* ------------------------------------------------------------------ *
 * 路由：哪些路径交给后端
 * ------------------------------------------------------------------ */

/** `/api` 与 `/api/**` 归后端，其余都是静态资源。 */
export function isApiPath(urlPath) {
  const path = String(urlPath ?? '/').split('?')[0];
  return path === '/api' || path.startsWith('/api/');
}

/* ------------------------------------------------------------------ *
 * 静态文件
 * ------------------------------------------------------------------ */

/**
 * 把自签证书发出去，专供手机装进系统信任库。
 *
 * 只发 `cert.pem` 这一个文件，**绝不发 `key.pem`** —— 证书是公开的，私钥不是。
 * 类型必须是 `application/x-x509-ca-cert`（见 `MIME`），否则 iOS 不弹安装描述文件的提示。
 */
async function serveCertDownload(response, certDir) {
  try {
    const body = await readFile(join(certDir, 'cert.pem'));
    response.writeHead(200, {
      'content-type': MIME['.crt'],
      'content-disposition': 'attachment; filename="cantobridge.crt"',
      'cache-control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('证书还没生成：先以 HTTPS 模式启动一次（node tools/serve.mjs）');
  }
}

async function serveStatic(request, response, root, { certDir = CERT_DIR, publicOnly = false } = {}) {
  const target = resolveRequestPath(request.url ?? '/', root);
  const relative = target?.slice(root.length).split(sep).filter(Boolean) ?? [];
  const hidden = relative.some(part => part.startsWith('.') || part === 'node_modules');
  const publicPath = relative.length === 0 || relative.join('/') === 'index.html' || ['src', 'assets'].includes(relative[0]);
  // `.certs/` 整个目录不参与静态分发。它恰好落在 `frontend/` 这棵静态树里，
  // 而里面有私钥——不拦就等于把私钥发给同网段的任何人（会场 Wi-Fi 上尤其难看）。
  // 证书本身有 `/cert.crt` 这个专门入口，不需要从文件树里摸。
  if (target === null || isInsideDir(target, certDir) || hidden || (publicOnly && !publicPath)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('forbidden');
    return;
  }
  const filePath = extname(target) ? target : join(root, 'index.html');
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentTypeFor(filePath), 'cache-control': 'no-cache' });
    response.end(body);
  } catch {
    try {
      const fallback = await readFile(join(root, 'index.html'));
      response.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
      response.end(fallback);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
    }
  }
}

/* ------------------------------------------------------------------ *
 * 反向代理：HTTP 与 upgrade 两条路
 * ------------------------------------------------------------------ */

/**
 * 把一次普通请求转给后端，响应原样流回来。
 *
 * 后端不可达时回 **502 + 统一信封**（而不是一段 HTML）——这样前端 `http.js` 拆信封
 * 会拿到 `{ ok: false, error: { code: 'upstream_unreachable' } }`，页面能给出正常的三态
 * 而不是"信封不合规"这种查不出原因的错。
 */
export function proxyHttp(request, response, backendOrigin) {
  const target = new URL(request.url ?? '/', backendOrigin);
  const headers = { ...request.headers, host: target.host };
  // 让后端回未压缩内容：省掉「解压再压」这一趟，演示期流量很小，不值得
  delete headers['accept-encoding'];

  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      method: request.method,
      path: target.pathname + target.search,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', (error) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    response.end(
      JSON.stringify({
        ok: false,
        error: { code: 'upstream_unreachable', message: '后端 ' + backendOrigin + ' 不可达：' + error.message },
      }),
    );
  });

  request.pipe(upstream);
  return upstream;
}

/**
 * WebSocket 握手隧道：把 upgrade 请求原样重放到后端，然后把两个 socket 对接起来。
 *
 * 这里**不解析帧**——隧道是字节级的，后端说 WebSocket 就是 WebSocket。所以
 * Step 2 在 8787 上起 `ws` 服务之后，这个函数一行都不用改。
 */
export function proxyUpgrade(request, socket, head, backendOrigin) {
  const target = new URL(request.url ?? '/', backendOrigin);

  const upstream = connect(Number(target.port) || 80, target.hostname, () => {
    const headers = { ...request.headers, host: target.host };
    const lines = ['GET ' + target.pathname + target.search + ' HTTP/1.1'];
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) lines.push(name + ': ' + item);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on('error', () => socket.destroy());
  // 两侧任意一边断开都要收掉另一边：只监听 'error' 不够 —— 对端正常 close（比如客户端
  // 直接 destroy()）不会触发 'error'，剩下的那半个 socket 会一直吊着，服务器也关不掉。
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
  return upstream;
}

/* ------------------------------------------------------------------ *
 * 服务器装配
 * ------------------------------------------------------------------ */

/**
 * 请求处理器：`backendOrigin` 为 null 时退化成纯静态服务器
 * （`createStaticServer` 就是这么用的，单测也依赖这条老路）。
 *
 * 证书下载排在最前面：它必须抢在「找不到文件就回退 index.html」之前，
 * 否则 `/cert.crt` 会被当成哈希路由、返回一个 HTML 页面。
 */
export function createRequestHandler({ root = ROOT, backendOrigin = null, certDir = CERT_DIR, publicOnly = false } = {}) {
  return function handleRequest(request, response) {
    if (isCertDownloadPath(request.url)) {
      if (publicOnly) { response.writeHead(404); response.end('not found'); return; }
      void serveCertDownload(response, certDir);
      return;
    }
    if (backendOrigin && isApiPath(request.url)) {
      proxyHttp(request, response, backendOrigin);
      return;
    }
    void serveStatic(request, response, root, { certDir, publicOnly });
  };
}

/** 纯静态服务器（向后兼容：单测与旧脚本用）。 */
export function createStaticServer({ root = ROOT, certDir = CERT_DIR } = {}) {
  return createHttpServer(createRequestHandler({ root, backendOrigin: null, certDir }));
}

/**
 * 完整服务器：静态 + `/api` 反代 + `/ws` 隧道。
 * `tls` 传 `{ key, cert }` 就是 HTTPS，不传就是 HTTP。
 */
export function createAppServer({ root = ROOT, backendOrigin = null, tls = null, certDir = CERT_DIR } = {}) {
  const handler = createRequestHandler({ root, backendOrigin, certDir });
  const server = tls ? createHttpsServer({ key: tls.key, cert: tls.cert }, handler) : createHttpServer(handler);
  if (backendOrigin) {
    server.on('upgrade', (request, socket, head) => proxyUpgrade(request, socket, head, backendOrigin));
  }
  return server;
}

/* ------------------------------------------------------------------ *
 * 局域网地址
 * ------------------------------------------------------------------ */

export function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

export function lanUrls(port, protocol = 'http') {
  return lanAddresses().map((address) => protocol + '://' + address + ':' + port);
}

/* ------------------------------------------------------------------ *
 * 自签证书
 * ------------------------------------------------------------------ */

/**
 * 只放行「IPv4 形状」的地址。证书 SAN 的 `IP.n` 槽位塞不进别的写法。
 *
 * 这道过滤是**必须**的，不是洁癖，它同时挡两件事：
 *   1. **无限重签**：喂进来一个证书里根本无法表示的主机（IPv6 / 域名 / 乱写的串），
 *      `missing` 就永不为空 —— 于是每次启动都重签、手机上每次都要重装证书。
 *   2. **配置注入**：`hosts` 会被直接插进 `openssl.cnf`，不过滤就等于让人拼配置文件。
 *
 * 注意这里**只查形状、不查数值范围**（`999.999.999.999` 能过）：范围和合法性交给
 * openssl 自己判。它拒绝时我们会走「重签失败 → 保留旧证书 + 告警」那条路，
 * 而不是把非法地址当成「缺了个地址」无限重试。
 */
const IPV4_SHAPE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function ipv4Hosts(hosts = []) {
  return [...new Set(hosts.filter((host) => typeof host === 'string' && IPV4_SHAPE.test(host)))];
}

/**
 * 抽出一张证书 SAN 里的 IP 列表。
 *
 * 收的是 `X509Certificate` 实例（鸭子类型也行，便于不装 openssl 也能测），
 * 不是 PEM 字符串 —— 调用方各自决定「读不出来」算什么错，这里不吞异常。
 * 没有 SAN 扩展时 `subjectAltName` 是 `undefined`（不是空串），要能安全地回空数组。
 */
export function sanIpsOf(cert) {
  return [...String(cert?.subjectAltName ?? '').matchAll(/IP Address:([0-9.]+)/g)].map((match) => match[1]);
}

/**
 * 私钥与证书配不配对。解析不了就回 false，不抛。
 *
 * 为什么需要它：重签时要**覆盖一张可能还能用的证书**。真正危险的窗口不是两次 rename
 * 之间（那是亚毫秒级、下次启动还能自愈），而是 openssl 非零退出却已经写出了 key.tmp、
 * 或者退出码是 0 但产出一对不匹配的文件 —— 无条件 rename 就会把烂证书提交上去。
 * 所以安全性来自「提交前校验」，不是来自 rename 的原子性。
 */
export function keyMatchesCert(keyPem, certPem) {
  try {
    const cert = new X509Certificate(certPem);
    return cert.checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    return false;
  }
}

/** 证书临期阈值：剩不到这么多天就算「该换了」。 */
export const CERT_MIN_VALID_DAYS = 30;

/**
 * 手上这张证书还能不能用。能用回 `null`，不能用回 `{ code, message }`。
 *
 * **为什么回对象而不是一句字符串**：`ensureCertificates` 必须按原因分类 ——
 * 「结构性损坏」（读不出来 / 缺文件 / 私钥不配对）**即使没连网也得重签**，
 * 而「过时」（SAN 缺地址 / 过期 / 临期）只在有网时才有意义。用字符串就得回头再解析一遍。
 * `message` 是给日志与断言看的中文，`code` 是给分支与测试看的稳定标识。
 *
 * 判定 SAN 用的是**「⊇ 当前地址」而不是相等**：地址消失（比如 VPN 关了）不触发重签，
 * 所以不会来回抖动，是收敛的。
 */
export function certProblem(certPem, { hosts = [], now = new Date(), minValidDays = CERT_MIN_VALID_DAYS } = {}) {
  let cert;
  try {
    cert = new X509Certificate(certPem);
  } catch (error) {
    return { code: 'unreadable', message: '证书读不出来（' + error.message + '）' };
  }

  const sanIps = sanIpsOf(cert);
  const missing = ipv4Hosts(hosts).filter((host) => !sanIps.includes(host));
  if (missing.length > 0) {
    return { code: 'san_missing', message: '证书 SAN 不含当前局域网地址 ' + missing.join('、') };
  }

  // 用 `new Date(cert.validTo)` 而不是 `validToDate`：后者是 Node 23 才有的，
  // 而后端 package.json 写着 engines >= 22，它也会 import 这个文件。
  const expiresAt = new Date(cert.validTo).getTime();
  if (!Number.isFinite(expiresAt)) {
    return { code: 'unreadable', message: '读不出证书的有效期（' + cert.validTo + '）' };
  }
  const remainingDays = (expiresAt - new Date(now).getTime()) / 86_400_000;
  if (remainingDays <= 0) {
    return { code: 'expired', message: '证书已于 ' + cert.validTo + ' 过期' };
  }
  if (remainingDays < minValidDays) {
    return {
      code: 'expiring',
      message: '证书 ' + cert.validTo + ' 到期，只剩不到 ' + minValidDays + ' 天',
    };
  }
  return null;
}

/**
 * 生成 openssl 配置。SAN 里必须列出局域网 IP —— 浏览器只认 SAN，不认 CN。
 * 用配置文件而不是 `-addext`：`-addext` 在 LibreSSL（macOS 自带）上不一定有。
 */
export function opensslConfig(hosts = []) {
  const alt = ['DNS.1 = localhost', 'DNS.2 = cantobridge.local', 'IP.1 = 127.0.0.1'];
  const unique = ipv4Hosts(hosts);
  unique.forEach((host, index) => alt.push('IP.' + (index + 2) + ' = ' + host));
  return [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3_req',
    'prompt = no',
    '',
    '[dn]',
    'CN = cantobridge.local',
    '',
    '[v3_req]',
    'subjectAltName = @alt',
    'basicConstraints = critical, CA:TRUE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    '',
    '[alt]',
    ...alt,
    '',
  ].join('\n');
}

/**
 * openssl 的候选可执行文件，**按平台生成**。
 *
 * 以前这里是一串写死的 POSIX 绝对路径。它在 Windows 上是**必错**的：`/usr/bin/openssl`
 * 会被解析成 `C:\usr\bin\openssl`，而 Git for Windows **自带 openssl**
 * （装在 `usr\bin\openssl.exe`）却默认不把它放进 PATH —— 于是 Windows 上必然
 * 「找不到 openssl → 退回 HTTP → 手机拿不到麦克风」，且现场看不出为什么。
 *
 * 所以：先让系统自己在 PATH 里找（`spawn` 会按 PATHEXT 补 `.exe`），再按平台试常见安装位置。
 * 写成纯函数（`platform` 与 `env` 都能注入）是为了能直接单测，不必真在 Windows 上跑。
 */
export function opensslCandidates(platform = process.platform, env = process.env) {
  const fromPath = ['openssl', 'openssl.exe'];
  if (platform !== 'win32') {
    return [...fromPath, '/usr/bin/openssl', '/opt/homebrew/bin/openssl', '/usr/local/bin/openssl'];
  }

  // Windows：Git for Windows（含「只为我安装」那种落在 LOCALAPPDATA 的）、
  // OpenSSL 官方安装包、以及 scoop / chocolatey 常见的落点。去重是因为
  // 64 位系统上 ProgramFiles 与 ProgramW6432 往往是同一个值。
  // 用 `win32.join` 而不是 `join`：这样在 macOS / Linux 上也能算出**正确的 Windows 路径**，
  // 函数与宿主平台无关，测试可以直接钉住结果。
  const roots = [
    ...new Set(
      [
        env.ProgramFiles,
        env['ProgramFiles(x86)'],
        env.ProgramW6432,
        env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Programs') : null,
      ].filter(Boolean),
    ),
  ];
  const relatives = [
    ['Git', 'usr', 'bin', 'openssl.exe'],
    ['Git', 'mingw64', 'bin', 'openssl.exe'],
    ['OpenSSL-Win64', 'bin', 'openssl.exe'],
    ['OpenSSL-Win32', 'bin', 'openssl.exe'],
    ['OpenSSL', 'bin', 'openssl.exe'],
  ];

  const out = [...fromPath];
  for (const root of roots) {
    for (const relative of relatives) out.push(win32.join(root, ...relative));
  }
  return out;
}

/** 挨个试候选；PATH 里的优先，找不到再试该平台常见的安装位置。 */
function runOpenssl(args, { candidates = opensslCandidates() } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let index = 0;
    let lastError = null;
    let settled = false;

    const attempt = () => {
      if (settled) return;
      if (index >= candidates.length) {
        settled = true;
        const hint = process.platform === 'win32'
          ? '。Windows 上最省事的是装 Git for Windows —— 它自带 openssl，装完重开一个终端再试'
          : '。macOS 可以 `brew install openssl`';
        rejectPromise(
          lastError ?? new Error('找不到可用的 openssl（试过：' + candidates.join(', ') + '）' + hint),
        );
        return;
      }
      const bin = candidates[index];
      index += 1;

      let child;
      try {
        child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (error) {
        lastError = error;
        attempt();
        return;
      }

      let stderr = '';
      let failed = false;
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        if (failed || settled) return;
        failed = true;
        lastError = error;
        attempt();
      });
      child.on('close', (code) => {
        if (failed || settled) return;
        if (code === 0) {
          settled = true;
          resolvePromise(true);
          return;
        }
        lastError = new Error('openssl（' + bin + '）退出码 ' + code + '：' + stderr.trim());
        attempt();
      });
    };

    attempt();
  });
}

/**
 * 读一对现成的私钥 + 证书。缺一个、读不出来、或者两者配不上对，都算「没有」。
 *
 * 校验配对不是多余的：私钥与证书对不上时，`createHttpsServer` 会抛一句很难懂的
 * `ERR_OSSL_X509_KEY_VALUES_MISMATCH`，而且那行在 `main()` 的 try/catch **之外**，
 * 表现成「服务根本起不来」。这里先认出来，就当它不存在、重签一棵新的。
 */
async function readCertificatePair(dir) {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  if (!existsSync(keyPath) || !existsSync(certPath)) return null;
  try {
    const key = await readFile(keyPath);
    const cert = await readFile(certPath);
    return keyMatchesCert(key, cert) ? { key, cert } : null;
  } catch {
    return null;
  }
}

/**
 * 开一对新证书到 `dir`。
 *
 * **先生成到 pid 后缀的临时文件，校验通过才 rename 覆盖。** 以前这个函数只在文件缺失
 * 时才写，改完自愈之后它会**覆盖一张可能还能用的证书** —— 中途失败不能把旧证书打烂。
 * 要校验「私钥与证书配对」是因为真正会出事的窗口是 openssl 写了一半就退出、
 * 或者产出一对不匹配的文件；失败时临时文件在 `finally` 里清掉，旧证书原封不动。
 * 用 pid 后缀是防并发的两个 `npm run serve` 互相踩。
 */
async function generateCertificates(dir, hosts) {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  const keyTmp = join(dir, 'key.pem.' + process.pid + '.tmp');
  const certTmp = join(dir, 'cert.pem.' + process.pid + '.tmp');
  const configPath = join(dir, 'openssl.cnf');

  await mkdir(dir, { recursive: true });
  try {
    await writeFile(configPath, opensslConfig(hosts), 'utf8');
    await runOpenssl([
      'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '825', '-nodes',
      '-keyout', keyTmp, '-out', certTmp, '-config', configPath,
    ]);

    const key = await readFile(keyTmp);
    const cert = await readFile(certTmp);
    if (!keyMatchesCert(key, cert)) throw new Error('openssl 产出的私钥与证书不配对');

    await rename(keyTmp, keyPath); // 先私钥后证书
    await rename(certTmp, certPath);
    return { key, cert };
  } finally {
    await rm(keyTmp, { force: true });
    await rm(certTmp, { force: true });
  }
}

/**
 * 该不该重签。`null` 表示不用动，否则回 `{ code, message }` 说明为什么。
 *
 * **分两类，这是这个函数存在的全部理由：**
 *   - **结构性损坏**（缺文件 / 读不出来 / 私钥不配对）→ **无条件重签**。
 *     它跟有没有网无关；不修的话坏证书会一路走到 `createHttpsServer`，
 *     而那行在 `main()` 的 try/catch **之外**，直接表现成「服务根本起不来」。
 *   - **过时**（SAN 缺地址 / 过期 / 临期）→ 交给 `certProblem` 判。注意没连网
 *     （`hosts` 为空）时 SAN 检查**天然不会**报缺失，所以不需要再单独设一道门槛。
 *
 * `force` 只在知道当前地址时才生效：`hosts` 为空时强签只会得到一张更差的
 * （只剩 localhost 的）证书。这个组合是被**刻意拒绝**的，不是漏了。
 */
function decideRenewal({ pair, usable, force, minValidDays, now }) {
  if (pair === null) return { code: 'missing', message: '证书文件缺失，或私钥与证书不配对' };

  const problem = certProblem(pair.cert, { hosts: usable, now, minValidDays });
  if (problem !== null) return problem;

  if (force && usable.length > 0) return { code: 'forced', message: '显式要求重签' };
  return null;
}

/**
 * 拿到一对能用的证书。少了就开，过时了就**自愈重签**。
 *
 * 为什么需要自愈：SAN 里必须写明本机局域网 IP（浏览器只认 SAN 不认 CN），而 IP 会随
 * Wi-Fi / DHCP 租约变化 —— 旧证书对新地址无效，手机上就是「不安全」甚至打不开。
 * 以前这里只在文件缺失时才生成，于是每换一次网络都得手动删掉 `.certs/` 再重启。
 *
 * `hosts` 是要写进 SAN 的局域网 IP：手机用哪个地址访问，就得有哪个地址。
 *
 * 返回 `{ key, cert, dir, generated, reason, warning }`：
 *   - `generated`：这次有没有（重新）生成；`reason.code === 'missing'` 表示是首次生成。
 *   - `warning`：重签失败但旧证书还能顶上时的一句告警，调用方要打出来。
 */
export async function ensureCertificates({
  dir = CERT_DIR,
  hosts = [],
  force = false,
  minValidDays = CERT_MIN_VALID_DAYS,
  now = new Date(),
} = {}) {
  const pair = await readCertificatePair(dir);
  const usable = ipv4Hosts(hosts);
  const reason = decideRenewal({ pair, usable, force, minValidDays, now });

  if (reason === null) {
    return { key: pair.key, cert: pair.cert, dir, generated: false, reason: null, warning: null };
  }

  try {
    const fresh = await generateCertificates(dir, usable);
    return { ...fresh, dir, generated: true, reason, warning: null };
  } catch (error) {
    if (pair === null) throw error;
    // 旧证书还在就继续用。带错名字的 HTTPS 页面在手机上是「可以点过去」的，
    // 而退回 HTTP 会直接掐死 getUserMedia —— 严格优于「局域网 IP 上的 HTTP」。
    return {
      key: pair.key,
      cert: pair.cert,
      dir,
      generated: false,
      reason: null,
      warning: '重签失败（' + error.message + '），本次继续用旧证书',
    };
  }
}

/* ------------------------------------------------------------------ *
 * 命令行
 * ------------------------------------------------------------------ */

/** 参数解析（纯函数，便于单测）：`--backend` 的值不能被当成端口。 */
export function parseArgs(argv = []) {
  const out = { port: null, backend: null, http: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--http') out.http = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--backend') {
      out.backend = argv[index + 1] ?? null;
      index += 1; // 吃掉值，否则它会被下一轮当成端口
    } else if (arg.startsWith('--backend=')) out.backend = arg.slice('--backend='.length);
    else if (arg.startsWith('--')) continue;
    else if (out.port === null) out.port = arg;
  }
  return out;
}

const HELP = [
  'CantoBridge 前端服务器（静态 + /api 反代 + /ws 隧道）',
  '',
  '  node tools/serve.mjs [port] [--backend <origin>] [--http]',
  '',
  '  port               默认 4173（也可用环境变量 PORT）',
  '  --backend <origin> 后端地址，默认 http://127.0.0.1:' + DEFAULT_BACKEND_PORT + '（也可用 BACKEND_ORIGIN）',
  '  --http             强制纯 HTTP；不加则用 HTTPS（自签证书自动生成 / 过时自愈重签）',
  '',
  '  /cert.crt          下载自签证书（手机装进系统信任库用；只发证书，不发私钥）',
  '',
].join('\n');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  const port = Number(opts.port ?? process.env.PORT ?? 4173);
  const backendOrigin = opts.backend ?? process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:' + DEFAULT_BACKEND_PORT;
  const forceHttp = opts.http || process.env.CANTOBRIDGE_TLS === '0';

  let tls = null;
  if (!forceHttp) {
    try {
      const certs = await ensureCertificates({ hosts: lanAddresses() });
      tls = { key: certs.key, cert: certs.cert };
      if (certs.warning) console.log('⚠ ' + certs.warning);
      if (certs.generated) {
        const firstRun = certs.reason.code === 'missing';
        console.log(
          (firstRun ? '已生成自签证书：' : '已重签自签证书（' + certs.reason.message + '）：') + certs.dir,
        );
        if (!firstRun) {
          // 重签会连私钥一起换，手机上装过的那张立刻失效。这句必须说清楚，
          // 否则用户会以为「都自愈了怎么还报不安全」。
          console.log('换了新证书，手机上之前装过的那张已经作废 —— 要打开下面打印的 /cert.crt 链接重装一次。');
        }
        console.log('浏览器首次访问会提示不受信任 —— 选「继续访问」，手机上需手动信任一次。');
      }
    } catch (error) {
      console.log('无法生成自签证书（' + error.message + '），本次退回 HTTP。');
      console.log('HTTP 下 localhost 仍能开麦克风；但手机用局域网 IP 打开会被浏览器拒掉 getUserMedia。');
    }
  }

  const server = createAppServer({ backendOrigin, tls });
  const protocol = tls ? 'https' : 'http';

  server.listen(port, '0.0.0.0', () => {
    console.log('CantoBridge 前端：' + protocol + '://localhost:' + port);
    console.log('后端反代：/api 与 /ws → ' + backendOrigin);
    for (const url of lanUrls(port, protocol)) console.log('手机同 Wi-Fi 打开：' + url + '/');
    if (tls) {
      for (const url of lanUrls(port, protocol)) {
        console.log('手机装证书（装一次，之后不再报「不安全」）：' + url + '/cert.crt');
      }
    }
  });
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  main().catch((error) => {
    console.error('serve 起步失败：' + (error?.message ?? String(error)));
    process.exitCode = 1;
  });
}

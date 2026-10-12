import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { connect } from 'node:net';
import { sep, win32 } from 'node:path';
import { test } from 'node:test';

import {
  contentTypeFor,
  createAppServer,
  createStaticServer,
  DEFAULT_BACKEND_PORT,
  isApiPath,
  lanUrls,
  opensslCandidates,
  opensslConfig,
  parseArgs,
  resolveRequestPath,
} from '../tools/serve.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => {
    // 升级隧道用的是长连接：不断掉已建立的连接，close() 会一直等下去
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/** 从裸 socket 里攒数据，直到 `predicate` 成立（升级隧道没有 HTTP 客户端可用）。 */
function readUntil(socket, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('等待超时，已收到：' + JSON.stringify(buffer)));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    }
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      if (predicate(buffer)) {
        cleanup();
        resolve(buffer);
      }
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

test('contentTypeFor：常见前端资源的 MIME', () => {
  assert.match(contentTypeFor('index.html'), /text\/html/);
  assert.match(contentTypeFor('app.js'), /javascript/);
  assert.match(contentTypeFor('app.mjs'), /javascript/);
  assert.match(contentTypeFor('app.css'), /text\/css/);
  assert.equal(contentTypeFor('photo.png'), 'image/png');
  assert.equal(contentTypeFor('unknown.bin'), 'application/octet-stream');
});

test('resolveRequestPath：任何写法都不能跑到站点根目录之外', () => {
  const root = resolveRequestPath('/index.html').replace(/[^\\/]+$/, '').replace(/[\\/]$/, '');
  const attempts = ['/', '/src/app/main.js', '/../../package.json', '/%2e%2e/%2e%2e/secret', '//etc/passwd', '/src/../src/app/main.js'];
  for (const attempt of attempts) {
    const resolved = resolveRequestPath(attempt, root);
    if (resolved === null) continue;
    assert.ok(resolved === root || resolved.startsWith(root + sep), attempt + ' 逃出了站点根目录：' + resolved);
  }
});

test('isApiPath：只有 /api 与 /api/** 归后端，别把 /apix 误伤', () => {
  assert.equal(isApiPath('/api'), true);
  assert.equal(isApiPath('/api/health'), true);
  assert.equal(isApiPath('/api/me?x=1'), true);
  assert.equal(isApiPath('/apix/health'), false);
  assert.equal(isApiPath('/src/app/main.js'), false);
  assert.equal(isApiPath('/'), false);
  assert.equal(isApiPath(undefined), false);
});

test('静态服务器：根路径与源文件都能取到', async () => {
  const server = createStaticServer({});
  const port = await listen(server);
  const base = 'http://127.0.0.1:' + port;
  try {
    const index = await fetch(base + '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    const html = await index.text();
    assert.match(html, /<div id="app"/);
    assert.match(html, /src\/app\/main\.js/);

    const css = await fetch(base + '/src/styles/tokens.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.match(await css.text(), /--accent:/);

    const js = await fetch(base + '/src/app/main.js');
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.match(await js.text(), /createApp/);
  } finally {
    await close(server);
  }
});

test('静态服务器：哈希路由用不到的其他路径回退到 index.html（不出现 404 白屏）', async () => {
  const server = createStaticServer({});
  const port = await listen(server);
  const base = 'http://127.0.0.1:' + port;
  try {
    const fallback = await fetch(base + '/room/r-1');
    assert.equal(fallback.status, 200);
    assert.match(await fallback.text(), /<div id="app"/);
    const missing = await fetch(base + '/src/nope.js');
    assert.ok([200, 404].includes(missing.status));
  } finally {
    await close(server);
  }
});

test('反代：/api 转给后端（连 Host 一起改），其余路径仍是静态文件', async () => {
  const backend = createHttpServer((request, response) => {
    response.writeHead(request.url === '/api/health' ? 200 : 404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(
      request.url === '/api/health'
        ? JSON.stringify({ ok: true, data: { status: 'ok', seenHost: request.headers.host } })
        : JSON.stringify({ ok: false, error: { code: 'not_found', message: 'no route' } }),
    );
  });
  const backendPort = await listen(backend);
  const app = createAppServer({ backendOrigin: 'http://127.0.0.1:' + backendPort });
  const appPort = await listen(app);
  const base = 'http://127.0.0.1:' + appPort;
  try {
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ok');
    // Host 必须改成后端的：后端 CORS / Origin 校验看的是它
    assert.equal(body.data.seenHost, '127.0.0.1:' + backendPort);

    // 非 /api 路径不碰后端，照旧发静态文件
    const index = await fetch(base + '/');
    assert.equal(index.status, 200);
    assert.match(await index.text(), /<div id="app"/);

    // 后端自己的 404 信封要原样带回来，前端才认得出 code
    const missing = await fetch(base + '/api/nope');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'not_found');
  } finally {
    await close(app);
    await close(backend);
  }
});

test('反代：后端不可达时回 502 + 统一信封（不是 HTML 白页）', async () => {
  // 端口 1 上基本不可能有人监听
  const app = createAppServer({ backendOrigin: 'http://127.0.0.1:1' });
  const appPort = await listen(app);
  try {
    const response = await fetch('http://127.0.0.1:' + appPort + '/api/health');
    assert.equal(response.status, 502);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'upstream_unreachable');
  } finally {
    await close(app);
  }
});

test('反代：/ws 的 upgrade 握手被隧道到后端（路径与 query 原样保留）', async () => {
  // 被升级的 socket 不在 http.Server 的连接表里，closeAllConnections() 管不到它，
  // 所以测试得自己攥住引用 —— 否则那半个连接会一直吊着，测试进程退不出去。
  const backendSockets = new Set();
  const backend = createHttpServer(() => {});
  backend.on('upgrade', (request, socket) => {
    backendSockets.add(socket);
    socket.on('close', () => backendSockets.delete(socket));
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
    );
    socket.write('tunnel-ok:' + request.url);
  });
  const backendPort = await listen(backend);
  const app = createAppServer({ backendOrigin: 'http://127.0.0.1:' + backendPort });
  const appPort = await listen(app);
  const socket = connect(appPort, '127.0.0.1');
  try {
    await new Promise((resolve) => socket.on('connect', resolve));
    socket.write(
      'GET /ws/rooms/r-1?token=t1 HTTP/1.1\r\n' +
        'Host: 127.0.0.1:' + appPort + '\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n',
    );
    const received = await readUntil(socket, (text) => text.includes('tunnel-ok:'));
    assert.match(received, /101 Switching Protocols/);
    // 信令靠 roomId 与令牌路由，所以路径和 query 一个都不能丢
    assert.match(received, /tunnel-ok:\/ws\/rooms\/r-1\?token=t1/);
  } finally {
    socket.destroy();
    for (const upstream of backendSockets) upstream.destroy();
    await close(app);
    await close(backend);
  }
});

test('lanUrls：返回本机局域网地址，协议跟着服务器走', () => {
  const urls = lanUrls(4173);
  assert.ok(Array.isArray(urls));
  for (const url of urls) assert.match(url, /^http:\/\/\d+\.\d+\.\d+\.\d+:4173$/);

  // 手机开麦克风必须 https，所以打印出来的链接也得是 https
  for (const url of lanUrls(4173, 'https')) assert.match(url, /^https:\/\/\d+\.\d+\.\d+\.\d+:4173$/);
});

test('parseArgs：--backend 的值不会被当成端口', () => {
  assert.deepEqual(parseArgs([]), { port: null, backend: null, http: false, help: false });
  assert.deepEqual(parseArgs(['5000']), { port: '5000', backend: null, http: false, help: false });
  assert.deepEqual(parseArgs(['5000', '--http']), { port: '5000', backend: null, http: true, help: false });
  assert.deepEqual(parseArgs(['--backend', 'http://127.0.0.1:9999', '5000']), {
    port: '5000',
    backend: 'http://127.0.0.1:9999',
    http: false,
    help: false,
  });
  assert.deepEqual(parseArgs(['--backend=http://127.0.0.1:9999']), {
    port: null,
    backend: 'http://127.0.0.1:9999',
    http: false,
    help: false,
  });
});

test('opensslConfig：SAN 里必须有 localhost 与局域网 IP（浏览器只认 SAN 不认 CN）', () => {
  const config = opensslConfig(['192.168.1.5', '10.0.0.7']);
  assert.match(config, /subjectAltName = @alt/);
  assert.match(config, /DNS\.1 = localhost/);
  assert.match(config, /IP\.1 = 127\.0\.0\.1/);
  assert.match(config, /IP\.2 = 192\.168\.1\.5/);
  assert.match(config, /IP\.3 = 10\.0\.0\.7/);
});

test('opensslCandidates：POSIX 上给系统路径，不掺 Windows 的 .exe 落点', () => {
  const list = opensslCandidates('darwin', {});
  assert.equal(list[0], 'openssl', 'PATH 里的名字永远排第一（Windows 上 spawn 会按 PATHEXT 补 .exe）');
  assert.ok(list.includes('/usr/bin/openssl'));
  assert.ok(list.includes('/opt/homebrew/bin/openssl'));
  assert.ok(list.every((item) => !item.includes('\\')), 'POSIX 列表里不该出现 Windows 反斜杠路径');
});

test('opensslCandidates：Windows 上要能找到 Git 自带的 openssl（它默认不在 PATH 里）', () => {
  const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' };
  const list = opensslCandidates('win32', env);

  assert.equal(list[0], 'openssl');
  assert.ok(list.includes('openssl.exe'));
  assert.ok(
    list.includes(win32.join('C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe')),
    'Git for Windows 的 openssl 就在 usr\\bin 下 —— 这条是 Windows 能起 HTTPS 的关键',
  );
  assert.ok(
    list.includes(
      win32.join('C:\\Users\\sam\\AppData\\Local', 'Programs', 'Git', 'usr', 'bin', 'openssl.exe'),
    ),
    '「只为我安装」的 Git 落在 LOCALAPPDATA\\Programs',
  );
  assert.ok(list.includes(win32.join('C:\\Program Files', 'OpenSSL-Win64', 'bin', 'openssl.exe')));
  assert.ok(list.every((item) => !item.startsWith('/usr/')), 'Windows 列表里不该有 POSIX 绝对路径');
});

test('opensslCandidates：Windows 上环境变量缺失也不炸，且候选不重复', () => {
  assert.deepEqual(opensslCandidates('win32', {}), ['openssl', 'openssl.exe'], '给不出 root 时就只剩 PATH 里的名字');

  // 64 位系统上 ProgramFiles 与 ProgramW6432 常常是同一个值 —— 不能因此把每条路径列两遍。
  const env = { ProgramFiles: 'C:\\Program Files', ProgramW6432: 'C:\\Program Files' };
  const list = opensslCandidates('win32', env);
  assert.equal(new Set(list).size, list.length, '候选列表里不该有重复');
});

test('默认后端端口与 services 层的约定一致（前端 4173 / 后端 8787）', () => {
  assert.equal(DEFAULT_BACKEND_PORT, 8787);
});

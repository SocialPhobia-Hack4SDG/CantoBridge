import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from '../backend/src/server.js';
import { ApiError } from '../backend/src/http/envelope.js';
import { createCloudDatabase, createSupabaseSnapshotStore } from '../backend/src/store/supabase.js';
import { createCloudflareIceProvider } from '../backend/src/domain/cloudflareTurn.js';
import { createRequestHandler, proxyUpgrade } from '../frontend/tools/serve.mjs';
import { createAccessGate } from './access.mjs';
import { createWindowLimiter } from './limits.mjs';
import { deploymentConfig } from './config.mjs';

export async function startDeployment({ config, storage, iceProvider, now = () => Date.now() }) {
  const cloud = await createCloudDatabase({ storage, now });
  const allowApi = createWindowLimiter({ max: 180, now });
  const allowLogin = createWindowLimiter({ max: 20, windowMs: 15 * 60_000, now });
  const allowIce = createWindowLimiter({ max: 20, windowMs: 60 * 60_000, now });
  const app = createServer({
    db: cloud.db, now, corsOrigins: [config.origin], devRoutes: false, exposeErrors: false,
    runRequest: cloud.runRequest, iceProvider,
    requestPolicy({ path, token, body }) {
      if (!allowApi(token ?? 'anonymous')) throw new ApiError('rate_limited', 'please try again later');
      if (path === '/api/auth/session') {
        if (!allowLogin(body.deviceId ?? 'unknown')) throw new ApiError('rate_limited', 'please try again later');
        if (typeof body.deviceId !== 'string' || body.deviceId.length < 32) throw new ApiError('bad_request', 'please register with a current HTTPS browser');
        if (!cloud.db.findUserByDeviceId(body.deviceId) && cloud.db.count('users') >= config.maxAccounts) {
          throw new ApiError('rate_limited', 'the beta is currently full');
        }
      }
      if (path === '/api/rtc/ice-servers' && !allowIce(cloud.db.getSession(token)?.userId ?? 'anonymous')) throw new ApiError('rate_limited', 'please try again later');
    },
  });
  await new Promise((resolveListen, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolveListen);
  });
  const backendOrigin = `http://127.0.0.1:${app.server.address().port}`;
  const handler = createRequestHandler({ backendOrigin, publicOnly: true });
  const gate = createAccessGate({ code: config.inviteCode, origin: config.origin, secure: config.origin.startsWith('https:'), now });
  const allowTraffic = createWindowLimiter({ max: 600, now });
  const allowUpgrade = createWindowLimiter({ max: 30, now });
  const sockets = new Set();
  let closing = false;

  // Render terminates TLS and appends the remote IP. Only trust the last entry
  // on Render; local runs cannot set their identity via an arbitrary header.
  function clientId(req) {
    const forwarded = config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim() : null;
    return forwarded || req.socket.remoteAddress || 'unknown';
  }

  const server = createHttpServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('permissions-policy', 'microphone=(self), camera=()');
    if (config.origin.startsWith('https:')) res.setHeader('strict-transport-security', 'max-age=31536000');
    const path = new URL(req.url, config.origin).pathname;
    if (path === '/api/health') {
      const ready = cloud.ready() && !closing;
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: ready, data: { status: ready ? 'ok' : 'unavailable' } })); return;
    }
    const id = clientId(req);
    if (!allowTraffic(id)) { res.writeHead(429); res.end('please try again later'); return; }
    void gate.handle(req, res, id).then(handled => {
      if (!handled) handler(req, res);
    }).catch(() => { if (!res.headersSent) res.writeHead(400); res.end('invalid request'); });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    if (closing || !cloud.ready() || !gate.authorized(req) || req.headers.origin !== config.origin || !allowUpgrade(clientId(req))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    proxyUpgrade(req, socket, head, backendOrigin);
  });
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(config.port, '0.0.0.0', resolveListen);
    });
  } catch (error) {
    await app.signaling.close();
    app.server.closeAllConnections();
    await new Promise(resolveClose => app.server.close(resolveClose));
    throw error;
  }

  return {
    server, app, cloud,
    async close() {
      closing = true;
      await cloud.drain();
      await app.signaling.close();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      app.server.closeAllConnections();
      await Promise.all([new Promise(resolveClose => server.close(resolveClose)), new Promise(resolveClose => app.server.close(resolveClose))]);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = deploymentConfig();
    const storage = createSupabaseSnapshotStore({ url: config.supabaseUrl, key: config.supabaseKey });
    const iceProvider = createCloudflareIceProvider({ keyId: config.turnKeyId, apiToken: config.turnApiToken });
    const deployment = await startDeployment({ config, storage, iceProvider });
    console.log('CantoBridge cloud service ready at ' + config.origin);
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 10_000).unref();
      void deployment.close().then(() => { clearTimeout(deadline); process.exit(0); }).catch(() => process.exit(1));
    });
  } catch (error) {
    console.error('Cloud startup failed: ' + error.message);
    process.exitCode = 1;
  }
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createWindowLimiter } from './limits.mjs';

const COOKIE = 'cantobridge_access';
const COOKIE_TTL_SEC = 7 * 24 * 60 * 60;

function equal(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

const PAGE = `<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CantoBridge 内测</title><style>body{margin:0;background:#f5f7f6;font:16px system-ui;color:#16392c;display:grid;min-height:100dvh;place-items:center}main{background:white;padding:32px;border-radius:20px;width:min(340px,80vw)}input,button{font:inherit;box-sizing:border-box;width:100%;padding:14px;border-radius:10px;margin-top:12px}input{border:1px solid #bdd6ca}button{background:#176b4a;color:white;border:0}p{line-height:1.6;color:#52685c}</style><main><h1>CantoBridge</h1><p>欢迎参加内测。请输入邀请口令。<br>Enter your invitation code to continue.</p><form method="post" action="/_access"><label for="code">邀请口令 / Invitation code</label><input id="code" name="code" type="password" required maxlength="256" autocomplete="current-password"><button type="submit">进入 / Continue</button></form></main></html>`;

export function createAccessGate({ code, origin, secure = true, now = () => Date.now(), loginLimit = 10 }) {
  if (typeof code !== 'string' || code.length < 16) throw new Error('Invite code must contain at least 16 characters');
  const attempts = createWindowLimiter({ max: loginLimit, windowMs: 15 * 60_000, now });
  const sign = value => createHmac('sha256', code).update(value).digest('base64url');

  function authorized(req) {
    const cookies = String(req.headers.cookie ?? '').split(';').map(value => value.trim());
    const cookie = cookies.find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!cookie) return false;
    const [expiry, signature, extra] = cookie.split('.');
    const expires = Number(expiry);
    return !extra && signature && Number.isSafeInteger(expires) && expires > now() && expires <= now() + COOKIE_TTL_SEC * 1000 && equal(signature, sign(expiry));
  }

  function page(res, status = 200) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    });
    res.end(PAGE);
  }

  return {
    authorized,
    async handle(req, res, clientId) {
      const url = new URL(req.url, origin);
      if (req.headers.origin && req.headers.origin !== origin) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'origin not allowed' } })); return true;
      }
      if (url.pathname === '/_access' && req.method === 'POST') {
        if (!attempts(clientId)) { page(res, 429); return true; }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024) { page(res, 400); return true; }
          chunks.push(chunk);
        }
        const entered = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('code') ?? '';
        if (!equal(entered, code)) { page(res, 403); return true; }
        const expiry = String(now() + COOKIE_TTL_SEC * 1000);
        res.writeHead(303, { location: '/', 'cache-control': 'no-store',
          'set-cookie': `${COOKIE}=${expiry}.${sign(expiry)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL_SEC}${secure ? '; Secure' : ''}`,
        });
        res.end(); return true;
      }
      if (authorized(req)) return false;
      if (url.pathname.startsWith('/api/')) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'invitation required' } }));
      } else page(res);
      return true;
    },
  };
}

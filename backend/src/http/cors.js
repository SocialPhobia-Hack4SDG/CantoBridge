/**
 * CORS：现场演示时前端跑在 4173，手机连同一个 WiFi 用局域网地址打开，
 * 所以除了 localhost 还要放行局域网 IP（契约见 TODO.md 第 3 节）。
 *
 * 默认规则：只放行 `http(s)://<本机/局域网地址>:<任意端口>`，其它 Origin 一律不回 CORS 头
 * （浏览器自己会拦），但**请求照常处理**——非浏览器客户端（curl / node --test）没有 Origin，
 * 不应该因为 CORS 被拒绝。
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|::1)$/;
const PRIVATE_IPV4 =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

export function isAllowedOrigin(origin, extra = []) {
  if (!origin) return false;
  if (extra.includes(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname;
  return LOCAL_HOST.test(host) || PRIVATE_IPV4.test(host);
}

export function corsHeaders(origin, extra = []) {
  if (!isAllowedOrigin(origin, extra)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,requestid',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

/** OPTIONS 预检：放行则 204，不放行则 403（明确告诉前端 Origin 不在白名单里）。 */
export function handlePreflight(req, res, extra = []) {
  const origin = req.headers?.origin;
  if (req.method !== 'OPTIONS') return false;
  const headers = corsHeaders(origin, extra);
  if (Object.keys(headers).length === 0) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'origin not allowed' } }));
    return true;
  }
  res.writeHead(204, headers);
  res.end();
  return true;
}

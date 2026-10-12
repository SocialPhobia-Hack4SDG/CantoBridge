import { ApiError } from '../http/envelope.js';

export function createCloudflareIceProvider({ keyId, apiToken, fetchImpl = fetch, now = () => Date.now(), ttlSec = 3600 }) {
  if (!keyId || !apiToken) throw new Error('Cloudflare TURN key ID and API token are required');
  if (!Number.isInteger(ttlSec) || ttlSec < 300 || ttlSec > 86400) throw new Error('Invalid TURN credential TTL');
  const cache = new Map();
  return async function iceProvider(session) {
    const cached = cache.get(session.userId);
    if (cached && cached.cacheUntil > now()) return cached.data;
    let response;
    try {
      response = await fetchImpl('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(keyId) + '/credentials/generate-ice-servers', {
        method: 'POST', headers: { authorization: 'Bearer ' + apiToken, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: ttlSec }), signal: AbortSignal.timeout(8000), redirect: 'error',
      });
    } catch { throw new ApiError('turn_unavailable', 'voice relay temporarily unavailable'); }
    if (!response.ok) throw new ApiError('turn_unavailable', 'voice relay temporarily unavailable');
    let payload;
    try { payload = await response.json(); }
    catch { throw new ApiError('turn_unavailable', 'invalid voice relay response'); }
    const iceServers = payload?.iceServers;
    if (!Array.isArray(iceServers) || !iceServers.some(server => {
      const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
      return Array.isArray(urls) && urls.some(url => /^turns?:/.test(url)) && server.username && server.credential;
    })) throw new ApiError('turn_unavailable', 'voice relay credentials missing');
    const data = { iceServers, expiresAt: new Date(now() + ttlSec * 1000).toISOString() };
    for (const [id, entry] of cache) if (entry.cacheUntil <= now()) cache.delete(id);
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(session.userId, { data, cacheUntil: now() + 60_000 });
    return data;
  };
}

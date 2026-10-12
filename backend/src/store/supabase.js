import { createDb } from './db.js';
import { createSeed } from './seed.js';

function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cloud snapshot');
  for (const key of Object.keys(createSeed())) {
    if (!Array.isArray(value[key])) throw new Error('Incomplete cloud snapshot');
  }
  return value;
}

// Server-side Data API only. RLS and SQL grants deny all browser access.
export function createSupabaseSnapshotStore({ url, key, fetchImpl = fetch, snapshotId = 'main' }) {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('SUPABASE_URL must use an HTTPS origin without credentials or a path');
  }
  if (!key) throw new Error('Supabase server key is required');
  const headers = { apikey: key, 'content-type': 'application/json' };
  // New sb_secret keys belong in apikey, not in the JWT Authorization header.
  if (!key.startsWith('sb_secret_')) headers.authorization = 'Bearer ' + key;

  async function request(path, init = {}) {
    let response;
    try {
      response = await fetchImpl(new URL(path, origin), {
        ...init, headers, signal: AbortSignal.timeout(10_000), redirect: 'error',
      });
    } catch { throw new Error('Cloud storage connection failed'); }
    if (!response.ok) throw new Error('Cloud storage request failed (' + response.status + ')');
    try { return await response.json(); }
    catch { throw new Error('Invalid cloud storage response'); }
  }

  return {
    async load() {
      const query = new URLSearchParams({ id: 'eq.' + snapshotId, select: 'revision,data' });
      const rows = await request('/rest/v1/cantobridge_snapshots?' + query);
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('Invalid cloud snapshot response');
      if (!rows.length) return { revision: 0, data: createSeed() };
      const { revision, data } = rows[0];
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid snapshot revision');
      return { revision, data: validateSnapshot(data) };
    },
    async save(data, revision) {
      validateSnapshot(data);
      const next = await request('/rest/v1/rpc/cantobridge_save_snapshot', {
        method: 'POST', body: JSON.stringify({ snapshot_id: snapshotId, expected_revision: revision, snapshot_data: data }),
      });
      if (next !== revision + 1) throw new Error('Cloud snapshot revision conflict');
      return next;
    },
  };
}

export async function createCloudDatabase({ storage, now = () => Date.now() }) {
  const loaded = await storage.load();
  validateSnapshot(loaded.data);
  const db = createDb({ now });
  // A restart cannot resume live media or an old waiting queue. Keep completed
  // room settlements, profiles, progress and history; drop only transient state.
  db.replace({ ...loaded.data, queue: [], matchRequests: [],
    rooms: loaded.data.rooms.filter(room => room.status === 'ended'),
    sessions: loaded.data.sessions.filter(session => Date.parse(session.expiresAt) > now()),
  });
  let revision = await storage.save(db.snapshot(), loaded.revision);
  let committed = db.snapshot();
  let available = true;
  let tail = Promise.resolve();

  async function execute(action, afterCommit) {
    if (!available) throw new Error('Cloud storage unavailable; restart required');
    // Clone the last committed state: expired-session cleanup may have happened
    // in a WS handshake between HTTP requests and must also be saved.
    let result;
    try { result = await action(); }
    catch (error) { db.replace(structuredClone(committed)); throw error; }
    const next = db.snapshot();
    if (JSON.stringify(next) !== JSON.stringify(committed)) {
      try { revision = await storage.save(next, revision); }
      catch (error) {
        db.replace(structuredClone(committed));
        // A lost response can mean the remote commit actually succeeded.
        // Never continue writing from an uncertain revision.
        available = false;
        throw error;
      }
      committed = structuredClone(next);
    }
    afterCommit?.(result);
    return result;
  }

  return {
    db,
    ready: () => available,
    runRequest(action, afterCommit) {
      const result = tail.then(() => execute(action, afterCommit));
      tail = result.catch(() => {});
      return result;
    },
    async drain() { await tail; },
  };
}

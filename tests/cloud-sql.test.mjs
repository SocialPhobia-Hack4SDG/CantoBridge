import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createSeed } from '../backend/src/store/seed.js';

test('真实 PostgreSQL：迁移可重复执行，浏览器角色无权限，服务端可 CAS 保存且拒绝旧版本', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const sql = readFileSync(new URL('../deploy/supabase.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(db.query('select * from public.cantobridge_snapshots'), /permission denied/);
    await assert.rejects(db.query('insert into public.cantobridge_snapshots values ($1, 1, $2, now())', ['main', createSeed()]), /permission denied/);
    await assert.rejects(db.query('update public.cantobridge_snapshots set revision = 99'), /permission denied/);
    await assert.rejects(db.query('delete from public.cantobridge_snapshots'), /permission denied/);
    await assert.rejects(db.query('select public.cantobridge_save_snapshot($1, $2, $3)', ['main', 0, createSeed()]), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const save = (revision, data) => db.query('select public.cantobridge_save_snapshot($1, $2, $3) as revision', ['main', revision, data]);
  assert.equal((await save(0, createSeed())).rows[0].revision, 1);
  const results = await Promise.allSettled([save(1, { ...createSeed(), users: [{ userId: 'winner-a' }] }), save(1, { ...createSeed(), users: [{ userId: 'winner-b' }] })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, '40001');
  const row = (await db.query('select revision, data from public.cantobridge_snapshots')).rows[0];
  assert.equal(row.revision, 2);
  assert.equal(row.data.users.length, 1);
  await assert.rejects(save(0, createSeed()), /revision conflict/);
  await assert.rejects(save(1, createSeed()), /revision conflict/);
  assert.equal((await db.query('select revision from public.cantobridge_snapshots')).rows[0].revision, 2);
});

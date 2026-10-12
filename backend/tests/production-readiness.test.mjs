import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startTestServer } from './helpers/server.mjs';

test('双账号真实信令可交换 SDP/ICE 和翻卡；禁用开发接口时不影响正式链路', async () => {
  const ui = await startTestServer({ devRoutes: false, corsOrigins: ['https://launch.example.test'] });
  const sockets = [];
  async function connect(token) {
    const ws = new WebSocket(ui.base.replace('http:', 'ws:') + '/ws/rooms/readiness-room?token=' + token, { origin: 'https://launch.example.test' }); sockets.push(ws);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); return ws;
  }
  function next(ws, type) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { ws.off('message', receive); reject(Error('missing ' + type)); }, 2000);
      function receive(raw) { const message = JSON.parse(String(raw)); if (message.type === type) { clearTimeout(timeout); ws.off('message', receive); resolve(message); } }
      ws.on('message', receive);
    });
  }
  try {
    const a = await ui.signInAs('learner', { deviceId: 'readiness-a' }); const b = await ui.signInAs('buddy', { deviceId: 'readiness-b' });
    ui.db.createRoom({ roomId: 'readiness-room', status: 'active', initiatorAccountId: a.userId, peerAccountId: b.userId, peerUserId: ui.db.getProfile(b.userId, 'buddy').userId, peerRole: 'buddy', initiatorRole: 'learner' });
    assert.equal((await ui.request('POST', '/api/dev/reset', { body: {} })).status, 404);
    const left = await connect(a.token); const right = await connect(b.token);
    for (const [sender, recipient, message] of [
      [left, right, { type: 'rtc:offer', sdp: { type: 'offer', sdp: 'test-sdp' } }],
      [right, left, { type: 'rtc:answer', sdp: { type: 'answer', sdp: 'test-sdp' } }],
      [left, right, { type: 'rtc:ice', candidate: { candidate: 'test-candidate' } }],
      [right, left, { type: 'room:card', cardId: 'test-card', index: 1, round: 0 }],
    ]) {
      const received = next(recipient, message.type); sender.send(JSON.stringify(message)); assert.deepEqual(await received, message);
    }
  } finally { for (const ws of sockets) ws.terminate(); await ui.close(); }
});

/**
 * 信令地址解析：REST 与 WebSocket 必须指向同一个后端，所以两者的地址口径一起钉住。
 *
 * 纯函数，不联网、不起服务；真正的握手（Origin / 令牌 / 房间号）在 backend/tests/ws.test.mjs。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SIGNAL_PATH, matchSignalUrl, resolveSignalUrl, roomSignalUrl } from '../src/lib/signal.js';

test('resolveSignalUrl：同源按页面协议推 ws / wss，端口跟着 host 走', () => {
  assert.equal(resolveSignalUrl({}), 'ws://localhost/ws');
  assert.equal(resolveSignalUrl({ protocol: 'https:', host: 'localhost:4173' }), 'wss://localhost:4173/ws');
  // 手机走局域网 https：wss 才不会被 mixed content 拦掉（这是整条远端链路的前提）
  assert.equal(resolveSignalUrl({ protocol: 'https:', host: '192.168.1.5:4173' }), 'wss://192.168.1.5:4173/ws');
  // host 传空串时兜回 localhost，不能拼出 `ws:///ws` 这种坏地址
  assert.equal(resolveSignalUrl({ host: '' }), 'ws://localhost/ws');
  assert.equal(SIGNAL_PATH, '/ws');
});

test('resolveSignalUrl：显式后端只换协议头，路径前缀与 REST 的 /api 平级', () => {
  assert.equal(resolveSignalUrl({ baseUrl: 'http://10.0.0.2:9999' }), 'ws://10.0.0.2:9999/ws');
  assert.equal(resolveSignalUrl({ baseUrl: 'https://api.example.com' }), 'wss://api.example.com/ws');
  // 没写协议头也认（`&backend=10.0.0.2:9999`）
  assert.equal(resolveSignalUrl({ baseUrl: '10.0.0.2:9999' }), 'ws://10.0.0.2:9999/ws');
  // 解析不出来时返回空串：调用方据此降级，而不是拿一个坏地址去连
  assert.equal(resolveSignalUrl({ baseUrl: 'http://' }), '');
});

test('resolveSignalUrl：?signal= 覆盖一切（REST 可以仍在同源）', () => {
  assert.equal(
    resolveSignalUrl({ baseUrl: 'http://10.0.0.2:9999', explicit: 'wss://signal.example.com/ws/' }),
    'wss://signal.example.com/ws',
    '显式指定优先于 baseUrl，结尾斜杠会被吃掉',
  );
  // 只写空白等于没写，退回默认口径
  assert.equal(resolveSignalUrl({ explicit: '   ' }), 'ws://localhost/ws');
});

test('roomSignalUrl：拼出 /ws/rooms/<roomId>，房间号做 URL 编码', () => {
  assert.equal(roomSignalUrl('wss://localhost:4173/ws', 'r-demo-77581'), 'wss://localhost:4173/ws/rooms/r-demo-77581');
  // 结尾多写的斜杠不会拼出双斜杠（后端 parseChannel 认不出 `//rooms`）
  assert.equal(roomSignalUrl('ws://localhost/ws/', 'r-1'), 'ws://localhost/ws/rooms/r-1');
  assert.equal(roomSignalUrl('ws://localhost/ws', 'a/b'), 'ws://localhost/ws/rooms/a%2Fb');
  // 基址为空 = 没有信令可用，交给 rtc.js 降级到同浏览器档位
  assert.equal(roomSignalUrl('', 'r-1'), '');
  assert.equal(roomSignalUrl(null, 'r-1'), '');
});

test('matchSignalUrl：拼出 /ws/match（与房间频道是两条独立连接）', () => {
  assert.equal(matchSignalUrl('wss://localhost:4173/ws'), 'wss://localhost:4173/ws/match');
  // 与 roomSignalUrl 同口径：结尾多写的斜杠不会拼出双斜杠
  assert.equal(matchSignalUrl('ws://localhost/ws/'), 'ws://localhost/ws/match');
  // 基址为空 = 没有信令可用，匹配频道客户端据此降级成空操作
  assert.equal(matchSignalUrl(''), '');
  assert.equal(matchSignalUrl(null), '');
  assert.equal(matchSignalUrl(undefined), '');
});

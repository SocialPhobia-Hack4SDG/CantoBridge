import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('四个 Logo 候选是带透明通道的完整高清 PNG，提示词记录齐全', () => {
  const root = new URL('../assets/branding/candidates/', import.meta.url);
  const prompts = readFileSync(new URL('README.md', root), 'utf8');
  assert.deepEqual(readFileSync(new URL('../logo.png', root)), readFileSync(new URL('03-cb-monogram.png', root)), '正式 logo 使用用户选中的第 3 款');
  for (const id of ['01-dialogue-bridge', '02-conversation', '03-cb-monogram', '04-harbour-voice']) {
    const image = readFileSync(new URL(id + '.png', root));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.subarray(12, 16).toString(), 'IHDR');
    assert.ok(image.readUInt32BE(16) >= 1024);
    assert.ok(image.readUInt32BE(20) >= 1024);
    assert.equal(image[25], 6, 'RGBA 图像保留透明通道');
    assert.ok(image.includes(Buffer.from('IEND')));
    assert.ok(prompts.includes(id + '.png'));
  }
});

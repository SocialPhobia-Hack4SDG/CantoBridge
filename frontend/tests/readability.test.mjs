import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function luminance(hex) {
  const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('五种主题的辅助文字与主按钮文字达到普通字号可读对比度', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const parse = body => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
  const base = parse(blocks[0][2]);
  for (const theme of ['mint', 'warm', 'blue', 'eye', 'night']) {
    const override = blocks.find(block => block[1].includes(`data-theme='${theme}'`));
    const tokens = { ...base, ...(override ? parse(override[2]) : {}) };
    const color = key => {
      const value = tokens[key];
      return value.startsWith('var(') ? color(value.slice(4, -1)) : value;
    };
    for (const surface of ['--bg-base', '--bg-raised']) {
      assert.ok(contrast(color('--text-muted'), color(surface)) >= 4.5, `${theme}: muted text on ${surface}`);
    }
    assert.ok(contrast(color('--on-accent'), color('--accent')) >= 4.5, `${theme}: primary button text`);
  }
});

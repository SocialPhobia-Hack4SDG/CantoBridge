import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { installDom } from '../frontend/tests/helpers/dom-stub.mjs';
import { icon } from '../frontend/src/lib/dom.js';
import { LandingPage } from '../frontend/src/pages/landing.js';
import { HomePage } from '../frontend/src/pages/home.js';
import { createTranslator } from '../frontend/src/i18n/i18n.js';
import { CallControls, TopicCard } from '../frontend/src/components/room.js';

test('所有导航和通话图标使用相同坐标系的本地 SVG，继承五种主题颜色', () => {
  const document = installDom();
  for (const theme of ['mint', 'warm', 'blue', 'eye', 'night']) {
    document.documentElement.setAttribute('data-theme', theme);
    for (const name of ['home','match','ranking','me','back','next','check','star','starFilled','mic','micOff','speaker','hangup','tram']) {
      const node = icon(name);
      assert.equal(node.getAttribute('aria-hidden'), 'true');
      assert.equal(node.textContent, '');
      assert.equal(node.querySelector('svg').getAttribute('viewBox'), '0 0 24 24');
      assert.equal(node.querySelector('svg').getAttribute('stroke'), 'currentColor');
      assert.ok(node.querySelector('path').getAttribute('d').length > 5);
      assert.equal(node.querySelector('svg').getAttribute('focusable'), 'false');
    }
  }
});

test('三语首页提供对话示例，主要入口仍进入注册且文案不丢失', () => {
  installDom();
  for (const locale of ['zh-Hans','zh-Hant','en']) {
    const t = createTranslator(locale); let destination;
    const page = LandingPage.render({ t, navigate: path => { destination = path; } });
    assert.ok(page.querySelector('.conversation-scene'));
    assert.ok(page.textContent.includes('得閒一齊飲茶？'));
    assert.ok(page.textContent.includes(t('landing.intro')));
    assert.equal(page.querySelectorAll('button').length, 1);
    page.querySelector('button').click();
    assert.equal(destination, '/register');
    assert.equal(page.textContent.includes('landing.questionMeaning'), false);
  }
});

test('首页历史使用轻量列表，真实历史内容和开始聊天入口保留', () => {
  installDom(); const t = createTranslator('zh-Hans'); let destination;
  const page = HomePage.render({ t, getState: () => ({ role: 'learner' }), label: (_, value) => value,
    navigate: path => { destination = path; } }, { data: { progress: { conversations: 2, totalMinutes: 8 }, history: [{ peerLabel: 'Alex', durationSec: 120 }] } });
  assert.equal(page.querySelector('.recent-section').classList.contains('card'), false);
  assert.ok(page.querySelector('.recent-list').textContent.includes('Alex'));
  page.querySelector('.home-action').querySelector('button').click();
  assert.equal(destination, '/match');
});

test('长话题内容完整保留，通话控制使用可访问名称和实际回调', () => {
  installDom();
  const long = '很长的话题 Long conversation '.repeat(25);
  const card = TopicCard({ card: { id: 'long', cantonese: long, mandarin: long, english: long, jyutping: long }, positionLabel: '1 / 8', difficultyLabel: 'Beginner' });
  for (const cls of ['is-yue','is-mandarin','is-english','is-jyutping']) assert.equal(card.querySelector('.' + cls).textContent, long);
  const called = [];
  const controls = CallControls({ muted: false, speakerOn: true, onToggleMute: () => called.push('mic'), onToggleSpeaker: () => called.push('speaker'), onHangup: () => called.push('end'), labels: { mic: 'Microphone', speaker: 'Speaker', hangup: 'End call' } });
  for (const button of controls.querySelectorAll('button')) { assert.ok(button.getAttribute('aria-label')); assert.ok(button.querySelector('svg')); button.click(); }
  assert.deepEqual(called, ['mic','speaker','end']);
});


test('五种主题的主要按钮和挂断按钮文字对比度达到 4.5:1', () => {
  const css = readFileSync(new URL('../frontend/src/styles/tokens.css', import.meta.url), 'utf8');
  const declarations = body => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
  const base = declarations(css.slice(css.indexOf('{') + 1, css.indexOf('}')));
  const luminance = hex => {
    const values = hex.slice(1).match(/../g).map(value => { const channel = parseInt(value, 16) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  for (const theme of ['mint', 'warm', 'blue', 'eye', 'night']) {
    const marker = css.indexOf(":root[data-theme='" + theme + "']");
    const start = marker < 0 ? -1 : css.indexOf('{', marker);
    const vars = { ...base, ...(start < 0 ? {} : declarations(css.slice(start + 1, css.indexOf('}', start)))) };
    const resolve = name => vars[name].startsWith('var(') ? resolve(vars[name].slice(4, -1)) : vars[name];
    for (const [background, foreground] of [['--accent', '--on-accent'], ['--danger', '--on-danger']]) {
      const [a, b] = [luminance(resolve(background)), luminance(resolve(foreground))].sort((a, b) => b - a);
      assert.ok((a + .05) / (b + .05) >= 4.5, theme + ' ' + background);
    }
  }
});

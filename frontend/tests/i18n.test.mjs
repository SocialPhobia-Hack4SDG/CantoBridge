import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOCALES, UI_STRINGS, createTranslator, translate } from '../src/i18n/i18n.js';

test('语言包：三种 locale 齐全且都非空', () => {
  assert.deepEqual(LOCALES, ['zh-Hans', 'zh-Hant', 'en']);
  const keys = Object.keys(UI_STRINGS);
  assert.ok(keys.length >= 180, '界面文案应覆盖全部页面，当前 ' + keys.length + ' 条');
  for (const key of keys) {
    for (const locale of LOCALES) {
      const value = UI_STRINGS[key][locale];
      assert.ok(typeof value === 'string' && value.trim().length > 0, key + ' 缺少 ' + locale);
    }
  }
});

test('语言包：key 命名规范（小写点号命名，不含空白）', () => {
  for (const key of Object.keys(UI_STRINGS)) {
    assert.match(key, /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)*$/, '非法 key：' + key);
  }
});

test('translate：插值与未知 key 行为明确', () => {
  assert.equal(translate('zh-Hans', 'duration.minutes', { minutes: 12 }), '12 分钟');
  assert.equal(translate('en', 'duration.minutes', { minutes: 12 }), '12 min');
  assert.equal(translate('zh-Hant', 'duration.minutes', { minutes: 12 }), '12 分鐘');
  assert.equal(translate('en', 'not.exist'), 'not.exist');
  assert.equal(translate('en', 'room.topicOf', { index: 3, total: 8 }), 'Topic 3 of 8');
});

test('translate：缺少变量时保留占位符而不是显示 undefined', () => {
  assert.equal(translate('en', 'room.topicOf', {}), 'Topic {index} of {total}');
});

test('createTranslator：非法 locale 回退到简体中文', () => {
  assert.equal(createTranslator('fr')('nav.home'), UI_STRINGS['nav.home']['zh-Hans']);
  assert.equal(createTranslator('zh-Hant')('nav.home'), '首頁');
  assert.equal(createTranslator('en')('nav.home'), 'Home');
});

test('语言包：繁体与简体不是同一份文案（真的做了转换）', () => {
  const differing = Object.keys(UI_STRINGS).filter(
    (key) => UI_STRINGS[key]['zh-Hans'] !== UI_STRINGS[key]['zh-Hant'],
  );
  assert.ok(differing.length > 40, '繁简应有明显差异，当前只有 ' + differing.length + ' 条');
});

test('语言包：界面文案里搜不到禁用词（去义工化的硬约束）', () => {
  const banned = ['义工', '志愿', '公益', '奉献', '陪伴', '帮扶', '老师', '教师', '教授者'];
  for (const key of Object.keys(UI_STRINGS)) {
    for (const locale of LOCALES) {
      const value = UI_STRINGS[key][locale];
      for (const word of banned) {
        assert.equal(value.includes(word), false, key + '（' + locale + '）出现了禁用词：' + word);
      }
    }
  }
});

test('语言包：招募叙事是「对等的交换」，不是防守式的「不是老师」', () => {
  const note = UI_STRINGS['role.note'];
  assert.equal(/不是老师|唔係老師|not a teacher/i.test(note['zh-Hans'] + note['zh-Hant'] + note['en']), false);
  assert.ok(note['zh-Hans'].includes('交换'), '要正面说清这是交换：' + note['zh-Hans']);
  assert.ok(note['en'].includes('exchange'));
  // 母语者卡片的副标题同样读成「交换」，不再读成「来当伙伴吧」
  assert.ok(UI_STRINGS['role.buddyCardSubtitle']['zh-Hans'].includes('交换'));
});

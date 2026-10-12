import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDom } from './helpers/dom-stub.mjs';
import { TagPicker } from '../src/components/onboarding.js';
import { pickCards } from '../src/lib/topicPicker.js';
import { labelOf } from '../src/data/labels.js';
installDom();
const custom = { label: '自定义标签', hint: '最多10字', long: '超长', empty: '不能为空', duplicate: '重复', full: '已满', invalid: '非法字符', add: '添加', cancel: '取消' };
const tags = [{ value: 'food', label: '美食' }];

test('自定义标签：点击展开，实时超长提示，空白和重复拦截，10个Unicode字符可添加', () => {
  const changes = [];
  const picker = TagPicker({ tags, value: ['food'], custom, onChange: (v) => changes.push(v) });
  const editor = picker.querySelector('.custom-tag-editor');
  assert.equal(editor.hidden, true);
  picker.querySelector('.custom-tag-trigger').click();
  assert.equal(editor.hidden, false);
  const input = picker.querySelector('input');
  const add = editor.querySelector('.btn-primary');
  for (const [value, message] of [['  ', '不能为空'], ['美食', '重复'], ['一二三四五六七八九十百', '超长'], ['a\nb', '非法字符']]) {
    input.value = value;
    input.dispatch('input');
    assert.ok(editor.textContent.includes(message));
    add.click();
    assert.equal(changes.length, 0);
  }
  input.value = '  😀😀😀😀😀😀😀😀😀😀  ';
  input.dispatch('input');
  assert.equal(input.getAttribute('aria-invalid'), 'false');
  add.click();
  assert.deepEqual(changes, [['food', '😀😀😀😀😀😀😀😀😀😀']]);
  const singleChanges = [];
  const single = TagPicker({ tags: [{ value: 'english', label: '英语' }], value: ['english'], max: 1, custom, onChange: (v) => singleChanges.push(v) });
  single.querySelector('.custom-tag-trigger').click();
  single.querySelector('input').value = '日语';
  single.querySelector('.btn-primary').click();
  assert.deepEqual(singleChanges, [['日语']], '自定义母语替换已有单选，不追加第二个值');
});

test('自定义标签：已保存标签显示为纯文本、可移除，达到5个时不能再添加', () => {
  assert.equal(labelOf('interests', '__proto__'), '__proto__');
  const cards = pickCards({ interests: ['陶艺'], seed: 'custom-interest', count: 8 });
  assert.equal(cards.length, 8, '自定义兴趣没有对应卡池时仍能正常出卡');
  const changes = [];
  const picker = TagPicker({ tags, value: ['food', '<b>茶</b>', '跑步', '阅读', '游泳'], custom, onChange: (v) => changes.push(v) });
  assert.equal(picker.querySelector('b'), null);
  assert.ok(picker.textContent.includes('<b>茶</b>'));
  assert.equal(picker.querySelector('.custom-tag-trigger').disabled, true);
  picker.querySelector('.custom-tag-trigger').click();
  assert.equal(picker.querySelector('.custom-tag-editor').hidden, true);
  picker.querySelectorAll('.pill')[1].click();
  assert.deepEqual(changes, [['food', '跑步', '阅读', '游泳']]);
});

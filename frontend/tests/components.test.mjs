import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installDom } from './helpers/dom-stub.mjs';

installDom();

const { h, icon, pill } = await import('../src/lib/dom.js');
const { AudioWaveform, CallStage, CallControls, PhraseChips, RoomHeader, TopicCard, TopicCardStack } = await import('../src/components/room.js');
const { BuddyCard, BuddyBrowseList, MatchAcceptToast, MatchCriteriaEditor, MatchWaitingPanel, ProfilePreviewCard } = await import('../src/components/match.js');
const { LevelSelector, PrivacyToggleList, QuestionPager, RoleSelectCard, TagPicker } = await import('../src/components/onboarding.js');
const { AppShell, BottomNav, EmptyState, ErrorState, FallbackBanner, LoadingSkeleton, StepProgress, TopBar } = await import('../src/components/base.js');
const { HomeActionCard, StatTile } = await import('../src/components/home.js');
const { AchievementBadge, AchievementWall, BuddyRequestList, LeaderboardList, MockControlPanel, RewardCard, SessionFeedbackSheet } = await import('../src/components/progress.js');

const CARD = {
  id: 'anime-beginner-01',
  topic: 'anime',
  difficulty: 'beginner',
  cantonese: '你最近睇緊咩動漫？',
  mandarin: '你最近在看什么动漫？',
  english: 'What anime have you been watching lately?',
  expressions: [
    { cantonese: '我最近睇緊……', mandarin: '我最近在看……', english: 'Lately I have been watching…' },
    { cantonese: '我最鍾意嘅係……', mandarin: '我最喜欢的是……', english: 'My favourite one is…' },
  ],
};

test('粤拼位于粤语原文之前，切卡更新读音，旧卡缺粤拼不出现空占位', () => {
  const card = { ...CARD, jyutping: 'nei5 zeoi3 gan6 tai2 gan2 me1 dung6 maan6?' };
  const topic = TopicCard({ card, positionLabel: '1/2', difficultyLabel: '初级', jyutpingLabel: '粤拼' });
  assert.equal(topic.querySelector('.is-jyutping').textContent, card.jyutping);
  assert.ok(topic.textContent.indexOf(card.jyutping) < topic.textContent.indexOf(card.cantonese));
  assert.equal(topic.querySelector('.is-jyutping').getAttribute('lang'), 'yue-Latn');
  const second = { ...card, id: 'two', cantonese: '你好！', jyutping: 'nei5 hou2!' };
  const stack = TopicCardStack({ cards: [card, second], index: 1, difficultyLabels: ['初级', '初级'], onSwipe: () => {} });
  assert.equal(stack.querySelector('.is-jyutping').textContent, 'nei5 hou2!');
  const old = TopicCard({ card: CARD, positionLabel: '', difficultyLabel: '' });
  assert.equal(old.querySelector('.topic-pronunciation'), null);
});

test('匹配称号随语言显示，匿名仍隐藏姓名，未佩戴不显示称号', () => {
  const peer = { peerId: 'test-peer', displayName: 'Private name', anonymous: true, equippedTitleId: 'conversation_regular' };
  const english = BuddyCard({ peer, locale: 'en', anonymousLabel: 'Anonymous user', onPick: () => {} });
  assert.ok(english.textContent.includes('Conversation Regular'));
  assert.ok(!english.textContent.includes('Private name'));
  const chinese = BuddyCard({ peer, locale: 'zh-Hans', onPick: () => {} });
  assert.ok(chinese.textContent.includes('交流达人'));
  const plain = BuddyCard({ peer: { ...peer, equippedTitleId: null }, onPick: () => {} });
  assert.equal(plain.querySelector('.achievement-title'), null);
});

test('头像旁显示用户 ID 与兴趣，匿名时即使带有真实 ID 也不展示', () => {
  const peer = { peerId: 'learner-user-123', displayName: '真实姓名', avatarId: 'female', anonymous: false };
  const props = { peer, compact: true, showIdentity: true, statusLabel: '通话中', interestLabels: ['动漫', '美食'], anonymousLabel: '匿名用户' };
  const named = CallStage(props);
  assert.equal(named.querySelector('.call-status').textContent, 'learner-user-123');
  assert.deepEqual(named.querySelectorAll('.call-interests .pill').map(x => x.textContent), ['动漫', '美食']);
  const anonymous = CallStage({ ...props, peer: { ...peer, anonymous: true } });
  assert.equal(anonymous.querySelector('.call-status').textContent, '匿名用户');
  assert.ok(!anonymous.textContent.includes(peer.peerId)); assert.ok(!anonymous.textContent.includes(peer.displayName));
});

test('h：元素、组件函数与属性都能用', () => {
  const node = h('div', { class: 'a', text: 'hi', dataset: { id: '1' }, style: { height: '8px' } }, h('span', { text: '子' }));
  assert.equal(node.tagName, 'DIV');
  assert.equal(node.getAttribute('class'), 'a');
  assert.equal(node.dataset.id, '1');
  assert.equal(node.style.props.height, '8px');
  assert.equal(node.textContent, 'hi子');
  const component = ({ title }) => h('p', { text: title });
  assert.equal(h(component, { title: '标题' }).textContent, '标题');
  assert.throws(() => h(component, {}, '多余子节点'), /props.children/);
  assert.equal(pill('标签', { tone: 'accent-soft' }).getAttribute('class'), 'pill tone-accent-soft');
  assert.ok(icon('star').querySelector('svg'));
  assert.equal(icon('star').querySelector('svg').getAttribute('stroke'), 'currentColor');
});

test('LoadingSkeleton / EmptyState / ErrorState / FallbackBanner：三态文本与动作', () => {
  const skeleton = h(LoadingSkeleton, { variant: 'card', rows: 3 });
  assert.equal(skeleton.getAttribute('class'), 'skeleton skeleton-card');
  assert.equal(skeleton.getAttribute('aria-busy'), 'true');
  assert.equal(skeleton.children.length, 3);

  let clicked = 0;
  const empty = h(EmptyState, { title: '暂时没有内容', description: '稍后再来', actionLabel: '刷新列表', onAction: () => { clicked += 1; } });
  assert.match(empty.textContent, /暂时没有内容/);
  empty.querySelector('.btn').click();
  assert.equal(clicked, 1);

  const error = h(ErrorState, { message: '加载失败', retryLabel: '重试', onRetry: () => {} });
  assert.match(error.textContent, /加载失败/);
  assert.equal(error.getAttribute('class'), 'state-block is-error');

  const banner = h(FallbackBanner, { tone: 'warning', message: '连接不稳定，正在重试……' });
  assert.equal(banner.getAttribute('class'), 'fallback-banner is-warning');
  assert.match(banner.textContent, /连接不稳定/);
});

test('底部导航只有一个共享滑块，更新位置与语言时正确同步选中项和无障碍状态', () => {
  const paths = [];
  const nav = BottomNav({ active: 'home', t: key => key, onNavigate: path => paths.push(path) });
  const slider = nav.querySelector('.bottom-nav-indicator');
  nav.querySelectorAll('.nav-item')[0].click();
  assert.deepEqual(paths, [], '重复点击当前页不应重新导航或重载页面');
  for (const [index, id] of ['home', 'match', 'leaderboard', 'me'].entries()) {
    nav.updateNav({ active: id, t: key => '翻译:' + key });
    assert.equal(nav.querySelectorAll('.bottom-nav-indicator').length, 1);
    assert.equal(nav.querySelector('.bottom-nav-indicator'), slider);
    assert.equal(nav.style.props['--nav-index'], String(index));
    const buttons = nav.querySelectorAll('.nav-item');
    assert.equal(buttons[index].getAttribute('aria-current'), 'page');
    assert.equal(buttons.filter(button => button.classList.contains('is-active')).length, 1);
    assert.ok(buttons[index].textContent.includes('翻译:nav.' + id));
  }
  nav.querySelectorAll('.nav-item')[0].click();
  assert.deepEqual(paths, ['/home'], '切换到其他页时仍正常导航');
});

test('AppShell / TopBar / BottomNav / StepProgress：外壳与导航', () => {
  const shell = AppShell({ children: h('p', { text: '内容' }), topBar: h(TopBar, { title: 'CantoBridge' }), nav: BottomNav({ active: 'home', t: (key) => key, onNavigate: () => {} }) });
  assert.match(shell.textContent, /CantoBridge/);
  assert.match(shell.textContent, /nav\.home/);
  assert.equal(shell.querySelectorAll('.nav-item').length, 4);
  assert.equal(shell.querySelector('.nav-item').getAttribute('class'), 'nav-item is-active');

  const progress = h(StepProgress, { current: 2, total: 3, label: '第 2 / 3 步' });
  assert.equal(progress.querySelectorAll('.step-seg').length, 3);
  assert.ok(progress.querySelectorAll('.step-seg.is-done').length === 1);
  assert.ok(progress.querySelector('.step-seg.is-active'));
});

test('RoleSelectCard / LevelSelector / PrivacyToggleList：受控与选中态', () => {
  let picked = null;
  const card = h(RoleSelectCard, { role: 'buddy', title: '我讲粤语', subtitle: '粤语伙伴', selected: true, onSelect: (role) => { picked = role; } });
  assert.ok(card.classList.contains('is-selected'));
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  card.click();
  assert.equal(picked, 'buddy');
  // 卡上只有图标 + 标题 + 副标题：示例标签行已经退场
  assert.match(card.textContent, /我讲粤语/);
  assert.match(card.textContent, /粤语伙伴/);
  assert.equal(card.querySelector('.role-examples'), null, '不再有示例标签行');

  let level = null;
  const selector = h(LevelSelector, { levels: [{ value: 'beginner', label: '初学者', hint: '只会几个词' }], value: 'beginner', onChange: (value) => { level = value; } });
  assert.ok(selector.querySelector('.level-option').classList.contains('is-selected'));
  assert.match(selector.textContent, /只会几个词/);
  selector.querySelector('.level-option').click();
  assert.equal(level, 'beginner');

  const toggles = [];
  const list = h(PrivacyToggleList, { items: [{ key: 'level', label: '粤语水平', value: false }], onChange: (key, value) => toggles.push([key, value]) });
  list.querySelector('.switch').click();
  assert.deepEqual(toggles, [['level', true]]);
});

test('TagPicker：上限拦截、取消选中、超限后其余标签置灰', () => {
  const changes = [];
  const tags = ['a', 'b', 'c'].map((value) => ({ value, label: value.toUpperCase() }));
  const picker = h(TagPicker, { tags, value: ['a', 'b'], max: 2, onChange: (next) => changes.push(next), countLabel: '最多选 5 个' });
  const buttons = picker.querySelectorAll('.pill');
  assert.equal(buttons.length, 3);
  assert.match(picker.textContent, /2 \/ 2/);
  assert.equal(buttons[2].disabled, true, '超过上限后未选中的标签不能再选');
  buttons[2].click();
  assert.deepEqual(changes, []);
  buttons[0].click();
  assert.deepEqual(changes, [['b']]);

  const empty = h(TagPicker, { tags: [], value: [], max: 5, onChange: () => {}, emptyLabel: '暂时没有内容' });
  assert.match(empty.textContent, /暂时没有内容/);
});

test('HomeActionCard / StatTile：首页主 CTA 与统计块', () => {
  let started = 0;
  const action = h(HomeActionCard, { role: 'learner', headline: '准备好练粤语了吗？', ctaLabel: '开始对话', badge: '现在有 4 人正在等', onStart: () => { started += 1; } });
  assert.match(action.textContent, /准备好练粤语了吗/);
  assert.match(action.textContent, /4 人正在等/);
  action.querySelector('.btn').click();
  assert.equal(started, 1);

  const tile = h(StatTile, { label: '本周练习', value: '46 分钟', hint: '离线数据' });
  assert.equal(tile.querySelector('.stat-value').textContent, '46 分钟');
  assert.match(tile.textContent, /离线数据/);
});

test('BuddyCard / BuddyBrowseList：匿名打码、匹配度、共同标签高亮', () => {
  let picked = null;
  const card = h(BuddyCard, {
    peer: { peerId: 'learner-demo-01', displayName: '匿名伙伴', anonymous: true },
    matchLabel: '86% 匹配度',
    meta: ['英语', '初学者'],
    tags: ['动漫', '美食', '旅行'],
    matchedTags: ['动漫'],
    onPick: (peer) => { picked = peer; },
  });
  assert.match(card.textContent, /匿名用户/);
  assert.match(card.textContent, /86% 匹配度/);
  assert.equal(card.querySelector('.avatar').getAttribute('data-avatar'), 'neutral');
  const pills = card.querySelectorAll('.pill');
  assert.ok(pills[0].classList.contains('pill'), '共同标签用 accent 药丸');
  assert.equal(pills[0].getAttribute('class'), 'pill tone-accent');
  assert.equal(pills[1].getAttribute('class'), 'pill tone-neutral');
  card.click();
  assert.equal(picked.peerId, 'learner-demo-01');

  const loading = h(BuddyBrowseList, { isLoading: true, onPick: () => {} });
  assert.ok(loading.querySelector('.skeleton'));
  const failed = h(BuddyBrowseList, { error: '列表加载失败', retryLabel: '重试', onRetry: () => {}, onPick: () => {} });
  assert.match(failed.textContent, /列表加载失败/);
  const empty = h(BuddyBrowseList, { items: [], emptyLabel: '现在没有人在等', retryLabel: '刷新列表', onRetry: () => {}, onPick: () => {} });
  assert.match(empty.textContent, /现在没有人在等/);
});

test('MatchCriteriaEditor：随便聊一键全选、逐个勾选、没选时保存禁用', () => {
  const options = [
    { value: 'anime', label: '动漫' },
    { value: 'food', label: '美食' },
    { value: 'travel', label: '旅行' },
  ];
  const toggles = [];
  let selectAllCount = 0;
  let savedCount = 0;
  let closedCount = 0;
  const build = (value) =>
    h(MatchCriteriaEditor, {
      title: '自定义匹配条件',
      hint: '勾选想聊的主题；都行就点「随便聊」',
      anyLabel: '随便聊',
      anyHint: '一键勾选全部主题',
      options,
      value,
      selectedLabel: '已选',
      minHint: '一个都不选就没法按主题找人',
      saveLabel: '保存',
      closeLabel: '收起',
      onToggle: (item) => toggles.push(item),
      onSelectAll: () => { selectAllCount += 1; },
      onSave: () => { savedCount += 1; },
      onClose: () => { closedCount += 1; },
    });

  const editor = build(['anime']);
  assert.match(editor.textContent, /自定义匹配条件/);
  assert.match(editor.textContent, /随便聊/);
  assert.match(editor.textContent, /一键勾选全部主题/);
  assert.match(editor.textContent, /已选 1 \/ 3/);
  // 只勾了 1 个时「随便聊」不该高亮——它就是「全部勾上」的意思
  assert.equal(editor.querySelector('.criteria-any').classList.contains('is-selected'), false);
  assert.equal(editor.querySelector('.criteria-any').getAttribute('aria-pressed'), 'false');

  editor.querySelector('.criteria-any').click();
  assert.equal(selectAllCount, 1, '「随便聊」要触发「一键全选」回调');

  const chips = editor.querySelectorAll('.pill');
  assert.equal(chips.length, options.length, '每个主题一枚标签');
  assert.equal(chips[0].classList.contains('is-selected'), true);
  assert.equal(chips[1].classList.contains('is-selected'), false);
  chips[1].click();
  assert.deepEqual(toggles, ['food'], '点标签把 value 交给上层，组件自己不改状态');

  const buttons = editor.querySelectorAll('.btn');
  assert.equal(buttons[0].textContent, '保存');
  assert.equal(buttons[1].textContent, '收起');
  buttons[0].click();
  buttons[1].click();
  assert.equal(savedCount, 1);
  assert.equal(closedCount, 1);

  // 全部勾上 = 随便聊：按钮高亮，语义上就是「都行」
  const everything = build(['anime', 'food', 'travel']);
  assert.equal(everything.querySelector('.criteria-any').classList.contains('is-selected'), true);
  assert.equal(everything.querySelector('.criteria-any').getAttribute('aria-pressed'), 'true');
  assert.match(everything.textContent, /已选 3 \/ 3/);
  assert.ok(!everything.querySelectorAll('.btn')[0].disabled, '选了主题时保存可用');

  // 一个都没选：「没选」和「都行」是两件事，保存禁用并给出提示
  const none = build([]);
  assert.match(none.textContent, /已选 0 \/ 3/);
  assert.equal(none.querySelectorAll('.btn')[0].disabled, true, '没选主题时保存应当禁用');
  assert.match(none.textContent, /一个都不选就没法按主题找人/);

  // closeLabel 传 null = 不渲染「收起」，只剩一个按钮（组件自身能力；匹配页当前已不用这个组件）
  const singleButton = h(MatchCriteriaEditor, {
    title: '自定义匹配条件',
    anyLabel: '随便聊',
    options,
    value: ['anime'],
    saveLabel: '保存',
    closeLabel: null,
    onToggle: () => {},
    onSelectAll: () => {},
    onSave: () => {},
    onClose: () => {},
  });
  const singleButtons = singleButton.querySelectorAll('.btn');
  assert.equal(singleButtons.length, 1, '不传 closeLabel 时只有一个按钮');
  assert.equal(singleButtons[0].textContent, '保存');
  assert.match(singleButton.textContent, /自定义匹配条件/);
});

test('MatchWaitingPanel / MatchAcceptToast / ProfilePreviewCard：等待、接受、预览', () => {
  let relaxed = 0;
  let cancelled = 0;
  let demoed = 0;
  const panel = h(MatchWaitingPanel, {
    elapsedText: '已等待 0:12',
    notice: '正在为你寻找粤语伙伴',
    criteria: '初学者、动漫',
    relaxLabel: '放宽匹配条件',
    onRelax: () => { relaxed += 1; },
    cancelLabel: '取消匹配',
    onCancel: () => { cancelled += 1; },
    timeoutHint: '等太久了？可以直接用演示伙伴',
    demoLabel: '使用演示伙伴',
    onDemo: () => { demoed += 1; },
  });
  assert.match(panel.textContent, /已等待 0:12/);
  assert.match(panel.textContent, /等太久了/);
  assert.match(panel.textContent, /取消匹配/);
  assert.equal(panel.querySelectorAll('.btn')[0].textContent, '放宽匹配条件');
  assert.equal(panel.querySelectorAll('.btn')[1].textContent, '取消匹配');
  assert.equal(panel.querySelectorAll('.btn')[2].textContent, '使用演示伙伴');
  // 「取消匹配」用更弱的安静按钮样式，避免和主/次按钮抢视线、降低误触
  assert.ok(panel.querySelector('.waiting-cancel').getAttribute('class').includes('btn-quiet'));
  panel.querySelectorAll('.btn')[0].click();
  panel.querySelectorAll('.btn')[1].click();
  panel.querySelectorAll('.btn')[2].click();
  assert.equal(relaxed, 1);
  assert.equal(cancelled, 1);
  assert.equal(demoed, 1);

  // 出口是可选能力：不传 cancelLabel 时面板上不该凭空多出一个按钮
  const noCancel = h(MatchWaitingPanel, {
    elapsedText: '已等待 0:12',
    notice: '正在为你寻找粤语伙伴',
    criteria: null,
    relaxLabel: '放宽匹配条件',
    onRelax: () => {},
  });
  assert.equal(noCancel.querySelectorAll('.btn').length, 1);
  assert.equal(noCancel.querySelector('.waiting-cancel'), null);

  // 匹配成功的「接受 / 不接受」细条弹窗：头像 + 名字 + 倒计时 + 两个按钮
  let accepted = 0;
  let declined = 0;
  const toast = h(MatchAcceptToast, {
    peer: { displayName: 'siu-fung', anonymous: false },
    remaining: 10,
    totalSeconds: 10,
    title: '匹配到伙伴啦',
    hint: '超时会回到等待队列',
    acceptLabel: '接受',
    declineLabel: '不接受',
    onAccept: () => { accepted += 1; },
    onDecline: () => { declined += 1; },
  });
  assert.match(toast.textContent, /匹配到伙伴啦/);
  assert.match(toast.textContent, /siu-fung/);
  assert.equal(toast.getAttribute('aria-label'), '超时会回到等待队列', '提示语做成了可访问名，不占屏幕高度');
  assert.match(toast.textContent, /10/, '倒计时秒数要看得见');
  const toastAvatar = toast.querySelector('.avatar');
  assert.ok(toastAvatar, '弹窗必须带头像');
  assert.equal(toastAvatar.getAttribute('data-avatar'), 'neutral', '旧账号使用预设人影');
  // 进度条的总时长来自设置，交给 CSS 动画跑一次，不随秒数重建
  assert.equal(toast.querySelector('.match-toast-bar').style.props['--toast-seconds'], '10s');
  const toastButtons = toast.querySelectorAll('.btn');
  assert.equal(toastButtons.length, 2, '弹窗要有「接受」与「不接受」两个按钮');
  toastButtons[0].click();
  toastButtons[1].click();
  assert.equal(accepted, 1);
  assert.equal(declined, 1);

  // 匿名时头像退回「?」，名字仍然是「匿名伙伴」——不泄露真实身份
  const anonToast = h(MatchAcceptToast, {
    peer: { displayName: '匿名伙伴', anonymous: true },
    title: '匹配到伙伴啦',
    acceptLabel: '接受',
    declineLabel: '不接受',
  });
  assert.equal(anonToast.querySelector('.avatar').getAttribute('data-avatar'), 'neutral');
  assert.equal(anonToast.querySelector('.match-toast-count').textContent, '0');
  assert.equal(anonToast.querySelector('.match-toast-bar').style.props['--toast-seconds'], '10s', '没传上限时退回 10 秒');
  assert.equal(toast.classList.contains('is-urgent'), false, '时间还早的时候不该是紧急态');

  // 只剩几秒 → 紧急态（进度条与数字变红，提醒「要来不及了」）
  const urgentToast = h(MatchAcceptToast, {
    peer: { displayName: 'siu-fung', anonymous: false },
    remaining: 1,
    totalSeconds: 10,
    title: '匹配到伙伴啦',
    acceptLabel: '接受',
    declineLabel: '不接受',
  });
  assert.ok(urgentToast.classList.contains('is-urgent'), '只剩几秒要进入紧急态');
  assert.equal(urgentToast.querySelector('.match-toast-count').textContent, '1');

  const preview = h(ProfilePreviewCard, {
    peer: { displayName: '匿名伙伴', anonymous: true, cantoneseLevel: 'beginner', identity: 'exchange_student' },
    matchedTags: ['动漫'],
    reason: ['动漫'],
    meta: ['英语'],
    topics: ['动漫', '美食'],
    labels: { level: '粤语水平', levelValue: '初学者', identity: '身份', identityValue: '交换生', hidden: '对方没有公开这一项', why: '为什么会匹配' },
  });
  assert.match(preview.textContent, /粤语水平/);
  assert.match(preview.textContent, /初学者/);
  assert.match(preview.textContent, /为什么会匹配/);

  const hidden = h(ProfilePreviewCard, {
    peer: { displayName: '匿名伙伴', anonymous: true, cantoneseLevel: null, identity: null },
    matchedTags: [],
    reason: [],
    meta: [],
    topics: [],
    labels: { level: '粤语水平', levelValue: '', identity: '身份', identityValue: '', hidden: '对方没有公开这一项', why: '为什么会匹配' },
  });
  assert.match(hidden.textContent, /对方没有公开这一项/);
});

test('AudioWaveform / RoomHeader / CallControls：语音舞台与控制条（没有摄像头按钮）', () => {
  const waveform = h(AudioWaveform, { level: 0.8, active: true });
  const bars = waveform.querySelectorAll('.wave');
  assert.equal(bars.length, 9);
  assert.ok(Number.parseInt(bars[0].style.props.height, 10) > 0);
  assert.ok(waveform.classList.contains('is-active'));

  const idle = h(AudioWaveform, { level: 0.9, active: false });
  assert.ok(idle.classList.contains('is-idle'));
  assert.equal(Number.parseInt(idle.querySelector('.wave').style.props.height, 10), 18, '静音态用最小高度');

  const header = h(RoomHeader, { peerName: '匿名伙伴', elapsedText: '1:20', anonymous: true, statusLabel: '通话中' });
  assert.match(header.textContent, /匿名伙伴/);
  assert.match(header.textContent, /1:20/);
  assert.ok(header.querySelector('.status-dot').classList.contains('tone-live'));

  let muted = 0;
  let hung = 0;
  const controls = h(CallControls, {
    muted: true,
    speakerOn: true,
    disabled: false,
    onToggleMute: () => { muted += 1; },
    onToggleSpeaker: () => {},
    onHangup: () => { hung += 1; },
    labels: { mic: '麦克风', muted: '已静音', speaker: '扬声器', hangup: '结束' },
  });
  const buttons = controls.querySelectorAll('.control-btn');
  assert.equal(buttons.length, 3, '只有麦克风 / 扬声器 / 挂断，没有摄像头');
  assert.ok(buttons[0].classList.contains('is-off'));
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  buttons[0].click();
  assert.equal(muted, 1);
  buttons[2].click();
  assert.equal(hung, 1);
  assert.match(controls.textContent, /已静音/);
});

test('TopicCard / TopicCardStack：三语行、难度、位置、滑动手势', () => {
  const card = h(TopicCard, { card: CARD, positionLabel: '第 1 / 8 张', difficultyLabel: '初学者' });
  const lines = card.querySelectorAll('.topic-line');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].textContent, CARD.cantonese);
  assert.equal(lines[1].textContent, CARD.mandarin);
  assert.equal(lines[2].textContent, CARD.english);
  assert.match(card.textContent, /第 1 \/ 8 张/);

  const swipes = [];
  const stack = h(TopicCardStack, {
    cards: [CARD, { ...CARD, id: 'anime-beginner-02', cantonese: '第二张' }],
    index: 0,
    positionLabel: '第 1 / 2 张',
    difficultyLabels: ['初学者', '初学者'],
    hint: '左右滑动切换话题卡',
    onSwipe: (delta) => swipes.push(delta),
    onSavePhrase: () => {},
  });
  assert.match(stack.textContent, /左右滑动切换话题卡/);
  const body = stack.querySelector('.stack-body');
  body.dispatch('pointerdown', { clientX: 200 });
  body.dispatch('pointerup', { clientX: 120 });
  body.dispatch('pointerdown', { clientX: 100 });
  body.dispatch('pointerup', { clientX: 190 });
  body.dispatch('pointerdown', { clientX: 100 });
  body.dispatch('pointerup', { clientX: 105 });
  assert.deepEqual(swipes, [1, -1], '滑动超过阈值才翻牌，轻点不翻');
});

test('TopicCard / TopicCardStack：「聊过了」只在看过的卡上出现', () => {
  const plain = h(TopicCard, { card: CARD, positionLabel: '第 1 / 2 张', difficultyLabel: '初学者' });
  assert.equal(plain.querySelectorAll('.pill').length, 1, '没传 seenLabel 时只有难度那一枚药丸');

  const seen = h(TopicCard, { card: CARD, positionLabel: '第 1 / 2 张', difficultyLabel: '初学者', seenLabel: '聊过了' });
  assert.match(seen.textContent, /聊过了/);

  const other = { ...CARD, id: 'food-beginner-01' };
  const stack = h(TopicCardStack, {
    cards: [CARD, other],
    index: 1,
    positionLabel: '第 2 / 2 张',
    difficultyLabels: ['初学者', '初学者'],
    seenIds: [CARD.id],
    seenLabel: '聊过了',
    onSwipe: () => {},
  });
  assert.doesNotMatch(stack.textContent, /聊过了/, 'seenIds 里没有当前这张就不该标');

  const marked = h(TopicCardStack, {
    cards: [CARD, other],
    index: 0,
    positionLabel: '第 1 / 2 张',
    difficultyLabels: ['初学者', '初学者'],
    seenIds: [CARD.id],
    seenLabel: '聊过了',
    onSwipe: () => {},
  });
  assert.match(marked.textContent, /聊过了/);
});

test('PhraseChips：句型照读 + 星标收藏', () => {
  const saved = [];
  const chips = h(PhraseChips, {
    phrases: CARD.expressions,
    savedIds: ['我最近睇緊……'],
    onPick: () => {},
    onSave: (phrase) => saved.push(phrase.cantonese),
    saveLabel: '收藏',
    savedLabel: '已收藏',
    title: '可以直接照读',
  });
  const rows = chips.querySelectorAll('.phrase-chip');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].classList.contains('is-saved'));
  assert.match(rows[0].textContent, /我最近睇緊……/);
  rows[1].querySelector('.phrase-star').click();
  assert.deepEqual(saved, ['我最鍾意嘅係……']);

  const readonly = h(PhraseChips, { phrases: CARD.expressions, onPick: null, onSave: () => {}, saveLabel: '收藏', savedLabel: '已收藏' });
  assert.ok(readonly.querySelectorAll('.phrase-text').every((node) => node.tagName !== 'BUTTON'), '没有朗读动作时句型文字不应伪装成按钮');
});

test('AchievementBadge / AchievementWall / RewardCard：成就与结算', () => {
  const unlocked = h(AchievementBadge, { name: '第一次对话', hint: '完成第一次对话', unlocked: true, isNew: true, newLabel: '新解锁' });
  assert.equal(unlocked.tagName, 'DIV', '没有详情动作的成就只应作为内容展示');
  assert.ok(unlocked.classList.contains('is-unlocked'));
  assert.ok(unlocked.classList.contains('is-new'));
  assert.match(unlocked.textContent, /新解锁/);

  const locked = h(AchievementBadge, { name: '连续七天', hint: '连续 7 天练习', unlocked: false });
  assert.ok(locked.classList.contains('is-locked'));
  assert.equal(locked.querySelector('.badge-medal').textContent, '☆');

  const wall = h(AchievementWall, {
    items: [{ id: 'a', name: '第一次对话', hint: '完成第一次对话', unlocked: true }],
    labels: { empty: '完成第一次聊天就能点亮第 1 枚徽章', new: '新解锁' },
  });
  assert.equal(wall.querySelectorAll('.badge').length, 1);
  const emptyWall = h(AchievementWall, { items: [], labels: { empty: '完成第一次聊天就能点亮第 1 枚徽章', new: '新解锁' } });
  assert.match(emptyWall.textContent, /点亮第 1 枚徽章/);

  const reward = h(RewardCard, {
    xpLabel: '本次获得',
    xpText: '+92',
    durationText: { label: '结算', value: '12 分钟' },
    cardsText: { label: '等下可以聊', value: '4' },
    roleNote: '可以把陪伴时长对接学校的义工计划',
    hint: null,
  });
  assert.match(reward.textContent, /\+92/);
  assert.match(reward.textContent, /12 分钟/);
  assert.match(reward.textContent, /义工计划/);
});

test('SessionFeedbackSheet / LeaderboardList：反馈标签与榜单', () => {
  const toggles = [];
  let connected = 0;
  const sheet = h(SessionFeedbackSheet, {
    title: '给对方一句反馈',
    question: '想再聊一次吗？',
    options: [{ value: 'friendly', label: '友善' }, { value: 'patient', label: '有耐性' }],
    value: ['friendly'],
    onToggle: (value) => toggles.push(value),
    onSubmit: () => {},
    onSkip: () => {},
    onConnect: () => { connected += 1; },
    connectLabel: '发出伙伴申请',
    notNowLabel: '暂时不要',
    submitLabel: '保存',
    skipLabel: '跳过',
    requestState: 'none',
  });
  const pills = sheet.querySelectorAll('.pill');
  assert.ok(pills[0].classList.contains('is-selected'));
  pills[1].click();
  assert.deepEqual(toggles, ['patient']);
  sheet.querySelectorAll('.feedback-actions .btn')[0].click();
  assert.equal(connected, 1);

  // 已发出申请：不再显示两个按钮，换成一句等待提示
  const pendingSheet = h(SessionFeedbackSheet, {
    title: 'x', question: 'y', options: [], value: [], onToggle: () => {}, onSubmit: () => {}, onSkip: () => {}, onConnect: () => {}, connectLabel: 'a', notNowLabel: 'b', submitLabel: 'c', skipLabel: 'd',
    requestState: 'pending', pendingLabel: '伙伴申请已发出，等 ta 确认', buddyLabel: '你们已经是伙伴了',
  });
  assert.equal(pendingSheet.querySelectorAll('.feedback-actions').length, 0, '已发出申请后不再显示两个按钮');
  assert.match(pendingSheet.querySelector('.buddy-request-state').textContent, /等 ta 确认/);

  const buddySheet = h(SessionFeedbackSheet, {
    title: 'x', question: 'y', options: [], value: [], onToggle: () => {}, onSubmit: () => {}, onSkip: () => {}, onConnect: () => {}, connectLabel: 'a', notNowLabel: 'b', submitLabel: 'c', skipLabel: 'd',
    requestState: 'buddy', pendingLabel: '伙伴申请已发出，等 ta 确认', buddyLabel: '你们已经是伙伴了',
  });
  assert.match(buddySheet.querySelector('.buddy-request-state').textContent, /已经是伙伴/);

  const rows = [
    { rank: 1, name: 'mingzhu', primary: '96 分钟', secondary: '620 XP', isMe: false },
    { rank: 3, name: '匿名伙伴', primary: '54 分钟', secondary: '360 XP', isMe: true },
  ];
  const board = h(LeaderboardList, { rows, me: rows[1], labels: { me: '我的名次' } });
  assert.equal(board.querySelectorAll('.leaderboard-row').length, 2);
  assert.ok(board.querySelectorAll('.leaderboard-row')[1].classList.contains('is-me'));
  assert.match(board.querySelector('.leaderboard-me').textContent, /我的名次/);
  assert.match(board.textContent, /#3/);
});

test('BuddyRequestList：三种状态分组显示，按钮回调拿到正确的 peerId', () => {
  installDom();
  const calls = [];
  const labels = {
    incoming: '收到的申请',
    outgoing: '我发出的申请',
    connected: '已连接的伙伴',
    connectedHint: '互相确认的伙伴',
    pendingIn: '待你确认',
    pendingOut: '等待对方确认',
    accept: '接受',
    decline: '拒绝',
    cancel: '撤回申请',
    remove: '解除伙伴',
    empty: '还没有伙伴',
  };
  const slot = h(BuddyRequestList, {
    labels,
    buddies: [{ peerId: 'ka-ho', label: 'ka-ho' }],
    requests: [
      { peerId: 'wai-ling', label: '匿名伙伴', direction: 'incoming', status: 'pending' },
      { peerId: 'siu-fung', label: 'siu-fung', direction: 'outgoing', status: 'pending' },
    ],
    onAccept: (peerId) => calls.push(['accept', peerId]),
    onDecline: (peerId) => calls.push(['decline', peerId]),
    onCancel: (peerId) => calls.push(['cancel', peerId]),
    onRemove: (peerId) => calls.push(['remove', peerId]),
  });

  assert.equal(slot.querySelectorAll('.buddy-slot-group').length, 3, '三个分组都要出现');
  const rows = slot.querySelectorAll('.buddy-row');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].dataset.peerId, 'wai-ling');
  assert.match(slot.textContent, /待你确认/);
  assert.match(slot.textContent, /等待对方确认/);
  assert.match(slot.textContent, /互相确认的伙伴/);

  const incomingActions = rows[0].querySelectorAll('.btn');
  assert.equal(incomingActions.length, 2, '收到的申请有两个按钮');
  incomingActions[0].click();
  incomingActions[1].click();
  rows[1].querySelector('.btn').click();
  rows[2].querySelector('.btn').click();
  assert.deepEqual(calls, [
    ['accept', 'wai-ling'],
    ['decline', 'wai-ling'],
    ['cancel', 'siu-fung'],
    ['remove', 'ka-ho'],
  ]);
});

test('BuddyRequestList：空态给一句可执行的引导，不渲染任何行', () => {
  installDom();
  const slot = h(BuddyRequestList, {
    labels: { empty: '还没有伙伴——聊完一场，发出第一份伙伴申请吧' },
    buddies: [],
    requests: [],
  });
  assert.ok(slot.classList.contains('is-empty'));
  assert.equal(slot.querySelectorAll('.buddy-row').length, 0);
  assert.match(slot.textContent, /发出第一份伙伴申请/);
});

test('MockControlPanel：分组开关、快捷跳转、一键重置', () => {
  const changes = [];
  const jumps = [];
  let resets = 0;
  const panel = h(MockControlPanel, {
    summary: '当前生效: 身份 粤语学习者 · 延迟 400ms',
    groups: [
      { label: '当前身份', onChange: (value) => changes.push(['role', value]), options: [{ value: 'learner', label: '粤语学习者', selected: true }, { value: 'buddy', label: '粤语伙伴', selected: false }] },
    ],
    actions: [{ label: '自动匹配成功', onClick: () => {} }],
    links: [{ label: '首页', to: '/home' }],
    onJump: (to) => jumps.push(to),
    onReset: () => { resets += 1; },
    t: (key) => key,
  });
  assert.match(panel.textContent, /当前生效/);
  const pills = panel.querySelectorAll('.mock-group .pill');
  assert.ok(pills[0].classList.contains('is-selected'));
  pills[1].click();
  assert.deepEqual(changes, [['role', 'buddy']]);
  panel.querySelectorAll('.mock-group')[1].querySelector('.pill').click();
  assert.deepEqual(jumps, ['/home']);
  const resetButton = panel.querySelectorAll('.mock-actions .btn').pop();
  resetButton.click();
  assert.equal(resets, 1);
  assert.match(panel.textContent, /dev\.reset/);
});

test('RoomHeader：房主自动标签只在 hostLabel + hostIntentLabel 都有时出现', () => {
  const plain = h(RoomHeader, { peerName: 'wai-ling', elapsedText: '0:30', statusLabel: '通话中' });
  assert.equal(plain.querySelectorAll('.pill').length, 0, '普通房间没有房主徽标');

  const host = h(RoomHeader, {
    peerName: 'wai-ling',
    elapsedText: '0:30',
    statusLabel: '通话中',
    hostLabel: '房主',
    hostIntentLabel: '教粤语',
  });
  const badge = host.querySelector('.pill.tone-accent');
  assert.ok(badge, '房主徽标没有渲染');
  assert.equal(badge.textContent, '房主 · 教粤语');

  // 匿名房照样带房主标签：两枚徽标可以同时在
  const anonymous = h(RoomHeader, {
    peerName: '匿名伙伴',
    elapsedText: '0:30',
    anonymous: true,
    statusLabel: '通话中',
    hostLabel: '房主',
    hostIntentLabel: '学粤语',
  });
  assert.equal(anonymous.querySelectorAll('.pill').length, 2);
  assert.ok(anonymous.textContent.includes('房主 · 学粤语'));

  // 只给一半：不渲染半截徽标
  const half = h(RoomHeader, { peerName: 'wai-ling', elapsedText: '0:30', statusLabel: '通话中', hostLabel: '房主' });
  assert.equal(half.querySelectorAll('.pill').length, 0);
});

test('QuestionPager：进度点、计数、上一项 / 下一项与左右滑动', () => {
  const calls = [];
  const pager = h(QuestionPager, {
    index: 1,
    total: 3,
    filled: [true, false, true],
    counterLabel: '第 2 / 3 项 · 已填 2 项',
    prevLabel: '上一项',
    nextLabel: '下一项',
    hint: '左右滑动可以切换上 / 下一项',
    onPrev: () => calls.push('prev'),
    onNext: () => calls.push('next'),
    children: h('div', { class: 'kid' }, '题目内容'),
  });

  assert.equal(pager.dataset.index, '1');
  assert.equal(pager.dataset.total, '3');
  const dots = pager.querySelectorAll('.question-dot');
  assert.equal(dots.length, 3, '一题一个进度点');
  assert.equal(pager.querySelectorAll('.question-dot.is-filled').length, 2, '已填的题是实心');
  assert.equal(dots[1].classList.contains('is-active'), true, '当前题高亮');
  assert.equal(pager.querySelector('.question-counter').textContent, '第 2 / 3 项 · 已填 2 项');
  assert.ok(pager.textContent.includes('题目内容'), '当前题的内容照常渲染');
  assert.ok(pager.textContent.includes('左右滑动可以切换上 / 下一项'));

  const navButtons = pager.querySelectorAll('.question-nav-btn');
  assert.equal(Boolean(navButtons[0].disabled), false);
  assert.equal(Boolean(navButtons[1].disabled), false);
  navButtons[0].click();
  navButtons[1].click();
  assert.deepEqual(calls, ['prev', 'next'], '按钮直接换题');

  const body = pager.querySelector('.question-body');
  body.dispatch('pointerdown', { clientX: 200 });
  body.dispatch('pointerup', { clientX: 120 });
  body.dispatch('pointerdown', { clientX: 100 });
  body.dispatch('pointerup', { clientX: 190 });
  body.dispatch('pointerdown', { clientX: 100 });
  body.dispatch('pointerup', { clientX: 105 });
  assert.deepEqual(calls, ['prev', 'next', 'next', 'prev'], '左划下一项、右划上一项，轻点不换题');

  const first = h(QuestionPager, { index: 0, total: 3, onPrev: () => {}, onNext: () => {} });
  assert.equal(first.querySelectorAll('.question-nav-btn')[0].disabled, true, '首项没有上一项');
  const last = h(QuestionPager, { index: 2, total: 3, onPrev: () => {}, onNext: () => {} });
  assert.equal(last.querySelectorAll('.question-nav-btn')[1].disabled, true, '没给 onFinal 时末项照旧禁用「下一项」');

  // 给了 onFinal：末项那颗按钮换成可点的 finalLabel，点它直接收尾（滑动仍然不提交）
  const finals = [];
  const finishable = h(QuestionPager, {
    index: 2,
    total: 3,
    nextLabel: '下一项',
    finalLabel: '下一步',
    onPrev: () => {},
    onNext: () => finals.push('next'),
    onFinal: () => finals.push('final'),
  });
  const finishButtons = finishable.querySelectorAll('.question-nav-btn');
  assert.equal(Boolean(finishButtons[1].disabled), false, '给了 onFinal 之后末项必须可点');
  assert.ok(finishButtons[1].textContent.includes('下一步'), '末项显示 finalLabel');
  assert.equal(finishButtons[1].textContent.includes('下一项'), false, '末项不再显示 nextLabel');
  finishButtons[1].click();
  const finishBody = finishable.querySelector('.question-body');
  finishBody.dispatch('pointerdown', { clientX: 200 });
  finishBody.dispatch('pointerup', { clientX: 120 });
  // 左划照旧只会触发 onNext（页面侧会夹住，是空操作）；关键是**不能**把 onFinal 也带出来，
  // 否则划一下就把问卷交上去了。
  assert.equal(finals.filter((name) => name === 'final').length, 1, '只有点按钮才收尾，左划不触发收尾');

  const clamped = h(QuestionPager, { index: 9, total: 3, onPrev: () => {}, onNext: () => {} });
  assert.equal(clamped.dataset.index, '2', '越界索引收敛到末项');
});

test('TagPicker：单选（max = 1）点另一项直接换过去，不用先取消', () => {
  const changes = [];
  const tags = ['a', 'b'].map((value) => ({ value, label: value.toUpperCase() }));
  const picker = h(TagPicker, { tags, value: ['a'], max: 1, onChange: (next) => changes.push(next) });
  const buttons = picker.querySelectorAll('.pill');
  assert.equal(Boolean(buttons[1].disabled), false, '单选时另一项不该被置灰');
  buttons[1].click();
  assert.deepEqual(changes, [['b']], '点另一项＝换成它');
  buttons[0].click();
  assert.deepEqual(changes, [['b'], []], '再点已选中的一项＝取消选择');
  assert.equal(picker.querySelector('.tag-picker-head').textContent.includes('/ 1'), true, '计数照常显示 1 / 1');
});

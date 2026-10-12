/**
 * onboarding 三页：RoleSelectPage（1/3）、ProfileSetupPage（2/3）、PrivacySetupPage（3/3）。
 * 未选身份直接进入 2/3、3/3 属于越权，由 app.js 的守卫拦下，这里只处理正常路径。
 */

import { definePage, renderStates } from '../app/page.js';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/base.js';
import { AvatarPicker } from '../components/avatars.js';
import { BuddyCard } from '../components/match.js';
import { LevelSelector, PrivacyToggleList, QuestionPager, RoleSelectCard, TagPicker } from '../components/onboarding.js';
import { MAX_INTERESTS, IDENTITIES, INTERESTS, LEARNING_GOALS, LEVELS, NATIVE_LANGUAGES } from '../data/tags.js';
import { h } from '../lib/dom.js';
import { clampInterests, uniqueList } from '../lib/logic.js';
import { onboardingProgress, privacyPreview } from '../lib/viewModel.js';

const LEVEL_HINT_KEYS = {
  beginner: 'level.beginnerHint',
  elementary: 'level.elementaryHint',
  intermediate: 'level.intermediateHint',
  advanced: 'level.advancedHint',
};

/** 分页后每题只显示自己的标题，key 与 renderForm 里的 questions[].key 一一对应。 */
const QUESTION_LABEL_KEYS = {
  nativeLanguage: 'setup.nativeLanguage',
  wantToLearn: 'setup.wantToLearn',
  cantoneseLevel: 'setup.level',
  interests: 'setup.interests',
  learningGoal: 'setup.goal',
  identity: 'setup.identity',
  avatarId: 'avatar.choose',
};

function optionsOf(values, groupName, label) {
  return values.map((value) => ({ value, label: label(groupName, value) }));
}

export const RoleSelectPage = definePage({
  name: 'RoleSelectPage',
  titleKey: 'role.title',

  render(ctx) {
    const t = ctx.t;
    const local = (ctx.view.local ??= { selected: ctx.query.role === 'buddy' ? 'buddy' : ctx.query.role === 'learner' ? 'learner' : null });
    const step = onboardingProgress(1);

    return h(
      'section',
      { class: 'stack' },
      h('p', { class: 'muted-note', text: t('role.step') }),
      h('h1', { class: 'page-title', text: t('role.title') }),
      h(RoleSelectCard, {
        role: 'learner',
        title: t('role.learnerTitle'),
        subtitle: t('role.learnerSubtitle'),
        selected: local.selected === 'learner',
        onSelect: (role) => {
          local.selected = role;
          ctx.paint();
        },
      }),
      h(RoleSelectCard, {
        role: 'buddy',
        title: t('role.buddyTitle'),
        subtitle: t('role.buddyCardSubtitle'),
        selected: local.selected === 'buddy',
        onSelect: (role) => {
          local.selected = role;
          ctx.paint();
        },
      }),
      h('p', { class: 'muted-note', text: t('role.note') }),
      h('p', { class: ['muted-note', local.selected ? 'is-hidden' : 'is-warn'], text: t('role.needSelect') }),
      h(
        'button',
        {
          class: 'btn btn-primary btn-block',
          type: 'button',
          disabled: !local.selected,
          onClick: () => {
            ctx.store.setRole(local.selected);
            ctx.navigate('/onboarding/profile');
          },
        },
        t('action.next'),
      ),
      h('small', { class: 'muted-note', text: step.label }),
    );
  },
});

export const ProfileSetupPage = definePage({
  name: 'ProfileSetupPage',
  titleKey: 'setup.title',

  load(ctx) {
    return ctx.api.getTags();
  },

  render(ctx, view) {
    const t = ctx.t;
    return renderStates(view, {
      loading: () => h('div', { class: 'stack' }, h(LoadingSkeleton, { variant: 'chips', rows: 4 })),
      error: () => h(ErrorState, { message: t('state.failed'), retryLabel: t('action.retry'), onRetry: () => ctx.reload() }),
      ready: () => renderForm(ctx, view),
    });
  },
});

function renderForm(ctx, view) {
  const t = ctx.t;
  const state = ctx.getState();
  const role = state.role;
  const profile = role === 'buddy' ? state.buddyProfile : state.learnerProfile;
  // 草稿只活在这一页（退出即丢，见 07 的 Q-G25）。view.local 可能是预置好的对象，
  // 所以缺哪一项补哪一项，而不是整体覆盖——否则第二次进来会把已填的草稿抹掉。
  const local = (view.local ??= {});
  if (!local.form) local.form = JSON.parse(JSON.stringify(profile));
  local.isNew ??= state.learnerProfile.onboarded !== true && state.buddyProfile.onboarded !== true;
  if (typeof local.step !== 'number') local.step = 0;
  const form = local.form;
  const isBuddy = role === 'buddy';
  const interests = optionsOf(INTERESTS, 'interests', ctx.label);
  const identities = optionsOf(IDENTITIES, 'identities', ctx.label);
  const goals = optionsOf(LEARNING_GOALS, 'goals', ctx.label);
  const nativeLanguages = optionsOf(NATIVE_LANGUAGES, 'nativeLanguages', ctx.label);
  const levels = LEVELS.map((value) => ({ value, label: ctx.label('levels', value), hint: t(LEVEL_HINT_KEYS[value]) }));
  const selectedInterests = isBuddy ? uniqueList(form.interests) : clampInterests(form.interests, MAX_INTERESTS);
  const needsInterest = selectedInterests.length === 0;

  function update(patch) {
    local.form = { ...local.form, ...patch };
    ctx.paint();
  }

  // 一屏一题：左右滑动（或点「上一项 / 下一项」）在题目之间走，题目顺序＝资料的自然阅读顺序。
  // 每题都带 filled，交给 QuestionPager 标在进度点上——用户随时知道还剩几题没填。
  const questions = [];
  if (!isBuddy) {
    questions.push({
      key: 'nativeLanguage',
      filled: Boolean(form.nativeLanguage),
      node: h(TagPicker, {
        tags: nativeLanguages.filter((tag) => tag.value !== 'other'),
        value: [form.nativeLanguage].filter((value) => value && value !== 'other'),
        max: 1,
        custom: {
          label: t('setup.customTag'), hint: t('setup.customLanguageHint'),
          long: t('setup.customTagLong'), empty: t('setup.customTagEmpty'),
          duplicate: t('setup.customTagDuplicate'), full: '',
          invalid: t('setup.customTagInvalid'), add: t('setup.customTagAdd'), cancel: t('action.cancel'),
        },
        onChange: (next) => update({ nativeLanguage: next[0] ?? null }),
      }),
    });
    questions.push({
      key: 'cantoneseLevel',
      filled: Boolean(form.cantoneseLevel),
      node: h(LevelSelector, { levels, value: form.cantoneseLevel, onChange: (value) => update({ cantoneseLevel: value }) }),
    });
  }
  questions.push({
    key: 'interests',
    filled: selectedInterests.length > 0,
    warning: needsInterest ? t('setup.emptyHint') : null,
    node: h(TagPicker, {
      tags: interests,
      value: selectedInterests,
      max: MAX_INTERESTS,
      onChange: (next) => update({ interests: clampInterests(next, MAX_INTERESTS) }),
      countLabel: t('setup.maxInterests'),
      emptyLabel: t('state.empty'),
      custom: {
        label: t('setup.customTag'), hint: t('setup.customTagHint'),
        long: t('setup.customTagLong'), empty: t('setup.customTagEmpty'),
        duplicate: t('setup.customTagDuplicate'), full: t('setup.maxInterests'),
        invalid: t('setup.customTagInvalid'), add: t('setup.customTagAdd'), cancel: t('action.cancel'),
      },
    }),
  });
  // 「愿意聊的话题」（`preferredTopics`）已从注册流程移除（2026-10-12）：
  // 它只**单向**参与母语者一侧的匹配分（`viewerTagsOf`），既不进卡片池、也不筛选任何人；
  // 而 `BUDDY_TOPICS` 的 7 个取值里 3 个永远匹配不上（既不在 `INTERESTS` 也不在
  // `LEARNING_GOALS`）、3 个与「兴趣」重复，只有 `university_life` 是它独有的贡献。
  // **字段与词表都保留**：老账号已有的取值照常生效，只是不再在注册时问。
  if (!isBuddy) {
    questions.push({
      key: 'learningGoal',
      filled: Boolean(form.learningGoal),
      node: h(TagPicker, {
        tags: goals,
        layout: 'rows',
        value: [form.learningGoal].filter(Boolean),
        max: 1,
        onChange: (next) => update({ learningGoal: next[0] ?? null }),
      }),
    });
  }
  questions.push({
    key: 'identity',
    filled: Boolean(form.identity),
    hint: t('setup.identityHint'),
    node: h(TagPicker, {
      tags: identities,
      layout: 'rows',
      value: [form.identity].filter(Boolean),
      max: 1,
      onChange: (next) => update({ identity: next[0] ?? null }),
    }),
  });
  if (isBuddy) {
    // 第 3 题是**可选**的回礼：不填也能点「暂时跳过」，所以没有 warning、也不参与任何校验。
    // 取值复用母语词表（不含粤语）——回礼不能是粤语，否则就退回成单向教学了。
    // 它只影响排序权重，不筛选：一个都没选的人照样出现在列表里。
    questions.push({
      key: 'wantToLearn',
      filled: uniqueList(form.wantToLearn).length > 0,
      hint: t('setup.wantToLearnHint'),
      node: h(TagPicker, {
        tags: nativeLanguages,
        value: uniqueList(form.wantToLearn),
        max: NATIVE_LANGUAGES.length,
        onChange: (next) => update({ wantToLearn: next }),
      }),
    });
  }

  questions.push({
    key: 'avatarId',
    filled: true,
    hint: t(local.isNew ? 'avatar.initialHint' : 'avatar.editHint'),
    node: h('div', { class: 'appearance-step' },
      h(AvatarPicker, { value: form.avatarId ?? 'neutral', initial: local.isNew, wallet: state.progress.wallet, t, onChange: avatarId => update({ avatarId }) }),
      !local.isNew ? h('div', { class: 'field appearance-frames' }, h('span', { class: 'field-label', text: t('frame.choose') }), h('small', { class: 'muted-note', text: t('frame.hint') }), h(AvatarPicker, { kind: 'frame', avatarId: form.avatarId, value: form.frameId ?? 'none', wallet: state.progress.wallet, t, onChange: frameId => update({ frameId }) })) : null),
  });

  const step = Math.max(0, Math.min(questions.length - 1, local.step ?? 0));
  local.step = step;
  const current = questions[step];
  const filledCount = questions.filter((question) => question.filled).length;

  function goTo(next) {
    local.step = Math.max(0, Math.min(questions.length - 1, next));
    ctx.paint();
  }

  // 收尾动作：把**当前已填的部分**落库，然后进资料可见范围页。
  // 外观是最后一个独立步骤；前面的「暂时跳过」只跳过资料题，仍会进入头像选择。
  // 头像步骤的「下一步」与「暂时跳过」都会保存草稿，再进入可见范围设置。
  async function saveAndContinue() {
    if (local.saving) return;
    local.saving = true;
    local.saveError = null;
    try {
      if (isBuddy) await ctx.api.saveBuddyProfile(local.form);
      else await ctx.api.saveLearnerProfile(local.form);
      ctx.navigate('/onboarding/privacy');
    } catch {
      local.saveError = t('state.failed');
      ctx.paint();
    } finally { local.saving = false; }
  }

  const roleLabel = isBuddy ? t('role.buddySubtitle') : t('role.learnerSubtitle');

  return h(
    'section',
    { class: 'stack' },
    h('h1', { class: 'page-title', text: t('setup.title') + ' · ' + roleLabel }),
    local.saveError ? h('p', { class: 'is-warn', attrs: { role: 'alert' }, text: local.saveError }) : null,
    h(QuestionPager, {
      index: step,
      total: questions.length,
      filled: questions.map((question) => question.filled),
      counterLabel: t('setup.itemCounter', { index: step + 1, total: questions.length }) + ' · ' + t('setup.filledCount', { count: filledCount }),
      prevLabel: t('setup.prevItem'),
      nextLabel: t('setup.nextItem'),
      finalLabel: t('setup.nextStep'),
      hint: t('setup.swipeHint'),
      onPrev: () => goTo(step - 1),
      onNext: () => goTo(step + 1),
      onFinal: saveAndContinue,
      children: h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label', text: t(QUESTION_LABEL_KEYS[current.key]) }),
        current.hint ? h('small', { class: 'muted-note', text: current.hint }) : null,
        current.node,
        current.warning ? h('small', { class: 'muted-note is-warn', text: current.warning }) : null,
      ),
    }),
    // 「暂时跳过」：资料不是必填关卡，所以刻意做小、做安静、靠右，不与问卷抢视线。
    // 先跳到独立头像步骤，保留已填的草稿；最后确认或使用默认头像后再保存。
    h(
      'div',
      { class: 'onboarding-skip-row' },
      h(
        'button',
        {
          class: 'btn btn-quiet btn-sm',
          type: 'button',
          onClick: () => current.key === 'avatarId' ? void saveAndContinue() : goTo(questions.length - 1),
        },
        t('setup.skipForNow'),
      ),
    ),
  );
}

export const PrivacySetupPage = definePage({
  name: 'PrivacySetupPage',
  titleKey: 'privacy.title',

  render(ctx) {
    const t = ctx.t;
    const state = ctx.getState();
    const settings = state.settings;
    const profile = state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
    const local = (ctx.view.local ??= {});
    if (local.username === undefined) local.username = profile.displayName ?? '';
    const nameError = h('small', { class: 'muted-note is-warn', attrs: { 'aria-live': 'polite' } });
    const nameCount = h('small', { class: 'muted-note', text: [...local.username.trim()].length + ' / 16' });
    const nameInput = h('input', {
      class: 'custom-tag-input', type: 'text', value: local.username,
      attrs: { 'aria-label': t('privacy.username'), placeholder: t('privacy.usernameHint') },
      onInput: (event) => {
        local.username = event.target.value;
        const name = local.username.trim();
        nameCount.textContent = [...name].length + ' / 16';
        const invalid = [...name].length < 2 || [...name].length > 16 || /[\u0000-\u001f\u007f]/u.test(name);
        nameError.textContent = invalid ? t('privacy.usernameError') : '';
        nameInput.setAttribute('aria-invalid', invalid ? 'true' : 'false');
        const title = usernameSection?.parentNode?.querySelector('.buddy-card-title strong');
        if (title && !settings.anonymous) title.textContent = name || profile.displayName || profile.userId;
      },
    });
    const usernameSection = h('div', { class: 'field' },
      h('span', { class: 'field-label', text: t('privacy.username') }), nameInput,
      h('small', { class: 'muted-note', text: t('privacy.usernameHint') }), nameCount, nameError);
    const preview = privacyPreview(profile, settings.visibility, { labelOf: ctx.label, anonymous: settings.anonymous });
    const items = [
      { key: 'nativeLanguage', label: t('privacy.itemNativeLanguage'), value: settings.visibility.nativeLanguage !== false },
      { key: 'level', label: t('privacy.itemLevel'), value: settings.visibility.level !== false },
      { key: 'identity', label: t('privacy.itemIdentity'), value: settings.visibility.identity !== false },
      { key: 'interests', label: t('privacy.itemInterests'), value: settings.visibility.interests !== false },
    ];

    function save(patch) {
      // 先落本地让开关立刻响应，再送服务端——可见范围是服务端要按它裁剪下发内容的
      // 设置（契约 2.5 节），只改本地的话真后端根本不知道（刷新即丢）。
      ctx.store.saveSettings(patch);
      ctx.paint();
      void ctx.api.saveSettings(patch).catch(() => {
        // 后端不可用时不打断注册流程：本地镜像仍然生效，只挂一条「离线数据」提示
        ctx.store.setNotice({ kind: 'banner', messageKey: 'state.offlineData', tone: 'warning' });
      });
    }

    return h(
      'section',
      { class: 'stack' },
      h('h1', { class: 'page-title', text: t('privacy.title') }),
      h('p', { class: 'muted-note', text: t('privacy.visibilityHint') }),
      usernameSection,
      h('div', { class: 'privacy-row' },
        h('div', { class: 'privacy-copy' }, h('span', { class: 'privacy-label', text: t('privacy.anonymous') }), h('small', { class: 'muted-note', text: t('privacy.anonymousHint') })),
        h('button', { class: ['switch', settings.anonymous ? 'is-on' : ''], type: 'button', attrs: { role: 'switch', 'aria-label': t('privacy.anonymous'), 'aria-checked': String(Boolean(settings.anonymous)) }, onClick: () => save({ anonymous: !settings.anonymous }) }, h('span', { class: 'switch-knob', attrs: { 'aria-hidden': 'true' } }))),
      h('span', { class: 'field-label', text: t('privacy.preview') }),
      h(PrivacyToggleList, { items, onChange: (key, value) => save({ visibility: { [key]: value } }) }),
      h(BuddyCard, { anonymousLabel: t('anonymous.label'),
            peer: {
              anonymous: preview.anonymous,
              displayName: preview.anonymous ? t('anonymous.label') : (local.username.trim() || profile.displayName || profile.userId),
              peerId: profile.userId,
              avatarId: profile.avatarId, frameId: profile.frameId,
            },
            meta: settings.visibility.level !== false && profile.cantoneseLevel ? [ctx.label('levels', profile.cantoneseLevel)] : [],
            tags: preview.rows,
            onPick: null,
          }),
      h(
        'button',
        {
          class: 'btn btn-primary btn-block',
          type: 'button',
          onClick: async () => {
            if (local.saving) return;
            if (local.username !== (profile.displayName ?? '')) {
              const name = local.username.trim();
              if ([...name].length < 2 || [...name].length > 16 || /[\u0000-\u001f\u007f]/u.test(name)) {
                nameError.textContent = t('privacy.usernameError');
                nameInput.setAttribute('aria-invalid', 'true');
                return;
              }
              local.saving = true;
              try {
                if (state.role === 'buddy') await ctx.api.saveBuddyProfile({ displayName: name });
                else await ctx.api.saveLearnerProfile({ displayName: name });
              } catch {
                nameError.textContent = t('state.failed');
                return;
              } finally { local.saving = false; }
            }
            // 走完三页＝这次填写正式生效：作废还原点，往后「退出」不会再回退这一轮
            ctx.store.commitOnboarding();
            // 只完成设置：不再把人直接推到匹配页（首页有「去匹配」主按钮，用户自己决定什么时候开始）
            ctx.navigate('/home');
          },
        },
        t('privacy.finishSetup'),
      ),
    );
  },
});

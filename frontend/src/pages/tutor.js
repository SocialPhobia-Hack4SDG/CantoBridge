import { definePage } from '../app/page.js';
import { CallStage, TopicCard } from '../components/room.js';
import { LoadingSkeleton } from '../components/base.js';
import { h, pill } from '../lib/dom.js';
import { LEVELS } from '../data/tags.js';
import { createTutorSession } from '../services/tutorSession.js';

function busy(ctx) { const runtime = ctx.getState().runtime; return Boolean(runtime.queue || runtime.room || runtime.matchRequest); }
function button(label, onClick, disabled = false, primary = false) {
  return h('button', { class: 'btn ' + (primary ? 'btn-primary' : 'btn-secondary'), type: 'button', disabled, onClick }, label);
}

export const AiTutorPage = definePage({
  name: 'AiTutorPage', titleKey: 'tutor.title',
  load(ctx) {
    const state = ctx.getState();
    const local = ctx.view.local ??= { stage: 'setup', goal: 'life', scene: 'food', level: state.learnerProfile.cantoneseLevel ?? 'beginner', cards: [], index: 0 };
    const life = { live: true };
    local.life = life; local.loading = false; local.error = false;
    const session = createTutorSession({ api: ctx.api,
      initialState: { ...local.voice, phase: local.stage === 'practice' ? 'listening' : 'idle' },
      onChange: state => { local.voice = state; if (life.live) ctx.paint(); },
    });
    local.session = session; local.voice = session.getState();
    const account = state.learnerProfile.userId;
    ctx.watch(() => {
      const next = ctx.getState();
      if (next.role !== 'learner' || next.learnerProfile.userId !== account) { ctx.navigate('/home'); return; }
      if (busy(ctx) && local.stage === 'practice') { local.session.end(); local.stage = 'setup'; }
      ctx.paint();
    });
    ctx.onCleanup(() => { life.live = false; local.session.dispose(); });
    return null;
  },
  render(ctx, view) {
    const local = view.local;
    if (!local) return h(LoadingSkeleton, { variant: 'card', rows: 2 });
    const t = ctx.t;
    return h('section', { class: 'stack tutor-page' },
      h('div', { class: 'card stack', attrs: { role: 'note' } },
        h('strong', { text: t('tutor.demo') }), h('p', { class: 'muted-note', text: t('tutor.demoHint') })),
      busy(ctx) ? h('div', { class: 'card stack' }, h('p', { text: t('demo.busy') }), button(t('demo.exit'), () => ctx.navigate('/match'))) : null,
      local.stage === 'setup' ? setup(ctx, local) : local.stage === 'summary' ? summary(ctx, local) : practice(ctx, local),
    );
  },
});

function setup(ctx, local) {
  const t = ctx.t;
  const disabled = local.loading || busy(ctx);
  const choose = goal => { local.goal = goal; ctx.paint(); };
  return h('div', { class: 'card stack' },
    h('h2', { class: 'card-title', text: t('tutor.choose') }),
    h('div', { class: 'pill-row' },
      pill(t('tutor.life'), { selected: local.goal === 'life', disabled, onClick: () => { if (!disabled) choose('life'); } }),
      pill(t('tutor.opening'), { selected: local.goal === 'opening', disabled, onClick: () => { if (!disabled) choose('opening'); } })),
    h('p', { class: 'muted-note', text: local.goal === 'life' ? t('tutor.lifeHint') : t('tutor.openingHint') }),
    local.goal === 'life' ? h('label', { class: 'field' }, h('span', { text: t('tutor.scene') }),
      h('select', { class: 'input tutor-scene', value: local.scene, disabled, onChange: event => { local.scene = event.target.value; } },
        h('option', { value: 'food', selected: local.scene === 'food', text: t('tutor.food') }), h('option', { value: 'travel', selected: local.scene === 'travel', text: t('tutor.travel') }), h('option', { value: 'shopping', selected: local.scene === 'shopping', text: t('tutor.shopping') }))) : null,
    h('label', { class: 'field' }, h('span', { text: t('setup.level') }),
      h('select', { class: 'input tutor-level', value: local.level, disabled, onChange: event => { local.level = event.target.value; } },
        LEVELS.map(level => h('option', { value: level, selected: local.level === level, text: ctx.label('levels', level) })))),
    h('p', { class: 'muted-note', text: t('tutor.profileHint') }),
    local.error ? h('p', { class: 'is-warn', attrs: { role: 'alert' }, text: t('tutor.loadFailed') }) : null,
    button(local.loading ? t('state.loading') : t('tutor.start'), () => void start(ctx, local), disabled, true),
  );
}

async function start(ctx, local) {
  if (local.loading || busy(ctx)) return;
  const life = local.life;
  local.loading = true; local.error = false; ctx.paint();
  try {
    await ctx.auth.ensure();
    if (!life.live || local.life !== life || busy(ctx)) return;
    const interests = ctx.getState().learnerProfile.interests ?? [];
    const selected = local.goal === 'life' ? [local.scene] : interests.length ? interests : ['daily_life'];
    const result = await ctx.api.generateTopicCards({ learnerInterests: [...new Set([...selected, ...interests])].slice(0, 5), buddyInterests: selected.slice(0, 5), cantoneseLevel: local.level, count: 3 });
    if (!life.live || local.life !== life || busy(ctx)) return;
    if (result.mode !== 'mock' || !Array.isArray(result.cards) || !result.cards.length || result.cards.some(card => !card.cantonese || !card.expressions?.[0]?.cantonese)) throw Error('invalid demo cards');
    local.cards = result.cards; local.index = 0; local.stage = 'practice'; local.help = false;
    local.session.dispose();
    local.session = createTutorSession({ api: ctx.api, onChange: state => { local.voice = state; if (life.live) ctx.paint(); } });
    local.session.start();
  } catch {
    if (life.live && local.life === life) local.error = true;
  } finally {
    if (life.live && local.life === life) { local.loading = false; ctx.paint(); }
  }
}

function practice(ctx, local) {
  const t = ctx.t;
  const card = local.cards[local.index];
  const voice = local.voice;
  const status = voice.muted ? t('tutor.muted') : voice.phase === 'thinking' ? t('tutor.thinking') : voice.phase === 'speaking' ? t('tutor.speaking') : t('tutor.listening');
  return h('div', { class: 'stack' },
    h(CallStage, { peer: { avatarId: 'star', frameId: 'orbit' }, statusLabel: status, modeLabel: t('tutor.title'), active: false, hint: t('tutor.silent') }),
    h('div', { class: 'pill-row' },
      button(voice.muted ? t('tutor.unmute') : t('tutor.mute'), () => local.session.toggleMute()),
      voice.phase === 'speaking'
        ? button(t('tutor.interrupt'), () => local.session.interrupt(), false, true)
        : button(t('tutor.exampleTurn'), () => void local.session.finishExample(card), voice.muted || voice.phase !== 'listening', true),
      button(t('tutor.end'), () => { local.session.end(); local.stage = 'summary'; ctx.paint(); })),
    voice.error ? h('p', { class: 'is-warn', attrs: { role: 'alert' }, text: t('tutor.replyFailed') }) : null,
    h(TopicCard, { card, positionLabel: `${local.index + 1} / ${local.cards.length}`, difficultyLabel: ctx.label('levels', card.difficulty), jyutpingLabel: t('room.jyutping') }),
    h('div', { class: 'pill-row' },
      button(t('tutor.hint'), () => { local.help = !local.help; ctx.paint(); }),
      button(t('tutor.next'), () => { local.index = (local.index + 1) % local.cards.length; local.help = false; local.session.resetTopic(); }, voice.phase === 'thinking')),
    local.help ? h('div', { class: 'card stack' }, card.expressions.map(item => h('p', {}, h('strong', { text: item.cantonese }), h('span', { class: 'muted-note', text: ' · ' + item.mandarin })))) : null,
    h('details', { class: 'card field', open: local.captions ? true : undefined, onToggle: event => { local.captions = event.target.open; } },
      h('summary', { text: t('tutor.captions') }),
      voice.utterance ? h('p', { text: t('tutor.exampleUser') + voice.utterance }) : h('p', { class: 'muted-note', text: t('tutor.captionEmpty') }),
      voice.reply ? h('div', { class: 'stack tutor-reply', attrs: { 'aria-live': 'polite' } }, h('p', { text: voice.reply.reply.cantonese }), h('p', { class: 'muted-note', text: voice.reply.reply.mandarin })) : null),
  );
}

function summary(ctx, local) {
  const t = ctx.t;
  const suggestions = local.voice.reply?.suggestions ?? [];
  return h('div', { class: 'card stack tutor-summary' },
    h('h2', { class: 'card-title', text: t('tutor.summary') }),
    h('p', { text: (local.goal === 'life' ? t('tutor.life') : t('tutor.opening')) + ' · ' + t('tutor.turns', { count: local.voice.turns }) }),
    h('p', { class: 'muted-note', text: t('tutor.noEvaluation') }),
    suggestions.map(item => h('p', {}, h('strong', { text: item.cantonese }), h('span', { class: 'muted-note', text: ' · ' + item.mandarin }))),
    button(t('tutor.again'), () => { local.stage = 'setup'; ctx.paint(); }),
    button(t('tutor.realPartner'), () => ctx.navigate('/match'), false, true),
  );
}

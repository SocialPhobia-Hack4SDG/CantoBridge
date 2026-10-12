import { definePage } from '../app/page.js';
import { ErrorState, LoadingSkeleton } from '../components/base.js';
import { h } from '../lib/dom.js';
import { PresetAvatar } from '../components/avatars.js';
import { avatarOf, ownedAvatars } from '../data/avatars.js';
import { frameOf, ownedFrames } from '../data/frames.js';
import { themeLabelKey } from '../data/themes.js';

function operationNotice(view) {
  return view.local.shopError
    ? h('p', { class: 'is-warn', attrs: { role: 'alert' }, text: view.local.shopError })
    : view.local.shopSuccess ? h('p', { class: 'muted-note', attrs: { role: 'status' }, text: view.local.shopSuccess }) : null;
}

function openPreview(ctx, view, item) {
  if (view.local.shopPending) return;
  if (item.type === 'frame') view.local.previewFrame = item.frameId;
  else if (item.type === 'avatar') view.local.previewAvatar = item.avatarId;
  else view.local.previewTheme = item.theme;
  view.local.confirmItem = null;
  view.local.shopSuccess = null;
  view.local.shopError = null;
  ctx.paint();
}

function redeemButton(ctx, view, item) {
  const t = ctx.t;
  const local = view.local;
  const shop = view.data.shop;
  const isFrame = item.type === 'frame';
  const isAvatar = item.type === 'avatar';
  const owned = isFrame ? ownedFrames(shop).includes(item.frameId) : isAvatar ? ownedAvatars(shop).includes(item.avatarId) : shop.ownedThemes.includes(item.theme);
  const state = ctx.getState();
  const profile = state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
  const active = isFrame ? (profile.frameId ?? 'none') === item.frameId : isAvatar ? profile.avatarId === item.avatarId : state.settings.theme === item.theme;
  const afford = shop.balance >= item.price;
  return h('button', {
    class: 'btn btn-secondary btn-sm', type: 'button',
    disabled: Boolean(local.shopPending) || (owned ? active : !afford),
    onClick: async () => {
      if (local.shopPending) return;
      if (owned && active) return;
      if (owned && !isAvatar && !isFrame) { ctx.store.setTheme(item.theme); local.shopError = null; local.shopSuccess = t('shop.applied'); ctx.paint(); return; }
      if (!owned && !afford) return;
      if (!owned && item.price > 0 && local.confirmItem !== item.id) { local.confirmItem = item.id; ctx.paint(); return; }
      local.shopPending = true;
      local.shopError = null;
      local.shopSuccess = null;
      local.pendingItem = item.id;
      ctx.paint();
      try {
        if (owned) {
          const method = state.role === 'buddy' ? 'saveBuddyProfile' : 'saveLearnerProfile';
          await ctx.api[method](isFrame ? { frameId: item.frameId } : { avatarId: item.avatarId });
        } else view.data.shop = await ctx.api.redeemShopItem(item.id);
        local.confirmItem = null;
        local.shopSuccess = t(owned ? 'shop.applied' : 'shop.unlockedHint');
      }
      catch { local.shopError = t('shop.failed'); }
      finally { local.shopPending = false; local.pendingItem = null; ctx.paint(); }
    },
  }, local.shopPending && local.pendingItem === item.id ? t('shop.processing') : owned ? (active ? t('shop.active') : t('shop.apply')) : !afford ? t('shop.insufficient') : local.confirmItem === item.id ? t('shop.confirm', { points: item.price }) : t('shop.redeem'));
}

function themePreview(ctx, view, item) {
  const t = ctx.t;
  return h('section', { class: 'stack shop-preview' },
    h('div', { class: 'shop-preview-heading' },
      h('h2', { text: t('shop.previewTitle', { theme: t(item.type === 'frame' ? frameOf(item.frameId).labelKey : item.type === 'avatar' ? avatarOf(item.avatarId).labelKey : themeLabelKey(item.theme)) }) }),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => { view.local.previewTheme = null; view.local.confirmItem = null; ctx.paint(); } }, t('shop.closePreview'))),
    h('p', { class: 'muted-note', text: t('shop.previewHint') }),
    h('div', { class: 'theme-preview-frame', attrs: { 'data-preview-theme': item.theme, 'aria-label': t('shop.samplePage') } },
      h('div', { class: 'theme-preview-top', text: t('nav.home') }),
      h('div', { class: 'theme-preview-body stack' },
        h('div', { class: 'card' },
          h('small', { class: 'muted-note', text: t('shop.sampleWelcome') }),
          h('h3', { text: t('shop.sampleGreeting') }),
          h('p', { class: 'muted-note', text: t('shop.sampleSubtitle') }),
          h('span', { class: 'pill tone-accent', text: t('role.learnerTitle') })),
        h('div', { class: 'theme-preview-stats' },
          h('div', { class: 'card' }, h('strong', { text: '25' }), h('p', { class: 'muted-note', text: t('shop.sampleMinutes') })),
          h('div', { class: 'card' }, h('strong', { text: '180 XP' }), h('p', { class: 'muted-note', text: t('shop.samplePoints') }))),
        h('div', { class: 'card' }, h('h3', { text: t('shop.sampleTopic') }),
          h('p', { text: t('shop.sampleQuestion') }),
          h('p', { class: 'muted-note', text: t('shop.sampleQuestionHint') })),
        h('div', { class: 'btn btn-primary theme-preview-cta', text: t('match.start') })),
      h('div', { class: 'theme-preview-nav' },
        ['home', 'match', 'leaderboard', 'me'].map((name) => h('span', { class: name === 'home' ? 'is-current' : '', text: t('nav.' + name) })))),
    h('div', { class: 'shop-preview-purchase' },
      h('span', { class: 'muted-note', text: t('shop.price', { points: item.price }) }), redeemButton(ctx, view, item)),
    operationNotice(view));
}

function framePreview(ctx, view, item) {
  const t = ctx.t;
  const state = ctx.getState();
  const profile = state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
  const name = t(frameOf(item.frameId).labelKey);
  return h('section', { class: 'stack shop-preview' },
    h('div', { class: 'shop-preview-heading' }, h('h2', { text: t('frame.previewTitle', { name }) }),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => { view.local.previewFrame = null; view.local.confirmItem = null; ctx.paint(); } }, t('frame.back'))),
    h('p', { class: 'muted-note', text: t('frame.previewHint') }),
    h('div', { class: 'card avatar-preview frame-preview' }, h(PresetAvatar, { avatarId: profile.avatarId, frameId: item.frameId, size: 200, label: name }),
      h('div', { class: 'avatar-profile-sample' }, h(PresetAvatar, { avatarId: profile.avatarId, frameId: item.frameId, size: 56 }), h('strong', { text: profile.displayName }))),
    h('div', { class: 'shop-preview-purchase' }, h('span', { text: t('shop.price', { points: item.price }) }), redeemButton(ctx, view, item)),
    operationNotice(view));
}

function avatarPreview(ctx, view, item) {
  const t = ctx.t;
  const name = t(avatarOf(item.avatarId).labelKey);
  const state = ctx.getState();
  const profile = state.role === 'buddy' ? state.buddyProfile : state.learnerProfile;
  return h('section', { class: 'stack shop-preview' },
    h('div', { class: 'shop-preview-heading' }, h('h2', { text: t('avatar.previewTitle', { name }) }),
      h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => { view.local.previewAvatar = null; view.local.confirmItem = null; ctx.paint(); } }, t('avatar.back'))),
    h('p', { class: 'muted-note', text: t('avatar.previewHint') }),
    h('div', { class: 'card avatar-preview' }, h(PresetAvatar, { avatarId: item.avatarId, frameId: profile.frameId, size: 240, label: name }),
      h('div', { class: 'avatar-profile-sample' }, h(PresetAvatar, { avatarId: item.avatarId, size: 56 }),
        h('div', {}, h('strong', { text: profile.displayName }), h('p', { class: 'muted-note', text: t('role.learnerTitle') })))),
    h('div', { class: 'shop-preview-purchase' }, h('span', { text: t('shop.price', { points: item.price }) }), redeemButton(ctx, view, item)),
    operationNotice(view));
}

export const ShopPage = definePage({
  name: 'ShopPage',
  titleKey: 'shop.title',
  async load(ctx) {
    ctx.view.local = { category: 'themes' };
    return { shop: await ctx.api.getShop() };
  },
  render(ctx, view) {
    const t = ctx.t;
    const local = view.local ?? (view.local = { category: 'themes' });
    const category = local.category ?? 'themes';
    const shop = view.data?.shop;
    const framePreviewItem = local.previewFrame && shop?.catalog.find(item => item.frameId === local.previewFrame);
    if (framePreviewItem) return framePreview(ctx, view, framePreviewItem);
    const avatarPreviewItem = local.previewAvatar && shop?.catalog.find(item => item.avatarId === local.previewAvatar);
    if (avatarPreviewItem) return avatarPreview(ctx, view, avatarPreviewItem);
    const preview = local.previewTheme && shop?.catalog.find(item => item.theme === local.previewTheme);
    if (preview) return themePreview(ctx, view, preview);
    return h('section', { class: 'stack' },
      h('div', { class: 'shop-categories', attrs: { role: 'group', 'aria-label': t('shop.categories') } },
        ['themes', 'avatars', 'frames'].map(id => h('button', {
          class: 'shop-category' + (category === id ? ' is-selected' : ''), type: 'button',
          attrs: { 'aria-pressed': String(category === id) },
          onClick: () => { if (local.shopPending || local.category === id) return; local.category = id; local.confirmItem = null; local.shopError = null; local.shopSuccess = null; ctx.paint(); },
        }, h('strong', { text: t('shop.category.' + id) }), h('small', { text: t('shop.available') })))),
      view.loading ? h(LoadingSkeleton, { variant: 'list', rows: 3 }) :
      view.error ? h(ErrorState, {
        message: t(view.error.code === 'not_found' ? 'shop.unavailable' : 'shop.loadFailed'),
        retryLabel: t('action.retry'), onRetry: () => ctx.reload(),
      }) : !shop ? h(ErrorState, { message: t('shop.loadFailed'), retryLabel: t('action.retry'), onRetry: () => ctx.reload() }) :
      h('div', { class: 'card shop-card' },
        h('h2', { class: 'card-title', text: t('shop.category.' + category) }),
        h('strong', { class: 'shop-balance', text: t('shop.balance', { points: shop.balance }) }),
        category === 'frames' ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: Boolean(local.shopPending), onClick: async () => {
          if (local.shopPending) return;
          local.shopPending = true; local.shopError = null; local.shopSuccess = null; ctx.paint();
          try { await ctx.api[ctx.getState().role === 'buddy' ? 'saveBuddyProfile' : 'saveLearnerProfile']({ frameId: 'none' }); local.shopSuccess = t('shop.applied'); }
          catch { local.shopError = t('shop.failed'); }
          finally { local.shopPending = false; ctx.paint(); }
        } }, t('frame.none')) : null,
        operationNotice(view),
        h('div', { class: 'shop-items' + (category === 'themes' ? '' : ' appearance-shop-grid') }, shop.catalog.filter(item => item.type === (category === 'frames' ? 'frame' : category === 'avatars' ? 'avatar' : 'theme')).map(item =>
          h('div', { class: 'shop-item' },
            item.type !== 'theme' ? h('button', { class: 'shop-image-preview', type: 'button', disabled: Boolean(local.shopPending), attrs: { 'aria-label': t('shop.preview') + ' · ' + t(item.type === 'frame' ? frameOf(item.frameId).labelKey : avatarOf(item.avatarId).labelKey) }, onClick: () => openPreview(ctx, view, item) },
              item.type === 'frame' ? h(PresetAvatar, { avatarId: (ctx.getState().role === 'buddy' ? ctx.getState().buddyProfile : ctx.getState().learnerProfile).avatarId, frameId: item.frameId, size: 96 }) : h(PresetAvatar, { avatarId: item.avatarId, size: 96 }),
              h('small', { text: t('shop.preview') })) : h('div', { class: 'shop-swatch theme-' + item.theme, attrs: { 'aria-hidden': 'true' } }),
            h('div', { class: 'shop-item-info' }, item.type === 'theme' ? h('strong', { text: t(themeLabelKey(item.theme)) }) : null,
              h('small', { class: 'muted-note', text: (item.type === 'frame' ? ownedFrames(shop).includes(item.frameId) : item.type === 'avatar' ? ownedAvatars(shop).includes(item.avatarId) : shop.ownedThemes.includes(item.theme)) ? t('shop.owned') : t('shop.price', { points: item.price }) })),
            h('div', { class: 'shop-item-actions' },
              item.type === 'theme' ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: Boolean(local.shopPending), attrs: { 'aria-label': t('shop.previewTitle', { theme: t(themeLabelKey(item.theme)) }) }, onClick: () => openPreview(ctx, view, item) }, t('shop.preview')) : null,
              redeemButton(ctx, view, item)),
            local.confirmItem === item.id ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: Boolean(local.shopPending), onClick: () => { local.confirmItem = null; ctx.paint(); } }, t('action.cancel')) : null))),
        shop.transactions?.length ? h('details', {}, h('summary', { text: t('shop.history') }),
          shop.transactions.slice(0, 10).map(entry => h('p', { class: 'muted-note', text: t('shop.' + entry.kind) + ' · ' + (entry.amount > 0 ? '+' : '') + entry.amount + ' · ' + new Date(entry.at).toLocaleDateString(ctx.locale) }))) : null),
      h('p', { class: 'muted-note shop-earning-note', text: t('shop.rules') }));
  },
});

import { SHOP_CATALOG } from '../data/shop.js';
import { requireSession } from '../http/auth.js';
import { ApiError } from '../http/envelope.js';
import { assertKnownKeys } from './validate.js';

export function createShopHandlers({ db, catalog = SHOP_CATALOG }) {
  const view = (accountId) => ({ ...db.getWallet(accountId), catalog });
  return {
    async get(ctx) { return { data: view(requireSession(ctx.req, db).userId) }; },
    async redeem(ctx) {
      const { userId } = requireSession(ctx.req, db);
      assertKnownKeys(ctx.body, { allowed: ['itemId'], ignored: ['requestId'] }, 'shop/redeem');
      const item = catalog.find((row) => row.id === ctx.body.itemId);
      if (!item) throw new ApiError('bad_request', 'unknown shop item');
      db.transaction(() => {
        const wallet = db.getWallet(userId);
        const owned = item.type === 'frame' ? wallet.ownedFrames : item.type === 'avatar' ? wallet.ownedAvatars : wallet.ownedThemes;
        const value = item.type === 'frame' ? item.frameId : item.type === 'avatar' ? item.avatarId : item.theme;
        if (owned.includes(value)) return;
        if (wallet.balance < item.price) throw new ApiError('bad_request', 'insufficient points');
        wallet.balance -= item.price;
        owned.push(value);
        wallet.transactions.unshift({ id: 'redeem:' + item.id, kind: 'redeem', amount: -item.price, at: new Date().toISOString() });
        db.updateProgress(userId, { wallet });
      });
      return { data: view(userId) };
    },
  };
}

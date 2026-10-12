export const DEFAULT_AVATAR = 'neutral';
export const FREE_AVATARS = ['neutral', 'male', 'female'];
export const AVATARS = ['neutral', 'male', 'female', 'star', 'fox', 'jade', 'male-sage'].map(id => ({ id, src: `/assets/avatars/${id}.${id === 'neutral' ? 'svg' : 'png'}`, labelKey: id === 'male-sage' ? 'avatar.maleSage' : 'avatar.' + id, free: FREE_AVATARS.includes(id) }));
export function avatarOf(id) { return AVATARS.find(item => item.id === id) ?? AVATARS[0]; }
export function ownedAvatars(wallet) { return [...new Set([...FREE_AVATARS, ...(wallet?.ownedAvatars ?? [])])]; }

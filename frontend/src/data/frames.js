// 沿用 frameId / ownedFrames 存储槽，避免已有账号丢失；新界面只展示小徽章。
export const FRAMES = ['none', 'milk-tea', 'pineapple', 'tram'].map(id => ({ id, labelKey: id === 'milk-tea' ? 'frame.milkTea' : 'frame.' + id, src: `/assets/badges/${id}.svg` }));
export const LEGACY_FRAME_IDS = ['aurora', 'orbit', 'sakura', 'pixel'];
export function frameOf(id) { return FRAMES.find(item => item.id === id) ?? FRAMES[0]; }
export function ownedFrames(wallet) { return [...new Set(['none', ...(wallet?.ownedFrames ?? [])])]; }

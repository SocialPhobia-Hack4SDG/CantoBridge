/**
 * 配色主题词表：唯一真源。
 *   mint = 默认，浅灰底 + Jade 绿（最克制，演示主用）
 *   warm = 主题 2，米黄底 + 明橙色按钮
 *
 * 颜色值不在这里：写在 src/styles/tokens.css 的 --palette-* 里，
 * 由 :root 与 :root[data-theme='warm'] 两组变量引用。这里只放 id 与文案 key 的拼法，
 * 让「主题列表」和「文案」两件事都有唯一出处。
 *
 * 界面文案 key = 'theme.' + id（配料卡上的主题名，如「薄荷绿」/「暖橙」）。
 * tools/check-ui.mjs 会读这里的 THEMES 逐个校验语言包，所以加主题必须同时加文案，
 * 不会出现「切过去是一片空白」。
 */

export const THEMES = ['mint', 'warm', 'blue', 'night', 'eye'];

export const DEFAULT_THEME = 'mint';

/** 存档里可能读到旧值 / 脏值，一律收敛到已知主题，不让界面落到没有变量的状态。 */
export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : DEFAULT_THEME;
}

/** 主题 id -> 完整名文案 key（「薄荷绿」/「暖橙」）。 */
export function themeLabelKey(id) {
  return 'theme.' + normalizeTheme(id);
}

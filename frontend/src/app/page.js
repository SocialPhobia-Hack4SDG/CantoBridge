/**
 * 页面契约：每个页面模块导出一个 definePage 结果，app.js 只认这个结构。
 *   name      与 docs/03 路由表的「页面组件」列一致（tools/check-ui.mjs 会校验）
 *   titleKey  TopBar 标题文案 key
 *   load(ctx) 可选：进入页面时的异步取数，抛错就落到失败态
 *   render(ctx, view) 纯同步，返回 DOM；view 里有 { data, error, loading }
 */

export function definePage(spec) {
  if (!spec || typeof spec.name !== 'string' || typeof spec.render !== 'function') {
    throw new Error('definePage 需要 { name, render }');
  }
  return { load: null, titleKey: null, ...spec };
}

/** 页面里最常用的「按三态渲染」小工具：加载中 / 失败 / 正常。 */
export function renderStates(view, { loading, error, ready }) {
  if (view.loading) return loading();
  if (view.error) return error(view.error);
  return ready();
}
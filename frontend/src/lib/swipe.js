/**
 * 跟手拖拽 + 松手判定：话题卡牌堆（`TopicCardStack`）与问卷分页器（`QuestionPager`）共用。
 * delta > 0 表示「下一项」（手指向左划），delta < 0 表示「上一项」。
 * 只依赖 pointer 事件；环境不支持时只会退化成「点按钮 / 箭头」，不会卡住。
 */
export function attachSwipe(element, { onSwipe, threshold = 56 } = {}) {
  let startX = null;
  const reset = () => {
    element.style?.setProperty?.("--drag", "0px");
    element.classList?.remove?.("is-dragging");
  };
  element.addEventListener?.("pointerdown", (event) => {
    startX = event.clientX ?? 0;
    element.classList?.add?.("is-dragging");
  });
  element.addEventListener?.("pointermove", (event) => {
    if (startX === null) return;
    const delta = (event.clientX ?? 0) - startX;
    element.style?.setProperty?.("--drag", Math.round(delta) + "px");
  });
  const finish = (event) => {
    if (startX === null) return;
    const delta = (event.clientX ?? 0) - startX;
    startX = null;
    reset();
    if (delta <= -threshold) onSwipe?.(1);
    else if (delta >= threshold) onSwipe?.(-1);
  };
  element.addEventListener?.("pointerup", finish);
  element.addEventListener?.("pointercancel", () => {
    startX = null;
    reset();
  });
}

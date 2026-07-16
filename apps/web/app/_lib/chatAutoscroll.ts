export const CHAT_AUTOSCROLL_BOTTOM_THRESHOLD_PX = 120;

export interface ScrollEndMetrics {
  scrollTop: number;
  viewportHeight: number;
  scrollHeight: number;
  thresholdPx?: number;
}

export function isNearScrollEnd({
  scrollTop,
  viewportHeight,
  scrollHeight,
  thresholdPx = CHAT_AUTOSCROLL_BOTTOM_THRESHOLD_PX,
}: ScrollEndMetrics): boolean {
  if (scrollHeight <= viewportHeight) return true;
  return scrollHeight - (scrollTop + viewportHeight) <= thresholdPx;
}

export function getPageScrollMetrics(windowObject: Window): ScrollEndMetrics {
  const documentElement = windowObject.document.documentElement;
  const body = windowObject.document.body;

  return {
    scrollTop: windowObject.scrollY || documentElement.scrollTop || body?.scrollTop || 0,
    viewportHeight: windowObject.innerHeight,
    scrollHeight: Math.max(documentElement.scrollHeight, body?.scrollHeight ?? 0),
  };
}

export function isNearPageBottom(windowObject: Window): boolean {
  return isNearScrollEnd(getPageScrollMetrics(windowObject));
}

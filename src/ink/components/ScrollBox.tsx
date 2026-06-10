import React, { type PropsWithChildren, type Ref, useImperativeHandle, useRef, useState } from 'react';
import type { Except } from 'type-fest';
import { markScrollActivity } from '../../bootstrap/state.js';
import type { DOMElement } from '../dom.js';
import { markDirty, scheduleRenderFrom } from '../dom.js';
import { markCommitStart } from '../reconciler.js';
import type { Styles } from '../styles.js';
import '../global.d.ts';
import Box from './Box.js';

// 滚动位置持久化 key
const SCROLL_POSITION_KEY = 'doge:scrollPosition';

/**
 * 保存当前滚动位置到 sessionStorage
 */
function saveScrollPosition(sessionId: string, scrollTop: number, scrollHeight: number) {
  try {
    const position = {
      scrollTop,
      scrollHeight,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(SCROLL_POSITION_KEY, JSON.stringify(position));
  } catch (e) {
    // sessionStorage 可能不可用或已溢出
    console.warn('Failed to save scroll position:', e);
  }
}

/**
 * 从 sessionStorage 恢复滚动位置
 * @returns 滚动位置信息，如果没有保存的位置则返回 null
 */
function loadSavedScrollPosition(): { scrollTop: number; scrollHeight: number } | null {
  try {
    const saved = sessionStorage.getItem(SCROLL_POSITION_KEY);
    if (saved) {
      const position = JSON.parse(saved) as { scrollTop: number; scrollHeight: number; savedAt: number };
      // 位置数据在 24 小时内有效
      if (Date.now() - position.savedAt < 24 * 60 * 60 * 1000) {
        return { scrollTop: position.scrollTop, scrollHeight: position.scrollHeight };
      }
    }
    return null;
  } catch (e) {
    console.warn('Failed to load scroll position:', e);
    return null;
  }
}

/**
 * 清除保存的滚动位置（例如在会话清空时）
 */
function clearSavedScrollPosition() {
  try {
    sessionStorage.removeItem(SCROLL_POSITION_KEY);
  } catch (e) {
    console.warn('Failed to clear scroll position:', e);
  }
}
export type ScrollBoxHandle = {
  scrollTo: (y: number) => void;
  scrollBy: (dy: number) => void;
  /**
   * Scroll so `el`'s top is at the viewport top (plus `offset`). Unlike
   * scrollTo which bakes a number that's stale by the time the throttled
   * render fires, this defers the position read to render time —
   * render-node-to-output reads `el.yogaNode.getComputedTop()` in the
   * SAME Yoga pass that computes scrollHeight. Deterministic. One-shot.
   */
  scrollToElement: (el: DOMElement, offset?: number) => void;
  scrollToBottom: () => void;
  getScrollTop: () => number;
  getPendingDelta: () => number;
  getScrollHeight: () => number;
  /**
   * Like getScrollHeight, but reads Yoga directly instead of the cached
   * value written by render-node-to-output (throttled, up to 16ms stale).
   * Use when you need a fresh value in useLayoutEffect after a React commit
   * that grew content. Slightly more expensive (native Yoga call).
   */
  getFreshScrollHeight: () => number;
  getViewportHeight: () => number;
  /**
   * Absolute screen-buffer row of the first visible content line (inside
   * padding). Used for drag-to-scroll edge detection.
   */
  getViewportTop: () => number;
  /**
   * True when scroll is pinned to the bottom. Set by scrollToBottom, the
   * initial stickyScroll attribute, and by the renderer when positional
   * follow fires (scrollTop at prevMax, content grows). Cleared by
   * scrollTo/scrollBy. Stable signal for "at bottom" that doesn't depend on
   * layout values (unlike scrollTop+viewportH >= scrollHeight).
   */
  isSticky: () => boolean;
  /**
   * Subscribe to imperative scroll changes (scrollTo/scrollBy/scrollToBottom).
   * Does NOT fire for stickyScroll updates done by the Ink renderer — those
   * happen during Ink's render phase after React has committed. Callers that
   * care about the sticky case should treat "at bottom" as a fallback.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Set the render-time scrollTop clamp to the currently-mounted children's
   * coverage span. Called by useVirtualScroll after computing its range;
   * render-node-to-output clamps scrollTop to [min, max] so burst scrollTo
   * calls that race past React's async re-render show the edge of mounted
   * content instead of blank spacer. Pass undefined to disable (sticky,
   * cold start).
   */
  setClampBounds: (min: number | undefined, max: number | undefined) => void;
  /** Get the saved scroll position for restoration */
  getSavedScrollPosition: () => { scrollTop: number; scrollHeight: number } | null;
  /** Save current scroll position to sessionStorage */
  saveScrollPosition: (scrollTop?: number, scrollHeight?: number) => void;
  /** Restore scroll position from sessionStorage */
  restoreScrollPosition: () => number | null;
  /** Clear saved scroll position */
  clearScrollPosition: () => void;
};
export type ScrollBoxProps = Except<Styles, 'textWrap' | 'overflow' | 'overflowX' | 'overflowY'> & {
  ref?: Ref<ScrollBoxHandle>;
  /**
   * When true, automatically pins scroll position to the bottom when content
   * grows. Unset manually via scrollTo/scrollBy to break the stickiness.
   */
  stickyScroll?: boolean;
  /**
   * When true, restores the scroll position from sessionStorage on mount.
   * Useful for preserving scroll position across page refreshes.
   */
  restoreOnMount?: boolean;
};

/**
 * A Box with `overflow: scroll` and an imperative scroll API.
 *
 * Children are laid out at their full Yoga-computed height inside a
 * constrained container. At render time, only children intersecting the
 * visible window (scrollTop..scrollTop+height) are rendered (viewport
 * culling). Content is translated by -scrollTop and clipped to the box bounds.
 *
 * Works best inside a fullscreen (constrained-height root) Ink tree.
 */
function ScrollBox({
  children,
  ref,
  stickyScroll,
  restoreOnMount = false,
  ...style
}: PropsWithChildren<ScrollBoxProps>): React.ReactNode {
  const domRef = useRef<DOMElement>(null);
  // scrollTo/scrollBy bypass React: they mutate scrollTop on the DOM node,
  // mark it dirty, and call the root's throttled scheduleRender directly.
  // The Ink renderer reads scrollTop from the node — no React state needed,
  // no reconciler overhead per wheel event. The microtask defer coalesces
  // multiple scrollBy calls in one input batch (discreteUpdates) into one
  // render — otherwise scheduleRender's leading edge fires on the FIRST
  // event before subsequent events mutate scrollTop. scrollToBottom still
  // forces a React render: sticky is attribute-observed, no DOM-only path.
  const [, forceRender] = useState(0);
  const listenersRef = useRef(new Set<() => void>());
  const renderQueuedRef = useRef(false);
  const savedPositionRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);

  // 在组件挂载时恢复保存的滚动位置
  React.useEffect(() => {
    if (restoreOnMount && domRef.current) {
      const saved = loadSavedScrollPosition();
      if (saved) {
        savedPositionRef.current = saved;
        // 检查当前 scrollHeight 是否匹配，如果不匹配则不恢复
        const currentScrollHeight = domRef.current.scrollHeight;
        if (Math.abs(currentScrollHeight - saved.scrollHeight) < 10) {
          // 滚动位置相近，恢复滚动位置
          domRef.current.scrollTop = saved.scrollTop;
          console.log('[ScrollBox] Restored scroll position:', saved);
        } else {
          console.log('[ScrollBox] Scroll height mismatch, not restoring position');
        }
      }
    }
    // 清理定时器
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const notify = () => {
    for (const l of listenersRef.current) l();
  };
  // 防抖保存滚动位置的定时器
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 保存滚动位置到 sessionStorage
  const debouncedSavePosition = React.useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      const el = domRef.current;
      if (el) {
        const scrollTop = el.scrollTop;
        const scrollHeight = el.scrollHeight;
        savedPositionRef.current = { scrollTop, scrollHeight };
        saveScrollPosition('', scrollTop, scrollHeight);
      }
    }, 100); // 100ms 防抖
  }, []);

  function scrollMutated(el: DOMElement): void {
    // Signal background intervals (IDE poll, LSP poll, GCS fetch, orphan
    // check) to skip their next tick — they compete for the event loop and
    // contributed to 1402ms max frame gaps during scroll drain.
    markScrollActivity();
    markDirty(el);
    markCommitStart();
    notify();
    // 触发保存滚动位置（防抖）
    debouncedSavePosition();
    if (renderQueuedRef.current) return;
    renderQueuedRef.current = true;
    queueMicrotask(() => {
      renderQueuedRef.current = false;
      scheduleRenderFrom(el);
    });
  }
  useImperativeHandle(ref, (): ScrollBoxHandle => ({
    scrollTo(y: number) {
      const el = domRef.current;
      if (!el) return;
      // Explicit false overrides the DOM attribute so manual scroll
      // breaks stickiness. Render code checks ?? precedence.
      el.stickyScroll = false;
      el.pendingScrollDelta = undefined;
      el.scrollAnchor = undefined;
      el.scrollTop = Math.max(0, Math.floor(y));
      scrollMutated(el);
    },
    scrollToElement(el: DOMElement, offset = 0) {
      const box = domRef.current;
      if (!box) return;
      box.stickyScroll = false;
      box.pendingScrollDelta = undefined;
      box.scrollAnchor = {
        el,
        offset
      };
      scrollMutated(box);
    },
    scrollBy(dy: number) {
      const el = domRef.current;
      if (!el) return;
      el.stickyScroll = false;
      // Wheel input cancels any in-flight anchor seek — user override.
      el.scrollAnchor = undefined;
      // Accumulate in pendingScrollDelta; renderer drains it at a capped
      // rate so fast flicks show intermediate frames. Pure accumulator:
      // scroll-up followed by scroll-down naturally cancels.
      el.pendingScrollDelta = (el.pendingScrollDelta ?? 0) + Math.floor(dy);
      scrollMutated(el);
    },
    scrollToBottom() {
      const el = domRef.current;
      if (!el) return;
      el.pendingScrollDelta = undefined;
      el.stickyScroll = true;
      markDirty(el);
      notify();
      forceRender(n => n + 1);
    },
    getScrollTop() {
      return domRef.current?.scrollTop ?? 0;
    },
    getPendingDelta() {
      // Accumulated-but-not-yet-drained delta. useVirtualScroll needs
      // this to mount the union [committed, committed+pending] range —
      // otherwise intermediate drain frames find no children (blank).
      return domRef.current?.pendingScrollDelta ?? 0;
    },
    getScrollHeight() {
      return domRef.current?.scrollHeight ?? 0;
    },
    getFreshScrollHeight() {
      const content = domRef.current?.childNodes[0] as DOMElement | undefined;
      return content?.yogaNode?.getComputedHeight() ?? domRef.current?.scrollHeight ?? 0;
    },
    getViewportHeight() {
      return domRef.current?.scrollViewportHeight ?? 0;
    },
    getViewportTop() {
      return domRef.current?.scrollViewportTop ?? 0;
    },
    isSticky() {
      const el = domRef.current;
      if (!el) return false;
      return el.stickyScroll ?? Boolean(el.attributes['stickyScroll']);
    },
    subscribe(listener: () => void) {
      listenersRef.current.add(listener);
      return () => listenersRef.current.delete(listener);
    },
    setClampBounds(min, max) {
      const el = domRef.current;
      if (!el) return;
      el.scrollClampMin = min;
      el.scrollClampMax = max;
    },
    /** 获取保存的滚动位置（用于恢复） */
    getSavedScrollPosition: () => savedPositionRef.current,
    /** 保存当前滚动位置到 sessionStorage */
    saveScrollPosition: (scrollTop?: number, scrollHeight?: number) => {
      const el = domRef.current;
      if (!el) return;
      const top = scrollTop ?? el.scrollTop;
      const height = scrollHeight ?? el.scrollHeight;
      savedPositionRef.current = { scrollTop: top, scrollHeight: height };
      saveScrollPosition('', top, height);
    },
    /** 恢复保存的滚动位置 */
    restoreScrollPosition: () => {
      const saved = loadSavedScrollPosition();
      if (saved && domRef.current) {
        savedPositionRef.current = saved;
        return saved.scrollTop;
      }
      return null;
    },
    /** 清除保存的滚动位置 */
    clearScrollPosition: () => {
      savedPositionRef.current = null;
      clearSavedScrollPosition();
    }
  }),
  // notify/scrollMutated are inline (no useCallback) but only close over
  // refs + imports — stable. Empty deps avoids rebuilding the handle on
  // every render (which re-registers the ref = churn).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  // Structure: outer viewport (overflow:scroll, constrained height) >
  // inner content (flexGrow:1, flexShrink:0 — fills at least the viewport
  // but grows beyond it for tall content). flexGrow:1 lets children use
  // spacers to pin elements to the bottom of the scroll area. Yoga's
  // Overflow.Scroll prevents the viewport from growing to fit the content.
  // The renderer computes scrollHeight from the content box and culls
  // content's children based on scrollTop.
  //
  // stickyScroll is passed as a DOM attribute (via ink-box directly) so it's
  // available on the first render — ref callbacks fire after the initial
  // commit, which is too late for the first frame.
  return <ink-box ref={el => {
    domRef.current = el;
    if (el) el.scrollTop ??= 0;
  }} style={{
    flexWrap: 'nowrap',
    flexDirection: style.flexDirection ?? 'row',
    flexGrow: style.flexGrow ?? 0,
    flexShrink: style.flexShrink ?? 1,
    ...style,
    overflowX: 'scroll',
    overflowY: 'scroll'
  }} {...stickyScroll ? {
    stickyScroll: true
  } : {}}>
      <Box flexDirection="column" flexGrow={1} flexShrink={0} width="100%">
        {children}
      </Box>
    </ink-box>;
}
export default ScrollBox;

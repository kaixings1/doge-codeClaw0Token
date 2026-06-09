import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box } from '../../ink.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { Clawd, type ClawdPose } from './Clawd.js';

type Frame = {
  pose: ClawdPose;
  offset: number;
};

function hold(pose: ClawdPose, offset: number, frames: number): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset }));
}

// 点击动画：跳跃 + 举手
const JUMP_WAVE: readonly Frame[] = [
  ...hold('default', 2, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
  ...hold('default', 2, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
];

// 点击动画：左右看
const LOOK_AROUND: readonly Frame[] = [
  ...hold('look-right', 0, 5),
  ...hold('look-left', 0, 5),
  ...hold('default', 0, 1),
];

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP_WAVE, LOOK_AROUND];

// 空闲动画：自动左右看 + 偶尔举手（像打招呼）
const IDLE_LOOP: readonly Frame[] = [
  ...hold('default', 0, 30),    // 正常站立 1.8 秒
  ...hold('look-left', 0, 10),  // 向左看 0.6 秒
  ...hold('default', 0, 20),    // 恢复 1.2 秒
  ...hold('look-right', 0, 10), // 向右看 0.6 秒
  ...hold('default', 0, 20),
  ...hold('arms-up', 0, 5),     // 举一下手（打招呼）0.3 秒
  ...hold('default', 0, 25),
];

const FRAME_MS = 60;
const incrementFrame = (i: number) => i + 1;
const CLAWD_HEIGHT = 7; // 与 Clawd 组件图形高度一致

export function AnimatedClawd() {
  const columns = useTerminalSize().columns;
  const $ = _c(8);
  const { pose, bounceOffset, onClick } = useClawdAnimation(columns);

  let t0;
  if ($[0] !== pose) {
    t0 = <Clawd pose={pose} />;
    $[0] = pose;
    $[1] = t0;
  } else {
    t0 = $[1];
  }

  let t1;
  if ($[2] !== bounceOffset || $[3] !== t0) {
    t1 = <Box marginTop={bounceOffset} flexShrink={0}>{t0}</Box>;
    $[2] = bounceOffset;
    $[3] = t0;
    $[4] = t1;
  } else {
    t1 = $[4];
  }

  let t2;
  if ($[5] !== onClick || $[6] !== t1) {
    t2 = (
      <Box height={CLAWD_HEIGHT} flexDirection="column" onClick={onClick}>
        {t1}
      </Box>
    );
    $[5] = onClick;
    $[6] = t1;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
}

function useClawdAnimation(columns: number) {
  const [reducedMotion] = useState(() => getInitialSettings().prefersReducedMotion ?? false);
  const [frameIndex, setFrameIndex] = useState(0); // 始终运行帧序列
  const sequenceRef = useRef<readonly Frame[]>(IDLE_LOOP);
  const clickLockRef = useRef(false);

  // 计算跳动幅度：基于终端宽度，最大跳动 20% 的高度
  const bounceOffset = Math.max(1, Math.min(20, columns / 5));

  const onClick = () => {
    if (reducedMotion || clickLockRef.current) return;
    clickLockRef.current = true;
    const anim = CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)]!;
    sequenceRef.current = anim;
    setFrameIndex(0);
  };

  useEffect(() => {
    if (reducedMotion) return;

    let intervalId: NodeJS.Timeout | null = null;

    // 动画循环逻辑：仅依赖于 setState 的函数更新，不直接读取 frameIndex
    const animate = () => {
      setFrameIndex(prevIndex => {
        const nextIndex = prevIndex + 1;
        if (nextIndex >= sequenceRef.current.length) {
            // 动画结束，恢复 idle 循环
            sequenceRef.current = IDLE_LOOP;
            clickLockRef.current = false;
            clearInterval(intervalId!);
            return 0;
        }
        return nextIndex;
      });
    };

    // 启动定时器，初始时需要确保 frameIndex 是一个有效的状态值
    // 初始启动时，如果 frameIndex 已经是 0 且动画未开始，我们需要设置一次定时器。
    // 使用 setInterval 保证持续性，并依赖于 setFrameIndex 来更新状态。
    if (frameIndex < sequenceRef.current.length && !clickLockRef.current) {
        intervalId = setInterval(animate, FRAME_MS);
    }

    // 清理函数：在组件卸载或依赖项变化时清除定时器
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [reducedMotion]); // 仅依赖 reducedMotion，不依赖 frameIndex壮



  // 当 reducedMotion 变化时，重置动画状态
  useEffect(() => {
    if (reducedMotion) {
      // 如果用户启用了减少运动模式，立即停止动画
      sequenceRef.current = IDLE_LOOP;
      setFrameIndex(0);
      clickLockRef.current = false;
    }
  }, [reducedMotion]);

  const currentFrame = sequenceRef.current[frameIndex] ?? { pose: 'default', offset: 0 };
  return {
    pose: currentFrame.pose,
    bounceOffset: currentFrame.offset,
    onClick,
  };
}
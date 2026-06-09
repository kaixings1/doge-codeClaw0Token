import * as React from 'react';
import { Box, Text } from '../../ink.js';
export type ClawdPose = 'default' | 'blink' | 'heart' | 'angry' | 'sleep' | 'arms-up';

export type ClawdPose = 'default' | 'blink' | 'heart' | 'angry' | 'sleep' | 'arms-up';

type Props = {
  pose: ClawdPose;
};

const GRAPHICS: Record<ClawdPose, string[]> = {
  default: [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱  ◕    ◕   ╲ ",
    "│      ω      │",
    "│    ‿    ‿   │",
    "│   ███████   │",
    " ╲             ╱ ",
    "  ╰───────────╯  ",
  ],
  blink: [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱  ◕    -    ╲ ",
    "│      ω      │",
    "│    ‿    ‿   │",
    "│   ███████   │",
    " ╲             ╱ ",
    "  ╰───────────╯  ",
  ],
  heart: [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱  ♥    ♥    ╲ ",
    "│      ω      │",
    "│    ‿    ‿   │",
    "│   ███████   │",
    " ╲             ╱ ",
    "  ╰───────────╯  ",
  ],
  angry: [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱  ◉    ◉    ╲ ",
    "│      εε     │",
    "│    ‿    ‿   │",
    "│   ███████   │",
    " ╲             ╱ ",
    "  ╰───────────╯  ",
  ],
  sleep: [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱  -    -    ╲ ",
    "│      ω      │",
    "│   zz   zz   │",
    "│   ███████   │",
    " ╲             ╱ ",
    "  ╰───────────╯  ",
  ],
  'arms-up': [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱  ◕    ◕    ╲ ",
    "│      ω      │",
    "│    ‿    ‿   │",
    "│   ███████   │",
    " ╲    ✨       ╱ ",
    "  ╰──────────╯   ",
  ],
};

// 统一宽度，防止换行抖动
const maxLen = Math.max(...Object.values(GRAPHICS).flat().map(l => l.length));
(Object.keys(GRAPHICS) as ClawdPose[]).forEach(pose => {
  GRAPHICS[pose] = GRAPHICS[pose].map(line => line.padEnd(maxLen, ' '));
});

// 糖果色渐变
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getCharColor(ch: string, row: number, totalRows: number): string | undefined {
  if ("◕◉♥✨-".includes(ch)) return "#ffffff";
  if ("╭╮╰╯╱╲│─▴▃".includes(ch)) {
    const t = row / (totalRows - 1);
    return hslToHex(340 - t * 30, 0.45, 0.65 + t * 0.15);
  }
  if ("ω‿zε".includes(ch)) {
    return row < totalRows / 2 ? "#ffaacc" : "#ff88bb";
  }
  const hue = 340 + (row / totalRows) * 50;
  return hslToHex(hue, 0.55, 0.7);
}

function renderLine(line: string, rowIdx: number, totalRows: number): React.ReactNode {
  return line.split("").map((ch, col) => {
    if (ch === " ") return " ";
    return <Text key={col} color={getCharColor(ch, rowIdx, totalRows)}>{ch}</Text>;
  });
}

// 动态渲染：根据 pose 属性渲染对应的图形
export function Clawd({ pose = 'default' }: Props) {
  const currentPose = pose;

  // 监听 pose 变化并更新内部状态
  useEffect(() => {
    if (pose !== currentPose) {
      setCurrentPose(pose);
      poseChangedRef.current = true;
    }
  }, [pose]);

  // 检测 pose 是否变化
  useEffect(() => {
    if (poseChangedRef.current && currentPose !== pose) {
      poseChangedRef.current = false;
    }
  }, [pose]);

  // 检测 pose 变化并重新渲染
  useEffect(() => {
    if (currentPose !== pose) {
      setCurrentPose(pose);
    }
  }, [pose]);

  return (
    <Box flexDirection="column" alignItems="center">
      {GRAPHICS[currentPose]?.map((line, idx) => (
        <Text key={idx}>{renderLine(line, idx, GRAPHICS[currentPose]?.length || 0)}</Text>
      ))}
    </Box>
  );
}

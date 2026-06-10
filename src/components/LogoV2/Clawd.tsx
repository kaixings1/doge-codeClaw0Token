import * as React from 'react';
import { Box, Text } from '../../ink.js';
export type ClawdPose =
  | 'default'
  | 'blink'
  | 'heart'
  | 'angry'
  | 'sleep'
  | 'arms-up'
  | 'look-left'
  | 'look-right'
  | 'waving'
  | 'thinking';


type Props = {
  pose?: ClawdPose;
};

// 统一宽度为 25 字符，确保所有姿势对齐
const ROW_WIDTH = 25;

const GRAPHICS: Record<ClawdPose, string[]> = {
  default: [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱   ◕     ◕    ╲   ",
    "    │      ω        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
  blink: [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱   ◕     -    ╲   ",
    "    │      ω        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
  heart: [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱    ♥      ♥   ╲   ",
    "    │      ω        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
  angry: [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱   ◉     ◉    ╲   ",
    "    │      εε       │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
  sleep: [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱   -      -    ╲   ",
    "    │      ω        │   ",
    "    │     zz zz     │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
  'arms-up': [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱   ◕     ◕    ╲   ",
    "    │      ω        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲     ✨       ╱    ",
    "      ╰───────────╯      ",
  ],
  'look-left': [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱ ◕     ◕      ╲   ",
    "    │      ω        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
  'look-right': [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱      ◕   ◕  ╲    ",
    "    │      ω        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
  waving: [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱   ◕     ◕    ╲   ",
    "    │      ω        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╱    ✨ ✨      ╲    ",
    "      ╰───────────╯      ",
  ],
  thinking: [
    "        ▴▃▃▃▃▃▃▃▴        ",
    "      ╭─────────────╮    ",
    "     ╱   ◕     ◕    ╲   ",
    "    │      ︿        │   ",
    "    │     ‿ ‿      │   ",
    "    │    ██████     │   ",
    "     ╲             ╱    ",
    "      ╰─────────────╯    ",
  ],
};

// 统一宽度，防止换行抖动
(Object.keys(GRAPHICS) as ClawdPose[]).forEach(pose => {
  GRAPHICS[pose] = GRAPHICS[pose].map(line => line.padEnd(ROW_WIDTH, ' '));
});

// 现代化渐变色 - 更精致、更协调的配色方案
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// 现代配色方案 - 使用 RGB 字符串格式，更鲜艳生动
function getCharColor(ch: string, row: number, totalRows: number): string {
  // 表情符号 - 白色高亮
  if ("◕◉♥✨-".includes(ch)) return "text";
  // 边框和结构 - 渐变紫色到蓝色 (更鲜艳)
  if ("╭╮╰╯╱╲│─▴▃".includes(ch)) {
    const t = row / (totalRows - 1);
    return hslToHex(330 - t * 40, 0.6, 0.55 + t * 0.2);
  }
  // 内部装饰符号 - 更鲜艳的粉色系
  if ("ω‿zε".includes(ch)) {
    return row < totalRows / 2 ? "rgb(255,200,220)" : "rgb(255,170,200)";
  }
  // 主体 - 更鲜艳的彩虹渐变 (从粉紫到橙黄)
  const hue = 330 + (row / totalRows) * 60;
  return hslToHex(hue, 0.65, 0.65);
}

function renderLine(line: string, rowIdx: number, totalRows: number): React.ReactNode {
  return line.split("").map((ch, col) => {
    if (ch === " ") return " ";
    return <Text key={col} color={getCharColor(ch, rowIdx, totalRows)}>{ch}</Text>;
  });
}

// 纯静态组件（不再有自动动画）
export function Clawd({ pose = 'default' }: Props) {
  const rows = GRAPHICS[pose];



  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((line, idx) => (
        <Text key={idx}>{renderLine(line, idx, rows.length)}</Text>
      ))}
    </Box>
  );
}


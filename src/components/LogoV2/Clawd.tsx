import * as React from 'react';
import { Box, Text } from '../../ink.js';
export type ClawdPose = 'default' | 'blink' | 'heart' | 'angry' | 'sleep' | 'arms-up' | 'look-left' | 'look-right';


type Props = {
  pose?: ClawdPose;
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
  'look-left': [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱ ◕   ◕     ╲ ",
    "│      ω      │",
    "│    ‿    ‿   │",
    "│   ███████   │",
    " ╲             ╱ ",
    "  ╰───────────╯  ",
  ],
  'look-right': [
    "    ▴▃▃▃▃▃▃▃▴     ",
    "  ╭───────────╮  ",
    " ╱     ◕   ◕  ╲ ",
    "│      ω      │",
    "│    ‿    ‿   │",
    "│   ███████   │",
    " ╲             ╱ ",
    "  ╰───────────╯  ",
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

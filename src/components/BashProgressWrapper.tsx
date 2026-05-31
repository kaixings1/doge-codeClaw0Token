import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';          // Ink 的组件
import { BashProgressView } from 'sdk-path'; // 假设 SDK 仍然暴露该组件
import { progressEmitter } from '../tools/progressEmitter';

export const BashProgressWrapper: React.FC = () => {
  const [output, setOutput] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [totalLines, setTotalLines] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const handler = (data: any) => {
      if (data.type === 'bash') {
        setOutput(data.output);
        setElapsed(data.elapsedSeconds);
        setTotalLines(data.output.split('\n').length);
        setTotalBytes(new TextEncoder().encode(data.output).length);
        setIsRunning(true);
      }
    };

    progressEmitter.on('progress', handler);
    return () => {
      progressEmitter.off('progress', handler);
    };
  }, []);

  // 如果 SDK 的 BashProgressView 可用，直接使用它，props 用我们自己的 state
  if (typeof BashProgressView !== 'undefined') {
    return (
      <BashProgressView
        fullOutput={output}
        lastOutput={output.split('\n').pop() || ''}
        elapsedTimeSeconds={elapsed}
        totalLines={totalLines}
        totalBytes={totalBytes}
      />
    );
  }

  // 如果 SDK 的组件不可用，自己实现一个简化版（用 Ink 组件）
  const displayLines = output.split('\n').slice(-100).join('\n');
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <Text color="cyan">[⏳ 运行中]</Text>
        <Text> 已运行 {elapsed} 秒</Text>
        {totalLines > 0 && <Text> · {totalLines} 行</Text>}
        {totalBytes > 0 && <Text> · {(totalBytes / 1024).toFixed(1)} KB</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>━━━━━━ 实时输出 ━━━━━━</Text>
        <Text>{displayLines || '(暂无输出)'}</Text>
        {output.split('\n').length > 100 && (
          <Text dimColor>... (仅显示最后100行，共 {output.split('\n').length} 行)</Text>
        )}
      </Box>
    </Box>
  );
};
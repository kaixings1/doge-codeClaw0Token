import { handleToolCall } from './commands/clear/tool-handler.ts';
const result = await handleToolCall({
  tool: 'exec',
  parameters: { command: 'dir', timeout: 10000 }
});
console.log(JSON.stringify(result, null, 2));

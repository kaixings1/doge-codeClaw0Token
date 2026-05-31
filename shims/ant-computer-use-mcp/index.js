export const DEFAULT_GRANT_FLAGS = {
    accessibility: false,
    screenRecording: false,
};
export const API_RESIZE_PARAMS = {};
function successText(text) {
    return {
        content: [{ type: 'text', text }],
    };
}
function errorText(text) {
    return {
        is_error: true,
        content: [{ type: 'text', text }],
    };
}
export function targetImageSize(width, height) {
    return [width, height];
}
const TOOL_DEFS = [
    {
        name: 'request_access',
        description: 'Request access to applications and computer-use permissions for this session.',
    },
    {
        name: 'list_granted_applications',
        description: 'List applications currently granted for computer use.',
    },
    { name: 'screenshot', description: 'Capture a screenshot.' },
    { name: 'zoom', description: 'Capture a zoomed screenshot region.' },
    { name: 'cursor_position', description: 'Read the current cursor position.' },
    { name: 'mouse_move', description: 'Move the mouse cursor.' },
    { name: 'left_click', description: 'Left click at a coordinate.' },
    { name: 'right_click', description: 'Right click at a coordinate.' },
    { name: 'middle_click', description: 'Middle click at a coordinate.' },
    { name: 'double_click', description: 'Double click at a coordinate.' },
    { name: 'triple_click', description: 'Triple click at a coordinate.' },
    { name: 'left_mouse_down', description: 'Press the left mouse button.' },
    { name: 'left_mouse_up', description: 'Release the left mouse button.' },
    { name: 'left_click_drag', description: 'Drag with the left mouse button.' },
    { name: 'scroll', description: 'Scroll at a coordinate or direction.' },
    { name: 'type', description: 'Type text through the active application.' },
    { name: 'key', description: 'Press a key or key chord.' },
    { name: 'hold_key', description: 'Hold one or more keys for a duration.' },
    { name: 'read_clipboard', description: 'Read clipboard text.' },
    { name: 'write_clipboard', description: 'Write clipboard text.' },
    {
        name: 'open_application',
        description: 'Open an application by bundle identifier.',
    },
    { name: 'wait', description: 'Wait for a short duration.' },
    {
        name: 'computer_batch',
        description: 'Execute a sequence of computer-use actions.',
    },
];
export function buildComputerUseTools() {
    return TOOL_DEFS;
}
export function createComputerUseMcpServer(adapter) {
    let closed = false;
    const handlers = new Map();
    return {
        async connect() {
            adapter?.logger?.warn('Computer Use MCP is running with a restored compatibility shim; request_access works, but native desktop actions remain unavailable in this workspace.');
        },
        setRequestHandler(schema, handler) {
            handlers.set(schema, handler);
        },
        async close() {
            closed = true;
            handlers.clear();
            adapter?.logger?.info?.('Computer Use MCP shim closed.');
        },
        get isClosed() {
            return closed;
        },
    };
}
export function bindSessionContext(_adapter, _coordinateMode, ctx) {
    return async (name, args) => {
        switch (name) {
            case 'request_access': {
                if (ctx?.onPermissionRequest) {
                    const response = await ctx.onPermissionRequest(args);
                    const grantedCount = Array.isArray(response.granted)
                        ? response.granted.length
                        : 0;
                    return successText(grantedCount > 0
                        ? `Computer-use access updated for ${grantedCount} application(s).`
                        : 'Computer-use access request completed.');
                }
                return errorText('Computer-use access approval is not configured in this restored workspace.');
            }
            case 'list_granted_applications': {
                const apps = ctx?.getAllowedApps?.() ?? [];
                if (apps.length === 0) {
                    return successText('No computer-use applications are currently granted.');
                }
                const names = apps
                    .map(app => app.displayName || app.bundleId || 'unknown')
                    .join(', ');
                return successText(`Granted computer-use applications: ${names}`);
            }
            case 'read_clipboard':
                return errorText('Clipboard access is unavailable in the restored computer-use shim.');
            default:
                return errorText(`Computer-use tool "${name}" is not available in this restored workspace. The shim currently supports session approval flows, but not native desktop execution.`);
        }
    };
}

import { execFileSync } from 'child_process';
const BLANK_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUVFRUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0mHyYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6gD/xAAVEAEBAAAAAAAAAAAAAAAAAAABAP/aAAgBAQABBQJf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwEf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwEf/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQAGPwJf/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQABPyFf/9k=';
function safeExec(file, args) {
    try {
        const stdout = execFileSync(file, args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return { ok: true, stdout: stdout.trim() };
    }
    catch {
        return { ok: false };
    }
}
function getDefaultDisplay() {
    return {
        id: 0,
        width: 1440,
        height: 900,
        scaleFactor: 1,
        originX: 0,
        originY: 0,
    };
}
function getDisplay(displayId) {
    const display = getDefaultDisplay();
    if (displayId === undefined || displayId === display.id) {
        return display;
    }
    return { ...display, id: displayId };
}
function buildScreenshotResult(width, height, displayId) {
    const display = getDisplay(displayId);
    return {
        base64: BLANK_JPEG_BASE64,
        width,
        height,
        displayWidth: display.width,
        displayHeight: display.height,
        displayId: display.id,
        originX: display.originX,
        originY: display.originY,
    };
}
function openBundle(bundleId) {
    if (!bundleId)
        return;
    safeExec('open', ['-b', bundleId]);
}
function getRunningApps() {
    const result = safeExec('osascript', [
        '-e',
        'tell application "System Events" to get the name of every application process',
    ]);
    if (!result.ok || result.stdout.length === 0)
        return [];
    return result.stdout
        .split(/\s*,\s*/u)
        .map(name => name.trim())
        .filter(Boolean)
        .map(name => ({
        bundleId: '',
        displayName: name,
    }));
}
function createInstalledApp(displayName) {
    return {
        bundleId: '',
        displayName,
    };
}
const stub = {
    _drainMainRunLoop() { },
    tcc: {
        checkAccessibility() {
            return false;
        },
        checkScreenRecording() {
            return false;
        },
    },
    hotkey: {
        registerEscape(_onEscape) {
            return false;
        },
        unregister() { },
        notifyExpectedEscape() { },
    },
    display: {
        getSize(displayId) {
            return getDisplay(displayId);
        },
        listAll() {
            return [getDefaultDisplay()];
        },
    },
    apps: {
        async prepareDisplay(_allowlistBundleIds, _surrogateHost, _displayId) {
            return { hidden: [] };
        },
        async previewHideSet(_allowlistBundleIds, _displayId) {
            return [];
        },
        async findWindowDisplays(bundleIds) {
            return bundleIds.map(bundleId => ({
                bundleId,
                displayIds: [],
            }));
        },
        async appUnderPoint(_x, _y) {
            return null;
        },
        async listInstalled() {
            return getRunningApps().map(app => createInstalledApp(app.displayName));
        },
        iconDataUrl(_path) {
            return null;
        },
        async listRunning() {
            return getRunningApps();
        },
        async open(bundleId) {
            openBundle(bundleId);
        },
        async unhide(_bundleIds) { },
    },
    screenshot: {
        async captureExcluding(_allowedBundleIds, _quality, width, height, displayId) {
            return buildScreenshotResult(width, height, displayId);
        },
        async captureRegion(_allowedBundleIds, _x, _y, _width, _height, outW, outH, _quality, displayId) {
            return buildScreenshotResult(outW, outH, displayId);
        },
    },
    async resolvePrepareCapture(_allowedBundleIds, _surrogateHost, _quality, targetW, targetH, preferredDisplayId, autoResolve = false, _doHide = false) {
        return {
            ...buildScreenshotResult(targetW, targetH, preferredDisplayId),
            hidden: [],
            autoResolved: autoResolve,
        };
    },
};
export default stub;

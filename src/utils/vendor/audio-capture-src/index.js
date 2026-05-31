let cachedModule = null;
let loadAttempted = false;
function loadModule() {
    if (loadAttempted) {
        return cachedModule;
    }
    loadAttempted = true;
    // Supported platforms: macOS (darwin), Linux, Windows (win32)
    const platform = process.platform;
    if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
        return null;
    }
    // Candidate 1: native-embed path (bun compile). AUDIO_CAPTURE_NODE_PATH is
    // defined at build time in build-with-plugins.ts for native builds only �?the
    // define resolves it to the static literal "../../audio-capture.node" so bun
    // compile can rewrite it to /$bunfs/root/audio-capture.node. MUST stay a
    // direct require(env var) �?bun cannot analyze require(variable) from a loop.
    if (process.env.AUDIO_CAPTURE_NODE_PATH) {
        try {
            cachedModule = require(process.env.AUDIO_CAPTURE_NODE_PATH);
            return cachedModule;
        }
        catch {
            // fall through to runtime fallbacks below
        }
    }
    // Candidates 2/3: npm-install and dev/source layouts. Dynamic require is
    // fine here �?in bundled output (node --target build) require() resolves at
    // runtime relative to cli.js at the package root; in dev it resolves
    // relative to this file (vendor/audio-capture-src/index.ts).
    const platformDir = `${process.arch}-${platform}`;
    const fallbacks = [
        `./vendor/audio-capture/${platformDir}/audio-capture.node`,
        `../audio-capture/${platformDir}/audio-capture.node`,
    ];
    for (const p of fallbacks) {
        try {
            cachedModule = require(p);
            return cachedModule;
        }
        catch {
            // try next
        }
    }
    return null;
}
export function isNativeAudioAvailable() {
    return loadModule() !== null;
}
export function startNativeRecording(onData, onEnd) {
    const mod = loadModule();
    if (!mod) {
        return false;
    }
    return mod.startRecording(onData, onEnd);
}
export function stopNativeRecording() {
    const mod = loadModule();
    if (!mod) {
        return;
    }
    mod.stopRecording();
}
export function isNativeRecordingActive() {
    const mod = loadModule();
    if (!mod) {
        return false;
    }
    return mod.isRecording();
}
export function startNativePlayback(sampleRate, channels) {
    const mod = loadModule();
    if (!mod) {
        return false;
    }
    return mod.startPlayback(sampleRate, channels);
}
export function writeNativePlaybackData(data) {
    const mod = loadModule();
    if (!mod) {
        return;
    }
    mod.writePlaybackData(data);
}
export function stopNativePlayback() {
    const mod = loadModule();
    if (!mod) {
        return;
    }
    mod.stopPlayback();
}
export function isNativePlaying() {
    const mod = loadModule();
    if (!mod) {
        return false;
    }
    return mod.isPlaying();
}
// Returns the microphone authorization status.
// On macOS, returns the TCC status: 0=notDetermined, 1=restricted, 2=denied, 3=authorized.
// On Linux, always returns 3 (authorized) �?no system-level mic permission API.
// On Windows, returns 3 (authorized) if registry key absent or allowed, 2 (denied) if explicitly denied.
// Returns 0 (notDetermined) if the native module is unavailable.
export function microphoneAuthorizationStatus() {
    const mod = loadModule();
    if (!mod || !mod.microphoneAuthorizationStatus) {
        return 0;
    }
    return mod.microphoneAuthorizationStatus();
}

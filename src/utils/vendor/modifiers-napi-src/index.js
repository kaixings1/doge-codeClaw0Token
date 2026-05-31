import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
let cachedModule = null;
function loadModule() {
    if (cachedModule) {
        return cachedModule;
    }
    // Only works on macOS
    if (process.platform !== 'darwin') {
        return null;
    }
    try {
        if (process.env.MODIFIERS_NODE_PATH) {
            // Bundled mode - use the env var path
            cachedModule = require(process.env.MODIFIERS_NODE_PATH);
        }
        else {
            // Dev mode - load from vendor directory
            const modulePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'modifiers-napi', `${process.arch}-darwin`, 'modifiers.node');
            cachedModule = createRequire(import.meta.url)(modulePath);
        }
        return cachedModule;
    }
    catch {
        return null;
    }
}
export function getModifiers() {
    const mod = loadModule();
    if (!mod) {
        return [];
    }
    return mod.getModifiers();
}
export function isModifierPressed(modifier) {
    const mod = loadModule();
    if (!mod) {
        return false;
    }
    return mod.isModifierPressed(modifier);
}
/**
 * Pre-warm the native module by loading it in advance.
 * Call this early (e.g., at startup) to avoid delay on first use.
 */
export function prewarm() {
    // Just call loadModule to cache it
    loadModule();
}

// Lazy: defers dlopen until first call. The .node binary links against
// CoreGraphics/ImageIO on darwin; resolving that at module-eval time blocks
// startup because imagePaste.ts pulls this into the REPL chunk via static
// import. Same pattern as audio-capture-src/index.ts.
let cachedModule = null;
let loadAttempted = false;
// Raw binding accessor. Callers that need optional exports (e.g. clipboard
// functions) reach through this; keeping the wrappers on the caller side lets
// feature() tree-shake the property access strings out of external builds.
export function getNativeModule() {
    if (loadAttempted)
        return cachedModule;
    loadAttempted = true;
    try {
        cachedModule = require('../../image-processor.node');
    }
    catch {
        cachedModule = null;
    }
    return cachedModule;
}
// Factory function that matches sharp's API
export function sharp(input) {
    let processorPromise = null;
    // Create a chain of operations
    const operations = [];
    // Track how many operations have been applied to avoid re-applying
    let appliedOperationsCount = 0;
    // Get or create the processor (without applying operations)
    async function ensureProcessor() {
        if (!processorPromise) {
            processorPromise = (async () => {
                const mod = getNativeModule();
                if (!mod) {
                    throw new Error('Native image processor module not available');
                }
                return mod.processImage(input);
            })();
        }
        return processorPromise;
    }
    // Apply any pending operations to the processor
    function applyPendingOperations(proc) {
        for (let i = appliedOperationsCount; i < operations.length; i++) {
            const op = operations[i];
            if (op) {
                op(proc);
            }
        }
        appliedOperationsCount = operations.length;
    }
    const instance = {
        async metadata() {
            const proc = await ensureProcessor();
            return proc.metadata();
        },
        resize(width, height, options) {
            operations.push(proc => {
                proc.resize(width, height, options);
            });
            return instance;
        },
        jpeg(options) {
            operations.push(proc => {
                proc.jpeg(options?.quality);
            });
            return instance;
        },
        png(options) {
            operations.push(proc => {
                proc.png(options);
            });
            return instance;
        },
        webp(options) {
            operations.push(proc => {
                proc.webp(options?.quality);
            });
            return instance;
        },
        async toBuffer() {
            const proc = await ensureProcessor();
            applyPendingOperations(proc);
            return proc.toBuffer();
        },
    };
    return instance;
}
export default sharp;

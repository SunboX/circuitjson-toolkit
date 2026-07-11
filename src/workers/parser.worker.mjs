import { Parser } from '../core/Parser.mjs'
import { ProjectLoader } from '../core/ProjectLoader.mjs'
import { AsyncInputOwnership } from '../core/AsyncInputOwnership.mjs'
import { ToolkitWorkerProtocol } from '../core/worker/ToolkitWorkerProtocol.mjs'

/**
 * Parses one protocol payload through the canonical direct async path.
 * @param {{ input: unknown, options?: object }} payload Worker payload.
 * @param {{ signal: AbortSignal, onProgress: Function }} runtime Protocol runtime.
 * @returns {Promise<object>} Canonical document result.
 */
async function parseInWorker(payload, runtime) {
    return await Parser.parseAsync(
        AsyncInputOwnership.markParser(payload.input),
        {
            ...(payload.options || {}),
            worker: false,
            signal: runtime.signal,
            onProgress: runtime.onProgress
        }
    )
}

/**
 * Loads one project payload through the canonical direct async path.
 * @param {{ entries: unknown, options?: object }} payload Worker payload.
 * @param {{ signal: AbortSignal, onProgress: Function }} runtime Protocol runtime.
 * @returns {Promise<object>} Canonical project result.
 */
async function loadProjectInWorker(payload, runtime) {
    return await ProjectLoader.loadAsync(
        AsyncInputOwnership.markProject(payload.entries),
        {
            ...(payload.options || {}),
            worker: false,
            signal: runtime.signal,
            onProgress: runtime.onProgress
        }
    )
}

/**
 * Installs the shared parser/project protocol on one worker-like scope.
 * @param {unknown} scope Worker global scope.
 * @returns {{ dispose: () => void }} Protocol installation.
 */
export function installParserWorker(scope) {
    return ToolkitWorkerProtocol.install(scope, {
        parse: parseInWorker,
        loadProject: loadProjectInWorker
    })
}

if (
    typeof globalThis.addEventListener === 'function' &&
    typeof globalThis.postMessage === 'function'
) {
    installParserWorker(globalThis)
}

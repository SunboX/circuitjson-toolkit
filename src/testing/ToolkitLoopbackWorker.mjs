import { ToolkitWorkerProtocol } from '../core/worker/ToolkitWorkerProtocol.mjs'

/**
 * Provides a real protocol loopback for packed cross-toolkit conformance tests.
 */
export class ToolkitLoopbackWorker {
    #clientListeners = new Map()
    #installation
    #observations
    #serverListeners = new Map()
    #terminated = false

    /**
     * Creates one worker-like protocol endpoint for a canonical toolkit.
     * @param {Record<string, any>} toolkit Toolkit namespace.
     * @param {{ parse: number, loadProject: number }} observations Request counts.
     */
    constructor(toolkit, observations) {
        this.#observations = observations
        const scope = {
            addEventListener: (type, listener) =>
                this.#add(this.#serverListeners, type, listener),
            removeEventListener: (type, listener) =>
                this.#remove(this.#serverListeners, type, listener),
            postMessage: (message, transfer = []) =>
                this.#postToClient(message, transfer),
            reportError: (error) => this.#reportError(error)
        }
        this.#installation = ToolkitWorkerProtocol.install(scope, {
            parse: async (payload, runtime) => {
                observations.parse += 1
                return await toolkit.Parser.parseAsync(payload.input, {
                    ...(payload.options || {}),
                    worker: false,
                    signal: runtime.signal,
                    onProgress: runtime.onProgress
                })
            },
            loadProject: async (payload, runtime) => {
                observations.loadProject += 1
                return await toolkit.ProjectLoader.loadAsync(payload.entries, {
                    ...(payload.options || {}),
                    worker: false,
                    signal: runtime.signal,
                    onProgress: runtime.onProgress
                })
            }
        })
    }

    /**
     * Creates a Worker constructor bound to one toolkit namespace.
     * @param {Record<string, any>} toolkit Toolkit namespace.
     * @param {{ parse: number, loadProject: number }} observations Request counts.
     * @returns {typeof ToolkitLoopbackWorker} Bound worker constructor.
     */
    static constructorFor(toolkit, observations) {
        return class BoundToolkitLoopbackWorker extends ToolkitLoopbackWorker {
            /** Creates a worker bound to the enclosing toolkit. */
            constructor() {
                super(toolkit, observations)
            }
        }
    }

    /**
     * Adds one client-side worker event listener.
     * @param {string} type Event type.
     * @param {Function} listener Event listener.
     * @returns {void}
     */
    addEventListener(type, listener) {
        this.#add(this.#clientListeners, type, listener)
    }

    /**
     * Removes one client-side worker event listener.
     * @param {string} type Event type.
     * @param {Function} listener Event listener.
     * @returns {void}
     */
    removeEventListener(type, listener) {
        this.#remove(this.#clientListeners, type, listener)
    }

    /**
     * Posts one client request through a clone boundary to the protocol server.
     * @param {unknown} message Protocol message.
     * @param {Transferable[]} [transfer] Explicit transfer list.
     * @returns {void}
     */
    postMessage(message, transfer = []) {
        if (this.#terminated) throw new Error('Loopback worker is terminated.')
        const cloned = structuredClone(message, { transfer })
        queueMicrotask(() =>
            this.#emit(this.#serverListeners, 'message', cloned)
        )
    }

    /** Stops the loopback worker and active protocol operations. */
    terminate() {
        if (this.#terminated) return
        this.#terminated = true
        this.#installation.dispose()
        this.#clientListeners.clear()
        this.#serverListeners.clear()
    }

    /**
     * Adds one listener to an event registry.
     * @param {Map<string, Set<Function>>} registry Event registry.
     * @param {string} type Event type.
     * @param {Function} listener Event listener.
     * @returns {void}
     */
    #add(registry, type, listener) {
        if (typeof listener !== 'function') return
        if (!registry.has(type)) registry.set(type, new Set())
        registry.get(type).add(listener)
    }

    /**
     * Removes one listener from an event registry.
     * @param {Map<string, Set<Function>>} registry Event registry.
     * @param {string} type Event type.
     * @param {Function} listener Event listener.
     * @returns {void}
     */
    #remove(registry, type, listener) {
        registry.get(type)?.delete(listener)
    }

    /**
     * Emits one plain worker-like event.
     * @param {Map<string, Set<Function>>} registry Event registry.
     * @param {string} type Event type.
     * @param {unknown} data Event data.
     * @returns {void}
     */
    #emit(registry, type, data) {
        if (this.#terminated) return
        for (const listener of registry.get(type) || []) {
            listener({ data })
        }
    }

    /**
     * Posts one protocol response through a clone boundary to the client.
     * @param {unknown} message Protocol response.
     * @param {Transferable[]} transfer Transfer list.
     * @returns {void}
     */
    #postToClient(message, transfer) {
        if (this.#terminated) return
        const cloned = structuredClone(message, { transfer })
        queueMicrotask(() =>
            this.#emit(this.#clientListeners, 'message', cloned)
        )
    }

    /**
     * Emits one worker error event to the client.
     * @param {unknown} error Worker failure.
     * @returns {void}
     */
    #reportError(error) {
        if (this.#terminated) return
        queueMicrotask(() => {
            for (const listener of this.#clientListeners.get('error') || []) {
                listener({ error, message: String(error?.message || error) })
            }
        })
    }
}

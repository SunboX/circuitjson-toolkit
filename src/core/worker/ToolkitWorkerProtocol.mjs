import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { RuntimeProxyBoundary } from '../contracts/RuntimeProxyBoundary.mjs'
import { WorkerRequestData } from './WorkerRequestData.mjs'

export const TOOLKIT_WORKER_PROTOCOL = 'ecad-toolkit.worker.v1'

const OPERATIONS = new Set(['parse', 'loadProject'])
const MESSAGE_EVENT_DATA_GETTER =
    typeof MessageEvent === 'function'
        ? Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data')?.get
        : null

/**
 * Installs and validates the shared clone-safe toolkit worker protocol.
 */
export class ToolkitWorkerProtocol {
    /**
     * Installs request, progress, result, error, and cancellation dispatch.
     * @param {unknown} scope Worker-like message scope.
     * @param {unknown} handlers Operation handlers.
     * @returns {{ dispose: () => void }} Installation controller.
     */
    static install(scope, handlers) {
        const addEventListener = ToolkitWorkerProtocol.#method(
            scope,
            'addEventListener'
        )
        const removeEventListener = ToolkitWorkerProtocol.#method(
            scope,
            'removeEventListener'
        )
        const postMessage = ToolkitWorkerProtocol.#method(scope, 'postMessage')
        const reportError = ToolkitWorkerProtocol.#method(scope, 'reportError')
        if (!addEventListener || !postMessage) {
            throw new TypeError(
                'Toolkit worker scope must expose message event and post methods.'
            )
        }
        const normalizedHandlers = ToolkitWorkerProtocol.#handlers(handlers)
        const controllers = new Map()
        let disposed = false

        /**
         * Posts one response and any worker-owned transferable buffers.
         * @param {unknown} message Outgoing message.
         * @param {Transferable[]} [transfer] Transfer list.
         * @returns {void}
         */
        const post = (message, transfer = []) => {
            postMessage(message, transfer)
        }
        /** @param {{ data?: unknown }} event Worker message event. @returns {void} */
        const onMessage = (event) => {
            if (disposed) return
            ToolkitWorkerProtocol.#dispatch(
                ToolkitWorkerProtocol.#eventData(event),
                normalizedHandlers,
                controllers,
                post
            ).catch((error) => {
                if (reportError) {
                    reportError(error)
                    return
                }
                queueMicrotask(() => {
                    throw error
                })
            })
        }
        addEventListener('message', onMessage)

        return Object.freeze({
            /** Stops dispatch and aborts active protocol operations. */
            dispose() {
                if (disposed) return
                disposed = true
                if (removeEventListener) {
                    removeEventListener('message', onMessage)
                }
                for (const controller of controllers.values()) {
                    controller.abort()
                }
                controllers.clear()
            }
        })
    }

    /**
     * Dispatches one data-only protocol message.
     * @param {unknown} candidate Incoming message candidate.
     * @param {Record<string, Function>} handlers Normalized handlers.
     * @param {Map<string, AbortController>} controllers Active controllers.
     * @param {(message: object, transfer?: Transferable[]) => void} post Outgoing post function.
     * @returns {Promise<void>} Dispatch completion.
     */
    static async #dispatch(candidate, handlers, controllers, post) {
        let message
        let requestId = ''
        try {
            message = ToolkitWorkerProtocol.#record(candidate, 'Worker message')
            requestId = ToolkitWorkerProtocol.#requestId(message.requestId)
            if (message.protocol !== TOOLKIT_WORKER_PROTOCOL) {
                throw ToolkitWorkerProtocol.#messageError(
                    'Unknown toolkit worker protocol.',
                    requestId
                )
            }
            const type = message.type
            if (typeof type !== 'string') {
                throw ToolkitWorkerProtocol.#messageError(
                    'Toolkit worker message type is invalid.',
                    requestId
                )
            }
            if (type === 'cancel') {
                ToolkitWorkerProtocol.#keys(
                    message,
                    ['protocol', 'type', 'requestId'],
                    requestId
                )
                const controller = controllers.get(requestId)
                if (controller) {
                    controllers.delete(requestId)
                    controller.abort()
                }
                return
            }
            if (!OPERATIONS.has(type) || !handlers[type]) {
                throw ToolkitWorkerProtocol.#messageError(
                    'Unknown toolkit worker operation.',
                    requestId
                )
            }
            const valueField = type === 'parse' ? 'input' : 'entries'
            ToolkitWorkerProtocol.#keys(
                message,
                ['protocol', 'type', 'requestId', valueField, 'options'],
                requestId
            )
            if (!Object.hasOwn(message, valueField)) {
                throw ToolkitWorkerProtocol.#messageError(
                    'Toolkit worker request payload is missing.',
                    requestId
                )
            }
            if (controllers.has(requestId)) {
                throw ToolkitWorkerProtocol.#messageError(
                    'Toolkit worker request id is already active.',
                    requestId
                )
            }

            const payload = {
                [valueField]: message[valueField],
                options: Object.hasOwn(message, 'options')
                    ? message.options
                    : {}
            }
            WorkerRequestData.assertCloneSafe(payload)
            const controller = new AbortController()
            controllers.set(requestId, controller)
            try {
                const value = await handlers[type](payload, {
                    signal: controller.signal,
                    onProgress: (progress) => {
                        if (controller.signal.aborted) return
                        post({
                            protocol: TOOLKIT_WORKER_PROTOCOL,
                            type: 'progress',
                            requestId,
                            progress
                        })
                    }
                })
                if (controllers.get(requestId) !== controller) return
                const prepared = WorkerRequestData.prepareResult(value)
                post(
                    {
                        protocol: TOOLKIT_WORKER_PROTOCOL,
                        type: 'result',
                        requestId,
                        value: prepared.value
                    },
                    prepared.transfer
                )
            } catch (error) {
                if (controllers.get(requestId) !== controller) return
                ToolkitWorkerProtocol.#postError(post, requestId, error)
            } finally {
                if (controllers.get(requestId) === controller) {
                    controllers.delete(requestId)
                }
            }
        } catch (error) {
            ToolkitWorkerProtocol.#postError(post, requestId, error)
        }
    }

    /**
     * Posts only canonical ToolkitError fields.
     * @param {(message: object, transfer?: Transferable[]) => void} post Outgoing post function.
     * @param {string} requestId Request id.
     * @param {unknown} error Failure candidate.
     * @returns {void}
     */
    static #postError(post, requestId, error) {
        const trusted = ToolkitError.trustedRecord(error)
        const normalized =
            trusted ||
            new ToolkitError('Toolkit worker operation failed.', {
                code: 'ERR_WORKER_RUNTIME',
                category: 'runtime',
                cause: error
            }).toJSON()
        post({
            protocol: TOOLKIT_WORKER_PROTOCOL,
            type: 'error',
            requestId,
            error: normalized,
            diagnostics: []
        })
    }

    /**
     * Requires an exact canonical message field set.
     * @param {Record<string, any>} message Message fields.
     * @param {string[]} allowed Allowed names.
     * @param {string} requestId Request id.
     * @returns {void}
     */
    static #keys(message, allowed, requestId) {
        const keys = Object.keys(message)
        if (
            keys.length !== allowed.length ||
            allowed.some((key) => !Object.hasOwn(message, key))
        ) {
            throw ToolkitWorkerProtocol.#messageError(
                'Toolkit worker message fields are invalid.',
                requestId
            )
        }
    }

    /**
     * Reads a genuine MessageEvent or a plain data-only test record.
     * @param {unknown} event Message event candidate.
     * @returns {unknown} Event data or undefined.
     */
    static #eventData(event) {
        try {
            RuntimeProxyBoundary.assert(event, 'Worker message event')
        } catch {
            return undefined
        }
        if (!event || !['object', 'function'].includes(typeof event)) {
            return undefined
        }
        if (MESSAGE_EVENT_DATA_GETTER) {
            try {
                return Reflect.apply(MESSAGE_EVENT_DATA_GETTER, event, [])
            } catch {
                // Plain worker test records are handled below.
            }
        }
        let owner = event
        for (let depth = 0; owner && depth < 16; depth += 1) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(owner, 'data')
                owner = Object.getPrototypeOf(owner)
            } catch {
                return undefined
            }
            if (!descriptor) continue
            return Object.hasOwn(descriptor, 'value')
                ? descriptor.value
                : undefined
        }
        return undefined
    }

    /**
     * Normalizes supported operation handlers without invoking accessors.
     * @param {unknown} value Handler record.
     * @returns {Record<string, Function>} Bound operation handlers.
     */
    static #handlers(value) {
        const fields = ToolkitWorkerProtocol.#record(
            value,
            'Worker protocol handlers'
        )
        const handlers = Object.create(null)
        for (const operation of OPERATIONS) {
            if (fields[operation] === undefined) continue
            if (typeof fields[operation] !== 'function') {
                throw new TypeError(
                    `Toolkit worker ${operation} handler must be a function.`
                )
            }
            handlers[operation] = fields[operation]
        }
        return handlers
    }

    /**
     * Reads an accessor-free plain record.
     * @param {unknown} value Record candidate.
     * @param {string} label Human-readable label.
     * @returns {Record<string, any>} Null-prototype field map.
     */
    static #record(value, label) {
        try {
            RuntimeProxyBoundary.assert(value, label)
        } catch {
            throw ToolkitWorkerProtocol.#messageError(
                `${label} must not be a Proxy.`
            )
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw ToolkitWorkerProtocol.#messageError(
                `${label} must be a plain object.`
            )
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw ToolkitWorkerProtocol.#messageError(
                `${label} could not be inspected safely.`
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw ToolkitWorkerProtocol.#messageError(
                `${label} must be a plain object.`
            )
        }
        const result = Object.create(null)
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                descriptor.get ||
                descriptor.set ||
                descriptor.enumerable !== true
            ) {
                throw ToolkitWorkerProtocol.#messageError(
                    `${label} may contain only enumerable data properties.`
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Resolves one callable method without reading it through an accessor.
     * @param {unknown} target Method owner.
     * @param {string} name Method name.
     * @returns {Function | null} Invocation closure.
     */
    static #method(target, name) {
        if (!target || !['object', 'function'].includes(typeof target)) {
            return null
        }
        let owner = target
        for (let depth = 0; owner && depth < 16; depth += 1) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(owner, name)
                owner = Object.getPrototypeOf(owner)
            } catch {
                return null
            }
            if (!descriptor) continue
            if (descriptor.get || descriptor.set) return null
            if (typeof descriptor.value !== 'function') return null
            const method = descriptor.value
            return (...args) => Reflect.apply(method, target, args)
        }
        return null
    }

    /**
     * Normalizes a required bounded request id.
     * @param {unknown} value Id candidate.
     * @returns {string} Request id.
     */
    static #requestId(value) {
        if (typeof value !== 'string' || !value || value.length > 256) {
            throw ToolkitWorkerProtocol.#messageError(
                'Toolkit worker request id is invalid.'
            )
        }
        return value
    }

    /**
     * Creates a typed invalid-message failure.
     * @param {string} message Failure message.
     * @param {string} [requestId] Request id.
     * @returns {ToolkitError} Typed worker failure.
     */
    static #messageError(message, requestId = '') {
        return new ToolkitError(message, {
            code: 'ERR_WORKER_MESSAGE',
            category: 'validation',
            details: requestId ? { requestId } : {}
        })
    }
}

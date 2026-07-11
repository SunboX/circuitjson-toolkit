import { ToolkitError } from '../contracts/ToolkitError.mjs'
import { RuntimeProxyBoundary } from '../contracts/RuntimeProxyBoundary.mjs'
import { TOOLKIT_WORKER_PROTOCOL } from './ToolkitWorkerProtocol.mjs'
import { WorkerRequestData } from './WorkerRequestData.mjs'
import { WorkerResponseData } from './WorkerResponseData.mjs'

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    'aborted'
)?.get
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener
const ERROR_EVENT_ERROR_GETTER =
    typeof ErrorEvent === 'function'
        ? Object.getOwnPropertyDescriptor(ErrorEvent.prototype, 'error')?.get
        : null
const MESSAGE_EVENT_DATA_GETTER =
    typeof MessageEvent === 'function'
        ? Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data')?.get
        : null
const MAX_PENDING_REQUESTS = 1024
const MAX_PROJECT_ENTRIES = 4096
const ATTEMPT_ERRORS = new WeakMap()

/**
 * Owns one lazily-created worker speaking the common toolkit protocol.
 */
export class ParserWorkerClient {
    static #defaultClient = null

    #activeRequestId = null
    #createWorker
    #disposed = false
    #nextRequestId = 1
    #onError = null
    #onMessage = null
    #onMessageError = null
    #pending = new Map()
    #postMessage = null
    #queueHead = null
    #queueTail = null
    #queued = new Map()
    #removeEventListener = null
    #terminateWorker = null
    #worker = null

    /**
     * Creates one client with an injected browser-compatible worker factory.
     * @param {{ createWorker: Function }} options Construction options.
     */
    constructor(options) {
        const fields = ParserWorkerClient.#record(
            options,
            'Parser worker client options'
        )
        if (typeof fields.createWorker !== 'function') {
            throw new TypeError(
                'Parser worker client createWorker must be a function.'
            )
        }
        this.#createWorker = fields.createWorker
    }

    /**
     * Returns true when the host exposes a browser Worker constructor.
     * @returns {boolean} Whether the default client can create a worker.
     */
    static isDefaultAvailable() {
        try {
            return typeof globalThis.Worker === 'function'
        } catch {
            return false
        }
    }

    /**
     * Returns the process-local default client, creating it lazily.
     * @returns {ParserWorkerClient} Default worker client.
     */
    static defaultClient() {
        return ParserWorkerClient.#defaultClientFor(null)
    }

    /**
     * Returns the process-local default client for one internal attempt.
     * @param {object | null} attemptToken Internal attempt identity.
     * @returns {ParserWorkerClient} Default worker client.
     */
    static #defaultClientFor(attemptToken) {
        if (!ParserWorkerClient.isDefaultAvailable()) {
            throw ParserWorkerClient.#unavailableError(attemptToken)
        }
        if (!ParserWorkerClient.#defaultClient) {
            ParserWorkerClient.#defaultClient = new ParserWorkerClient({
                createWorker: () => {
                    const WorkerConstructor = globalThis.Worker
                    return Reflect.construct(WorkerConstructor, [
                        new URL(
                            '../../workers/parser.worker.mjs',
                            import.meta.url
                        ),
                        { type: 'module' }
                    ])
                }
            })
        }
        return ParserWorkerClient.#defaultClient
    }

    /**
     * Disposes the process-local default worker client when one exists.
     * @returns {void}
     */
    static disposeDefault() {
        ParserWorkerClient.#defaultClient?.dispose()
        ParserWorkerClient.#defaultClient = null
    }

    /**
     * Runs one parser request as a request-scoped default-worker attempt.
     * @param {unknown} input Parser input.
     * @param {unknown} [options] Parser options.
     * @returns {Promise<{ ok: true, value: object } | { ok: false, error: unknown, unavailable: boolean }>} Attempt result.
     */
    static async parseDefault(input, options = {}) {
        return await ParserWorkerClient.#defaultAttempt('parse', input, options)
    }

    /**
     * Runs one project request as a request-scoped default-worker attempt.
     * @param {unknown} entries Project entries.
     * @param {unknown} [options] Project options.
     * @returns {Promise<{ ok: true, value: object } | { ok: false, error: unknown, unavailable: boolean }>} Attempt result.
     */
    static async loadProjectDefault(entries, options = {}) {
        return await ParserWorkerClient.#defaultAttempt(
            'loadProject',
            entries,
            options
        )
    }

    /**
     * Parses one source input in the owned worker.
     * @param {unknown} input Parser input.
     * @param {unknown} [options] Parser options.
     * @returns {Promise<object>} Canonical document result.
     */
    async parse(input, options = {}) {
        const prepared = ParserWorkerClient.#parsePayload(input, options)
        return await this.#request('parse', prepared)
    }

    /** Runs one parser request as an instance-scoped worker attempt. */
    async parseAttempt(input, options = {}) {
        return await this.#attempt('parse', input, options)
    }

    /**
     * Loads one project entry list in the owned worker.
     * @param {unknown} entries Project entries.
     * @param {unknown} [options] Project options.
     * @returns {Promise<object>} Canonical project result.
     */
    async loadProject(entries, options = {}) {
        const prepared = ParserWorkerClient.#projectPayload(entries, options)
        return await this.#request('loadProject', prepared)
    }

    /** Runs one project request as an instance-scoped worker attempt. */
    async loadProjectAttempt(entries, options = {}) {
        return await this.#attempt('loadProject', entries, options)
    }

    /**
     * Cancels one active request and immediately replaces its owned worker.
     * @param {unknown} requestId Request id.
     * @returns {boolean} Whether an active request was cancelled.
     */
    cancel(requestId) {
        const id = typeof requestId === 'string' ? requestId : ''
        if (!this.#pending.has(id)) return false
        const error = ParserWorkerClient.#cancelledError(id)
        if (this.#activeRequestId === id) {
            try {
                this.#postMessage?.({
                    protocol: TOOLKIT_WORKER_PROTOCOL,
                    type: 'cancel',
                    requestId: id
                })
            } catch {
                // Worker termination below is authoritative.
            }
            this.#settle(id, 'reject', error, false)
            this.#resetWorker()
            this.#drain()
            return true
        }
        this.#settle(id, 'reject', error)
        return true
    }

    /**
     * Terminates the worker and permanently rejects future work.
     * @returns {void}
     */
    dispose() {
        if (this.#disposed) return
        this.#disposed = true
        const error = ParserWorkerClient.#disposedError()
        for (const requestId of [...this.#pending.keys()]) {
            this.#settle(requestId, 'reject', error, false)
        }
        this.#queueHead = null
        this.#queueTail = null
        this.#queued.clear()
        this.#resetWorker()
    }

    /**
     * Posts one prepared operation and observes progress/cancellation.
     * @param {'parse' | 'loadProject'} operation Worker operation.
     * @param {{ payload: object, transfer: Transferable[], signal: AbortSignal | null, onProgress: Function | null }} prepared Prepared request.
     * @param {object | null} attemptToken Request-scoped attempt identity.
     * @returns {Promise<object>} Worker result.
     */
    async #request(operation, prepared, attemptToken = null) {
        if (this.#disposed) throw ParserWorkerClient.#disposedError()
        if (prepared.signal && ParserWorkerClient.#isAborted(prepared.signal)) {
            throw ParserWorkerClient.#cancelledError('')
        }
        if (this.#pending.size >= MAX_PENDING_REQUESTS) {
            throw ParserWorkerClient.#queueError()
        }
        const requestId = `worker-${this.#nextRequestId}`
        this.#nextRequestId += 1

        return await new Promise((resolve, reject) => {
            const pending = {
                operation,
                prepared,
                resolve,
                reject,
                signal: prepared.signal,
                onAbort: null,
                onProgress: prepared.onProgress,
                previousProgress: null,
                attemptToken
            }
            if (prepared.signal) {
                pending.onAbort = () => this.cancel(requestId)
                ADD_EVENT_LISTENER.call(
                    prepared.signal,
                    'abort',
                    pending.onAbort,
                    { once: true }
                )
            }
            this.#pending.set(requestId, pending)
            this.#enqueue(requestId)
            this.#drain()
        })
    }

    /**
     * Posts the next queued request so worker termination stays request-scoped.
     * @returns {void}
     */
    #drain() {
        if (this.#disposed || this.#activeRequestId) return
        let requestId = this.#dequeue()
        let pending = requestId ? this.#pending.get(requestId) || null : null
        while (requestId && !pending) {
            requestId = this.#dequeue()
            pending = requestId ? this.#pending.get(requestId) || null : null
        }
        if (!pending) return
        if (pending.signal && ParserWorkerClient.#isAborted(pending.signal)) {
            this.#settle(
                requestId,
                'reject',
                ParserWorkerClient.#cancelledError(requestId)
            )
            return
        }
        this.#activeRequestId = requestId
        let phase = 'construct'
        try {
            this.#ensureWorker()
            phase = 'post'
            this.#postMessage(
                {
                    protocol: TOOLKIT_WORKER_PROTOCOL,
                    type: pending.operation,
                    requestId,
                    ...pending.prepared.payload
                },
                pending.prepared.transfer
            )
            if (
                pending.signal &&
                ParserWorkerClient.#isAborted(pending.signal)
            ) {
                this.cancel(requestId)
            }
        } catch (error) {
            const requestError = ParserWorkerClient.#requestError(error, phase)
            if (phase === 'construct' && pending.attemptToken) {
                ATTEMPT_ERRORS.set(requestError, pending.attemptToken)
            }
            this.#settle(requestId, 'reject', requestError, false)
            this.#resetWorker()
            this.#drain()
        }
    }

    /**
     * Creates and binds the worker on first use.
     * @returns {void}
     */
    #ensureWorker() {
        if (this.#worker) return
        let worker
        try {
            worker = Reflect.apply(this.#createWorker, undefined, [])
        } catch (error) {
            throw ParserWorkerClient.#runtimeError(error)
        }
        RuntimeProxyBoundary.assert(worker, 'Parser worker')
        const addEventListener = ParserWorkerClient.#method(
            worker,
            'addEventListener'
        )
        const removeEventListener = ParserWorkerClient.#method(
            worker,
            'removeEventListener'
        )
        const postMessage = ParserWorkerClient.#method(worker, 'postMessage')
        const terminate = ParserWorkerClient.#method(worker, 'terminate')
        if (!addEventListener || !postMessage || !terminate) {
            throw new TypeError(
                'Parser worker must expose message event, post, and terminate methods.'
            )
        }
        this.#worker = worker
        this.#postMessage = postMessage
        this.#removeEventListener = removeEventListener
        this.#terminateWorker = terminate
        this.#onMessage = (event) => this.#handleMessage(event)
        this.#onError = (event) =>
            this.#failActive(
                ParserWorkerClient.#runtimeError(
                    ParserWorkerClient.#eventField(
                        event,
                        'error',
                        ERROR_EVENT_ERROR_GETTER
                    )
                )
            )
        this.#onMessageError = () =>
            this.#failActive(
                ParserWorkerClient.#protocolError(
                    'Toolkit worker message could not be cloned.'
                )
            )
        addEventListener('message', this.#onMessage)
        addEventListener('error', this.#onError)
        addEventListener('messageerror', this.#onMessageError)
    }

    /**
     * Routes one worker response to its pending request.
     * @param {{ data?: unknown }} event Worker message event.
     * @returns {void}
     */
    #handleMessage(event) {
        let message
        try {
            message = WorkerResponseData.message(
                ParserWorkerClient.#eventField(
                    event,
                    'data',
                    MESSAGE_EVENT_DATA_GETTER
                )
            )
            if (message.requestId !== this.#activeRequestId) {
                return
            }
            if (message.type === 'progress') {
                this.#progress(message.requestId, message.progress)
                return
            }
            if (message.type === 'result') {
                const pending = this.#pending.get(message.requestId)
                const value = WorkerResponseData.result(
                    pending?.operation,
                    message.value
                )
                this.#settle(message.requestId, 'resolve', value)
                return
            }
            if (message.type === 'error') {
                this.#settle(
                    message.requestId,
                    'reject',
                    WorkerResponseData.remoteError(
                        message.error,
                        message.diagnostics
                    )
                )
                return
            }
        } catch (error) {
            this.#failActive(
                ToolkitError.trustedRecord(error)
                    ? error
                    : ParserWorkerClient.#protocolError(
                          'Toolkit worker response is invalid.',
                          error
                      )
            )
        }
    }

    /**
     * Validates and emits one ordered worker progress row.
     * @param {string} requestId Request id.
     * @param {unknown} candidate Progress candidate.
     * @returns {void}
     */
    #progress(requestId, candidate) {
        const pending = this.#pending.get(requestId)
        if (!pending) return
        try {
            const row = WorkerResponseData.progress(
                candidate,
                pending.previousProgress
            )
            pending.previousProgress = row
            pending.onProgress?.(row)
        } catch (error) {
            this.#failActive(error)
        }
    }

    /**
     * Settles and removes one pending request.
     * @param {string} requestId Request id.
     * @param {'resolve' | 'reject'} action Settlement action.
     * @param {unknown} value Settlement value.
     * @param {boolean} [drain] Whether to continue queued work.
     * @returns {void}
     */
    #settle(requestId, action, value, drain = true) {
        const pending = this.#pending.get(requestId)
        if (!pending) return
        this.#pending.delete(requestId)
        this.#removeQueued(requestId)
        if (this.#activeRequestId === requestId) {
            this.#activeRequestId = null
        }
        ParserWorkerClient.#removeAbortListener(pending)
        pending[action](value)
        if (drain) this.#drain()
    }

    /**
     * Appends one request id to the constant-time pending queue.
     * @param {string} requestId Request id.
     * @returns {void}
     */
    #enqueue(requestId) {
        const node = { requestId, previous: this.#queueTail, next: null }
        if (this.#queueTail) this.#queueTail.next = node
        else this.#queueHead = node
        this.#queueTail = node
        this.#queued.set(requestId, node)
    }

    /**
     * Removes and returns the next queued request id.
     * @returns {string | null} Next request id.
     */
    #dequeue() {
        const node = this.#queueHead
        if (!node) return null
        this.#unlinkQueued(node)
        return node.requestId
    }

    /**
     * Removes one cancelled request from the pending queue in constant time.
     * @param {string} requestId Request id.
     * @returns {void}
     */
    #removeQueued(requestId) {
        const node = this.#queued.get(requestId)
        if (node) this.#unlinkQueued(node)
    }

    /**
     * Unlinks one known queue node.
     * @param {{ requestId: string, previous: object | null, next: object | null }} node Queue node.
     * @returns {void}
     */
    #unlinkQueued(node) {
        if (node.previous) node.previous.next = node.next
        else this.#queueHead = node.next
        if (node.next) node.next.previous = node.previous
        else this.#queueTail = node.previous
        this.#queued.delete(node.requestId)
        node.previous = null
        node.next = null
    }

    /**
     * Rejects the active request, replaces the failed worker, and continues.
     * @param {unknown} error Active request failure.
     * @returns {void}
     */
    #failActive(error) {
        const requestId = this.#activeRequestId
        if (requestId) {
            this.#settle(requestId, 'reject', error, false)
        }
        this.#resetWorker()
        this.#drain()
    }

    /**
     * Detaches listeners and terminates only the current worker instance.
     * @returns {void}
     */
    #resetWorker() {
        if (this.#worker && this.#removeEventListener) {
            this.#removeEventListener('message', this.#onMessage)
            this.#removeEventListener('error', this.#onError)
            this.#removeEventListener('messageerror', this.#onMessageError)
        }
        try {
            this.#terminateWorker?.()
        } catch {
            // The worker is discarded even if a host terminate hook fails.
        }
        this.#worker = null
        this.#postMessage = null
        this.#removeEventListener = null
        this.#terminateWorker = null
        this.#onMessage = null
        this.#onError = null
        this.#onMessageError = null
    }

    /**
     * Builds a parse payload and exact transfer list.
     * @param {unknown} input Parser input.
     * @param {unknown} options Parser options.
     * @returns {{ payload: object, transfer: Transferable[], signal: AbortSignal | null, onProgress: Function | null }} Prepared payload.
     */
    static #parsePayload(input, options) {
        const fields = ParserWorkerClient.#record(input, 'Worker parser input')
        if (!Object.hasOwn(fields, 'data')) {
            throw new TypeError('Worker parser input requires data.')
        }
        const request = ParserWorkerClient.#selectFields(fields, [
            'fileName',
            'data',
            'assets'
        ])
        const preparedOptions = ParserWorkerClient.#options(options)
        const prepared = WorkerRequestData.prepare(
            { input: request, options: preparedOptions.posted },
            { transferInput: preparedOptions.transferInput }
        )
        return {
            payload: prepared.value,
            transfer: prepared.transfer,
            signal: preparedOptions.signal,
            onProgress: preparedOptions.onProgress
        }
    }

    /**
     * Builds a project payload and exact transfer list.
     * @param {unknown} entries Project entries.
     * @param {unknown} options Project options.
     * @returns {{ payload: object, transfer: Transferable[], signal: AbortSignal | null, onProgress: Function | null }} Prepared payload.
     */
    static #projectPayload(entries, options) {
        const values = ParserWorkerClient.#array(
            entries,
            'Worker project entries',
            MAX_PROJECT_ENTRIES
        )
        const preparedOptions = ParserWorkerClient.#options(options)
        const preparedEntries = values.map((entry) => {
            const fields = ParserWorkerClient.#record(
                entry,
                'Worker project entry'
            )
            if (!Object.hasOwn(fields, 'data')) {
                throw new TypeError('Worker project entry requires data.')
            }
            return ParserWorkerClient.#selectFields(fields, [
                'name',
                'data',
                'assets',
                'compressedByteLength',
                'archiveDepth'
            ])
        })
        const prepared = WorkerRequestData.prepare(
            {
                entries: preparedEntries,
                options: preparedOptions.posted
            },
            { transferInput: preparedOptions.transferInput }
        )
        return {
            payload: prepared.value,
            transfer: prepared.transfer,
            signal: preparedOptions.signal,
            onProgress: preparedOptions.onProgress
        }
    }

    /**
     * Selects only fields consumed by the direct parser/project contract.
     * @param {Record<string, any>} fields Input fields.
     * @param {string[]} names Canonical field names.
     * @returns {Record<string, any>} Selected data record.
     */
    static #selectFields(fields, names) {
        const selected = {}
        for (const name of names) {
            if (Object.hasOwn(fields, name)) selected[name] = fields[name]
        }
        return selected
    }

    /**
     * Separates runtime-only options from posted data.
     * @param {unknown} options Options candidate.
     * @returns {{ posted: object, signal: AbortSignal | null, onProgress: Function | null, transferInput: boolean }} Prepared options.
     */
    static #options(options) {
        const fields = ParserWorkerClient.#record(
            options,
            'Worker request options'
        )
        const signal = ParserWorkerClient.#signal(fields.signal)
        const onProgress =
            fields.onProgress === undefined ? null : fields.onProgress
        if (onProgress !== null && typeof onProgress !== 'function') {
            throw new TypeError('Worker onProgress must be a function.')
        }
        if (fields.retainSource === 'reference') {
            throw new ToolkitError(
                'Worker requests cannot retain caller source references.',
                {
                    code: 'ERR_CAPABILITY_UNAVAILABLE',
                    category: 'unsupported',
                    details: { capability: 'parser.retainSource.reference' }
                }
            )
        }
        const posted = { ...fields }
        delete posted.signal
        delete posted.onProgress
        delete posted.worker
        delete posted.transferInput
        return {
            posted,
            signal,
            onProgress,
            transferInput: fields.transferInput === true
        }
    }

    /**
     * Executes one exact default-client attempt and consumes only its own
     * construction-failure authorization.
     * @param {'parse' | 'loadProject'} operation Worker operation.
     * @param {unknown} input Operation input.
     * @param {unknown} options Operation options.
     * @returns {Promise<{ ok: true, value: object } | { ok: false, error: unknown, unavailable: boolean }>} Attempt result.
     */
    static async #defaultAttempt(operation, input, options) {
        const token = {}
        try {
            const client = ParserWorkerClient.#defaultClientFor(token)
            return await client.#attempt(operation, input, options, token)
        } catch (error) {
            return ParserWorkerClient.#attemptFailure(error, token)
        }
    }

    /**
     * Executes one exact request and consumes only its own authorization.
     * @param {'parse' | 'loadProject'} operation Worker operation.
     * @param {unknown} input Operation input.
     * @param {unknown} options Operation options.
     * @param {object} [token] Request-scoped attempt identity.
     * @returns {Promise<{ ok: true, value: object } | { ok: false, error: unknown, unavailable: boolean }>} Attempt result.
     */
    async #attempt(operation, input, options, token = {}) {
        try {
            const prepared =
                operation === 'parse'
                    ? ParserWorkerClient.#parsePayload(input, options)
                    : ParserWorkerClient.#projectPayload(input, options)
            const value = await this.#request(operation, prepared, token)
            return { ok: true, value }
        } catch (error) {
            return ParserWorkerClient.#attemptFailure(error, token)
        }
    }

    /** @param {unknown} error Failure. @param {object} token Attempt identity. @returns {{ ok: false, error: unknown, unavailable: boolean }} Attempt failure. */
    static #attemptFailure(error, token) {
        const unavailable =
            Boolean(error && typeof error === 'object') &&
            ATTEMPT_ERRORS.get(error) === token
        if (unavailable) ATTEMPT_ERRORS.delete(error)
        return { ok: false, error, unavailable }
    }

    /**
     * Validates one genuine optional AbortSignal.
     * @param {unknown} value Signal candidate.
     * @returns {AbortSignal | null} Signal or null.
     */
    static #signal(value) {
        if (value === undefined || value === null) return null
        try {
            ABORTED_GETTER.call(value)
            return value
        } catch {
            throw new TypeError('Worker signal must be an AbortSignal.')
        }
    }

    /** @param {AbortSignal} signal Signal. @returns {boolean} Aborted state. */
    static #isAborted(signal) {
        return Boolean(ABORTED_GETTER.call(signal))
    }

    /**
     * Removes a captured signal listener.
     * @param {{ signal: AbortSignal | null, onAbort: Function | null }} pending Pending row.
     * @returns {void}
     */
    static #removeAbortListener(pending) {
        if (!pending.signal || !pending.onAbort) return
        REMOVE_EVENT_LISTENER.call(pending.signal, 'abort', pending.onAbort)
    }

    /**
     * Reads one dense plain array through data descriptors.
     * @param {unknown} value Array candidate.
     * @param {string} label Human-readable label.
     * @param {number} maximum Maximum length.
     * @returns {any[]} Item values.
     */
    static #array(value, label, maximum) {
        RuntimeProxyBoundary.assert(value, label)
        if (!Array.isArray(value)) {
            throw new TypeError(`${label} must be an array.`)
        }
        let prototype
        let keys
        try {
            prototype = Object.getPrototypeOf(value)
            keys = Reflect.ownKeys(value)
        } catch {
            throw new TypeError(`${label} could not be inspected safely.`)
        }
        const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > maximum ||
            keys.length !== length + 1
        ) {
            throw new TypeError(`${label} must be a bounded dense plain array.`)
        }
        const result = new Array(length)
        for (let index = 0; index < length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(
                value,
                String(index)
            )
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(`${label} must contain data properties.`)
            }
            result[index] = descriptor.value
        }
        return result
    }

    /**
     * Reads one accessor-free plain record.
     * @param {unknown} value Record candidate.
     * @param {string} label Human-readable label.
     * @returns {Record<string, any>} Null-prototype field map.
     */
    static #record(value, label) {
        RuntimeProxyBoundary.assert(value, label)
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(`${label} must be a plain object.`)
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw new TypeError(`${label} could not be inspected safely.`)
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${label} must be a plain object.`)
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
                throw new TypeError(
                    `${label} may contain only enumerable data properties.`
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Resolves one callable method without reading callable properties.
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
     * Reads a genuine platform event getter or an inherited data property.
     * @param {unknown} event Event candidate.
     * @param {string} name Field name.
     * @param {Function | null} intrinsicGetter Captured platform getter.
     * @returns {unknown} Safely read field or undefined.
     */
    static #eventField(event, name, intrinsicGetter) {
        RuntimeProxyBoundary.assert(event, 'Parser worker event')
        if (!event || !['object', 'function'].includes(typeof event)) {
            return undefined
        }
        if (intrinsicGetter) {
            try {
                return Reflect.apply(intrinsicGetter, event, [])
            } catch {
                // Plain test/event records are handled by descriptors below.
            }
        }
        let owner = event
        for (let depth = 0; owner && depth < 16; depth += 1) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(owner, name)
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

    /** @returns {ToolkitError} Disposed-client failure. */
    static #disposedError() {
        return new ToolkitError('Parser worker client is disposed.', {
            code: 'ERR_WORKER_DISPOSED',
            category: 'runtime'
        })
    }

    /** @returns {ToolkitError} Bounded-queue failure. */
    static #queueError() {
        return new ToolkitError('Parser worker request queue is full.', {
            code: 'ERR_WORKER_QUEUE_LIMIT',
            category: 'validation',
            details: { maximum: MAX_PENDING_REQUESTS }
        })
    }

    /** @param {string} requestId Request id. @returns {ToolkitError} Error. */
    static #cancelledError(requestId) {
        return new ToolkitError('Toolkit worker request was cancelled.', {
            code: 'ERR_CANCELLED',
            category: 'cancelled',
            details: requestId ? { requestId } : {}
        })
    }

    /**
     * Creates an invalid-request error.
     * @param {unknown} cause Failure cause.
     * @param {'construct' | 'post'} phase Failed request phase.
     * @returns {ToolkitError} Typed error.
     */
    static #requestError(cause, phase) {
        const error = new ToolkitError(
            'Toolkit worker request could not be posted.',
            {
                code: 'ERR_WORKER_REQUEST',
                category: 'validation',
                details: { phase },
                cause
            }
        )
        return error
    }

    /**
     * Creates one one-shot default-worker availability authorization.
     * @param {object | null} attemptToken Internal attempt identity.
     * @returns {ToolkitError} Typed unavailable error.
     */
    static #unavailableError(attemptToken) {
        const error = new ToolkitError(
            'Toolkit parser workers are not available in this host.',
            {
                code: 'ERR_CAPABILITY_UNAVAILABLE',
                category: 'unsupported',
                details: { capability: 'parser.worker' }
            }
        )
        if (attemptToken) {
            ATTEMPT_ERRORS.set(error, attemptToken)
        }
        return error
    }

    /**
     * Creates a worker runtime error.
     * @param {unknown} cause Failure cause.
     * @returns {ToolkitError} Typed error.
     */
    static #runtimeError(cause) {
        return new ToolkitError('Toolkit parser worker failed.', {
            code: 'ERR_WORKER_RUNTIME',
            category: 'runtime',
            cause
        })
    }

    /**
     * Creates a malformed-protocol error.
     * @param {string} message Failure message.
     * @param {unknown} [cause] Failure cause.
     * @returns {ToolkitError} Typed error.
     */
    static #protocolError(message, cause = null) {
        return new ToolkitError(message, {
            code: 'ERR_WORKER_MESSAGE',
            category: 'runtime',
            cause
        })
    }
}

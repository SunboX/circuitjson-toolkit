import { TOOLKIT_WORKER_PROTOCOL } from './ToolkitWorkerProtocol.mjs'

const REFLECT_APPLY = Reflect.apply
const REFLECT_CONSTRUCT = Reflect.construct
const REFLECT_OWN_KEYS = Reflect.ownKeys
const GET_PROTOTYPE = Object.getPrototypeOf
const GET_DESCRIPTORS = Object.getOwnPropertyDescriptors
const HAS_OWN = Object.hasOwn
const OBJECT_PROTOTYPE = Object.prototype
const WEAK_MAP_GET = WeakMap.prototype.get
const WEAK_MAP_SET = WeakMap.prototype.set
const WEAK_MAP_DELETE = WeakMap.prototype.delete
const WORKER_CONSTRUCTOR = globalThis.Worker
const WORKER_POST = WORKER_CONSTRUCTOR?.prototype?.postMessage
const WORKER_TERMINATE = WORKER_CONSTRUCTOR?.prototype?.terminate
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener
const MESSAGE_DATA = Object.getOwnPropertyDescriptor(
    MessageEvent.prototype,
    'data'
)?.get
const EVENT_CURRENT_TARGET = Object.getOwnPropertyDescriptor(
    Event.prototype,
    'currentTarget'
)?.get
const EVENT_TRUSTED =
    Object.getOwnPropertyDescriptor(new Event('message'), 'isTrusted')?.get ||
    Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted')?.get
const ERROR_DATA =
    typeof ErrorEvent === 'function'
        ? Object.getOwnPropertyDescriptor(ErrorEvent.prototype, 'error')?.get
        : null
const RECEIVED_RESULTS = new WeakMap()

/**
 * Keeps native workers and their unexposed structured-clone results private.
 * A custom factory cannot mint the one-use result capabilities created here.
 */
export class NativeParserWorkerTransport {
    #worker
    #listeners = new Map()
    #nativeListeners = new Map()

    /**
     * Constructs an isolated transport using the captured native constructor.
     * @param {string | URL} url Worker module URL.
     */
    constructor(url) {
        this.#worker = NativeParserWorkerTransport.#createModuleWorker(
            WORKER_CONSTRUCTOR,
            url
        )
        for (const type of ['message', 'error', 'messageerror']) {
            const listener = (event) => this.#receive(type, event)
            this.#nativeListeners.set(type, listener)
            REFLECT_APPLY(ADD_EVENT_LISTENER, this.#worker, [type, listener])
        }
    }

    /**
     * Uses private native transport only while the captured host is unchanged.
     * Replaced or emulated Worker constructors retain generic validation.
     * @param {string | URL} url Worker module URL.
     * @returns {object} Browser-compatible worker transport.
     */
    static create(url) {
        const Constructor = globalThis.Worker
        if (
            Constructor !== WORKER_CONSTRUCTOR ||
            typeof WORKER_POST !== 'function' ||
            typeof WORKER_TERMINATE !== 'function' ||
            !MESSAGE_DATA ||
            !EVENT_CURRENT_TARGET ||
            !EVENT_TRUSTED
        ) {
            return NativeParserWorkerTransport.#createModuleWorker(
                Constructor,
                url
            )
        }
        return new NativeParserWorkerTransport(url)
    }

    /**
     * Detects hosts that silently ignore WorkerOptions.type before their
     * classic script can execute module imports. Construction failures let
     * the parser's request-scoped auto mode fall back without losing input.
     * Replaced constructors keep the existing injected-worker contract.
     * @param {Function} Constructor Browser worker constructor.
     * @param {string | URL} url Worker module URL.
     * @returns {Worker} Worker with module options consumed by the native host.
     */
    static #createModuleWorker(Constructor, url) {
        let typeRead = false
        const worker = REFLECT_CONSTRUCT(Constructor, [
            url,
            {
                /** @returns {string} Requested worker script type. */
                get type() {
                    typeRead = true
                    return 'module'
                }
            }
        ])
        if (Constructor === WORKER_CONSTRUCTOR && !typeRead) {
            REFLECT_APPLY(WORKER_TERMINATE, worker, [])
            throw new TypeError('This browser does not support module workers.')
        }
        return worker
    }

    /**
     * Consumes an opaque result exactly once. The returned data has never been
     * exposed outside this transport; exposing it here destroys its capability.
     * @param {unknown} token Result candidate.
     * @returns {{ value: unknown } | null} Privately received data, if proven.
     */
    static consumeResult(token) {
        const received = REFLECT_APPLY(WEAK_MAP_GET, RECEIVED_RESULTS, [token])
        if (!received) return null
        REFLECT_APPLY(WEAK_MAP_DELETE, RECEIVED_RESULTS, [token])
        return received
    }

    /** @param {string} type Event type. @param {Function} listener Listener. @returns {void} */
    addEventListener(type, listener) {
        if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
        this.#listeners.get(type).add(listener)
    }

    /** @param {string} type Event type. @param {Function} listener Listener. @returns {void} */
    removeEventListener(type, listener) {
        this.#listeners.get(type)?.delete(listener)
    }

    /** @param {unknown} message Request. @param {Transferable[]} [transfer] Transfer list. @returns {void} */
    postMessage(message, transfer = []) {
        REFLECT_APPLY(WORKER_POST, this.#worker, [message, transfer])
    }

    /** Detaches native listeners and terminates the private worker. @returns {void} */
    terminate() {
        for (const [type, listener] of this.#nativeListeners) {
            REFLECT_APPLY(REMOVE_EVENT_LISTENER, this.#worker, [type, listener])
        }
        this.#nativeListeners.clear()
        this.#listeners.clear()
        REFLECT_APPLY(WORKER_TERMINATE, this.#worker, [])
    }

    /**
     * Hides the native target and result graph before invoking any consumer.
     * Synthetic events and invalid envelopes never receive a capability.
     * @param {string} type Event type.
     * @param {Event} event Native event.
     * @returns {void}
     */
    #receive(type, event) {
        let forwarded = {}
        if (type === 'message') {
            const data = REFLECT_APPLY(MESSAGE_DATA, event, [])
            forwarded = { data }
            if (
                REFLECT_APPLY(EVENT_TRUSTED, event, []) === true &&
                REFLECT_APPLY(EVENT_CURRENT_TARGET, event, []) === this.#worker
            ) {
                try {
                    const message =
                        NativeParserWorkerTransport.#resultMessage(data)
                    if (message) {
                        const token = Object.freeze(Object.create(null))
                        REFLECT_APPLY(WEAK_MAP_SET, RECEIVED_RESULTS, [
                            token,
                            { value: message.value }
                        ])
                        message.value = token
                        forwarded = { data: message }
                    }
                } catch {
                    // The ordinary client boundary reports malformed envelopes.
                }
            }
        } else if (type === 'error') {
            let error = null
            if (ERROR_DATA) {
                try {
                    error = REFLECT_APPLY(ERROR_DATA, event, [])
                } catch {
                    // Some worker failures dispatch Event rather than ErrorEvent.
                }
            }
            forwarded = {
                error
            }
        }
        for (const listener of this.#listeners.get(type) || []) {
            REFLECT_APPLY(listener, undefined, [forwarded])
        }
    }

    /**
     * Captures only exact native result headers without calling replaceable
     * exported helpers that could introduce caller-owned values into the graph.
     * @param {unknown} data Privately received native event data.
     * @returns {object | null} Result envelope safe to hide behind a capability.
     */
    static #resultMessage(data) {
        if (!data || typeof data !== 'object') return null
        const prototype = GET_PROTOTYPE(data)
        if (prototype !== OBJECT_PROTOTYPE && prototype !== null) return null
        const descriptors = GET_DESCRIPTORS(data)
        if (REFLECT_OWN_KEYS(descriptors).length !== 4) return null
        for (const key of ['protocol', 'type', 'requestId', 'value']) {
            const descriptor = descriptors[key]
            if (
                !descriptor ||
                !HAS_OWN(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                return null
            }
        }
        const protocol = descriptors.protocol.value
        const type = descriptors.type.value
        const requestId = descriptors.requestId.value
        if (
            protocol !== TOOLKIT_WORKER_PROTOCOL ||
            type !== 'result' ||
            typeof requestId !== 'string' ||
            !requestId ||
            requestId.length > 256
        ) {
            return null
        }
        return { protocol, type, requestId, value: descriptors.value.value }
    }
}

Object.freeze(NativeParserWorkerTransport.prototype)
Object.freeze(NativeParserWorkerTransport)

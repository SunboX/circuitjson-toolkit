import assert from 'node:assert/strict'
import test from 'node:test'

import { Parser } from '../src/core/Parser.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { ParserWorkerClient } from '../src/core/worker/ParserWorkerClient.mjs'
import {
    TOOLKIT_WORKER_PROTOCOL,
    ToolkitWorkerProtocol
} from '../src/core/worker/ToolkitWorkerProtocol.mjs'
import { WorkerRequestData } from '../src/core/worker/WorkerRequestData.mjs'

/**
 * Provides one structured-clone loopback around the browser Worker contract.
 */
class FakeToolkitWorker {
    #clientListeners = new Map()
    #serverListeners = new Map()
    #terminated = false

    /**
     * Creates and installs one protocol server.
     * @param {Record<string, Function>} handlers Worker operation handlers.
     */
    constructor(handlers) {
        this.failServerPosts = false
        this.requests = []
        this.serverRequests = []
        this.terminateCalls = 0
        this.transferLists = []
        this.serverScope = {
            addEventListener: (type, listener) =>
                this.#add(this.#serverListeners, type, listener),
            removeEventListener: (type, listener) =>
                this.#remove(this.#serverListeners, type, listener),
            postMessage: (message, transfer = []) => {
                if (this.failServerPosts) {
                    throw new Error('server post failed')
                }
                return this.#send(this.#clientListeners, message, transfer)
            },
            reportError: (error) => this.emitClientError({ error })
        }
        ToolkitWorkerProtocol.install(this.serverScope, handlers)
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    addEventListener(type, listener) {
        this.#add(this.#clientListeners, type, listener)
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    removeEventListener(type, listener) {
        this.#remove(this.#clientListeners, type, listener)
    }

    /**
     * Sends one client message to the installed protocol server.
     * @param {object} message Protocol message.
     * @param {Transferable[]} [transfer] Explicit transfer list.
     */
    postMessage(message, transfer = []) {
        this.requests.push(message)
        this.transferLists.push([...transfer])
        this.serverRequests.push(
            this.#send(this.#serverListeners, message, transfer)
        )
    }

    /** @param {unknown} message Uncloned adversarial server message. */
    postUncloned(message) {
        for (const listener of this.#serverListeners.get('message') || []) {
            listener({ data: message })
        }
    }

    /** @param {object} message Client-bound protocol message. */
    emitClientMessage(message) {
        this.#send(this.#clientListeners, message, [])
    }

    /** @param {object} event Client-bound worker error event. */
    emitClientError(event) {
        queueMicrotask(() => {
            if (this.#terminated) return
            for (const listener of this.#clientListeners.get('error') || []) {
                listener(event)
            }
        })
    }

    /** Terminates delivery in both directions. */
    terminate() {
        this.terminateCalls += 1
        this.#terminated = true
        this.#clientListeners.clear()
        this.#serverListeners.clear()
    }

    /**
     * Registers one listener.
     * @param {Map<string, Set<Function>>} listeners Listener registry.
     * @param {string} type Event type.
     * @param {Function} listener Listener.
     */
    #add(listeners, type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type).add(listener)
    }

    /**
     * Removes one listener.
     * @param {Map<string, Set<Function>>} listeners Listener registry.
     * @param {string} type Event type.
     * @param {Function} listener Listener.
     */
    #remove(listeners, type, listener) {
        listeners.get(type)?.delete(listener)
    }

    /**
     * Delivers a platform-cloned message on the next microtask.
     * @param {Map<string, Set<Function>>} listeners Listener registry.
     * @param {object} message Message value.
     * @param {Transferable[]} transfer Transfer list.
     * @returns {object} Delivered structured clone.
     */
    #send(listeners, message, transfer) {
        const cloned = structuredClone(message, { transfer })
        queueMicrotask(() => {
            if (this.#terminated) return
            for (const listener of listeners.get('message') || []) {
                listener({ data: cloned })
            }
        })
        return cloned
    }
}

/**
 * Creates the real direct handlers installed by the parser worker entrypoint.
 * @param {Record<string, Function>} [overrides] Handler overrides.
 * @returns {Record<string, Function>} Worker handlers.
 */
function createHandlers(overrides = {}) {
    return {
        parse: async (payload, runtime) =>
            await Parser.parseAsync(payload.input, {
                ...payload.options,
                worker: false,
                signal: runtime.signal,
                onProgress: runtime.onProgress
            }),
        loadProject: async (payload, runtime) =>
            await ProjectLoader.loadAsync(payload.entries, {
                ...payload.options,
                worker: false,
                signal: runtime.signal,
                onProgress: runtime.onProgress
            }),
        ...overrides
    }
}

test('worker client matches direct parse without detaching input by default', async () => {
    const workers = []
    const client = new ParserWorkerClient({
        createWorker: () => {
            const worker = new FakeToolkitWorker(createHandlers())
            workers.push(worker)
            return worker
        }
    })
    const bytes = new TextEncoder().encode('[]')
    const direct = Parser.parse({ fileName: 'board.json', data: bytes })
    const progress = []
    const worker = await client.parse(
        { fileName: 'board.json', data: bytes },
        { transferInput: false, onProgress: (row) => progress.push(row) }
    )

    assert.deepEqual(worker, direct)
    assert.equal(bytes.byteLength, 2)
    assert.equal(
        CircuitJsonDocumentContext.prepare(worker).statistics.validationPasses,
        0
    )
    assert.deepEqual(
        progress.map((row) => row.stage),
        ['detect', 'decode', 'validate', 'complete']
    )
    assert.equal(workers.length, 1)
    assert.equal(workers[0].requests[0].type, 'parse')
    assert.equal(Object.hasOwn(workers[0].requests[0], 'payload'), false)
    assert.equal(
        Object.hasOwn(workers[0].requests[0].options, 'onProgress'),
        false
    )
    assert.equal(Object.hasOwn(workers[0].requests[0].options, 'signal'), false)
    client.dispose()
})

test('transfer ownership is explicit and partial views copy exact bytes', async () => {
    const workers = []
    const client = new ParserWorkerClient({
        createWorker: () => {
            const worker = new FakeToolkitWorker(createHandlers())
            workers.push(worker)
            return worker
        }
    })
    const owned = new TextEncoder().encode('[]')
    await client.parse(
        { fileName: 'owned.json', data: owned },
        { transferInput: true }
    )
    assert.equal(owned.byteLength, 0)

    const backing = new Uint8Array([88, 91, 93, 89])
    const exactView = backing.subarray(1, 3)
    const parsed = await client.parse(
        { fileName: 'view.json', data: exactView },
        { transferInput: true }
    )
    assert.deepEqual(parsed.model, [])
    assert.equal(backing.byteLength, 4)
    assert.deepEqual([...backing], [88, 91, 93, 89])
    assert.equal(workers[0].serverRequests[1].input.data.buffer.byteLength, 2)

    const hiddenBacking = new Uint8Array([83, 91, 93, 84])
    await client.parse({
        fileName: 'isolated.json',
        data: hiddenBacking.subarray(1, 3)
    })
    assert.equal(workers[0].serverRequests[2].input.data.buffer.byteLength, 2)

    if (typeof SharedArrayBuffer === 'function') {
        const shared = new Uint8Array(new SharedArrayBuffer(2))
        shared.set([91, 93])
        const sharedResult = await client.parse(
            { fileName: 'shared.json', data: shared },
            { transferInput: true }
        )
        assert.deepEqual(sharedResult.model, [])
        assert.equal(shared.byteLength, 2)
    }

    const repeated = new TextEncoder().encode('[]')
    const repeatedProject = await client.loadProject(
        [
            { name: 'one.json', data: repeated.buffer },
            { name: 'two.json', data: repeated.buffer }
        ],
        { transferInput: true }
    )
    assert.equal(repeatedProject.documents.length, 2)
    assert.equal(repeated.byteLength, 0)
    client.dispose()
})

test('worker client loads projects and reconstructs clone-safe errors', async () => {
    const client = new ParserWorkerClient({
        createWorker: () => new FakeToolkitWorker(createHandlers())
    })
    const project = await client.loadProject([
        { name: 'b.json', data: '[]' },
        { name: 'a.json', data: '[]' }
    ])
    assert.equal(project.schema, 'ecad-toolkit.project.v1')
    assert.deepEqual(
        project.documents.map((document) => document.source.fileName),
        ['a.json', 'b.json']
    )

    await assert.rejects(
        () => client.parse({ fileName: 'bad.json', data: '{' }),
        {
            name: 'ToolkitError',
            code: 'ERR_CIRCUITJSON_PARSE',
            category: 'parse',
            format: 'circuitjson',
            source: 'bad.json'
        }
    )
    client.dispose()
})

test('cancellation terminates the owned worker and the next request replaces it', async () => {
    const workers = []
    const client = new ParserWorkerClient({
        createWorker: () => {
            const worker = new FakeToolkitWorker(
                createHandlers({
                    parse: async (payload, runtime) => {
                        if (payload.input.fileName !== 'pending.json') {
                            return await Parser.parseAsync(payload.input, {
                                ...payload.options,
                                worker: false,
                                signal: runtime.signal,
                                onProgress: runtime.onProgress
                            })
                        }
                        return await new Promise(() => {})
                    }
                })
            )
            workers.push(worker)
            return worker
        }
    })
    const controller = new AbortController()
    let shadowReads = 0
    Object.defineProperty(controller.signal, 'aborted', {
        configurable: true,
        value: false
    })
    Object.defineProperty(controller.signal, 'addEventListener', {
        configurable: true,
        get() {
            shadowReads += 1
            return () => {}
        }
    })
    Object.defineProperty(controller.signal, 'removeEventListener', {
        configurable: true,
        get() {
            shadowReads += 1
            return () => {}
        }
    })
    const pending = client.parse(
        { fileName: 'pending.json', data: '[]' },
        { signal: controller.signal }
    )
    await new Promise((resolve) => setImmediate(resolve))
    const requestId = workers[0].requests[0].requestId
    assert.equal(client.cancel('missing'), false)
    controller.abort()
    await assert.rejects(
        () =>
            Promise.race([
                pending,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 100)
                )
            ]),
        { name: 'ToolkitError', code: 'ERR_CANCELLED' }
    )
    assert.equal(workers[0].terminateCalls, 1)
    assert.equal(shadowReads, 0)
    assert.equal(client.cancel(requestId), false)

    const recovered = await client.parse({
        fileName: 'recovered.json',
        data: '[]'
    })
    assert.deepEqual(recovered.model, [])
    assert.equal(workers.length, 2)
    client.dispose()
})

test('callback failures retain identity and terminate progress delivery', async () => {
    const workers = []
    const client = new ParserWorkerClient({
        createWorker: () => {
            const worker = new FakeToolkitWorker(createHandlers())
            workers.push(worker)
            return worker
        }
    })
    const sentinel = new Error('host progress failed')
    await assert.rejects(
        () =>
            client.parse(
                { fileName: 'progress.json', data: '[]' },
                {
                    onProgress: () => {
                        throw sentinel
                    }
                }
            ),
        (error) => error === sentinel
    )
    assert.equal(workers[0].terminateCalls, 1)
    client.dispose()
})

test('protocol rejects unknown messages with a serialized ToolkitError', async () => {
    const worker = new FakeToolkitWorker(createHandlers())
    const received = new Promise((resolve) => {
        worker.addEventListener('message', (event) => resolve(event.data))
    })
    worker.postUncloned({
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'private-message',
        requestId: 'unknown-1'
    })
    const message = await received

    assert.equal(message.protocol, TOOLKIT_WORKER_PROTOCOL)
    assert.equal(message.type, 'error')
    assert.equal(message.requestId, 'unknown-1')
    assert.deepEqual(Object.keys(message.error), [
        'name',
        'message',
        'code',
        'category',
        'format',
        'source',
        'location',
        'details',
        'cause'
    ])
    assert.equal(message.error.code, 'ERR_WORKER_MESSAGE')
    assert.deepEqual(message.diagnostics, [])

    let coercions = 0
    const hostileReceived = new Promise((resolve) => {
        worker.addEventListener('message', (event) => {
            if (event.data.requestId === 'unknown-2') resolve(event.data)
        })
    })
    worker.postUncloned({
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: {
            toString() {
                coercions += 1
                return 'parse'
            }
        },
        requestId: 'unknown-2'
    })
    const hostileMessage = await hostileReceived
    assert.equal(hostileMessage.error.code, 'ERR_WORKER_MESSAGE')
    assert.equal(coercions, 0)
    worker.terminate()
})

test('protocol cancellation aborts its handler and suppresses late results', async () => {
    let handlerSignal = null
    const worker = new FakeToolkitWorker({
        parse: async (_payload, runtime) => {
            handlerSignal = runtime.signal
            await new Promise((resolve) =>
                runtime.signal.addEventListener('abort', resolve, {
                    once: true
                })
            )
            return { late: true }
        }
    })
    const received = []
    worker.addEventListener('message', (event) => received.push(event.data))
    worker.postMessage({
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'parse',
        requestId: 'cancel-1',
        input: { fileName: 'pending.json', data: '[]' },
        options: {}
    })
    await new Promise((resolve) => setImmediate(resolve))
    worker.postMessage({
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'cancel',
        requestId: 'cancel-1'
    })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(handlerSignal.aborted, true)
    assert.deepEqual(received, [])
    worker.terminate()
})

test('nested binary views preserve exact ranges and explicit transfer ownership', async () => {
    const workers = []
    const client = new ParserWorkerClient({
        createWorker: () => {
            const worker = new FakeToolkitWorker(
                createHandlers({
                    parse: async (payload) => {
                        const source = payload.input.assets[0].source
                        return DocumentResult.create({
                            fileName: payload.input.fileName,
                            format: 'circuitjson',
                            model: [],
                            statistics: {
                                dataView: {
                                    backing: source.dataView.buffer.byteLength,
                                    length: source.dataView.byteLength
                                },
                                uint16: {
                                    backing: source.uint16.buffer.byteLength,
                                    length: source.uint16.length
                                },
                                shared: {
                                    backing: source.shared.buffer.byteLength,
                                    length: source.shared.byteLength,
                                    isShared:
                                        typeof SharedArrayBuffer ===
                                            'function' &&
                                        source.shared.buffer instanceof
                                            SharedArrayBuffer
                                }
                            }
                        })
                    }
                })
            )
            workers.push(worker)
            return worker
        }
    })
    const dataViewBacking = new ArrayBuffer(12)
    const uint16Backing = new ArrayBuffer(16)
    const source = {
        dataView: new DataView(dataViewBacking, 4, 4),
        uint16: new Uint16Array(uint16Backing, 4, 2)
    }
    if (typeof SharedArrayBuffer === 'function') {
        source.shared = new Uint8Array(new SharedArrayBuffer(10), 3, 3)
    } else {
        source.shared = new Uint8Array(new ArrayBuffer(10), 3, 3)
    }

    const result = await client.parse(
        {
            fileName: 'nested-binary.json',
            data: '[]',
            assets: [{ name: 'payload', source }]
        },
        { transferInput: true }
    )

    assert.deepEqual(result.statistics.dataView, { backing: 4, length: 4 })
    assert.deepEqual(result.statistics.uint16, { backing: 4, length: 2 })
    assert.deepEqual(result.statistics.shared, {
        backing: 3,
        length: 3,
        isShared: false
    })
    assert.equal(dataViewBacking.byteLength, 12)
    assert.equal(uint16Backing.byteLength, 16)
    assert.equal(workers[0].transferLists[0].length, 3)
    client.dispose()
})

test('cancelling one concurrent request preserves queued work', async () => {
    const workers = []
    const client = new ParserWorkerClient({
        createWorker: () => {
            const worker = new FakeToolkitWorker(
                createHandlers({
                    parse: async (payload, runtime) => {
                        if (payload.input.fileName === 'first.json') {
                            await new Promise((resolve) =>
                                runtime.signal.addEventListener(
                                    'abort',
                                    resolve,
                                    { once: true }
                                )
                            )
                        }
                        return await Parser.parseAsync(payload.input, {
                            ...payload.options,
                            worker: false,
                            signal: runtime.signal
                        })
                    }
                })
            )
            workers.push(worker)
            return worker
        }
    })
    const first = client.parse({ fileName: 'first.json', data: '[]' })
    const second = client.parse({ fileName: 'second.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))
    const firstId = workers[0].requests[0].requestId

    assert.equal(client.cancel(firstId), true)
    await assert.rejects(() => first, { code: 'ERR_CANCELLED' })
    assert.deepEqual((await second).model, [])
    assert.equal(workers.length, 2)
    client.dispose()
})

test('server post failures and hostile error events promptly settle requests', async () => {
    const failingClient = new ParserWorkerClient({
        createWorker: () => {
            const worker = new FakeToolkitWorker(createHandlers())
            worker.failServerPosts = true
            return worker
        }
    })
    await assert.rejects(
        () =>
            Promise.race([
                failingClient.parse({ fileName: 'post.json', data: '[]' }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 100)
                )
            ]),
        { code: 'ERR_WORKER_RUNTIME' }
    )
    failingClient.dispose()

    let worker
    const hostileClient = new ParserWorkerClient({
        createWorker: () => {
            worker = new FakeToolkitWorker(
                createHandlers({
                    parse: async () => await new Promise(() => {})
                })
            )
            return worker
        }
    })
    let errorReads = 0
    const pending = hostileClient.parse({
        fileName: 'hostile-error.json',
        data: '[]'
    })
    await new Promise((resolve) => setImmediate(resolve))
    const event = {}
    Object.defineProperty(event, 'error', {
        enumerable: true,
        get() {
            errorReads += 1
            throw new Error('must not execute')
        }
    })
    worker.emitClientError(event)
    await assert.rejects(
        () =>
            Promise.race([
                pending,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 100)
                )
            ]),
        { code: 'ERR_WORKER_RUNTIME' }
    )
    assert.equal(errorReads, 0)
    hostileClient.dispose()
})

test('project worker parity ignores fields the direct loader ignores', async () => {
    const client = new ParserWorkerClient({
        createWorker: () => new FakeToolkitWorker(createHandlers())
    })
    const entry = {
        name: 'ignored.json',
        data: '[]',
        ignored() {
            throw new Error('must not post')
        }
    }
    const direct = ProjectLoader.load([entry])
    const worker = await client.loadProject([entry])
    assert.deepEqual(worker, direct)
    client.dispose()
})

test('ProjectLoader rejects signal lookalikes without invoking accessors', async () => {
    let reads = 0
    const signal = {}
    Object.defineProperty(signal, 'aborted', {
        enumerable: true,
        get() {
            reads += 1
            return false
        }
    })
    await assert.rejects(
        () =>
            ProjectLoader.loadAsync([{ name: 'signal.json', data: '[]' }], {
                signal
            }),
        { code: 'ERR_PROJECT_INPUT' }
    )
    assert.equal(reads, 0)
})

test('remote ToolkitError messages require every canonical field and category', async () => {
    let worker
    const client = new ParserWorkerClient({
        createWorker: () => {
            worker = new FakeToolkitWorker(
                createHandlers({
                    parse: async () => await new Promise(() => {})
                })
            )
            return worker
        }
    })
    const pending = client.parse({ fileName: 'remote.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))
    const requestId = worker.requests[0].requestId
    worker.emitClientMessage({
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'error',
        requestId,
        error: {
            message: 'remote failure',
            code: 'ERR_REMOTE',
            category: 'invalid',
            format: 'circuitjson',
            source: '',
            location: null,
            details: {},
            cause: null
        },
        diagnostics: []
    })
    await assert.rejects(() => pending, { code: 'ERR_WORKER_MESSAGE' })
    client.dispose()
})

test('worker requests enforce aggregate binary byte limits', () => {
    assert.throws(
        () =>
            WorkerRequestData.assertCloneSafe({
                payload: new ArrayBuffer(100_000_001)
            }),
        TypeError
    )
})

test('Parser and ProjectLoader use the default worker client when available', async () => {
    const original = globalThis.Worker
    const workers = []
    globalThis.Worker = class extends FakeToolkitWorker {
        /** Creates one loopback default worker. */
        constructor() {
            super(createHandlers())
            workers.push(this)
        }
    }
    try {
        const bytes = new TextEncoder().encode('[]')
        const parsed = await Parser.parseAsync(
            { fileName: 'default.json', data: bytes },
            { worker: true }
        )
        const project = await ProjectLoader.loadAsync(
            [{ name: 'default.json', data: '[]' }],
            { worker: true }
        )
        const retainedInput = { fileName: 'retained.json', data: '[]' }
        const retained = await Parser.parseAsync(retainedInput, {
            worker: 'auto',
            retainSource: 'reference'
        })

        assert.deepEqual(parsed.model, [])
        assert.equal(project.schema, 'ecad-toolkit.project.v1')
        assert.equal(retained.sourceReference, retainedInput)
        assert.equal(workers.length, 1)
    } finally {
        ParserWorkerClient.disposeDefault()
        if (original === undefined) delete globalThis.Worker
        else globalThis.Worker = original
    }
})

test('client validates construction and rejects work after disposal', async () => {
    assert.throws(() => new ParserWorkerClient({}), { name: 'TypeError' })
    const client = new ParserWorkerClient({
        createWorker: () => new FakeToolkitWorker(createHandlers())
    })
    client.dispose()
    await assert.rejects(
        () => client.parse({ fileName: 'disposed.json', data: '[]' }),
        { name: 'ToolkitError', code: 'ERR_WORKER_DISPOSED' }
    )
})

test('nested request accessors are rejected without execution', async () => {
    const client = new ParserWorkerClient({
        createWorker: () => new FakeToolkitWorker(createHandlers())
    })
    let sourceReads = 0
    const source = {}
    Object.defineProperty(source, 'entryName', {
        enumerable: true,
        get() {
            sourceReads += 1
            return 'body.step'
        }
    })
    await assert.rejects(
        () =>
            client.parse({
                fileName: 'asset.json',
                data: '[]',
                assets: [{ name: 'body.step', data: null, source }]
            }),
        { name: 'TypeError' }
    )
    assert.equal(sourceReads, 0)

    let optionReads = 0
    const archiveLimits = {}
    Object.defineProperty(archiveLimits, 'maxEntries', {
        enumerable: true,
        get() {
            optionReads += 1
            return 1
        }
    })
    await assert.rejects(
        () =>
            client.loadProject([{ name: 'board.json', data: '[]' }], {
                archiveLimits
            }),
        { name: 'TypeError' }
    )
    assert.equal(optionReads, 0)
    client.dispose()
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { Parser } from '../src/core/Parser.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { ParserWorkerClient } from '../src/core/worker/ParserWorkerClient.mjs'
import {
    TOOLKIT_WORKER_PROTOCOL,
    ToolkitWorkerProtocol
} from '../src/core/worker/ToolkitWorkerProtocol.mjs'
import { WorkerRequestData } from '../src/core/worker/WorkerRequestData.mjs'
import { WorkerResponseData } from '../src/core/worker/WorkerResponseData.mjs'

/** Browser-compatible manually driven worker test double. */
class ManualWorker {
    #listeners = new Map()

    /** Creates empty request state. */
    constructor() {
        this.requests = []
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    addEventListener(type, listener) {
        if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
        this.#listeners.get(type).add(listener)
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    removeEventListener(type, listener) {
        this.#listeners.get(type)?.delete(listener)
    }

    /** @param {object} message Request message. @param {Transferable[]} transfer Transfer list. */
    postMessage(message, transfer = []) {
        this.requests.push(structuredClone(message, { transfer }))
    }

    /** @param {unknown} message Raw response data. */
    emitUncloned(message) {
        for (const listener of this.#listeners.get('message') || []) {
            listener({ data: message })
        }
    }

    /** Clears worker listeners. */
    terminate() {
        this.#listeners.clear()
    }
}

/**
 * Runs the real toolkit worker protocol across structured-clone boundaries.
 */
class ProtocolLoopbackWorker {
    #clientListeners = new Map()
    #serverListeners = new Map()

    /** Installs the parser worker entrypoint handlers. */
    constructor() {
        const scope = {
            addEventListener: (type, listener) =>
                this.#add(this.#serverListeners, type, listener),
            removeEventListener: (type, listener) =>
                this.#remove(this.#serverListeners, type, listener),
            postMessage: (message, transfer = []) =>
                this.#send(this.#clientListeners, message, transfer)
        }
        ToolkitWorkerProtocol.install(scope, {
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
                })
        })
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    addEventListener(type, listener) {
        this.#add(this.#clientListeners, type, listener)
    }

    /** @param {string} type Event type. @param {Function} listener Listener. */
    removeEventListener(type, listener) {
        this.#remove(this.#clientListeners, type, listener)
    }

    /** @param {object} message Request message. @param {Transferable[]} transfer Transfer list. */
    postMessage(message, transfer = []) {
        this.#send(this.#serverListeners, message, transfer)
    }

    /** Clears both protocol directions. */
    terminate() {
        this.#clientListeners.clear()
        this.#serverListeners.clear()
    }

    /**
     * Registers one listener.
     * @param {Map<string, Set<Function>>} listeners Listener map.
     * @param {string} type Event type.
     * @param {Function} listener Listener.
     * @returns {void}
     */
    #add(listeners, type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type).add(listener)
    }

    /**
     * Removes one listener.
     * @param {Map<string, Set<Function>>} listeners Listener map.
     * @param {string} type Event type.
     * @param {Function} listener Listener.
     * @returns {void}
     */
    #remove(listeners, type, listener) {
        listeners.get(type)?.delete(listener)
    }

    /**
     * Delivers one structured clone asynchronously.
     * @param {Map<string, Set<Function>>} listeners Listener map.
     * @param {object} message Message.
     * @param {Transferable[]} transfer Transfer list.
     * @returns {void}
     */
    #send(listeners, message, transfer) {
        const cloned = structuredClone(message, { transfer })
        queueMicrotask(() => {
            for (const listener of listeners.get('message') || []) {
                listener({ data: cloned })
            }
        })
    }
}

/**
 * Starts one pending manual worker operation.
 * @param {'parse' | 'loadProject'} operation Operation.
 * @returns {Promise<{ client: ParserWorkerClient, worker: ManualWorker, pending: Promise<object>, requestId: string }>} Active state.
 */
async function start(operation) {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const pending =
        operation === 'parse'
            ? client.parse({ fileName: 'manual.json', data: '[]' })
            : client.loadProject([{ name: 'manual.json', data: '[]' }])
    await new Promise((resolve) => setImmediate(resolve))
    return {
        client,
        worker,
        pending,
        requestId: worker.requests[0].requestId
    }
}

/** @param {string} requestId Request id. @param {unknown} value Result. @returns {object} Result response. */
function resultResponse(requestId, value) {
    return {
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'result',
        requestId,
        value
    }
}

/** @param {string} requestId Request id. @returns {object} Remote unavailable response. */
function unavailableResponse(requestId) {
    return {
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'error',
        requestId,
        error: {
            name: 'ToolkitError',
            message: 'Remote operation is unavailable.',
            code: 'ERR_CAPABILITY_UNAVAILABLE',
            category: 'unsupported',
            format: 'circuitjson',
            source: 'manual.json',
            location: null,
            details: { capability: 'remote.only' },
            cause: null
        },
        diagnostics: []
    }
}

/**
 * Creates a counting transparent proxy handler.
 * @param {{ calls: number }} counter Mutable counter.
 * @returns {ProxyHandler<object>} Handler.
 */
function countingHandler(counter) {
    return {
        get(target, key, receiver) {
            counter.calls += 1
            return Reflect.get(target, key, receiver)
        },
        getOwnPropertyDescriptor(target, key) {
            counter.calls += 1
            return Reflect.getOwnPropertyDescriptor(target, key)
        },
        getPrototypeOf(target) {
            counter.calls += 1
            return Reflect.getPrototypeOf(target)
        },
        ownKeys(target) {
            counter.calls += 1
            return Reflect.ownKeys(target)
        }
    }
}

test('automatic mode never hides a posted remote unavailable failure', async () => {
    const original = globalThis.Worker
    globalThis.Worker = class extends ManualWorker {
        /** Posts one canonical remote error after accepting the request. */
        postMessage(message, transfer = []) {
            super.postMessage(message, transfer)
            queueMicrotask(() =>
                this.emitUncloned(unavailableResponse(message.requestId))
            )
        }
    }
    ParserWorkerClient.disposeDefault()
    try {
        await assert.rejects(
            () =>
                Parser.parseAsync(
                    { fileName: 'auto.json', data: '[]' },
                    { worker: 'auto' }
                ),
            { code: 'ERR_CAPABILITY_UNAVAILABLE' }
        )
        await assert.rejects(
            () =>
                ProjectLoader.loadAsync([{ name: 'auto.json', data: '[]' }], {
                    worker: 'auto'
                }),
            { code: 'ERR_CAPABILITY_UNAVAILABLE' }
        )
    } finally {
        ParserWorkerClient.disposeDefault()
        if (original === undefined) delete globalThis.Worker
        else globalThis.Worker = original
    }
})

test('worker responses reject sparse models and malformed project relations', async (t) => {
    await t.test('sparse document model', async () => {
        const state = await start('parse')
        const document = structuredClone(
            Parser.parse({ fileName: 'manual.json', data: '[]' })
        )
        document.model = new Array(1)
        state.worker.emitUncloned(resultResponse(state.requestId, document))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })

    await t.test('dense invalid document model', async () => {
        const state = await start('parse')
        const document = structuredClone(
            Parser.parse({ fileName: 'manual.json', data: '[]' })
        )
        document.model = [7]
        state.worker.emitUncloned(resultResponse(state.requestId, document))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })

    await t.test('non-string project descriptor collections', async () => {
        const state = await start('loadProject')
        const project = structuredClone(
            ProjectLoader.load([{ name: 'manual.json', data: '[]' }])
        )
        project.project = {
            id: 'manual-project',
            name: '',
            format: 'circuitjson',
            documentIds: [7],
            relationships: [7]
        }
        state.worker.emitUncloned(resultResponse(state.requestId, project))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })
})

test('worker responses reject nested accessors without executing them', async () => {
    const state = await start('parse')
    const document = structuredClone(
        Parser.parse({ fileName: 'manual.json', data: '[]' })
    )
    let reads = 0
    const source = {}
    Object.defineProperty(source, 'entryName', {
        enumerable: true,
        get() {
            reads += 1
            return 'asset.bin'
        }
    })
    document.assets = [
        {
            id: 'asset-1',
            kind: 'source',
            name: 'asset.bin',
            mediaType: 'application/octet-stream',
            byteLength: 0,
            data: null,
            source
        }
    ]
    state.worker.emitUncloned(resultResponse(state.requestId, document))

    await assert.rejects(() => state.pending, {
        code: 'ERR_WORKER_MESSAGE'
    })
    assert.equal(reads, 0)
    state.client.dispose()
})

test('validated worker responses carry a reusable local proof', async () => {
    const state = await start('parse')
    state.worker.emitUncloned(
        resultResponse(
            state.requestId,
            structuredClone(
                Parser.parse({ fileName: 'manual.json', data: '[]' })
            )
        )
    )
    const document = await state.pending

    assert.equal(
        CircuitJsonDocumentContext.prepare(document).statistics
            .validationPasses,
        0
    )
    state.client.dispose()
})

test('worker and error boundaries reject proxies without invoking traps', async () => {
    const requestCounter = { calls: 0 }
    const request = new Proxy(
        { input: { fileName: 'proxy.json', data: '[]' }, options: {} },
        countingHandler(requestCounter)
    )
    assert.throws(() => WorkerRequestData.prepare(request), TypeError)
    assert.equal(requestCounter.calls, 0)

    const errorCounter = { calls: 0 }
    const error = new Proxy(
        { name: 'Error', message: 'proxy failure', code: 'ERR_PROXY' },
        countingHandler(errorCounter)
    )
    const normalized = ToolkitError.from(error)
    assert.equal(normalized.message, 'Toolkit operation failed.')
    assert.equal(errorCounter.calls, 0)

    const documentCounter = { calls: 0 }
    const proven = Parser.parse({ fileName: 'proven.json', data: '[]' })
    const wrapped = new Proxy(proven, countingHandler(documentCounter))
    assert.throws(() => WorkerRequestData.prepareResult(wrapped), TypeError)
    assert.equal(documentCounter.calls, 0)

    const workerCounter = { calls: 0 }
    const worker = new Proxy(new ManualWorker(), countingHandler(workerCounter))
    const client = new ParserWorkerClient({ createWorker: () => worker })
    await assert.rejects(
        () => client.parse({ fileName: 'worker-proxy.json', data: '[]' }),
        { code: 'ERR_WORKER_REQUEST' }
    )
    assert.equal(workerCounter.calls, 0)
    client.dispose()
})

test('project completion cancellation matches parser cancellation', async () => {
    const controller = new AbortController()
    await assert.rejects(
        () =>
            ProjectLoader.loadAsync([{ name: 'cancel.json', data: '[]' }], {
                signal: controller.signal,
                onProgress(progress) {
                    if (progress.stage === 'complete') controller.abort()
                }
            }),
        { code: 'ERR_CANCELLED' }
    )
})

test('real worker parser and project preserve full binary assets', async () => {
    const client = new ParserWorkerClient({
        createWorker: () => new ProtocolLoopbackWorker()
    })
    const parseBytes = new Uint8Array([1, 2, 3])
    const parsed = await client.parse(
        {
            fileName: 'asset.json',
            data: '[]',
            assets: [
                {
                    kind: 'model',
                    name: 'body.step',
                    mediaType: 'model/step',
                    data: parseBytes,
                    source: { entryName: 'body.step' }
                }
            ]
        },
        { decodeAssets: 'full' }
    )
    assert.deepEqual([...parsed.assets[0].data], [1, 2, 3])
    assert.equal(parseBytes.byteLength, 3)

    const projectBytes = new Uint8Array([4, 5, 6])
    const companionBytes = new Uint8Array([7, 8, 9])
    const project = await client.loadProject(
        [
            {
                name: 'asset.json',
                data: '[]',
                assets: [
                    {
                        kind: 'model',
                        name: 'nested.step',
                        data: projectBytes,
                        source: { entryName: 'nested.step' }
                    }
                ]
            },
            { name: 'models/companion.step', data: companionBytes }
        ],
        { decodeAssets: 'full' }
    )
    assert.deepEqual([...project.documents[0].assets[0].data], [4, 5, 6])
    assert.deepEqual([...project.assets[0].data], [7, 8, 9])
    assert.equal(projectBytes.byteLength, 3)
    assert.equal(companionBytes.byteLength, 3)
    client.dispose()
})

test('worker protocol rejects incoming proxies without invoking traps', async () => {
    const listeners = new Set()
    const posts = []
    let handlerCalls = 0
    const installation = ToolkitWorkerProtocol.install(
        {
            addEventListener(type, listener) {
                if (type === 'message') listeners.add(listener)
            },
            removeEventListener(type, listener) {
                if (type === 'message') listeners.delete(listener)
            },
            postMessage(message) {
                posts.push(message)
            }
        },
        {
            parse: async () => {
                handlerCalls += 1
                return Parser.parse({ fileName: 'proxy.json', data: '[]' })
            }
        }
    )
    const counter = { calls: 0 }
    const request = new Proxy(
        {
            protocol: TOOLKIT_WORKER_PROTOCOL,
            type: 'parse',
            requestId: 'proxy-request',
            input: { fileName: 'proxy.json', data: '[]' },
            options: {}
        },
        countingHandler(counter)
    )
    for (const listener of listeners) listener({ data: request })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(counter.calls, 0)
    assert.equal(handlerCalls, 0)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].type, 'error')
    assert.equal(posts[0].error.code, 'ERR_WORKER_MESSAGE')
    installation.dispose()
})

test('worker construction fallback authorization is one-shot', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'Worker'
    )
    Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: class {
            /** Simulates one unavailable construction attempt. */
            constructor() {
                throw new Error('worker construction blocked')
            }
        },
        writable: true
    })
    ParserWorkerClient.disposeDefault()
    try {
        let constructionError = null
        try {
            await Parser.parseAsync(
                { fileName: 'required.json', data: '[]' },
                { worker: true }
            )
        } catch (error) {
            constructionError = error
        }
        assert.equal(constructionError?.code, 'ERR_WORKER_REQUEST')

        class ProgressWorker extends ManualWorker {
            /** Emits one valid progress response after accepting work. */
            postMessage(message, transfer = []) {
                super.postMessage(message, transfer)
                queueMicrotask(() =>
                    this.emitUncloned({
                        protocol: TOOLKIT_WORKER_PROTOCOL,
                        type: 'progress',
                        requestId: message.requestId,
                        progress: {
                            stage: 'detect',
                            message: 'Detecting CircuitJSON input.'
                        }
                    })
                )
            }
        }
        globalThis.Worker = ProgressWorker
        let progressCalls = 0
        await assert.rejects(
            () =>
                Parser.parseAsync(
                    { fileName: 'replay.json', data: '[]' },
                    {
                        worker: 'auto',
                        onProgress() {
                            progressCalls += 1
                            if (progressCalls === 1) throw constructionError
                        }
                    }
                ),
            (error) => error === constructionError
        )
        assert.equal(progressCalls, 1)
    } finally {
        ParserWorkerClient.disposeDefault()
        if (originalDescriptor) {
            Object.defineProperty(globalThis, 'Worker', originalDescriptor)
        } else {
            delete globalThis.Worker
        }
    }
})

test('custom clients cannot authorize default automatic fallback', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'Worker'
    )
    const customClient = new ParserWorkerClient({
        createWorker() {
            throw new Error('custom worker construction blocked')
        }
    })
    let savedError = null
    try {
        await customClient.parse({ fileName: 'custom.json', data: '[]' })
    } catch (error) {
        savedError = error
    }
    assert.equal(savedError?.code, 'ERR_WORKER_REQUEST')

    class ProgressWorker extends ManualWorker {
        /** Emits one valid progress response after accepting work. */
        postMessage(message, transfer = []) {
            super.postMessage(message, transfer)
            queueMicrotask(() =>
                this.emitUncloned({
                    protocol: TOOLKIT_WORKER_PROTOCOL,
                    type: 'progress',
                    requestId: message.requestId,
                    progress: {
                        stage: 'detect',
                        message: 'Detecting CircuitJSON input.'
                    }
                })
            )
        }
    }

    ParserWorkerClient.disposeDefault()
    Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: ProgressWorker,
        writable: true
    })
    let progressCalls = 0
    try {
        await assert.rejects(
            () =>
                Parser.parseAsync(
                    { fileName: 'custom-replay.json', data: '[]' },
                    {
                        worker: 'auto',
                        onProgress() {
                            progressCalls += 1
                            if (progressCalls === 1) throw savedError
                        }
                    }
                ),
            (error) => error === savedError
        )
        assert.equal(progressCalls, 1)
    } finally {
        customClient.dispose()
        ParserWorkerClient.disposeDefault()
        if (originalDescriptor) {
            Object.defineProperty(globalThis, 'Worker', originalDescriptor)
        } else {
            delete globalThis.Worker
        }
    }
})

test('shared and resizable binary snapshots retain their accounted range', () => {
    if (
        typeof SharedArrayBuffer !== 'function' ||
        typeof SharedArrayBuffer.prototype.grow !== 'function' ||
        typeof ArrayBuffer.prototype.resize !== 'function'
    ) {
        return
    }

    const shared = new SharedArrayBuffer(1, { maxByteLength: 65_536 })
    new Uint8Array(shared)[0] = 17
    const OriginalUint8Array = globalThis.Uint8Array
    let intercepted = false
    globalThis.Uint8Array = class extends OriginalUint8Array {
        /** Grows the source if preparation re-reads its live full range. */
        constructor(...args) {
            if (args.length === 1 && args[0] === shared) {
                intercepted = true
                shared.grow(65_536)
            }
            super(...args)
        }
    }
    try {
        const snapshot = WorkerRequestData.prepareResponse(shared)
        assert.equal(snapshot.byteLength, 1)
        assert.equal(new OriginalUint8Array(snapshot)[0], 17)
        assert.equal(intercepted, false)
    } finally {
        globalThis.Uint8Array = OriginalUint8Array
    }

    const resizable = new ArrayBuffer(1, { maxByteLength: 65_536 })
    new Uint8Array(resizable)[0] = 23
    const prepared = WorkerRequestData.prepare(
        { data: resizable },
        { transferInput: true }
    )
    resizable.resize(65_536)
    assert.equal(prepared.value.data.byteLength, 1)
    assert.equal(new Uint8Array(prepared.value.data)[0], 23)
    assert.notEqual(prepared.value.data, resizable)
    assert.deepEqual(prepared.transfer, [prepared.value.data])

    const viewBuffer = new ArrayBuffer(2, { maxByteLength: 65_536 })
    const lengthTrackingView = new Uint8Array(viewBuffer)
    lengthTrackingView.set([31, 37])
    const preparedView = WorkerRequestData.prepare({ data: lengthTrackingView })
    viewBuffer.resize(65_536)
    assert.deepEqual([...preparedView.value.data], [31, 37])
    assert.equal(preparedView.value.data.buffer.byteLength, 2)
})

test('worker result envelopes require canonical schemas, sources, and asset lengths', () => {
    const valid = () =>
        structuredClone(
            Parser.parse(
                {
                    fileName: 'canonical.json',
                    data: '[]',
                    assets: [
                        {
                            name: 'payload.bin',
                            data: new Uint8Array([1, 2, 3])
                        }
                    ]
                },
                { decodeAssets: 'full' }
            )
        )

    for (const [field, value] of [
        ['name', 'other-model'],
        ['version', '9.9.9']
    ]) {
        const document = valid()
        document.modelSchema[field] = value
        assert.throws(() => WorkerResponseData.result('parse', document), {
            code: 'ERR_WORKER_MESSAGE'
        })
    }

    for (const field of ['format', 'fileName', 'fileType']) {
        const document = valid()
        document.source[field] = 7
        assert.throws(() => WorkerResponseData.result('parse', document), {
            code: 'ERR_WORKER_MESSAGE'
        })
    }

    const sourceNeutralDocument = valid()
    sourceNeutralDocument.source.format = 'gerber'
    sourceNeutralDocument.source.fileType = 'gerber'
    assert.equal(
        WorkerResponseData.result('parse', sourceNeutralDocument).source.format,
        'gerber'
    )

    const binaryLength = valid()
    binaryLength.assets[0].byteLength = 0
    assert.throws(() => WorkerResponseData.result('parse', binaryLength), {
        code: 'ERR_WORKER_MESSAGE'
    })

    const textLength = valid()
    textLength.assets[0].data = '🙂'
    textLength.assets[0].byteLength = 2
    assert.throws(() => WorkerResponseData.result('parse', textLength), {
        code: 'ERR_WORKER_MESSAGE'
    })

    const project = structuredClone(
        ProjectLoader.load([{ name: 'canonical.json', data: '[]' }])
    )
    project.source.entryNames = [7]
    assert.throws(() => WorkerResponseData.result('loadProject', project), {
        code: 'ERR_WORKER_MESSAGE'
    })

    const sourceNeutralProject = structuredClone(
        ProjectLoader.load([{ name: 'canonical.json', data: '[]' }])
    )
    sourceNeutralProject.source.format = 'kicad'
    sourceNeutralProject.documents[0].source.format = 'kicad'
    sourceNeutralProject.documents[0].source.fileType = 'kicad_pcb'
    assert.equal(
        WorkerResponseData.result('loadProject', sourceNeutralProject).source
            .format,
        'kicad'
    )
})
test('automatic mode handles a disappearing or hostile Worker global', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'Worker'
    )
    ParserWorkerClient.disposeDefault()
    try {
        let reads = 0
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            get() {
                reads += 1
                return reads === 1 ? class extends ManualWorker {} : undefined
            }
        })
        const parsed = await Parser.parseAsync(
            { fileName: 'disappeared.json', data: '[]' },
            { worker: 'auto' }
        )
        assert.equal(parsed.schema, 'ecad-toolkit.document.v1')
        assert.equal(reads >= 2, true)

        ParserWorkerClient.disposeDefault()
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            get() {
                throw new Error('hostile Worker getter')
            }
        })
        const project = await ProjectLoader.loadAsync(
            [{ name: 'hostile.json', data: '[]' }],
            { worker: 'auto' }
        )
        assert.equal(project.schema, 'ecad-toolkit.project.v1')
    } finally {
        ParserWorkerClient.disposeDefault()
        if (originalDescriptor) {
            Object.defineProperty(globalThis, 'Worker', originalDescriptor)
        } else {
            delete globalThis.Worker
        }
    }
})

test('worker responses reject cyclic and hidden nested fields', async (t) => {
    await t.test('cyclic document model', async () => {
        const state = await start('parse')
        const document = structuredClone(
            Parser.parse({
                fileName: 'cycle.json',
                data: '[{"type":"source_net","source_net_id":"n1","name":"N1","member_source_group_ids":[]}]'
            })
        )
        document.model[0].extra = document.model[0]
        state.worker.emitUncloned(resultResponse(state.requestId, document))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })

    await t.test('cyclic project relationship', async () => {
        const state = await start('loadProject')
        const project = structuredClone(
            ProjectLoader.load([{ name: 'cycle.json', data: '[]' }])
        )
        const relationship = { kind: 'related' }
        relationship.self = relationship
        project.project = {
            id: 'cycle-project',
            name: '',
            format: 'circuitjson',
            documentIds: [project.documents[0].id],
            relationships: [relationship]
        }
        state.worker.emitUncloned(resultResponse(state.requestId, project))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })

    await t.test('non-enumerable nested data', async () => {
        const state = await start('parse')
        const document = structuredClone(
            Parser.parse({ fileName: 'hidden.json', data: '[]' })
        )
        Object.defineProperty(document.source, 'hidden', {
            enumerable: false,
            value: 'must reject'
        })
        state.worker.emitUncloned(resultResponse(state.requestId, document))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })

    await t.test('non-enumerable nested accessor', async () => {
        const state = await start('parse')
        const document = structuredClone(
            Parser.parse({ fileName: 'hidden-accessor.json', data: '[]' })
        )
        let reads = 0
        Object.defineProperty(document.source, 'hidden', {
            enumerable: false,
            get() {
                reads += 1
                return 'must not read'
            }
        })
        state.worker.emitUncloned(resultResponse(state.requestId, document))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        assert.equal(reads, 0)
        state.client.dispose()
    })

    await t.test('nested response proxy', async () => {
        const state = await start('parse')
        const document = structuredClone(
            Parser.parse({ fileName: 'proxy-response.json', data: '[]' })
        )
        const counter = { calls: 0 }
        document.source = new Proxy(document.source, countingHandler(counter))
        state.worker.emitUncloned(resultResponse(state.requestId, document))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        assert.equal(counter.calls, 0)
        state.client.dispose()
    })

    await t.test('cyclic remote error details', async () => {
        const state = await start('parse')
        const details = {}
        details.self = details
        const response = unavailableResponse(state.requestId)
        response.error.details = details
        state.worker.emitUncloned(response)
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })
})

test('proven result models cannot bypass cycle or descriptor checks', () => {
    const cyclic = {
        type: 'source_net',
        source_net_id: 'cyclic-net',
        name: 'Cyclic net'
    }
    cyclic.extra = cyclic
    assert.throws(
        () =>
            WorkerRequestData.prepareResult(
                DocumentResult.createValidated({
                    fileName: 'cyclic-proof.json',
                    model: [cyclic]
                })
            ),
        TypeError
    )

    const hidden = {
        type: 'source_net',
        source_net_id: 'hidden-net',
        name: 'Hidden net'
    }
    Object.defineProperty(hidden, 'hidden', {
        enumerable: false,
        value: 'must reject'
    })
    assert.throws(
        () =>
            WorkerRequestData.prepareResult(
                DocumentResult.createValidated({
                    fileName: 'hidden-proof.json',
                    model: [hidden]
                })
            ),
        TypeError
    )

    assert.throws(
        () =>
            WorkerRequestData.prepareResult(
                DocumentResult.createValidated({
                    fileName: 'sparse-proof.json',
                    model: new Array(1)
                })
            ),
        TypeError
    )

    const arbitraryAssetGetter = DocumentResult.create({
        fileName: 'asset-getter.json',
        model: [],
        assets: [{ name: 'asset.bin', data: null }]
    })
    let reads = 0
    Object.defineProperty(arbitraryAssetGetter.assets[0], 'data', {
        configurable: true,
        enumerable: true,
        get() {
            reads += 1
            return new Uint8Array([1])
        }
    })
    assert.throws(
        () => WorkerRequestData.prepareResult(arbitraryAssetGetter),
        TypeError
    )
    assert.equal(reads, 0)
})

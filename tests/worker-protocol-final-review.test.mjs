import assert from 'node:assert/strict'
import test from 'node:test'

import { Parser } from '../src/core/Parser.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { ParserWorkerClient } from '../src/core/worker/ParserWorkerClient.mjs'
import {
    TOOLKIT_WORKER_PROTOCOL,
    ToolkitWorkerProtocol
} from '../src/core/worker/ToolkitWorkerProtocol.mjs'
import { WorkerRequestData } from '../src/core/worker/WorkerRequestData.mjs'

/**
 * Exposes a manually driven browser Worker-compatible response surface.
 */
class ManualWorker {
    #listeners = new Map()

    /** Creates an empty response queue. */
    constructor() {
        this.requests = []
        this.transferLists = []
        this.terminateCalls = 0
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
        this.transferLists.push([...transfer])
    }

    /** @param {object} message Clone-safe response message. */
    emit(message) {
        this.emitUncloned(structuredClone(message))
    }

    /** @param {unknown} message Raw adversarial response message. */
    emitUncloned(message) {
        for (const listener of this.#listeners.get('message') || []) {
            listener({ data: message })
        }
    }

    /** Terminates the manual worker. */
    terminate() {
        this.terminateCalls += 1
        this.#listeners.clear()
    }
}

/**
 * Starts one unresolved parse request against a manual worker.
 * @returns {Promise<{ client: ParserWorkerClient, worker: ManualWorker, pending: Promise<object>, requestId: string }>} Active request state.
 */
async function startManualParse() {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const pending = client.parse({ fileName: 'manual.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))
    return {
        client,
        worker,
        pending,
        requestId: worker.requests[0].requestId
    }
}

/**
 * Starts one unresolved project request against a manual worker.
 * @returns {Promise<{ client: ParserWorkerClient, worker: ManualWorker, pending: Promise<object>, requestId: string }>} Active request state.
 */
async function startManualProject() {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const pending = client.loadProject([{ name: 'manual.json', data: '[]' }])
    await new Promise((resolve) => setImmediate(resolve))
    return {
        client,
        worker,
        pending,
        requestId: worker.requests[0].requestId
    }
}

/** @returns {Record<string, any>} Valid canonical document result. */
function documentResult() {
    return Parser.parse({ fileName: 'manual.json', data: '[]' })
}

/** @param {string} requestId Request id. @param {unknown} value Result value. @returns {object} Result response. */
function resultResponse(requestId, value) {
    return {
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'result',
        requestId,
        value
    }
}

/** @param {string} requestId Request id. @param {object} overrides Error overrides. @returns {object} Error response. */
function errorResponse(requestId, overrides = {}) {
    return {
        protocol: TOOLKIT_WORKER_PROTOCOL,
        type: 'error',
        requestId,
        error: {
            name: 'ToolkitError',
            message: 'Remote failure.',
            code: 'ERR_REMOTE',
            category: 'runtime',
            format: 'circuitjson',
            source: 'manual.json',
            location: null,
            details: {},
            cause: null,
            ...overrides.error
        },
        diagnostics: overrides.diagnostics || [],
        ...overrides.message
    }
}

test('worker client rejects non-exact and noncanonical result responses', async (t) => {
    const cases = [
        {
            name: 'missing value',
            response: (requestId) => ({
                protocol: TOOLKIT_WORKER_PROTOCOL,
                type: 'result',
                requestId
            })
        },
        {
            name: 'extra field',
            response: (requestId) => ({
                ...resultResponse(requestId, documentResult()),
                extra: true
            })
        },
        {
            name: 'scalar parse result',
            response: (requestId) => resultResponse(requestId, 7)
        }
    ]
    for (const entry of cases) {
        await t.test(entry.name, async () => {
            const state = await startManualParse()
            state.worker.emit(entry.response(state.requestId))
            await assert.rejects(() => state.pending, {
                code: 'ERR_WORKER_MESSAGE'
            })
            state.client.dispose()
        })
    }
})

test('worker client rejects malformed nested project documents', async () => {
    const state = await startManualProject()
    const project = ProjectLoader.load([{ name: 'manual.json', data: '[]' }])
    project.documents = [7]
    state.worker.emit(resultResponse(state.requestId, project))
    await assert.rejects(() => state.pending, {
        code: 'ERR_WORKER_MESSAGE'
    })
    state.client.dispose()
})

test('worker client rejects extra error fields and malformed diagnostics or causes', async (t) => {
    const cases = [
        {
            name: 'extra response field',
            response: (requestId) =>
                errorResponse(requestId, { message: { extra: true } })
        },
        {
            name: 'malformed diagnostic',
            response: (requestId) =>
                errorResponse(requestId, { diagnostics: [{}] })
        },
        {
            name: 'malformed remote cause',
            response: (requestId) =>
                errorResponse(requestId, {
                    error: { cause: { evil: true } }
                })
        }
    ]
    for (const entry of cases) {
        await t.test(entry.name, async () => {
            const state = await startManualParse()
            state.worker.emit(entry.response(state.requestId))
            await assert.rejects(() => state.pending, {
                code: 'ERR_WORKER_MESSAGE'
            })
            state.client.dispose()
        })
    }
})

test('worker client ignores responses for queued requests until they are posted', async () => {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    let firstSettled = false
    let secondSettled = false
    const first = client.parse({ fileName: 'first.json', data: '[]' })
    const second = client.parse({ fileName: 'second.json', data: '[]' })
    first.then(
        () => {
            firstSettled = true
        },
        () => {
            firstSettled = true
        }
    )
    second.then(
        () => {
            secondSettled = true
        },
        () => {
            secondSettled = true
        }
    )
    try {
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(worker.requests.length, 1)

        worker.emit(resultResponse('worker-2', documentResult()))
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(firstSettled, false)
        assert.equal(secondSettled, false)
        assert.equal(worker.requests.length, 1)

        worker.emit(resultResponse('worker-1', documentResult()))
        await first
        assert.equal(worker.requests.length, 2)
        worker.emit(resultResponse('worker-2', documentResult()))
        await second
    } finally {
        client.dispose()
        await Promise.allSettled([first, second])
    }
})

test('queued parser and project requests own caller buffers before posting', async () => {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const active = client.parse({ fileName: 'active.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))

    const parserData = new TextEncoder().encode('[]')
    const parserAsset = new Uint8Array([1, 2, 3])
    const queuedParser = client.parse({
        fileName: 'queued-parser.json',
        data: parserData,
        assets: [{ name: 'parser.bin', data: parserAsset }]
    })
    parserData.set(new TextEncoder().encode('{}'))
    parserAsset.fill(9)

    worker.emit(resultResponse('worker-1', documentResult()))
    await active
    assert.equal(worker.requests.length, 2)
    assert.deepEqual(
        [...worker.requests[1].input.data],
        [...new TextEncoder().encode('[]')]
    )
    assert.deepEqual([...worker.requests[1].input.assets[0].data], [1, 2, 3])
    worker.emit(resultResponse('worker-2', documentResult()))
    await queuedParser

    const blocker = client.parse({ fileName: 'blocker.json', data: '[]' })
    const projectData = new TextEncoder().encode('[]')
    const projectAsset = new Uint8Array([4, 5, 6])
    const queuedProject = client.loadProject([
        {
            name: 'queued-project.json',
            data: projectData,
            assets: [{ name: 'project.bin', data: projectAsset }]
        }
    ])
    projectData.set(new TextEncoder().encode('{}'))
    projectAsset.fill(8)

    worker.emit(resultResponse('worker-3', documentResult()))
    await blocker
    assert.equal(worker.requests.length, 4)
    assert.deepEqual(
        [...worker.requests[3].entries[0].data],
        [...new TextEncoder().encode('[]')]
    )
    assert.deepEqual(
        [...worker.requests[3].entries[0].assets[0].data],
        [4, 5, 6]
    )
    worker.emit(
        resultResponse(
            'worker-4',
            ProjectLoader.load([{ name: 'queued-project.json', data: '[]' }])
        )
    )
    await queuedProject
    client.dispose()
})

test('queued transfer requests detach exact caller buffers immediately', async () => {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const active = client.parse({ fileName: 'active.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))

    const data = new TextEncoder().encode('[]')
    const asset = new Uint8Array([7, 8, 9])
    const alias = new DataView(asset.buffer)
    const partialBacking = new Uint8Array([0, 4, 5, 6, 0])
    const partial = partialBacking.subarray(1, 4)
    const shared =
        typeof SharedArrayBuffer === 'function'
            ? new Uint8Array(new SharedArrayBuffer(5), 1, 3)
            : new Uint8Array(new ArrayBuffer(5), 1, 3)
    shared.set([3, 2, 1])
    const queued = client.parse(
        {
            fileName: 'queued-transfer.json',
            data,
            assets: [
                {
                    name: 'transfer.bin',
                    data: asset,
                    source: { alias, partial, shared }
                }
            ]
        },
        { transferInput: true }
    )
    assert.equal(data.byteLength, 0)
    assert.equal(asset.byteLength, 0)
    assert.equal(partialBacking.byteLength, 5)
    assert.equal(shared.byteLength, 3)

    worker.emit(resultResponse('worker-1', documentResult()))
    await active
    assert.equal(worker.requests.length, 2)
    assert.deepEqual(
        [...worker.requests[1].input.data],
        [...new TextEncoder().encode('[]')]
    )
    assert.deepEqual([...worker.requests[1].input.assets[0].data], [7, 8, 9])
    assert.equal(
        worker.requests[1].input.assets[0].data.buffer,
        worker.requests[1].input.assets[0].source.alias.buffer
    )
    assert.equal(
        worker.requests[1].input.assets[0].source.partial.buffer.byteLength,
        3
    )
    if (typeof SharedArrayBuffer === 'function') {
        assert.equal(
            worker.requests[1].input.assets[0].source.shared.buffer instanceof
                SharedArrayBuffer,
            false
        )
    }
    worker.emit(resultResponse('worker-2', documentResult()))
    await queued
    client.dispose()
})

test('rejected transfer requests preserve buffers before queue admission', async () => {
    const disposedClient = new ParserWorkerClient({
        createWorker: () => new ManualWorker()
    })
    disposedClient.dispose()
    const disposedBytes = new TextEncoder().encode('[]')
    await assert.rejects(
        () =>
            disposedClient.parse(
                { fileName: 'disposed.json', data: disposedBytes },
                { transferInput: true }
            ),
        { code: 'ERR_WORKER_DISPOSED' }
    )
    assert.equal(disposedBytes.byteLength, 2)

    const cancelledClient = new ParserWorkerClient({
        createWorker: () => new ManualWorker()
    })
    const controller = new AbortController()
    controller.abort()
    const cancelledBytes = new TextEncoder().encode('[]')
    await assert.rejects(
        () =>
            cancelledClient.parse(
                { fileName: 'cancelled.json', data: cancelledBytes },
                {
                    signal: controller.signal,
                    transferInput: true
                }
            ),
        { code: 'ERR_CANCELLED' }
    )
    assert.equal(cancelledBytes.byteLength, 2)
    cancelledClient.dispose()
})

test('accepted queued transfer stays owned when cancelled before posting', async () => {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const active = client.parse({ fileName: 'active.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))
    const controller = new AbortController()
    const bytes = new TextEncoder().encode('[]')
    const queued = client.parse(
        { fileName: 'queued-cancel.json', data: bytes },
        {
            signal: controller.signal,
            transferInput: true
        }
    )
    assert.equal(bytes.byteLength, 0)
    controller.abort()
    await assert.rejects(() => queued, { code: 'ERR_CANCELLED' })
    assert.equal(worker.requests.length, 1)
    worker.emit(resultResponse('worker-1', documentResult()))
    await active
    assert.equal(worker.requests.length, 1)
    client.dispose()
})

test('queue-limit rejection preserves explicitly transferable buffers', async () => {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const active = client.parse({ fileName: 'active.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))
    const queued = []
    for (let index = 0; index < 1023; index += 1) {
        queued.push(
            client
                .parse({ fileName: `queued-${index}.json`, data: '[]' })
                .catch((error) => error.code)
        )
    }
    const rejectedBytes = new TextEncoder().encode('[]')
    await assert.rejects(
        () =>
            client.parse(
                { fileName: 'over-limit.json', data: rejectedBytes },
                { transferInput: true }
            ),
        { code: 'ERR_WORKER_QUEUE_LIMIT' }
    )
    assert.equal(rejectedBytes.byteLength, 2)
    client.dispose()
    await Promise.allSettled([active, ...queued])
})

test('worker progress accepts only exact primitive wire fields', async (t) => {
    await t.test('boxed primitives', async () => {
        const state = await startManualParse()
        state.worker.emit({
            protocol: TOOLKIT_WORKER_PROTOCOL,
            type: 'progress',
            requestId: state.requestId,
            progress: {
                stage: new String('detect'),
                completed: new Number(1),
                total: new Number(2)
            }
        })
        state.worker.emit(resultResponse(state.requestId, documentResult()))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        state.client.dispose()
    })

    await t.test('hostile coercion hook', async () => {
        const state = await startManualParse()
        let calls = 0
        state.worker.emitUncloned({
            protocol: TOOLKIT_WORKER_PROTOCOL,
            type: 'progress',
            requestId: state.requestId,
            progress: {
                stage: {
                    toString() {
                        calls += 1
                        return 'detect'
                    }
                }
            }
        })
        state.worker.emit(resultResponse(state.requestId, documentResult()))
        await assert.rejects(() => state.pending, {
            code: 'ERR_WORKER_MESSAGE'
        })
        assert.equal(calls, 0)
        state.client.dispose()
    })
})

test('ToolkitError.from never reads hostile thrown-value accessors', () => {
    let reads = 0
    const thrown = {}
    Object.defineProperty(thrown, 'message', {
        enumerable: true,
        get() {
            reads += 1
            return 'hostile'
        }
    })
    const error = ToolkitError.from(thrown)
    assert.equal(reads, 0)
    assert.equal(error.message, 'Toolkit operation failed.')
    assert.equal(error.cause.message, 'Toolkit operation failed.')
})

test('WorkerRequestData preserves enumerable __proto__ as data', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}')
    const prepared = WorkerRequestData.prepare(input).value
    assert.equal(Object.hasOwn(prepared, '__proto__'), true)
    assert.deepEqual(prepared.__proto__, { polluted: true })
    assert.equal(Object.getPrototypeOf(prepared), Object.prototype)
    assert.equal(Object.prototype.polluted, undefined)
})

test('worker protocol transfers isolated result buffers without draining protected assets', async () => {
    const listeners = new Set()
    const posts = []
    let result
    const scope = {
        addEventListener(type, listener) {
            if (type === 'message') listeners.add(listener)
        },
        removeEventListener(type, listener) {
            if (type === 'message') listeners.delete(listener)
        },
        postMessage(message, transfer = []) {
            posts.push({
                message: structuredClone(message, { transfer }),
                transfer: [...transfer]
            })
        }
    }
    const installation = ToolkitWorkerProtocol.install(scope, {
        parse: async () => {
            result = DocumentResult.create({
                fileName: 'output.json',
                format: 'circuitjson',
                model: [],
                assets: [
                    {
                        id: 'output-bytes',
                        name: 'output.bin',
                        data: new Uint8Array([1, 2, 3])
                    }
                ]
            })
            return result
        }
    })
    for (const listener of listeners) {
        listener({
            data: {
                protocol: TOOLKIT_WORKER_PROTOCOL,
                type: 'parse',
                requestId: 'output-transfer',
                input: { fileName: 'output.json', data: '[]' },
                options: {}
            }
        })
    }
    await new Promise((resolve) => setImmediate(resolve))
    const posted = posts.find((entry) => entry.message.type === 'result')
    assert.equal(posted.transfer.length, 1)
    assert.equal(result.assets[0].data.byteLength, 3)
    assert.deepEqual([...posted.message.value.assets[0].data], [1, 2, 3])
    installation.dispose()
})

test('result transfer reuses only proven models and rejects unproven accessors', () => {
    const proven = Parser.parse({
        fileName: 'proven.json',
        data: '[{"type":"source_net","source_net_id":"n1","name":"N1","member_source_group_ids":[]}]'
    })
    const prepared = WorkerRequestData.prepareResult(proven)
    assert.equal(prepared.value.model, proven.model)

    let reads = 0
    const element = { type: 'source_net', source_net_id: 'n2' }
    Object.defineProperty(element, 'name', {
        enumerable: true,
        get() {
            reads += 1
            return 'N2'
        }
    })
    const unproven = DocumentResult.create({
        fileName: 'unproven.json',
        model: [element]
    })
    assert.throws(() => WorkerRequestData.prepareResult(unproven), TypeError)
    assert.equal(reads, 0)
})

test('queued cancellations leave no array-shift tombstone scan', async () => {
    const worker = new ManualWorker()
    const client = new ParserWorkerClient({ createWorker: () => worker })
    const active = client.parse({ fileName: 'active.json', data: '[]' })
    await new Promise((resolve) => setImmediate(resolve))
    const cancelled = []
    for (let index = 0; index < 2000; index += 1) {
        const controller = new AbortController()
        const pending = client
            .parse(
                { fileName: `queued-${index}.json`, data: '[]' },
                { signal: controller.signal }
            )
            .catch((error) => error.code)
        controller.abort()
        cancelled.push(pending)
    }
    assert.deepEqual(
        new Set(await Promise.all(cancelled)),
        new Set(['ERR_CANCELLED'])
    )

    const originalShift = Array.prototype.shift
    let shiftCalls = 0
    Array.prototype.shift = function (...args) {
        shiftCalls += 1
        return Reflect.apply(originalShift, this, args)
    }
    try {
        worker.emit(resultResponse('worker-1', documentResult()))
        await active
    } finally {
        Array.prototype.shift = originalShift
        client.dispose()
    }
    assert.equal(shiftCalls < 50, true, `Observed ${shiftCalls} shift calls.`)
})

test('worker auto mode falls back only when worker construction is unavailable', async () => {
    const originalWorker = globalThis.Worker
    let constructions = 0
    globalThis.Worker = class {
        /** Simulates CSP or module-worker construction denial. */
        constructor() {
            constructions += 1
            throw new Error('worker construction blocked')
        }
    }
    ParserWorkerClient.disposeDefault()
    try {
        const fallbackData = new TextEncoder().encode('[]')
        const fallbackAsset = new Uint8Array([1, 2, 3])
        const parsed = await Parser.parseAsync(
            {
                fileName: 'fallback.json',
                data: fallbackData,
                assets: [{ name: 'fallback.bin', data: fallbackAsset }]
            },
            {
                worker: 'auto',
                decodeAssets: 'full',
                transferInput: true
            }
        )
        const project = await ProjectLoader.loadAsync(
            [{ name: 'fallback.json', data: '[]' }],
            { worker: 'auto' }
        )
        assert.equal(parsed.schema, 'ecad-toolkit.document.v1')
        assert.deepEqual([...parsed.assets[0].data], [1, 2, 3])
        assert.equal(fallbackData.byteLength, 2)
        assert.equal(fallbackAsset.byteLength, 3)
        assert.equal(project.schema, 'ecad-toolkit.project.v1')
        assert.equal(constructions, 2)
        await assert.rejects(
            () =>
                Parser.parseAsync(
                    { fileName: 'required-worker.json', data: '[]' },
                    { worker: true }
                ),
            { code: 'ERR_WORKER_REQUEST' }
        )
    } finally {
        ParserWorkerClient.disposeDefault()
        if (originalWorker === undefined) delete globalThis.Worker
        else globalThis.Worker = originalWorker
    }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ParserWorkerClient } from '../src/core/worker/ParserWorkerClient.mjs'
import { TOOLKIT_WORKER_PROTOCOL } from '../src/core/worker/ToolkitWorkerProtocol.mjs'
import { WorkerRequestData } from '../src/core/worker/WorkerRequestData.mjs'
import { WorkerResponseData } from '../src/core/worker/WorkerResponseData.mjs'

/** Creates a small source-independent canonical response. @returns {object} Document. */
function documentFixture() {
    return {
        schema: 'ecad-toolkit.document.v1',
        id: 'fake-document',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'circuitjson',
            fileName: 'fake.json',
            fileType: 'json'
        },
        extensions: { fake: { rows: [{ position: [1, 2] }] } },
        assets: [],
        diagnostics: [],
        statistics: {}
    }
}

/** Synthetic worker that can alter a genuine MessageEvent before delivery. */
class AlteringWorker extends EventTarget {
    static mutate = null

    /** @param {object} request Request. @returns {void} */
    postMessage(request) {
        const value = documentFixture()
        AlteringWorker.mutate?.(value)
        queueMicrotask(() =>
            this.dispatchEvent(
                new MessageEvent('message', {
                    data: {
                        protocol: TOOLKIT_WORKER_PROTOCOL,
                        type: 'result',
                        requestId: request.requestId,
                        value
                    }
                })
            )
        )
    }

    /** Ends this synthetic worker. @returns {void} */
    terminate() {}
}

test('URL-created clients preserve injected host-worker response isolation', async () => {
    const originalWorker = globalThis.Worker
    let retained
    AlteringWorker.mutate = (value) => {
        retained = value.extensions.fake.rows[0]
    }
    globalThis.Worker = AlteringWorker
    let client
    try {
        client = ParserWorkerClient.fromWorkerUrl(
            new URL('file:///fake.worker.mjs')
        )
        const result = await client.parse({ fileName: 'fake.json', data: '[]' })
        retained.position[0] = 99
        assert.deepEqual(result.extensions.fake.rows[0].position, [1, 2])
        assert.ok(Object.isFrozen(result.extensions.fake.rows[0]))
    } finally {
        client?.dispose()
        globalThis.Worker = originalWorker
        AlteringWorker.mutate = null
    }
})

test('custom native-looking events keep altered buffer brands and reject accessors', async () => {
    let getterCalls = 0
    for (const accessor of [false, true]) {
        const bytes = new ArrayBuffer(2)
        new Uint8Array(bytes).set([7, 8])
        Object.setPrototypeOf(bytes, Object.prototype)
        AlteringWorker.mutate = (value) => {
            value.extensions.fake.binary = bytes
            if (accessor) {
                Object.defineProperty(value.extensions.fake, 'hidden', {
                    enumerable: true,
                    get() {
                        getterCalls += 1
                        return 1
                    }
                })
            }
        }
        const client = new ParserWorkerClient({
            createWorker: () => new AlteringWorker()
        })
        try {
            const operation = client.parse({
                fileName: 'fake.json',
                data: '[]'
            })
            if (accessor) {
                await assert.rejects(operation, { code: 'ERR_WORKER_MESSAGE' })
            } else {
                const result = await operation
                assert.deepEqual(
                    [...new Uint8Array(result.extensions.fake.binary)],
                    [7, 8]
                )
                new Uint8Array(bytes)[0] = 99
                assert.deepEqual(
                    [...new Uint8Array(result.extensions.fake.binary)],
                    [7, 8]
                )
            }
        } finally {
            client.dispose()
            AlteringWorker.mutate = null
        }
    }
    assert.equal(getterCalls, 0)
})

test('caller flags cannot skip worker raw-buffer ownership checks', () => {
    const bytes = new ArrayBuffer(2)
    new Uint8Array(bytes).set([3, 4])
    Object.setPrototypeOf(bytes, null)
    const result = WorkerRequestData.prepareResponse(
        { bytes },
        { native: true, standardBuiltins: true, trusted: true }
    )
    assert.deepEqual([...new Uint8Array(result.bytes)], [3, 4])
    assert.notStrictEqual(result.bytes, bytes)
})

test('response validation cannot acquire normalized provenance from a replaced preparer', () => {
    const original = WorkerRequestData.prepareResponse
    const injected = documentFixture()
    const retained = injected.extensions.fake.rows[0]
    WorkerRequestData.prepareResponse = () => injected
    try {
        const result = WorkerResponseData.result('parse', documentFixture())
        retained.position[0] = 99
        assert.deepEqual(result.extensions.fake.rows[0].position, [1, 2])
    } finally {
        WorkerRequestData.prepareResponse = original
    }
})

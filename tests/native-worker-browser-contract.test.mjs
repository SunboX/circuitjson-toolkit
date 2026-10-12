import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import test from 'node:test'

const ROOT = new URL('../', import.meta.url)

/** Serves repo-owned modules to an isolated browser. @returns {Promise<object>} Server and URL. */
async function serveModules() {
    const server = createServer(async (request, response) => {
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        const pathname = new URL(request.url, 'http://localhost').pathname
        if (pathname === '/') {
            response.setHeader('Content-Type', 'text/html')
            response.end('<!doctype html><title>Native worker contract</title>')
            return
        }
        try {
            if (!pathname.startsWith('/src/'))
                throw new Error('Unknown fixture')
            response.setHeader('Content-Type', 'text/javascript')
            response.end(await readFile(new URL(`.${pathname}`, ROOT)))
        } catch {
            response.writeHead(404).end()
        }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server, url: `http://127.0.0.1:${server.address().port}/` }
}

test(
    'auto parsing falls back when a browser host ignores module worker options',
    { skip: !process.env.WORKER_BROWSER_MODULE, timeout: 30_000 },
    async () => {
        const { chromium } = await import(process.env.WORKER_BROWSER_MODULE)
        const { server, url } = await serveModules()
        let browser
        try {
            browser = await chromium.launch({
                headless: true,
                executablePath: process.env.WORKER_BROWSER_EXECUTABLE
            })
            const page = await browser.newPage()
            const errors = []
            page.on('pageerror', (error) => errors.push(error.message))
            await page.goto(url)
            const result = await page.evaluate(async () => {
                const NativeWorker = globalThis.Worker
                globalThis.Worker = class extends NativeWorker {
                    /** Models a host that treats every worker as a classic script. */
                    constructor(url) {
                        super(url)
                    }
                }
                const { Parser, ParserWorkerClient } =
                    await import('/src/parser.mjs')
                try {
                    const document = await Parser.parseAsync(
                        { fileName: 'fake.json', data: '[]' },
                        { worker: 'auto' }
                    )
                    let forcedError = null
                    try {
                        await Parser.parseAsync(
                            { fileName: 'fake.json', data: '[]' },
                            { worker: true }
                        )
                    } catch (error) {
                        forcedError = {
                            code: error.code,
                            phase: error.details.phase
                        }
                    }
                    return {
                        schema: document.schema,
                        model: document.model,
                        forcedError
                    }
                } finally {
                    ParserWorkerClient.disposeDefault()
                    globalThis.Worker = NativeWorker
                }
            })
            assert.deepEqual(result, {
                schema: 'ecad-toolkit.document.v1',
                model: [],
                forcedError: { code: 'ERR_WORKER_REQUEST', phase: 'construct' }
            })
            assert.deepEqual(errors, [])
        } finally {
            await browser?.close()
            await new Promise((resolve) => server.close(resolve))
        }
    }
)

test(
    'native browser workers preserve ownership, bounds, and private clone provenance',
    { skip: !process.env.WORKER_BROWSER_MODULE, timeout: 120_000 },
    async (context) => {
        const { chromium } = await import(process.env.WORKER_BROWSER_MODULE)
        const { server, url } = await serveModules()
        let browser
        try {
            browser = await chromium.launch({
                headless: true,
                executablePath: process.env.WORKER_BROWSER_EXECUTABLE
            })
            const page = await browser.newPage()
            await page.goto(url)
            const result = await page.evaluate(async () => {
                const { ParserWorkerClient } =
                    await import('/src/core/worker/ParserWorkerClient.mjs')
                const { NativeParserWorkerTransport } =
                    await import('/src/core/worker/NativeParserWorkerTransport.mjs')
                const { WorkerRequestData } =
                    await import('/src/core/worker/WorkerRequestData.mjs')
                const { WorkerResponseData } =
                    await import('/src/core/worker/WorkerResponseData.mjs')
                const workerSource = `
                    self.onmessage = ({data: request}) => {
                        const rows = Array.from({length: Number(request.input.data) || 2}, (_, i) => ({
                            id: 'row-' + i, type: 'fake-row', position: [i, i + 1],
                            properties: {visible: true, layer: 'top'}
                        }))
                        const buffer = new ArrayBuffer(2)
                        new Uint8Array(buffer).set([3, 4])
                        Object.setPrototypeOf(buffer, null)
                        const value = {
                            schema: 'ecad-toolkit.document.v1', id: 'fake',
                            modelSchema: {name: 'circuit-json', version: '0.0.446'}, model: [],
                            source: {format: 'circuitjson', fileName: 'fake.json', fileType: 'json'},
                            extensions: {fake: {rows, buffer}}, assets: [], diagnostics: [], statistics: {}
                        }
                        if (request.input.fileName === 'cycle.json') value.extensions.fake.loop = value.extensions
                        if (request.input.fileName === 'deep.json') {
                            let parent = value.extensions.fake
                            for (let i = 0; i < 260; i++) parent = parent.child = {}
                        }
                        if (request.input.fileName === 'binary.json') {
                            const shared = new SharedArrayBuffer(2)
                            new Uint8Array(shared).set([5, 6])
                            const resizable = new ArrayBuffer(2, {maxByteLength: 4})
                            new Uint8Array(resizable).set([7, 8])
                            value.extensions.fake.shared = shared
                            value.extensions.fake.resizable = resizable
                            value.extensions.fake.partial = new Uint16Array(new Uint16Array([0, 257, 514, 0]).buffer, 2, 2)
                            value.extensions.fake.view = new DataView(new Uint8Array([0, 9, 10, 0]).buffer, 1, 2)
                        }
                        self.postMessage({protocol: request.protocol, type: 'result', requestId: request.requestId, value})
                    }
                `
                const workerUrl = URL.createObjectURL(
                    new Blob([workerSource], { type: 'text/javascript' })
                )
                const native = ParserWorkerClient.fromWorkerUrl(workerUrl)
                const generic = new ParserWorkerClient({
                    createWorker: () => new Worker(workerUrl)
                })
                const durations = { native: [], generic: [] }
                try {
                    const result = await native.parse({
                        fileName: 'binary.json',
                        data: '2'
                    })
                    const binary = result.extensions.fake
                    const copy = new Uint8Array(binary.buffer)
                    copy[0] = 99
                    const binaryResult = {
                        buffer: [...new Uint8Array(binary.buffer)],
                        shared: [...new Uint8Array(binary.shared)],
                        resizable: [...new Uint8Array(binary.resizable)],
                        partial: [...binary.partial],
                        view: [...new Uint8Array(binary.view.buffer)],
                        sharedIsFixed:
                            binary.shared instanceof ArrayBuffer &&
                            !binary.shared.resizable,
                        resizableIsFixed: !binary.resizable.resizable,
                        frozen: Object.isFrozen(binary.rows[0])
                    }
                    const rejected = []
                    for (const fileName of ['cycle.json', 'deep.json']) {
                        try {
                            await native.parse({ fileName, data: '1' })
                            rejected.push(false)
                        } catch (error) {
                            rejected.push(error.code === 'ERR_WORKER_MESSAGE')
                        }
                    }
                    let getterCalls = 0
                    const custom = new ParserWorkerClient({
                        createWorker() {
                            const worker = new Worker(workerUrl)
                            worker.addEventListener('message', (event) => {
                                Object.defineProperty(
                                    event.data.value.extensions.fake,
                                    'accessor',
                                    {
                                        enumerable: true,
                                        get() {
                                            getterCalls += 1
                                            return 1
                                        }
                                    }
                                )
                            })
                            return worker
                        }
                    })
                    let customRejected = false
                    try {
                        await custom.parse({ fileName: 'fake.json', data: '1' })
                    } catch (error) {
                        customRejected = error.code === 'ERR_WORKER_MESSAGE'
                    } finally {
                        custom.dispose()
                    }

                    const transport =
                        NativeParserWorkerTransport.create(workerUrl)
                    let capabilityResult
                    try {
                        capabilityResult = await new Promise((resolve) => {
                            transport.addEventListener('message', (event) => {
                                const token = event.data.value
                                const opaque =
                                    Reflect.ownKeys(token).length === 0 &&
                                    !('target' in event)
                                const prepared =
                                    WorkerRequestData.prepareResponse(token)
                                const replay =
                                    WorkerRequestData.prepareResponse(token)
                                resolve({
                                    opaque,
                                    schema: prepared.schema,
                                    replayKeys: Reflect.ownKeys(replay).length
                                })
                            })
                            transport.postMessage({
                                protocol: 'ecad-toolkit.worker.v1',
                                requestId: 'probe',
                                input: { fileName: 'fake.json', data: '1' }
                            })
                        })
                    } finally {
                        transport.terminate()
                    }

                    const injected = structuredClone(result)
                    const injectedBuffer = new Uint8Array([21, 22]).buffer
                    Object.setPrototypeOf(injectedBuffer, Object.prototype)
                    injected.extensions.fake.buffer = injectedBuffer
                    const originalMessage = WorkerResponseData.message
                    let injectedOnce = false
                    WorkerResponseData.message = (value) => {
                        const fields = originalMessage(value)
                        if (!injectedOnce) {
                            injectedOnce = true
                            fields.value = injected
                        }
                        return fields
                    }
                    let helperBytes
                    try {
                        const received = await native.parse({
                            fileName: 'fake.json',
                            data: '1'
                        })
                        new Uint8Array(injectedBuffer)[0] = 99
                        helperBytes = [
                            ...new Uint8Array(received.extensions.fake.buffer)
                        ]
                    } finally {
                        WorkerResponseData.message = originalMessage
                    }

                    for (let run = 0; run < 6; run += 1) {
                        for (const [name, client] of [
                            ['generic', generic],
                            ['native', native]
                        ]) {
                            const start = performance.now()
                            const document = await client.parse({
                                fileName: 'fake.json',
                                data: '10000'
                            })
                            const duration = performance.now() - start
                            if (document.extensions.fake.rows.length !== 10000)
                                throw new Error('Missing rows')
                            if (run > 0) durations[name].push(duration)
                        }
                    }
                    return {
                        binaryResult,
                        rejected,
                        getterCalls,
                        customRejected,
                        capabilityResult,
                        helperBytes,
                        durations
                    }
                } finally {
                    native.dispose()
                    generic.dispose()
                    URL.revokeObjectURL(workerUrl)
                }
            })
            assert.deepEqual(result.binaryResult, {
                buffer: [3, 4],
                shared: [5, 6],
                resizable: [7, 8],
                partial: [257, 514],
                view: [9, 10],
                sharedIsFixed: true,
                resizableIsFixed: true,
                frozen: true
            })
            assert.deepEqual(result.rejected, [true, true])
            assert.equal(result.customRejected, true)
            assert.equal(result.getterCalls, 0)
            assert.deepEqual(result.helperBytes, [21, 22])
            assert.deepEqual(result.capabilityResult, {
                opaque: true,
                schema: 'ecad-toolkit.document.v1',
                replayKeys: 0
            })
            for (const values of Object.values(result.durations))
                values.sort((a, b) => a - b)
            context.diagnostic(JSON.stringify(result.durations))
            assert.ok(
                result.durations.native[2] < result.durations.generic[2] * 0.65
            )
        } finally {
            await browser?.close()
            await new Promise((resolve) => server.close(resolve))
        }
    }
)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { WorkerRequestData } from '../src/core/worker/WorkerRequestData.mjs'

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const BINARY_EXCEPTION_PROBE = `
import inspector from 'node:inspector'
import { WorkerRequestData } from './src/core/worker/WorkerRequestData.mjs'
const session = new inspector.Session()
session.connect()
const post = (method, parameters = {}) => new Promise((resolve, reject) =>
    session.post(method, parameters, (error, result) => error ? reject(error) : resolve(result))
)
let pauses = 0
session.on('Debugger.paused', () => {
    pauses += 1
    session.post('Debugger.resume')
})
await post('Debugger.enable')
await post('Debugger.setPauseOnExceptions', { state: 'all' })
WorkerRequestData.prepareResponse([
    [1, 2, 3],
    new Uint8Array([4, 5]),
    new DataView(new ArrayBuffer(4))
])
await new Promise((resolve) => setImmediate(resolve))
await post('Debugger.setPauseOnExceptions', { state: 'none' })
session.disconnect()
process.stdout.write(String(pauses))
`

test('worker response arrays and views avoid exception-based binary probing', () => {
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', BINARY_EXCEPTION_PROBE],
        { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10_000 }
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(Number(result.stdout.trim()), 0)
})

test('worker responses retain cross-realm and altered-prototype binary data', () => {
    const foreign = vm.runInNewContext('new Uint16Array([257, 514])')
    const altered = new ArrayBuffer(3)
    new Uint8Array(altered).set([6, 7, 8])
    Object.setPrototypeOf(altered, Object.prototype)
    const view = new Uint8Array([9, 10])
    Object.setPrototypeOf(view, DataView.prototype)
    const prepared = WorkerRequestData.prepareResponse([foreign, altered, view])

    assert.ok(prepared[0] instanceof Uint16Array)
    assert.deepEqual([...prepared[0]], [257, 514])
    assert.deepEqual([...new Uint8Array(prepared[1])], [6, 7, 8])
    assert.ok(prepared[2] instanceof Uint8Array)
    assert.deepEqual([...prepared[2]], [9, 10])
    assert.notStrictEqual(prepared[1], altered)
    assert.notStrictEqual(prepared[2], view)

    if (typeof SharedArrayBuffer === 'function') {
        const shared = new SharedArrayBuffer(2)
        new Uint8Array(shared).set([11, 12])
        Object.setPrototypeOf(shared, null)
        const copied = WorkerRequestData.prepareResponse(shared)
        assert.ok(copied instanceof ArrayBuffer)
        assert.deepEqual([...new Uint8Array(copied)], [11, 12])
    }
})

test('worker requests normalize cross-realm dense arrays through own data', () => {
    const foreign = vm.runInNewContext('[1, [2, 3], new Uint8Array([4, 5])]')
    for (const prepared of [
        WorkerRequestData.prepare(foreign).value,
        WorkerRequestData.prepareResponse(foreign)
    ]) {
        assert.strictEqual(Object.getPrototypeOf(prepared), Array.prototype)
        assert.deepEqual(prepared.slice(0, 2), [1, [2, 3]])
        assert.deepEqual([...prepared[2]], [4, 5])
    }
    const sparse = vm.runInNewContext('[1, , 3]')
    assert.throws(() => WorkerRequestData.prepareResponse(sparse), TypeError)
})

test('worker binary classification does not invoke forged binary accessors', () => {
    let calls = 0
    const forged = Object.create(null)
    for (const key of ['buffer', 'byteLength', Symbol.toStringTag]) {
        Object.defineProperty(forged, key, {
            enumerable: true,
            get() {
                calls += 1
                throw new Error('unexpected binary accessor')
            }
        })
    }

    assert.throws(() => WorkerRequestData.prepareResponse(forged), TypeError)
    assert.equal(calls, 0)
})

test(
    'worker response preparation benchmark uses owned synthetic records',
    {
        skip: process.env.WORKER_DATA_BENCHMARK !== '1'
    },
    (context) => {
        const source = Array.from({ length: 10_000 }, (_, index) => ({
            id: `record-${index}`,
            type: 'fake-record',
            points: [
                [index, index + 1],
                [index + 2, index + 3]
            ],
            properties: { visible: true, layer: 'top' }
        }))
        const durations = []
        for (let run = 0; run < 6; run += 1) {
            const start = performance.now()
            const prepared = WorkerRequestData.prepareResponse(source)
            const duration = performance.now() - start
            assert.deepEqual(prepared.at(-1), source.at(-1))
            assert.notStrictEqual(prepared.at(-1), source.at(-1))
            if (run > 0) durations.push(duration)
        }
        durations.sort((a, b) => a - b)
        context.diagnostic(
            JSON.stringify({ workerResponseMedianMs: durations[2], durations })
        )
    }
)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { BinaryDataSnapshot } from '../src/core/context/BinaryDataSnapshot.mjs'
import { CircuitJsonDocumentContext } from '../src/index.mjs'

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const ORDINARY_GRAPH_EXCEPTION_PROBE = `
import inspector from 'node:inspector'
import { StructuredDataSnapshot } from './src/core/context/StructuredDataSnapshot.mjs'

const session = new inspector.Session()
session.connect()
const post = (method, parameters = {}) =>
    new Promise((resolve, reject) =>
        session.post(method, parameters, (error, result) =>
            error ? reject(error) : resolve(result)
        )
    )

let pauses = 0
session.on('Debugger.paused', () => {
    pauses += 1
    session.post('Debugger.resume')
})

await post('Debugger.enable')
await post('Debugger.setPauseOnExceptions', { state: 'all' })
StructuredDataSnapshot.capture(
    {
        board: {
            layers: [
                { id: 'top', visible: true },
                { id: 'bottom', visible: true }
            ],
            points: [{ x: 1, y: 2 }, { x: 3, y: 4 }]
        }
    },
    StructuredDataSnapshot.createState({ standardBuiltins: true })
)
await new Promise((resolve) => setImmediate(resolve))
await post('Debugger.setPauseOnExceptions', { state: 'none' })
session.disconnect()
process.stdout.write(String(pauses))
`

test('proven standard metadata graphs avoid exception-based binary probing', () => {
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', ORDINARY_GRAPH_EXCEPTION_PROBE],
        {
            cwd: PROJECT_ROOT,
            encoding: 'utf8',
            timeout: 10_000
        }
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(
        Number(result.stdout.trim()),
        0,
        'ordinary records and arrays must not trigger caught binary brand errors'
    )
})

test('binary classification keeps cross-realm and altered-prototype binary values', () => {
    const crossRealmBuffer = vm.runInNewContext('new ArrayBuffer(5)')
    const alteredBuffer = new ArrayBuffer(4)
    Object.setPrototypeOf(alteredBuffer, Object.prototype)
    const typedView = new Uint8Array([4, 5, 6])
    const typedBuffer = typedView.buffer
    Object.setPrototypeOf(typedView, DataView.prototype)

    assert.deepEqual(BinaryDataSnapshot.describe(crossRealmBuffer), {
        buffer: crossRealmBuffer,
        byteOffset: 0,
        byteLength: 5,
        kind: 'buffer'
    })
    assert.deepEqual(BinaryDataSnapshot.describe(alteredBuffer), {
        buffer: alteredBuffer,
        byteOffset: 0,
        byteLength: 4,
        kind: 'buffer'
    })
    assert.deepEqual(BinaryDataSnapshot.describe(typedView), {
        buffer: typedBuffer,
        byteOffset: 0,
        byteLength: 3,
        kind: 'typed-array'
    })

    if (typeof SharedArrayBuffer === 'function') {
        const alteredSharedBuffer = new SharedArrayBuffer(6)
        Object.setPrototypeOf(alteredSharedBuffer, null)
        assert.deepEqual(BinaryDataSnapshot.describe(alteredSharedBuffer), {
            buffer: alteredSharedBuffer,
            byteOffset: 0,
            byteLength: 6,
            kind: 'buffer'
        })
    }
})

test('binary classification does not dispatch proxy prototype traps', () => {
    let calls = 0
    const proxy = new Proxy(
        {},
        {
            getPrototypeOf() {
                calls += 1
                throw new Error('prototype trap')
            }
        }
    )

    assert.equal(BinaryDataSnapshot.describe(proxy), null)
    assert.equal(calls, 0)
})

test('structured-clone contexts retain normalized extension binaries', () => {
    const payload = new Uint8Array([1, 2, 3])
    const context = CircuitJsonDocumentContext.prepareStructuredClone(
        structuredClone({
            schema: 'ecad-toolkit.document.v1',
            id: 'document-fast-path',
            modelSchema: { name: 'circuit-json', version: '0.0.446' },
            model: [],
            source: {
                format: 'altium',
                fileName: 'fake-board.PcbDoc',
                fileType: 'pcb'
            },
            extensions: {
                altium: {
                    $meta: {
                        schema: 'ecad-toolkit.extension.v1',
                        completeness: 'native',
                        included: ['payload'],
                        omitted: []
                    },
                    payload
                }
            },
            assets: [],
            diagnostics: [],
            statistics: {}
        })
    )

    assert.deepEqual([...context.extensions.altium.payload], [1, 2, 3])
    assert.notStrictEqual(context.extensions.altium.payload, payload)
})

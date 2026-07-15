import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { BinaryDataSnapshot } from '../src/core/context/BinaryDataSnapshot.mjs'
import { CircuitJsonReadOnlyDocument } from '../src/core/context/CircuitJsonReadOnlyDocument.mjs'
import { StructuredDataSnapshot } from '../src/core/context/StructuredDataSnapshot.mjs'
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

test('structured-clone adoption isolates retained extension binary views', () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-isolated-extension-binary',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'native',
                    included: ['payload'],
                    omitted: []
                },
                payload: new Uint8Array([1, 2, 3])
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const retainedPayload = document.extensions.fake.payload

    const context = CircuitJsonDocumentContext.prepareStructuredClone(document)
    retainedPayload[0] = 9

    assert.deepEqual([...context.extensions.fake.payload], [1, 2, 3])
})

test(
    'structured-clone adoption isolates shared sender memory',
    { skip: typeof SharedArrayBuffer !== 'function' },
    () => {
        const shared = new Uint8Array(new SharedArrayBuffer(3))
        shared.set([4, 5, 6])
        const document = structuredClone({
            schema: 'ecad-toolkit.document.v1',
            id: 'document-isolated-shared-binary',
            modelSchema: { name: 'circuit-json', version: '0.0.446' },
            model: [],
            source: {
                format: 'fake',
                fileName: 'fake-board.json',
                fileType: 'pcb'
            },
            extensions: {
                fake: {
                    $meta: {
                        schema: 'ecad-toolkit.extension.v1',
                        completeness: 'native',
                        included: ['payload'],
                        omitted: []
                    },
                    payload: shared
                }
            },
            assets: [],
            diagnostics: [],
            statistics: {}
        })

        const context =
            CircuitJsonDocumentContext.prepareStructuredClone(document)
        shared[0] = 9

        assert.deepEqual([...context.extensions.fake.payload], [4, 5, 6])
    }
)

test('structured-clone extension ownership rejects a binary root', () => {
    assert.throws(
        () =>
            CircuitJsonReadOnlyDocument.copyReadonlyExtensionValue(
                new Uint8Array([1, 2, 3]),
                null,
                { standardBuiltins: true }
            ),
        /root must be a plain data container/iu
    )
})

test('structured-clone contexts adopt isolated plain extension graphs in place', () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-owned-extension',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'native',
                    included: ['layers'],
                    omitted: []
                },
                layers: Array.from({ length: 64 }, (_, index) => ({
                    id: `layer-${index}`,
                    points: [
                        { x: index, y: index + 1 },
                        { x: index + 2, y: index + 3 }
                    ]
                }))
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const extensions = document.extensions
    const layers = extensions.fake.layers

    const context = CircuitJsonDocumentContext.prepareStructuredClone(document)

    assert.strictEqual(context.extensions, extensions)
    assert.strictEqual(context.extensions.fake.layers, layers)
    assert.equal(Object.isFrozen(extensions), true)
    assert.equal(Object.isFrozen(layers[0].points[0]), true)
})

test('structured-clone adoption normalizes only built-in subtrees', () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-built-in-subtree',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'native',
                    included: ['createdAt', 'layers'],
                    omitted: []
                },
                createdAt: new Date('2026-01-02T03:04:05.000Z'),
                layers: [{ id: 'top' }]
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const extensions = document.extensions
    const layers = extensions.fake.layers

    const context = CircuitJsonDocumentContext.prepareStructuredClone(document)

    assert.strictEqual(context.extensions, extensions)
    assert.strictEqual(context.extensions.fake.layers, layers)
    assert.equal(context.extensions.fake.createdAt, '2026-01-02T03:04:05.000Z')
})

test('structured-clone adoption reuses its validation traversal for sealing', () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-single-pass-seal',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'native',
                    included: ['layers'],
                    omitted: []
                },
                layers: Array.from({ length: 64 }, (_, index) => ({
                    id: `layer-${index}`,
                    visible: index % 2 === 0
                }))
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors
    let wholeContainerScans = 0
    Object.getOwnPropertyDescriptors = (...args) => {
        wholeContainerScans += 1
        return Reflect.apply(originalGetOwnPropertyDescriptors, Object, args)
    }

    try {
        CircuitJsonDocumentContext.prepareStructuredClone(document)
    } finally {
        Object.getOwnPropertyDescriptors = originalGetOwnPropertyDescriptors
    }

    assert.equal(wholeContainerScans, 0)
})

test('asynchronous structured-clone preparation yields before sealing extensions', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-prepare',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'native',
                    included: ['layers'],
                    omitted: []
                },
                layers: [{ id: 'top' }]
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    let yields = 0

    const context =
        await CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
                assert.equal(Object.isFrozen(document.model), true)
                assert.equal(Object.isFrozen(document.extensions), false)
            }
        })

    assert.equal(yields, 1)
    assert.equal(Object.isFrozen(document.extensions), true)
    assert.strictEqual(context.document, document)
})

test('asynchronous structured-clone preparation yields inside large extension adoption', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-large-extension',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'native',
                    included: ['records', 'payload'],
                    omitted: []
                },
                payload: new Uint8Array([1, 2, 3]),
                records: Array.from({ length: 12_000 }, (_, index) => ({
                    id: `record-${index}`,
                    point: { x: index, y: index + 1 },
                    visible: index % 2 === 0
                }))
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    let yields = 0

    const context =
        await CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
            }
        })

    assert.ok(yields > 2)
    assert.deepEqual([...context.extensions.fake.payload], [1, 2, 3])
    assert.equal(Object.isFrozen(context.extensions.fake.records), true)
    assert.equal(
        Object.isFrozen(context.extensions.fake.records.at(-1).point),
        true
    )
})

test('exclusive ownership violation of an acquired record is rejected', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-rejects-extension-race',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'native',
                    included: ['records'],
                    omitted: []
                },
                records: Array.from({ length: 12_000 }, (_, index) => ({
                    id: `record-${index}`,
                    value: index
                }))
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const retainedRecord = document.extensions.fake.records[0]
    let yields = 0

    await assert.rejects(
        CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
                if (yields !== 2) return
                Object.defineProperty(retainedRecord, 'value', {
                    configurable: true,
                    enumerable: true,
                    get: () => 7
                })
            }
        }),
        /changed during adoption|ordinary data properties/iu
    )

    assert.ok(yields > 1)
})

test('asynchronous structured-clone adoption chunks large container locking', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-container-lock',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                values: Array.from({ length: 12_000 }, (_, index) => index)
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const values = document.extensions.fake.values
    let sawProgressiveLock = false
    let context
    Object.defineProperty(Array.prototype, 'inheritedTraversalProbe', {
        configurable: true,
        enumerable: true,
        value: true
    })

    try {
        context = await CircuitJsonDocumentContext.prepareStructuredCloneAsync(
            document,
            {
                ownership: 'exclusive',
                yield: async () => {
                    const current = document.extensions.fake.values
                    const first = Object.getOwnPropertyDescriptor(current, '0')
                    const last = Object.getOwnPropertyDescriptor(
                        current,
                        '11999'
                    )
                    if (
                        current !== values &&
                        first?.writable === false &&
                        last?.writable === true &&
                        !Object.isExtensible(current)
                    ) {
                        sawProgressiveLock = true
                    }
                }
            }
        )
    } finally {
        delete Array.prototype.inheritedTraversalProbe
    }

    assert.equal(sawProgressiveLock, true)
    assert.equal(Object.isFrozen(context.extensions.fake.values), true)
})

test('cooperative array normalization excludes hidden keys and preserves graph identity', async () => {
    const values = [1, 2, 3]
    values.push(values)
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-clean-array',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: { fake: { alias: values, values } },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const transferred = document.extensions.fake.values
    const hiddenSymbol = Symbol('hidden-extension-value')
    Object.defineProperty(transferred, 'hidden', {
        configurable: true,
        value: 7,
        writable: true
    })
    Object.defineProperty(transferred, hiddenSymbol, {
        configurable: true,
        enumerable: true,
        value: 8,
        writable: true
    })

    const context =
        await CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive'
        })
    const normalized = context.extensions.fake.values

    assert.notStrictEqual(normalized, transferred)
    assert.strictEqual(context.extensions.fake.alias, normalized)
    assert.strictEqual(normalized[3], normalized)
    assert.equal(Object.hasOwn(normalized, 'hidden'), false)
    assert.equal(Object.hasOwn(normalized, hiddenSymbol), false)
    assert.equal(Object.isFrozen(normalized), true)
})

test('exclusive ownership violations before acquisition are outside snapshot semantics', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-exclusive-transfer-contract',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                records: Array.from({ length: 12_000 }, (_, index) => ({
                    id: `record-${index}`,
                    value: index
                }))
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const unacquired = document.extensions.fake.records.at(-1)
    let mutationApplied = false
    let yields = 0

    const context =
        await CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
                if (yields === 2) {
                    mutationApplied = Reflect.set(unacquired, 'value', -1)
                }
            }
        })

    assert.equal(mutationApplied, true)
    assert.equal(context.extensions.fake.records.at(-1).value, -1)
    assert.equal(Object.isFrozen(context.extensions.fake.records.at(-1)), true)
})

test('cooperative preparation caps individual plain extension records', async () => {
    const oversizedRecord = Object.fromEntries(
        Array.from({ length: 16_385 }, (_, index) => [`field${index}`, index])
    )
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-record-cap',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: { fake: { oversizedRecord } },
        assets: [],
        diagnostics: [],
        statistics: {}
    })

    await assert.rejects(
        CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive'
        }),
        /too many properties/iu
    )
})

test('asynchronous structured-clone preparation requires exclusive ownership', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-atomic-retained-alias',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: {
                records: Array.from({ length: 12_000 }, (_, index) => ({
                    id: `record-${index}`,
                    value: index
                }))
            }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    let yields = 0

    await assert.rejects(
        CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            yield: async () => {
                yields += 1
            }
        }),
        /exclusive ownership/iu
    )

    assert.equal(yields, 0)
    assert.equal(document.extensions.fake.records.at(-1).value, 11_999)
    assert.equal(Object.isFrozen(document.extensions), false)
})

test('asynchronous preparation reuses an immutable context without a transfer', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-context-reuse',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: { fake: { values: [1, 2, 3] } },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const context = CircuitJsonDocumentContext.prepareStructuredClone(document)

    assert.strictEqual(
        await CircuitJsonDocumentContext.prepareStructuredCloneAsync(context),
        context
    )
})

test('transferred structured-clone preparation chunks large immutable text accounting', async () => {
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-large-text',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: {
            fake: { note: 'x'.repeat(4 * 1024 * 1024) }
        },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    let yields = 0

    const context =
        await CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
            }
        })

    assert.ok(yields > 2)
    assert.equal(context.extensions.fake.note.length, 4 * 1024 * 1024)
})

test('chunked text accounting preserves a surrogate pair at a slice boundary', async () => {
    const note = `${'x'.repeat(64 * 1024 - 1)}😀`
    const state = StructuredDataSnapshot.createState({
        maxBytes: 64 * 1024 + 3,
        standardBuiltins: true
    })
    let yields = 0

    const adopted = await StructuredDataSnapshot.adoptStructuredCloneAsync(
        structuredClone({ note }),
        state,
        async () => {
            yields += 1
        }
    )

    assert.equal(adopted.note, note)
    assert.equal(state.bytes, 64 * 1024 + 3)
    assert.ok(yields > 1)
})

test('exclusive structured-clone preparation yields while copying large binaries', async () => {
    const payload = new Uint8Array(4 * 1024 * 1024)
    payload[0] = 3
    payload[payload.length - 1] = 7
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-large-binary',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: { fake: { payload } },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    let yields = 0

    const context =
        await CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
            }
        })

    assert.ok(yields > 2)
    assert.equal(context.extensions.fake.payload[0], 3)
    assert.equal(context.extensions.fake.payload.at(-1), 7)
    assert.notStrictEqual(context.extensions.fake.payload, payload)
})

test('large Map normalization avoids whole-array key scans', async () => {
    const lookup = new Map(
        Array.from({ length: 12_000 }, (_, index) => [`key-${index}`, index])
    )
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-map-result',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: { fake: { lookup } },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const originalOwnKeys = Reflect.ownKeys
    let largeArrayScans = 0
    Reflect.ownKeys = (value) => {
        if (Array.isArray(value) && value.length >= 12_000) {
            largeArrayScans += 1
        }
        return originalOwnKeys(value)
    }
    let context

    try {
        context = await CircuitJsonDocumentContext.prepareStructuredCloneAsync(
            document,
            { ownership: 'exclusive' }
        )
    } finally {
        Reflect.ownKeys = originalOwnKeys
    }

    assert.equal(largeArrayScans, 0)
    assert.equal(context.extensions.fake.lookup.length, 12_000)
    assert.equal(Object.isFrozen(context.extensions.fake.lookup), true)
})

test('exclusive structured-clone preparation yields inside large Map iteration', async () => {
    const lookup = new Map(
        Array.from({ length: 12_000 }, (_, index) => [`key-${index}`, index])
    )
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-large-map',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: { fake: { lookup } },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const retainedLookup = document.extensions.fake.lookup
    let yields = 0

    await assert.rejects(
        CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
                if (yields === 2) retainedLookup.delete('key-11999')
            }
        }),
        /map changed during inspection/iu
    )

    assert.ok(yields > 1)
})

test('exclusive structured-clone preparation yields inside large Set iteration', async () => {
    const values = new Set(
        Array.from({ length: 12_000 }, (_, index) => `value-${index}`)
    )
    const document = structuredClone({
        schema: 'ecad-toolkit.document.v1',
        id: 'document-cooperative-large-set',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'fake',
            fileName: 'fake-board.json',
            fileType: 'pcb'
        },
        extensions: { fake: { values } },
        assets: [],
        diagnostics: [],
        statistics: {}
    })
    const retainedValues = document.extensions.fake.values
    let yields = 0

    await assert.rejects(
        CircuitJsonDocumentContext.prepareStructuredCloneAsync(document, {
            ownership: 'exclusive',
            yield: async () => {
                yields += 1
                if (yields === 2) retainedValues.delete('value-11999')
            }
        }),
        /set changed during inspection/iu
    )

    assert.ok(yields > 1)
})

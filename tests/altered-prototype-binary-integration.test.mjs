import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { CircuitJsonDocumentContext } from '../src/index.mjs'
import { StructuredDataSnapshot } from '../src/core/context/StructuredDataSnapshot.mjs'
import { ToolkitAsset } from '../src/parser.mjs'

const SOURCE_BYTES = Object.freeze([3, 17, 29, 43])

/**
 * Creates genuine raw buffers whose ordinary prototype identity was altered.
 * @returns {{ label: string, buffer: ArrayBuffer | SharedArrayBuffer, view: Uint8Array }[]} Binary scenarios.
 */
function alteredRawBuffers() {
    const constructors = [
        {
            label: 'ArrayBuffer',
            create: () => new ArrayBuffer(SOURCE_BYTES.length)
        }
    ]
    if (typeof SharedArrayBuffer === 'function') {
        constructors.push({
            label: 'SharedArrayBuffer',
            create: () => new SharedArrayBuffer(SOURCE_BYTES.length)
        })
    }

    const scenarios = []
    for (const constructor of constructors) {
        for (const prototype of [Object.prototype, null]) {
            const buffer = constructor.create()
            const view = new Uint8Array(buffer)
            view.set(SOURCE_BYTES)
            Object.setPrototypeOf(buffer, prototype)
            scenarios.push({
                label:
                    constructor.label +
                    ' with ' +
                    (prototype === null ? 'null' : 'Object.prototype'),
                buffer,
                view
            })
        }
    }
    return scenarios
}

/**
 * Builds one canonical document containing a binary extension value.
 * @param {unknown} payload Extension payload.
 * @returns {Record<string, any>} Canonical document.
 */
function createDocument(payload) {
    return {
        schema: 'ecad-toolkit.document.v1',
        id: 'document-altered-binary',
        modelSchema: { name: 'circuit-json', version: '0.0.446' },
        model: [],
        source: {
            format: 'circuitjson',
            fileName: 'fake-board.json',
            fileType: 'circuitjson'
        },
        extensions: {
            fixture: {
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
    }
}

test('StructuredDataSnapshot.capture preserves altered-prototype raw buffer bytes', () => {
    for (const scenario of alteredRawBuffers()) {
        const snapshot = StructuredDataSnapshot.capture(scenario.buffer)

        assert.deepEqual(snapshot, SOURCE_BYTES, scenario.label)
        scenario.view.fill(255)
        assert.deepEqual(
            snapshot,
            SOURCE_BYTES,
            scenario.label + ' must be isolated from later source mutation'
        )
    }
})

test('ToolkitAsset.create owns altered-prototype raw buffer payloads', () => {
    for (const scenario of alteredRawBuffers()) {
        const asset = ToolkitAsset.create({
            name: 'fixture.bin',
            data: scenario.buffer
        })
        const ownedBytes = asset.data

        assert.equal(asset.byteLength, SOURCE_BYTES.length, scenario.label)
        assert.equal(ownedBytes instanceof Uint8Array, true, scenario.label)
        assert.equal(
            ownedBytes.buffer instanceof ArrayBuffer,
            true,
            scenario.label
        )
        assert.notStrictEqual(
            ownedBytes.buffer,
            scenario.buffer,
            scenario.label
        )
        assert.deepEqual([...ownedBytes], SOURCE_BYTES, scenario.label)

        scenario.view.fill(0)
        assert.deepEqual(
            [...ownedBytes],
            SOURCE_BYTES,
            scenario.label + ' must be isolated from later source mutation'
        )
        assert.doesNotThrow(() => structuredClone(asset), scenario.label)
    }
})

test('exact contexts retain altered and cross-realm typed-array element types', () => {
    const altered = new Uint16Array([0x1234, 0x5678])
    Object.setPrototypeOf(altered, Object.prototype)
    const crossRealm = vm.runInNewContext('new Float32Array([1.25, -2.5])')
    let tagAccessorCalls = 0
    const shadowedTag = new Int32Array([7, -4])
    Object.defineProperty(shadowedTag, Symbol.toStringTag, {
        get() {
            tagAccessorCalls += 1
            throw new Error('untrusted typed-array tag accessor')
        }
    })

    const scenarios = [
        {
            label: 'altered Uint16Array',
            payload: altered,
            Constructor: Uint16Array,
            values: [0x1234, 0x5678]
        },
        {
            label: 'cross-realm Float32Array',
            payload: crossRealm,
            Constructor: Float32Array,
            values: [1.25, -2.5]
        },
        {
            label: 'shadowed Int32Array tag',
            payload: shadowedTag,
            Constructor: Int32Array,
            values: [7, -4]
        }
    ]
    if (typeof BigUint64Array === 'function') {
        scenarios.push({
            label: 'cross-realm BigUint64Array',
            payload: vm.runInNewContext('new BigUint64Array([1n, 9n])'),
            Constructor: BigUint64Array,
            values: [1n, 9n]
        })
    }
    if (typeof globalThis.Float16Array === 'function') {
        scenarios.push({
            label: 'Float16Array',
            payload: new globalThis.Float16Array([1.5, -2]),
            Constructor: globalThis.Float16Array,
            values: [1.5, -2]
        })
    }

    for (const scenario of scenarios) {
        const context = CircuitJsonDocumentContext.prepare(
            createDocument(scenario.payload)
        )
        const owned = context.extensions.fixture.payload

        assert.equal(
            owned instanceof scenario.Constructor,
            true,
            scenario.label
        )
        assert.deepEqual([...owned], scenario.values, scenario.label)
    }
    assert.equal(tagAccessorCalls, 0)
})

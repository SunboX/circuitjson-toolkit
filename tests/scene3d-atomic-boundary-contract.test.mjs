import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { CircuitJsonReadOnlyDocument } from '../src/core/context/CircuitJsonReadOnlyDocument.mjs'
import { StructuredDataSnapshot } from '../src/core/context/StructuredDataSnapshot.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { PcbScene3dBuilder } from '../src/scene3d.mjs'
import { createNativeDocument } from './helpers/FakeScene3dDocuments.mjs'

const U_SHAPE = Object.freeze([
    Object.freeze({ x: -3, y: -3 }),
    Object.freeze({ x: 3, y: -3 }),
    Object.freeze({ x: 3, y: 3 }),
    Object.freeze({ x: 1, y: 3 }),
    Object.freeze({ x: 1, y: -1 }),
    Object.freeze({ x: -1, y: -1 }),
    Object.freeze({ x: -1, y: 3 }),
    Object.freeze({ x: -3, y: 3 })
])

/**
 * Subdivides every U-shape edge without changing its geometry.
 * @returns {{ x: number, y: number }[]} A 512-point polygon.
 */
function detailedUShape() {
    const points = []
    for (let edge = 0; edge < U_SHAPE.length; edge += 1) {
        const start = U_SHAPE[edge]
        const end = U_SHAPE[(edge + 1) % U_SHAPE.length]
        for (let step = 0; step < 64; step += 1) {
            const progress = step / 64
            points.push({
                x: start.x + (end.x - start.x) * progress,
                y: start.y + (end.y - start.y) * progress
            })
        }
    }
    return points
}

/**
 * Creates a prepared unique-coordinate overlap workload.
 * @param {number} count U-board and pad count.
 * @returns {CircuitJsonDocumentContext} Prepared document context.
 */
function uniqueOverlapContext(count) {
    const polygon = detailedUShape()
    const model = []
    for (let index = 0; index < count; index += 1) {
        model.push({
            type: 'pcb_board',
            pcb_board_id: `detailed-u-${index}`,
            center: { x: 0, y: 0 },
            width: 6,
            height: 6,
            thickness: 1,
            points: polygon
        })
    }
    model.push({
        type: 'pcb_board',
        pcb_board_id: 'containing-board',
        center: { x: 0, y: 1 },
        width: 4,
        height: 4,
        thickness: 4
    })
    for (let index = 0; index < count; index += 1) {
        model.push({
            type: 'pcb_smtpad',
            pcb_smtpad_id: `unique-pad-${index}`,
            x: 0.9992 + (0.0006 * index) / Math.max(1, count - 1),
            y: 1,
            width: 0.01,
            height: 0.01,
            shape: 'rect',
            layer: 'top'
        })
    }
    return CircuitJsonDocumentContext.prepare(
        DocumentResult.createValidated({ model })
    )
}

/**
 * Measures one first scene build and validates the containing-board result.
 * @param {number} count Workload size.
 * @returns {number} Elapsed milliseconds.
 */
function uniqueOverlapMilliseconds(count) {
    const context = uniqueOverlapContext(count)
    const started = performance.now()
    const scene = PcbScene3dBuilder.build(context)
    const elapsed = performance.now() - started
    assert.equal(scene.pads.length, count)
    assert.equal(
        scene.pads.every((pad) => pad.position.z === 2),
        true
    )
    return elapsed
}

/**
 * Returns the median of five fresh first-build measurements.
 * @param {number} count Workload size.
 * @returns {number} Median milliseconds.
 */
function uniqueOverlapMedian(count) {
    const samples = Array.from({ length: 5 }, () =>
        uniqueOverlapMilliseconds(count)
    ).sort((left, right) => left - right)
    return samples[2]
}

test('unique overlap coordinates retain subquadratic point-location scaling', () => {
    uniqueOverlapMilliseconds(32)
    const at100 = uniqueOverlapMedian(100)
    const at200 = uniqueOverlapMedian(200)
    const at400 = uniqueOverlapMedian(400)

    assert.ok(
        at200 < at100 * 2.8 && at400 < at200 * 2.8,
        `unique overlap scaling was ${at100.toFixed(1)} / ${at200.toFixed(1)} / ${at400.toFixed(1)} ms`
    )
})

test('asset descriptors are captured once for both byte limits and ownership', () => {
    const document = structuredClone(
        createNativeDocument('full', { withModelReference: false })
    )
    const target = document.assets[0]
    let dataDescriptorReads = 0
    document.assets[0] = new Proxy(target, {
        getOwnPropertyDescriptor(owner, key) {
            const descriptor = Reflect.getOwnPropertyDescriptor(owner, key)
            if (key !== 'data') return descriptor
            dataDescriptorReads += 1
            if (dataDescriptorReads > 3) return descriptor
            return {
                ...descriptor,
                value: new Uint8Array(dataDescriptorReads <= 2 ? 1 : 4096).fill(
                    7
                )
            }
        }
    })

    const scene = PcbScene3dBuilder.build(document, {
        fidelity: 'canonical',
        maxAssetBytes: 16,
        maxTotalAssetBytes: 16
    })

    assert.equal(scene.schema, 'ecad-toolkit.scene3d.v1')
    assert.equal(dataDescriptorReads, 1)
})

test('metadata is bounded and copied in one descriptor traversal', () => {
    const document = structuredClone(
        createNativeDocument('none', { withModelReference: false })
    )
    const lateKeys = Array.from(
        { length: 120_001 },
        (_, index) => `late-${index}`
    )
    let ownKeyCalls = 0
    let descriptorCalls = 0
    document.source.metadata = new Proxy(Object.create(null), {
        ownKeys() {
            ownKeyCalls += 1
            return ownKeyCalls === 2 ? lateKeys : []
        },
        getOwnPropertyDescriptor() {
            descriptorCalls += 1
            return {
                configurable: true,
                enumerable: true,
                writable: true,
                value: 1
            }
        }
    })

    const scene = PcbScene3dBuilder.build(document)

    assert.equal(scene.schema, 'ecad-toolkit.scene3d.v1')
    assert.equal(ownKeyCalls, 1)
    assert.equal(descriptorCalls, 0)
})

test('binary metadata output consumes the shared item budget before copying', () => {
    const blobs = [
        new ArrayBuffer(100_001),
        new DataView(new ArrayBuffer(100_001)),
        new Uint16Array(50_001)
    ]
    if (typeof SharedArrayBuffer === 'function') {
        blobs.push(new SharedArrayBuffer(100_001))
    }
    for (const blob of blobs) {
        const document = structuredClone(
            createNativeDocument('none', { withModelReference: false })
        )
        document.source.metadata = { blob }

        assert.throws(
            () => PcbScene3dBuilder.build(document),
            /asset source is too large/u
        )
    }
})

test('binary metadata copies only the range used for budget accounting', () => {
    if (
        typeof SharedArrayBuffer !== 'function' ||
        typeof SharedArrayBuffer.prototype.grow !== 'function'
    ) {
        return
    }
    const blob = new SharedArrayBuffer(1, { maxByteLength: 200_000 })
    new Uint8Array(blob)[0] = 7
    const originalOwnKeys = Reflect.ownKeys
    Reflect.ownKeys = (value) => {
        if (value === blob) blob.grow(100_001)
        return originalOwnKeys(value)
    }
    try {
        const snapshot = StructuredDataSnapshot.capture(blob)
        assert.deepEqual(snapshot, [7])
    } finally {
        Reflect.ownKeys = originalOwnKeys
    }
})

test('resident asset limits and ownership use one captured binary range', () => {
    if (
        typeof SharedArrayBuffer !== 'function' ||
        typeof SharedArrayBuffer.prototype.grow !== 'function'
    ) {
        return
    }
    const original = structuredClone(createNativeDocument('full')).assets[0]
    const payload = new SharedArrayBuffer(1, { maxByteLength: 200_000 })
    new Uint8Array(payload)[0] = 9
    const fields = { ...original }
    delete fields.data
    const reordered = { data: payload, ...fields, trigger: true }
    let triggerCalls = 0
    const asset = new Proxy(reordered, {
        getOwnPropertyDescriptor(owner, key) {
            const descriptor = Reflect.getOwnPropertyDescriptor(owner, key)
            if (key === 'trigger') {
                triggerCalls += 1
                payload.grow(100_001)
            }
            return descriptor
        }
    })

    const captured = CircuitJsonReadOnlyDocument.captureAsset(
        asset,
        null,
        false,
        (byteLength) => assert.equal(byteLength, 1)
    )

    assert.equal(triggerCalls, 1)
    assert.equal(captured.data.byteLength, 1)
    assert.deepEqual([...captured.data], [9])
})

test('shrinking binary metadata during capture fails atomically', () => {
    if (typeof ArrayBuffer.prototype.resize !== 'function') return
    const blob = new ArrayBuffer(10, { maxByteLength: 10 })
    const originalOwnKeys = Reflect.ownKeys
    Reflect.ownKeys = (value) => {
        if (value === blob) blob.resize(1)
        return originalOwnKeys(value)
    }
    try {
        assert.throws(
            () => StructuredDataSnapshot.capture(blob),
            /changed during capture/u
        )
    } finally {
        Reflect.ownKeys = originalOwnKeys
    }
})

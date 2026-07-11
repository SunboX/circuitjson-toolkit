import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { PcbScene3dBuilder } from '../src/scene3d.mjs'
import {
    createAssemblyModel,
    createNativeDocument
} from './helpers/FakeScene3dDocuments.mjs'

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
 * Translates the shared U polygon on the X axis.
 * @param {number} offsetX X offset.
 * @returns {{ x: number, y: number }[]} Translated points.
 */
function uShape(offsetX = 0) {
    return U_SHAPE.map((point) => ({
        x: point.x + offsetX,
        y: point.y
    }))
}

/**
 * Creates an overlapping-AABB point-location workload.
 * @param {number} count Equal outline and pad count.
 * @returns {CircuitJsonDocumentContext} Prepared context.
 */
function overlappingContext(count) {
    const model = []
    for (let index = 0; index < count; index += 1) {
        model.push({
            type: 'pcb_board',
            pcb_board_id: `overlap-board-${index}`,
            center: { x: 0, y: 0 },
            width: 6,
            height: 6,
            thickness: index === count - 1 ? 4 : 1,
            ...(index === count - 1 ? {} : { points: uShape() })
        })
    }
    for (let index = 0; index < count; index += 1) {
        model.push({
            type: 'pcb_smtpad',
            pcb_smtpad_id: `overlap-pad-${index}`,
            x: 0,
            y: 1,
            width: 0.1,
            height: 0.1,
            shape: 'rect',
            layer: 'top'
        })
    }
    return CircuitJsonDocumentContext.prepare(
        DocumentResult.createValidated({ model })
    )
}

/**
 * Measures first-build point-location work and verifies the exact winner.
 * @param {number} count Equal outline and pad count.
 * @returns {number} Build milliseconds.
 */
function overlappingMilliseconds(count) {
    const context = overlappingContext(count)
    const started = performance.now()
    const scene = PcbScene3dBuilder.build(context)
    const elapsed = performance.now() - started
    assert.equal(scene.pads[0].position.z, 2)
    return elapsed
}

test('nested source and extension records become owned data without get traps', () => {
    const document = structuredClone(createNativeDocument('full'))
    let reads = 0
    const sourceMetadata = new Proxy(
        { nested: { revision: 'A' } },
        {
            get(target, key, receiver) {
                reads += 1
                return Reflect.get(target, key, receiver)
            }
        }
    )
    const extension = new Proxy(document.extensions.altium, {
        get(target, key, receiver) {
            reads += 1
            return Reflect.get(target, key, receiver)
        }
    })
    document.source.metadata = sourceMetadata
    document.extensions.altium = extension

    const context = CircuitJsonDocumentContext.prepare(document)
    const scene = PcbScene3dBuilder.build(context, { fidelity: 'native' })

    assert.equal(scene.statistics.nativeFidelity, 1)
    assert.equal(reads, 0)
    assert.notStrictEqual(context.source.metadata, sourceMetadata)
    assert.notStrictEqual(context.extensions.altium, extension)
    assert.equal(Object.isFrozen(context.source.metadata.nested), true)
    assert.equal(Object.isFrozen(context.extensions.altium.$meta), true)
})

test('extension metadata rejects coercible fields and entries without execution', () => {
    const document = structuredClone(createNativeDocument('full'))
    let coercions = 0
    const coercible = {
        [Symbol.toPrimitive]() {
            coercions += 1
            return 'canonical'
        }
    }
    document.extensions.altium.$meta.completeness = coercible
    document.extensions.altium.$meta.included = [coercible]

    assert.throws(
        () => PcbScene3dBuilder.build(document, { fidelity: 'native' }),
        TypeError
    )
    assert.equal(coercions, 0)
})

test('concave polygon representative remains on geometry and its exact board', () => {
    const points = uShape(30)
    const model = [
        {
            type: 'pcb_board',
            pcb_board_id: 'thin-overlap',
            center: { x: 30, y: 1 },
            width: 1,
            height: 1,
            thickness: 1
        },
        {
            type: 'pcb_board',
            pcb_board_id: 'u-board',
            center: { x: 30, y: 0 },
            width: 6,
            height: 6,
            thickness: 4,
            points
        },
        {
            type: 'pcb_copper_pour',
            pcb_copper_pour_id: 'u-zone',
            shape: 'polygon',
            points,
            layer: 'bottom',
            net: 'U_GND'
        }
    ]

    const scene = PcbScene3dBuilder.build(model)
    const zone = scene.zones[0]

    assert.deepEqual(zone.position, { x: 30, y: -3, z: -2 })
})

test('context and scene metadata normalize mutable-slot built-ins to frozen data', () => {
    const document = structuredClone(createNativeDocument('full'))
    document.source.metadata = {
        values: new Map([['scale', 1]]),
        tags: new Set(['mechanical']),
        timestamp: new Date('2020-01-02T03:04:05.000Z'),
        matcher: /body/giu
    }
    document.assets[0].source.metadata = {
        values: new Map([['asset-scale', 2]])
    }
    const context = CircuitJsonDocumentContext.prepare(document)

    assert.deepEqual(context.source.metadata.values, [['scale', 1]])
    assert.deepEqual(context.source.metadata.tags, ['mechanical'])
    assert.equal(context.source.metadata.timestamp, '2020-01-02T03:04:05.000Z')
    assert.deepEqual(context.source.metadata.matcher, {
        source: 'body',
        flags: 'giu',
        lastIndex: 0
    })
    assert.deepEqual(context.assets[0].source.metadata.values, [
        ['asset-scale', 2]
    ])
    assert.equal(Object.isFrozen(context.source.metadata.values), true)
    assert.equal(Object.isFrozen(context.source.metadata.values[0]), true)
    assert.equal(
        Object.isFrozen(context.assets[0].source.metadata.values),
        true
    )
    assert.throws(
        () => context.source.metadata.values.push(['late', 3]),
        TypeError
    )
    assert.throws(
        () => context.assets[0].source.metadata.values.push(['late-asset', 3]),
        TypeError
    )

    const first = PcbScene3dBuilder.build(context, { fidelity: 'native' })
    const second = PcbScene3dBuilder.build(context, { fidelity: 'native' })
    assert.deepEqual(second, first)
    assert.equal(Object.isFrozen(first.assets[0].source.metadata.values), true)
})

test('overlapping polygon AABBs retain exact point location subquadratically', () => {
    overlappingMilliseconds(64)
    const at500 = overlappingMilliseconds(500)
    const at1000 = overlappingMilliseconds(1000)
    const at2000 = overlappingMilliseconds(2000)

    assert.ok(
        at1000 < at500 * 2.8 && at2000 < at1000 * 2.8,
        `overlap scaling was ${at500.toFixed(1)} / ${at1000.toFixed(1)} / ${at2000.toFixed(1)} ms`
    )
})

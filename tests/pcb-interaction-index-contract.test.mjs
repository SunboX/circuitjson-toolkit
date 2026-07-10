import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { PcbInteractionIndex } from '../src/interaction.mjs'
import { createRichCircuitJsonDocument } from './helpers/FakePcbInteractionDocuments.mjs'

test('PcbInteractionIndex reuses one broad phase and returns canonical hits', () => {
    const context = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    const index = PcbInteractionIndex.create(context)
    const hits = index.hitTest({ x: 0.6, y: 0.6 }, { tolerance: 0 })

    assert.deepEqual(
        hits.map((hit) => hit.elementId),
        ['pad_rot', 'courtyard_1', 'board_1']
    )
    assert.deepEqual(hits[0], {
        elementId: 'pad_rot',
        primitiveId: 'pad_rot',
        kind: 'pad',
        side: 'top',
        layerId: 'top',
        bounds: {
            minX: 0.15805826175840776,
            minY: 0.15805826175840776,
            maxX: 1.0419417382415923,
            maxY: 1.0419417382415923
        },
        distance: 0,
        componentId: 'pcb_u1',
        netName: 'SIG',
        groupIds: ['group_1'],
        source: {
            format: 'circuitjson',
            elementId: 'pad_rot',
            elementType: 'pcb_smtpad'
        }
    })
    assert.equal(
        index.pick({ x: 0.6, y: 0.6 }, { tolerance: 0 }).elementId,
        'pad_rot'
    )
    assert.equal(index.hitTest({ x: 200, y: 200 }).length, 0)
    assert.equal(index.statistics.spatialIndexBuilds, 1)
    assert.equal(index.statistics.primitiveBuilds, 1)
    assert.doesNotThrow(() => structuredClone(hits))

    const second = PcbInteractionIndex.create(context)
    second.hitTest({ x: 1.4, y: 0.6 }, { tolerance: 0 })
    assert.equal(second.statistics.spatialIndexBuilds, 1)
    assert.equal(second.statistics.primitiveBuilds, 1)
})

test('PcbInteractionIndex applies exact geometry after its broad phase', () => {
    const index = PcbInteractionIndex.create(createRichCircuitJsonDocument())

    assert.equal(
        index
            .hitTest({ x: 0.8, y: 0.9 }, { tolerance: 0 })
            .some((hit) => hit.elementId === 'pad_rot'),
        true
    )
    assert.equal(
        index
            .hitTest({ x: 0.45, y: 1.75 }, { tolerance: 0 })
            .some((hit) => hit.elementId === 'pad_poly'),
        false
    )
    assert.equal(
        index
            .hitTest({ x: 0.86, y: 0.43 }, { tolerance: 0 })
            .some((hit) => hit.elementId === 'pad_pill'),
        false
    )
})

test('PcbInteractionIndex normalizes reusable visibility defaults', () => {
    const index = PcbInteractionIndex.create(createRichCircuitJsonDocument(), {
        side: 'top',
        hiddenLayers: ['top_silkscreen']
    })

    assert.equal(
        index
            .hitTest({ x: 0.6, y: 0.6 }, { tolerance: 0 })
            .some((hit) => hit.layerId === 'top_silkscreen'),
        false
    )
    assert.equal(
        index
            .hitTest(
                { x: 0.6, y: 0.6 },
                { tolerance: 0, hiddenObjects: ['pads'] }
            )
            .some((hit) => hit.kind === 'pad'),
        false
    )
})

test('PcbInteractionIndex rejects unsafe options without executing accessors', () => {
    let getterCalls = 0
    const options = {}
    Object.defineProperty(options, 'side', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 'top'
        }
    })

    assert.throws(
        () =>
            PcbInteractionIndex.create(
                createRichCircuitJsonDocument(),
                options
            ),
        { code: 'ERR_INTERACTION_OPTIONS' }
    )
    assert.equal(getterCalls, 0)
    const index = PcbInteractionIndex.create(createRichCircuitJsonDocument())
    for (const invalid of [
        { side: 'front' },
        { tolerance: -1 },
        { hiddenLayers: 'top' },
        { unknown: true }
    ]) {
        assert.throws(() => index.hitTest({ x: 0, y: 0 }, invalid), {
            code: 'ERR_INTERACTION_OPTIONS'
        })
    }

    const point = { y: 0 }
    Object.defineProperty(point, 'x', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 0
        }
    })
    assert.throws(() => index.hitTest(point), {
        code: 'ERR_INTERACTION_OPTIONS'
    })
    assert.equal(getterCalls, 0)
})

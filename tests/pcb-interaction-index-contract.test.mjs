import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { PcbPrimitivePreparation } from '../src/core/context/PcbPrimitivePreparation.mjs'
import { CircuitJsonPcbClearanceDiagnostics } from '../src/core/CircuitJsonPcbClearanceDiagnostics.mjs'
import { PcbInteractionIndex } from '../src/interaction.mjs'
import { PcbInteractionPrimitiveModel } from '../src/renderers.mjs'
import { createRichCircuitJsonDocument } from './helpers/FakePcbInteractionDocuments.mjs'

/**
 * Builds independent rotated and diagonal interaction geometry.
 * @returns {object[]} Standards-shaped PCB document.
 */
function createDifferentialGeometryDocument() {
    return [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_grid',
            center: { x: 0, y: 0 },
            width: 20,
            height: 20
        },
        {
            type: 'pcb_smtpad',
            pcb_smtpad_id: 'pad_grid',
            shape: 'rotated_rect',
            x: 0,
            y: 0,
            width: 2,
            height: 0.2,
            ccw_rotation: 45,
            layer: 'top',
            net: 'PAD_NET'
        },
        {
            type: 'pcb_trace',
            pcb_trace_id: 'trace_grid',
            net: 'TRACE_NET',
            route: [
                {
                    route_type: 'wire',
                    x: -4,
                    y: -3,
                    width: 0.24,
                    layer: 'top'
                },
                {
                    route_type: 'wire',
                    x: -2,
                    y: -1,
                    width: 0.24,
                    layer: 'top'
                }
            ]
        },
        {
            type: 'pcb_courtyard_line',
            pcb_courtyard_line_id: 'courtyard_grid',
            x1: 2,
            y1: -2,
            x2: 4,
            y2: 0,
            width: 0.18,
            layer: 'top_courtyard'
        },
        {
            type: 'pcb_plated_hole',
            pcb_plated_hole_id: 'hole_grid',
            shape: 'circular_hole_with_rect_pad',
            x: 3,
            y: 3,
            rect_pad_width: 1.8,
            rect_pad_height: 0.3,
            hole_diameter: 0.2,
            ccw_rotation: 30,
            layer: 'top',
            net: 'HOLE_NET'
        }
    ]
}

/**
 * Builds one stable legacy hit identity for differential comparisons.
 * @param {object} hit Legacy or canonical hit row.
 * @returns {string} Comparable identity.
 */
function hitIdentity(hit) {
    return [
        String(hit.id || hit.primitiveId || ''),
        String(hit.kind || ''),
        String(hit.layer || hit.layerId || '')
    ].join('|')
}

/**
 * Builds distinct-net pads that would trigger quadratic clearance overlays.
 * @param {number} count Pad count.
 * @returns {object[]} Synthetic interaction document.
 */
function createDistinctNetPadDocument(count) {
    return [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_scaling',
            center: { x: 0, y: 0 },
            width: count * 2,
            height: 4,
            min_trace_clearance: 0.2
        },
        ...Array.from({ length: count }, (_entry, index) => ({
            type: 'pcb_smtpad',
            pcb_smtpad_id: `pad_scaling_${index}`,
            shape: 'rect',
            x: index * 1.5 - count * 0.75,
            y: 0,
            width: 0.5,
            height: 0.5,
            layer: 'top',
            net: `NET_${index}`
        }))
    ]
}

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
            minX: 0.14999999999999997,
            minY: 0.15805826175840776,
            maxX: 1.05,
            maxY: 1.0419417382415923
        },
        distance: 0,
        componentId: 'pcb_u1',
        componentKey: 'U1',
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

test('PcbInteractionIndex broad phase is a conservative legacy differential over rotated geometry', () => {
    const document = createDifferentialGeometryDocument()
    const index = PcbInteractionIndex.create(document)
    const rotatedPadGrid = [
        [-1.18, -0.28],
        [-1.18, 0.28],
        [-1, 0],
        [0, 0],
        [1, 0],
        [1.18, -0.28],
        [1.18, 0.28]
    ].map(([x, y]) => ({
        x: (x - y) / Math.sqrt(2),
        y: (x + y) / Math.sqrt(2)
    }))
    const floatingBoundary = 0.1 + 0.2
    const points = [
        ...rotatedPadGrid,
        { x: -3, y: -2 },
        { x: -2.88, y: -2.12 },
        { x: 3, y: -1 },
        { x: 3.12, y: -1.12 },
        { x: 3, y: 3 },
        { x: 3.78, y: 3.45 },
        { x: floatingBoundary, y: floatingBoundary },
        {
            x: floatingBoundary + Number.EPSILON,
            y: floatingBoundary - Number.EPSILON
        }
    ]

    for (const tolerance of [0, 0.05, 0.2]) {
        for (const point of points) {
            const options = { tolerance }
            const legacy = PcbInteractionPrimitiveModel.hitTest(
                document,
                point,
                options
            ).map(hitIdentity)
            const prepared = index.hitTest(point, options).map(hitIdentity)
            assert.deepEqual(prepared, legacy, { point, tolerance })
        }
    }
})

test('PcbInteractionIndex preserves supported tolerance and finite-point limits', () => {
    const document = createDifferentialGeometryDocument()
    const index = PcbInteractionIndex.create(document)
    const point = { x: 0, y: 0 }
    const tolerance = 1_000_000

    assert.deepEqual(
        index.hitTest(point, { tolerance }).map(hitIdentity),
        PcbInteractionPrimitiveModel.hitTest(document, point, {
            tolerance
        }).map(hitIdentity)
    )
    assert.deepEqual(index.hitTest({ x: Number.MAX_VALUE, y: 0 }), [])
})

test('interaction bounds union stroke, point, stored, and rotated geometry', () => {
    assert.deepEqual(
        PcbInteractionPrimitiveModel.interactionBounds({
            kind: 'track',
            x1: 0,
            y1: 0,
            x2: 2,
            y2: 2,
            width: 2,
            points: [
                { x: 0, y: 0 },
                { x: 2, y: 2 }
            ],
            bounds: { minX: -0.5, minY: -0.5, maxX: 2.5, maxY: 2.5 }
        }),
        { minX: -1, minY: -1, maxX: 3, maxY: 3 }
    )
    assert.deepEqual(
        PcbInteractionPrimitiveModel.interactionBounds({
            kind: 'pad',
            x: 0,
            y: 0,
            width: 4,
            height: 0.2,
            rotation: 45,
            bounds: { minX: -2, minY: -0.1, maxX: 2, maxY: 0.1 }
        }),
        {
            minX: -2,
            minY: -1.4849242404917498,
            maxX: 2,
            maxY: 1.4849242404917498
        }
    )
})

test('PcbInteractionIndex binds duplicate primitive ids to their own source envelopes', () => {
    const document = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_collision',
            center: { x: 0, y: 0 },
            width: 8,
            height: 8
        },
        {
            type: 'pcb_smtpad',
            pcb_smtpad_id: 'shared_id',
            shape: 'rect',
            x: 0,
            y: 0,
            width: 2,
            height: 1,
            layer: 'top',
            net: 'PAD_NET'
        },
        {
            type: 'pcb_via',
            pcb_via_id: 'shared_id',
            x: 0,
            y: 0,
            outer_diameter: 0.5,
            hole_diameter: 0.2,
            layers: ['top', 'bottom'],
            net: 'VIA_NET'
        }
    ]
    const hits = PcbInteractionIndex.create(document).hitTest(
        { x: 0, y: 0 },
        { tolerance: 0 }
    )

    assert.deepEqual(
        hits.slice(0, 2).map((hit) => ({
            kind: hit.kind,
            netName: hit.netName,
            elementType: hit.source.elementType,
            bounds: hit.bounds
        })),
        [
            {
                kind: 'pad',
                netName: 'PAD_NET',
                elementType: 'pcb_smtpad',
                bounds: { minX: -1, minY: -0.5, maxX: 1, maxY: 0.5 }
            },
            {
                kind: 'via',
                netName: 'VIA_NET',
                elementType: 'pcb_via',
                bounds: {
                    minX: -0.25,
                    minY: -0.25,
                    maxX: 0.25,
                    maxY: 0.25
                }
            }
        ]
    )
})

test('PcbInteractionIndex rejects primitive and spatial cache key collisions', () => {
    const primitiveCollision = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    primitiveCollision.getOrCreateDerived(
        'pcb',
        'interaction-primitives-v1',
        () => Object.freeze({ primitives: [], groups: [] })
    )
    assert.throws(() => PcbInteractionIndex.create(primitiveCollision), {
        code: 'ERR_INTERACTION_CACHE_COLLISION'
    })

    const spatialCollision = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    spatialCollision.getOrCreateDerived('interaction', 'pcb-spatial-v2', () =>
        Object.freeze({ candidates: () => [] })
    )
    assert.throws(() => PcbInteractionIndex.create(spatialCollision), {
        code: 'ERR_INTERACTION_CACHE_COLLISION'
    })

    const completeCollision = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    completeCollision.getOrCreateDerived('render', 'pcb-primitives-v1', () =>
        Object.freeze({ primitives: [] })
    )
    assert.throws(
        () => PcbPrimitivePreparation.prepareComplete(completeCollision),
        { code: 'ERR_INTERACTION_CACHE_COLLISION' }
    )
})

test('PcbPrimitivePreparation binds immutable values to one context and key', () => {
    const firstContext = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    const secondContext = CircuitJsonDocumentContext.prepare(
        createRichCircuitJsonDocument()
    )
    const model = PcbPrimitivePreparation.prepareInteraction(firstContext)
    const complete = PcbPrimitivePreparation.prepareComplete(firstContext)

    assert.equal(Object.isFrozen(model), true)
    assert.equal(Object.isFrozen(model.primitives), true)
    assert.equal(Object.isFrozen(model.primitives[0]), true)
    assert.equal(Object.isFrozen(model.primitives[0].source), true)
    assert.equal(Object.isFrozen(complete), true)
    assert.equal(complete.primitives, model.primitives)
    assert.throws(
        () =>
            secondContext.getOrCreateDerived(
                'pcb',
                'interaction-primitives-v1',
                () => model
            ),
        TypeError
    )
})

test('PcbInteractionIndex preparation skips clearance and report overlays', () => {
    const original = CircuitJsonPcbClearanceDiagnostics.build
    let clearanceBuilds = 0
    CircuitJsonPcbClearanceDiagnostics.build = function (...args) {
        clearanceBuilds += 1
        return original.apply(this, args)
    }

    try {
        const index = PcbInteractionIndex.create(
            createDistinctNetPadDocument(24)
        )
        assert.equal(clearanceBuilds, 0)
        assert.equal(index.statistics.primitiveBuilds, 1)
        assert.equal(index.statistics.spatialIndexBuilds, 1)
    } finally {
        CircuitJsonPcbClearanceDiagnostics.build = original
    }
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

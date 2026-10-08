import assert from 'node:assert/strict'
import test from 'node:test'
import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { CircuitJsonTextStrokeGeometry } from '../src/scene3d.mjs'

/** Returns source-neutral board-space geometry. */
function geometry() {
    return {
        version: 1,
        units: 'mm',
        coordinate_space: 'board',
        stroke_width: 0.2,
        paths: [
            [
                [1, 2],
                [3, 4],
                [5, 2]
            ]
        ]
    }
}
/** Returns a valid canonical text element. */
function textRow(source = geometry()) {
    return {
        type: 'pcb_note_text',
        pcb_note_text_id: 'note',
        text: 'Ω μ',
        anchor_position: { x: 1, y: 2 },
        layer: 'top',
        font_size: 1,
        anchor_alignment: 'center',
        source_stroke_geometry: source
    }
}
test('source stroke paths survive JSON, structured cloning and immutable context transport', () => {
    const row = textRow()
    const context = CircuitJsonDocumentContext.prepare(
        JSON.parse(JSON.stringify([row]))
    )
    assert.deepEqual(structuredClone(context.model), [row])
    assert.ok(
        Object.isFrozen(context.model[0].source_stroke_geometry.paths[0][0])
    )
    assert.ok(CircuitJsonTextStrokeGeometry.isValid(row.source_stroke_geometry))
})
test('source stroke contract rejects unsupported units, versions, non-finite or malformed paths', () => {
    for (const override of [
        { version: 2 },
        { units: 'mil' },
        { coordinate_space: 'local' },
        { stroke_width: 0 },
        { stroke_width: Infinity },
        { paths: [[[1, 2]]] },
        {
            paths: [
                [
                    [1, 2],
                    [NaN, 3]
                ]
            ]
        },
        {
            paths: [
                [
                    [1, 2, 3],
                    [4, 5]
                ]
            ]
        },
        { paths: null }
    ]) {
        const candidate = { ...geometry(), ...override }
        assert.equal(CircuitJsonTextStrokeGeometry.isValid(candidate), false)
        assert.ok(
            CircuitJsonDocument.validateModel([textRow(candidate)]).length
        )
    }
    assert.ok(
        CircuitJsonTextStrokeGeometry.isValid({ ...geometry(), paths: [] })
    )
    let calls = 0
    const candidate = {
        ...geometry(),
        get paths() {
            calls++
            return []
        }
    }
    assert.equal(CircuitJsonTextStrokeGeometry.isValid(candidate), false)
    assert.equal(calls, 0)
})
test('board-space similarity transforms preserve paths and scale widths without mutating source', () => {
    const source = geometry()
    const result = CircuitJsonTextStrokeGeometry.transform(
        source,
        [0, 2, 2, 0, 10, 20]
    )
    assert.deepEqual(result.paths, [
        [
            [14, 22],
            [18, 26],
            [14, 30]
        ]
    ])
    assert.equal(result.stroke_width, 0.4)
    assert.deepEqual(source, geometry())
    assert.throws(
        () =>
            CircuitJsonTextStrokeGeometry.transform(source, [2, 0, 0, 1, 0, 0]),
        /similarity/
    )
})

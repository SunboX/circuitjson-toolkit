import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'

/**
 * Creates one source-neutral board-text row with exact source fidelity.
 * @param {Record<string, unknown>} [overrides] Field overrides.
 * @returns {Record<string, unknown>}
 */
function boardText(overrides = {}) {
    return {
        type: 'pcb_note_text',
        pcb_note_text_id: 'pcb_note_text_1',
        text: 'BOARD MARK',
        anchor_position: { x: 12.5, y: 4.25 },
        layer: 'bottom',
        ccw_rotation: 28,
        font_size: 1.2,
        font_width: 0.8,
        font_height: 1.2,
        stroke_width: 0.12,
        anchor_alignment: 'center',
        source_anchor_alignment: 'center_left',
        is_mirrored_from_top_view: true,
        is_hidden: false,
        source_layer: 'B.SilkS',
        source_type: 'gr_text',
        source_text_kind: 'text',
        ...overrides
    }
}

test('PCB text fidelity fields are validated and preserved by document preparation', () => {
    const row = boardText()
    const model = [row]

    assert.deepEqual(CircuitJsonDocument.validateModel(model), [])

    const context = CircuitJsonDocumentContext.prepare(model)

    assert.deepEqual(context.model[0], row)
    assert.equal(context.model[0].source_anchor_alignment, 'center_left')
    assert.equal(context.model[0].font_width, 0.8)
    assert.equal(context.model[0].font_height, 1.2)
    assert.equal(context.model[0].source_layer, 'B.SilkS')
    assert.equal(context.model[0].source_type, 'gr_text')
    assert.equal(Object.isFrozen(context.model[0]), true)
})

test('PCB text fidelity fields reject malformed extension values', () => {
    const invalidFields = [
        ['source_anchor_alignment', 'middle_left'],
        ['font_width', -0.8],
        ['font_height', Number.NaN],
        ['stroke_width', -0.12],
        ['is_hidden', 'false'],
        ['source_layer', ''],
        ['source_type', 42],
        ['source_text_kind', null]
    ]

    for (const [field, value] of invalidFields) {
        assert.match(
            CircuitJsonDocument.validateModel([
                boardText({ [field]: value })
            ])[0],
            /canonical toolkit extension schema/u,
            field
        )
    }
})

test('PCB text fidelity lengths accept the same unit style as canonical dimensions', () => {
    assert.deepEqual(
        CircuitJsonDocument.validateModel([
            boardText({
                font_width: '32mil',
                font_height: '1.2mm',
                stroke_width: '0.12mm'
            })
        ]),
        []
    )
})

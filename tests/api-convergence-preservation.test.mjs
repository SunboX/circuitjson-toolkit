import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocument } from '../src/core/CircuitJsonDocument.mjs'
import { PcbDiagnosticFocusModel } from '../src/core/PcbDiagnosticFocusModel.mjs'
import { PcbInteractionPrimitiveModel } from '../src/core/PcbInteractionPrimitiveModel.mjs'
import { CircuitJsonSchematicSvgRenderer } from '../src/ui/CircuitJsonSchematicSvgRenderer.mjs'

test('public normalization projects legacy table cells onto canonical geometry', () => {
    const model = [
        {
            type: 'schematic_table',
            schematic_table_id: 'table',
            anchor_position: { x: 2, y: 3 },
            anchor: 'top_left',
            column_widths: [4, 6],
            row_heights: [1.5, 2.5]
        },
        {
            type: 'schematic_table_cell',
            schematic_table_cell_id: 'cell',
            schematic_table_id: 'table',
            row: 1,
            column: 0,
            col_span: 2,
            text: 'Total'
        }
    ]

    const normalized = CircuitJsonDocument.normalizeModel(model)

    assert.notEqual(normalized, model)
    assert.deepEqual(model[1], {
        type: 'schematic_table_cell',
        schematic_table_cell_id: 'cell',
        schematic_table_id: 'table',
        row: 1,
        column: 0,
        col_span: 2,
        text: 'Total'
    })
    assert.deepEqual(normalized[1], {
        type: 'schematic_table_cell',
        schematic_table_cell_id: 'cell',
        schematic_table_id: 'table',
        text: 'Total',
        start_row_index: 1,
        end_row_index: 1,
        start_column_index: 0,
        end_column_index: 1,
        center: { x: 7, y: 5.75 },
        width: 10,
        height: 2.5
    })
    assert.equal(CircuitJsonDocument.isModel(normalized), true)
})

test('public normalization does not execute element accessors during table discovery', () => {
    let reads = 0
    const hostile = {}
    Object.defineProperty(hostile, 'type', {
        enumerable: true,
        get() {
            reads += 1
            return 'schematic_table'
        }
    })
    const model = [hostile]

    assert.equal(CircuitJsonDocument.normalizeModel(model), model)
    assert.equal(reads, 0)
})

test('schematic rendering preserves authored dash length and gap', () => {
    const markup = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'schematic_line',
            schematic_line_id: 'line',
            x1: 0,
            y1: 0,
            x2: 2,
            y2: 0,
            is_dashed: true,
            dash_length: 0.25,
            dash_gap: 0.1
        }
    ])

    assert.match(markup, /stroke-dasharray="0\.25 0\.1"/u)
})

test('schematic rendering preserves canonical dash patterns and safe line caps', () => {
    const markup = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'schematic_line',
            schematic_line_id: 'line',
            x1: 0,
            y1: 0,
            x2: 2,
            y2: 0,
            stroke_dasharray: [16, 10, 3, 10],
            stroke_linecap: 'round'
        }
    ])
    const unsafeMarkup = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'schematic_line',
            schematic_line_id: 'unsafe_line',
            x1: 0,
            y1: 0,
            x2: 2,
            y2: 0,
            stroke_dasharray: [1, 1],
            stroke_linecap: 'round\" onload=\"alert(1)'
        }
    ])

    assert.match(
        markup,
        /stroke-dasharray="16 10 3 10" stroke-linecap="round"/u
    )
    assert.doesNotMatch(unsafeMarkup, /stroke-linecap=/u)
    assert.doesNotMatch(unsafeMarkup, /onload=/u)
})

test('schematic rendering keeps hidden component labels out of markup and bounds', () => {
    const hiddenName = 'HIDDEN_COMPONENT_DESIGNATOR_WITH_A_VERY_LONG_NAME'
    const markup = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'source_component',
            source_component_id: 'source_hidden',
            name: hiddenName,
            ftype: 'simple_chip'
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'component_hidden',
            source_component_id: 'source_hidden',
            center: { x: 0, y: 0 },
            size: { width: 2, height: 2 },
            show_label: false
        }
    ])
    const viewBox = markup
        .match(/viewBox="([^"]+)"/u)[1]
        .split(' ')
        .map(Number)

    assert.match(markup, /data-schematic-component-id="component_hidden"/u)
    assert.doesNotMatch(markup, /class="schematic-component__label"/u)
    assert.doesNotMatch(markup, new RegExp(`>${hiddenName}</text>`, 'u'))
    assert.ok(viewBox[2] <= 22.4)
})

test('interaction validation rejects accessor rows without dispatching them', () => {
    let reads = 0
    const hostile = new Array(1)
    Object.defineProperty(hostile, '0', {
        configurable: true,
        enumerable: true,
        get() {
            reads += 1
            return {
                type: 'pcb_board',
                pcb_board_id: 'hostile_board',
                center: { x: 0, y: 0 }
            }
        }
    })

    const model = PcbInteractionPrimitiveModel.build(hostile)

    assert.equal(reads, 0)
    assert.deepEqual(model.primitives, [])
    assert.deepEqual(model.components, [])
})

test('interaction normalizes PCB paths, courtyards, and pad diagnostic aliases', () => {
    const document = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board',
            center: { x: 0, y: 0 },
            width: 6,
            height: 4
        },
        {
            type: 'pcb_smtpad',
            pcb_smtpad_id: 'pad_a',
            shape: 'rect',
            x: -1,
            y: 0,
            width: 0.6,
            height: 0.4,
            layer: 'top'
        },
        {
            type: 'pcb_smtpad',
            pcb_smtpad_id: 'pad_b',
            shape: 'rect',
            x: 1,
            y: 0,
            width: 0.8,
            height: 0.4,
            layer: 'top'
        },
        {
            type: 'pcb_fabrication_note_path',
            pcb_fabrication_note_path_id: 'path',
            points: [
                { x: -2, y: 1 },
                { x: 0, y: 1 },
                { x: 2, y: 1 }
            ],
            width: 0.06,
            layer: 'top_fabrication'
        },
        {
            type: 'pcb_courtyard_outline',
            pcb_courtyard_outline_id: 'courtyard',
            points: [
                { x: -1.8, y: 1.8 },
                { x: -1.2, y: 1.8 }
            ],
            stroke_width: 0.05,
            layer: 'top_courtyard'
        },
        {
            type: 'pcb_pad_pad_clearance_error',
            pcb_pad_pad_clearance_error_id: 'clearance',
            pcb_smtpad_ids: ['pad_a', 'pad_b'],
            error_type: 'pcb_pad_pad_clearance',
            message: 'Clearance is too small.'
        }
    ]

    const model = PcbInteractionPrimitiveModel.build(document)
    const diagnostic = model.diagnostics.find((row) => row.id === 'clearance')
    const focus = PcbDiagnosticFocusModel.build(document).get('clearance')

    assert.deepEqual(
        model.primitives
            .filter((primitive) => primitive.id.startsWith('path:'))
            .map((primitive) => primitive.id),
        ['path:0', 'path:1']
    )
    assert.deepEqual(
        model.primitives
            .filter((primitive) => primitive.id.startsWith('courtyard'))
            .map((primitive) => [
                primitive.id,
                primitive.x1,
                primitive.y1,
                primitive.x2,
                primitive.y2
            ]),
        [['courtyard:0', -1.8, 1.8, -1.2, 1.8]]
    )
    assert.deepEqual(diagnostic.relatedPrimitiveIds, ['pad_a', 'pad_b'])
    assert.deepEqual(focus.relatedPrimitiveIds, ['pad_a', 'pad_b'])
})

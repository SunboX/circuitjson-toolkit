import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { CircuitJsonSchematicSvgRenderer } from '../src/ui/CircuitJsonSchematicSvgRenderer.mjs'
import { SchematicSvgRenderer } from '../src/ui/SchematicSvgRenderer.mjs'
import { SchematicTextBounds } from '../src/ui/SchematicTextBounds.mjs'

test('SchematicSvgRenderer accepts DocumentInput and reuses its element index', () => {
    const context = CircuitJsonDocumentContext.prepare(
        createSchematicDocument()
    )
    const svg = SchematicSvgRenderer.render(context, {
        sheetId: 'schematic_sheet_main'
    })

    assert.equal(svg.includes('schematic-svg'), true)
    assert.equal(svg.includes('schematic_component_main'), true)
    assert.equal(svg.includes('schematic_component_other'), false)
    assert.equal(svg.includes('schematic_symbol_main'), true)
    assert.equal(svg.includes('schematic_symbol_other'), false)
    assert.equal(svg.includes('schematic_port_main'), true)
    assert.equal(svg.includes('schematic_port_other'), false)
    assert.equal(svg.includes('>CLK</text>'), true)
    assert.equal(svg.includes('data-pin-number="7"'), true)
    assert.equal(svg.includes('MAIN_TABLE_CELL'), true)
    assert.equal(svg.includes('OTHER_TABLE_CELL'), false)
    assert.equal(svg.includes('schematic_component_group_member'), true)
    assert.equal(svg.includes('schematic_group_explicit'), true)
    assert.equal(svg.includes('schematic_group_derived'), true)
    assert.equal(svg.includes('schematic_probe_main'), true)
    assert.equal((svg.match(/<line class="schematic-wire"/gu) || []).length, 2)
    assert.equal(svg.includes('x1="0" y1="0" x2="2" y2="0"'), true)
    assert.equal(svg.includes('x1="2" y1="0" x2="2" y2="2"'), true)
    assert.equal(svg.includes('d="M 22 0 A 2 2 0 0 1 20 2"'), true)
    assert.equal(svg.includes('d="M 22 5 A 2 2 0 1 0 20 7"'), true)
    assert.equal(svg.includes('d="M 22 10 A 2 2 0 1 0 20 12"'), true)
    assert.equal(
        svg.includes('d="M 22 15 A 2 2 0 0 0 18 15 A 2 2 0 0 0 22 15"'),
        true
    )
    assert.equal(svg.includes('stroke="#123456"'), true)
    assert.equal(svg.includes('attacker.invalid'), false)
    assert.equal(svg.includes('url('), false)
    assert.equal(svg.includes('PCB_ONLY_DIAGNOSTIC'), false)
    assert.equal(svg.includes('pcb_error_other_domain'), false)
    const viewBox = (svg.match(/viewBox="([^"]+)"/u)?.[1] || '')
        .split(' ')
        .map(Number)
    assert.equal(viewBox[2] < 100, true)
    assert.equal(context.statistics.indexBuilds.elements, 1)
    assert.equal(
        SchematicSvgRenderer.render(context, {
            sheetId: 'schematic_sheet_main'
        }),
        svg
    )
    assert.equal(context.statistics.indexBuilds.elements, 1)
    assert.equal(SchematicSvgRenderer.render(context), svg)
    assert.equal(context.statistics.indexBuilds.elements, 1)
    assert.throws(
        () => SchematicSvgRenderer.render(context, { sheetId: 'missing' }),
        { code: 'ERR_RENDER_SHEET' }
    )
})

test('SchematicSvgRenderer derives bounds and renders every standard debug shape', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_debug',
            name: 'Debug'
        },
        {
            type: 'schematic_debug_object',
            shape: 'rect',
            label: 'DEBUG_RECT',
            center: { x: 100, y: 50 },
            size: { width: 4, height: 2 }
        },
        {
            type: 'schematic_debug_object',
            shape: 'line',
            label: 'DEBUG_LINE',
            start: { x: 98, y: 48 },
            end: { x: 102, y: 52 }
        },
        {
            type: 'schematic_debug_object',
            shape: 'point',
            label: 'DEBUG_POINT',
            center: { x: 103, y: 53 }
        }
    ])

    assert.equal(
        (svg.match(/class="schematic-debug-object"/gu) || []).length,
        3
    )
    assert.equal(svg.includes('class="schematic-debug-object__rect"'), true)
    assert.equal(svg.includes('class="schematic-debug-object__line"'), true)
    assert.equal(svg.includes('class="schematic-debug-object__point"'), true)
    assert.equal(svg.includes('x1="98" y1="48" x2="102" y2="52"'), true)
    assert.equal(svg.includes('cx="103" cy="53"'), true)
    assert.equal(svg.includes('DEBUG_RECT'), true)
    assert.equal(svg.includes('DEBUG_LINE'), true)
    assert.equal(svg.includes('DEBUG_POINT'), true)

    const viewBox = (svg.match(/viewBox="([^"]+)"/u)?.[1] || '')
        .split(' ')
        .map(Number)
    assert.equal(viewBox.length, 4)
    assert.equal(viewBox[0] <= 98, true)
    assert.equal(viewBox[1] <= 48, true)
    assert.equal(viewBox[0] + viewBox[2] >= 103, true)
    assert.equal(viewBox[1] + viewBox[3] >= 53, true)
})

test('legacy schematic renderer retains its fixed direct-input canvas', () => {
    const svg = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'schematic_component',
            schematic_component_id: 'legacy_component',
            center: { x: 100, y: 50 },
            size: { width: 4, height: 3 }
        }
    ])

    assert.equal(svg.includes('viewBox="-11.2 -11.2 22.4 22.4"'), true)
    assert.equal(/^<svg[^>]*font-size=/u.test(svg), false)
})

test('canonical schematic SVG fixes its inherited default font size', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'source_component',
            source_component_id: 'source_default_font',
            name: 'WWWW',
            ftype: 'simple_chip'
        },
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_default_font',
            name: 'Default font'
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'component_default_font',
            source_component_id: 'source_default_font',
            center: { x: 0, y: 0 },
            size: { width: 4, height: 3 }
        }
    ])

    assert.equal(/^<svg[^>]*font-size="1"/u.test(svg), true)
})

test('legacy schematic debug rectangles preserve their original byte shape', () => {
    const svg = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'schematic_debug_object',
            schematic_debug_object_id: 'legacy_debug_rect',
            message: 'LEGACY_DEBUG',
            center: { x: 0, y: 0 },
            size: { width: 4, height: 2 }
        }
    ])

    assert.equal(
        svg.includes('<rect x="-2" y="-1" width="4" height="2"></rect>'),
        true
    )
    assert.equal(svg.includes('schematic-debug-object__rect'), false)
})

test('legacy schematic aliases survive empty standard edge arrays', () => {
    const svg = CircuitJsonSchematicSvgRenderer.render([
        {
            type: 'schematic_trace',
            schematic_trace_id: 'legacy_empty_edges',
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
            edges: [],
            junctions: []
        },
        {
            type: 'schematic_trace',
            schematic_trace_id: 'legacy_malformed_edges',
            start: { x: 2, y: 2 },
            end: { x: 3, y: 3 },
            edges: [{ from: null, to: null }],
            junctions: []
        },
        {
            type: 'schematic_arc',
            schematic_arc_id: 'legacy_arc_default',
            center: { x: 0, y: 0 },
            radius: 2,
            start_angle: 0,
            end_angle: 90
        }
    ])

    assert.equal((svg.match(/<line class="schematic-wire"/gu) || []).length, 2)
    assert.equal(svg.includes('x1="0" y1="0" x2="1" y2="1"'), true)
    assert.equal(svg.includes('x1="2" y1="2" x2="3" y2="3"'), true)
    assert.equal(svg.includes('d="M 2 0 A 2 2 0 0 1 0 2"'), true)
})

test('SchematicSvgRenderer keeps point-only terminals inside the viewBox', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_port',
            name: 'Port'
        },
        {
            type: 'source_port',
            source_port_id: 'source_port_only',
            source_component_id: 'source_component_only',
            name: 'ONLY',
            pin_number: 1
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_port_only',
            source_port_id: 'source_port_only',
            center: { x: 0, y: 0 }
        }
    ])
    const [minX, , width] = (svg.match(/viewBox="([^"]+)"/u)?.[1] || '')
        .split(' ')
        .map(Number)

    assert.equal(minX <= -0.35, true)
    assert.equal(minX + width >= 0.7, true)
    assert.equal(svg.includes('>ONLY</text>'), true)
    assert.equal(svg.includes('data-pin-number="1"'), true)
})

test('SchematicSvgRenderer shares exact table anchors with content bounds', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_tables',
            name: 'Tables'
        },
        {
            type: 'schematic_table',
            schematic_table_id: 'table_center_left',
            anchor_position: { x: 10, y: 10 },
            anchor: 'center_left',
            column_widths: [4],
            row_heights: [2]
        },
        {
            type: 'schematic_table',
            schematic_table_id: 'table_center_right',
            anchor_position: { x: 10, y: 20 },
            anchor: 'center_right',
            column_widths: [4],
            row_heights: [2]
        },
        {
            type: 'schematic_table',
            schematic_table_id: 'table_large',
            anchor_position: { x: 100, y: 50 },
            anchor: 'top_left',
            column_widths: [10, 10],
            row_heights: [5, 5]
        }
    ])

    assert.equal(
        svg.includes(
            'data-schematic-table-id="table_center_left" x="10" y="9" width="4" height="2"'
        ),
        true
    )
    assert.equal(
        svg.includes(
            'data-schematic-table-id="table_center_right" x="6" y="19" width="4" height="2"'
        ),
        true
    )
    const [minX, minY, width, height] = (
        svg.match(/viewBox="([^"]+)"/u)?.[1] || ''
    )
        .split(' ')
        .map(Number)
    assert.equal(minX <= 6, true)
    assert.equal(minY <= 9, true)
    assert.equal(minX + width >= 120, true)
    assert.equal(minY + height >= 60, true)
})

test('SchematicSvgRenderer bounds explicit stroke and table border widths', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_stroke_bounds',
            name: 'Stroke bounds'
        },
        {
            type: 'schematic_line',
            schematic_line_id: 'schematic_line_thick',
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 0,
            stroke_width: 100
        },
        {
            type: 'schematic_table',
            schematic_table_id: 'schematic_table_thick',
            anchor_position: { x: 0, y: 10 },
            anchor: 'top_left',
            column_widths: [4],
            row_heights: [2],
            border_width: 80
        }
    ])
    const [minX, minY, width, height] = (
        svg.match(/viewBox="([^"]+)"/u)?.[1] || ''
    )
        .split(' ')
        .map(Number)

    assert.equal(svg.includes('stroke-width="100"'), true)
    assert.equal(svg.includes('stroke-width="80"'), true)
    assert.equal(minX <= -50, true)
    assert.equal(minY <= -50, true)
    assert.equal(minX + width >= 51, true)
    assert.equal(minY + height >= 52, true)
})

test('SchematicSvgRenderer bounds the circular extrema of three-point arcs', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'schematic_arc',
            schematic_arc_id: 'schematic_arc_large_sweep',
            start: { x: 17.3648188, y: 98.4807753 },
            mid: { x: -17.3648188, y: 98.4807753 },
            end: { x: 17.3648188, y: -98.4807753 },
            stroke_width: 2
        }
    ])
    const [minX, minY, width, height] = (
        svg.match(/viewBox="([^"]+)"/u)?.[1] || ''
    )
        .split(' ')
        .map(Number)

    assert.equal(minX <= -101, true)
    assert.equal(minY <= -101, true)
    assert.equal(minX + width >= 18.3648188, true)
    assert.equal(minY + height >= 99.4807753, true)
})

test('SchematicSvgRenderer bounds every fixed-radius marker', () => {
    const cases = [
        {
            marker: {
                type: 'schematic_layout_error',
                schematic_layout_error_id: 'marker_diagnostic',
                error_type: 'schematic_layout_error',
                message: 'Marker',
                center: { x: 0, y: 0 }
            },
            distance: 6,
            radius: 0.45
        },
        {
            marker: {
                type: 'schematic_debug_object',
                schematic_debug_object_id: 'marker_debug_point',
                shape: 'point',
                center: { x: 0, y: 0 }
            },
            distance: 4,
            radius: 0.25
        },
        {
            marker: {
                type: 'schematic_voltage_probe',
                schematic_voltage_probe_id: 'marker_probe',
                schematic_trace_id: 'marker_trace',
                position: { x: 0, y: 0 }
            },
            distance: 7,
            radius: 0.45
        }
    ]

    for (const { marker, distance, radius } of cases) {
        const svg = SchematicSvgRenderer.render([
            {
                type: 'schematic_sheet',
                schematic_sheet_id: 'schematic_sheet_marker_bounds',
                name: 'Marker bounds'
            },
            marker,
            {
                type: 'schematic_line',
                schematic_line_id: `extent_${distance}`,
                x1: distance,
                y1: 0,
                x2: distance,
                y2: 1
            }
        ])
        const minX = Number(svg.match(/viewBox="([^"]+)"/u)?.[1].split(' ')[0])

        assert.equal(minX <= -radius, true)
    }
})

test('SchematicSvgRenderer bounds long and rotated text labels', () => {
    const longText = 'W'.repeat(100)
    const svg = SchematicSvgRenderer.render([
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_text_bounds',
            name: 'Text'
        },
        {
            type: 'schematic_text',
            schematic_text_id: 'schematic_text_horizontal',
            text: longText,
            font_size: 1,
            position: { x: 0, y: 0 },
            rotation: 0,
            anchor: 'top_left',
            color: '#000000'
        },
        {
            type: 'schematic_text',
            schematic_text_id: 'schematic_text_vertical',
            text: longText,
            font_size: 1,
            position: { x: 0, y: 0 },
            rotation: 90,
            anchor: 'center',
            color: '#000000'
        },
        {
            type: 'source_port',
            source_port_id: 'source_port_long_label',
            source_component_id: 'source_component_long_label',
            name: 'LONG_PORT_LABEL',
            pin_number: 9
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_port_long_label',
            source_port_id: 'source_port_long_label',
            center: { x: 0, y: 0 }
        },
        {
            type: 'schematic_voltage_probe',
            schematic_voltage_probe_id: 'schematic_probe_long_label',
            schematic_trace_id: 'schematic_trace_text_bounds',
            position: { x: 0, y: 0 },
            name: 'LONG_PROBE_LABEL'
        }
    ])
    const [, , width, height] = (svg.match(/viewBox="([^"]+)"/u)?.[1] || '')
        .split(' ')
        .map(Number)

    assert.equal(width >= 100, true)
    assert.equal(height >= 100, true)
    assert.equal(svg.includes('LONG_PORT_LABEL'), true)
    assert.equal(svg.includes('LONG_PROBE_LABEL'), true)
    assert.equal(
        svg.includes('text-anchor="start" dominant-baseline="hanging"'),
        true
    )
    assert.equal(
        svg.includes('text-anchor="middle" dominant-baseline="central"'),
        true
    )
})

test('SchematicSvgRenderer bounds every visible generated label', () => {
    const longLabel = 'W'.repeat(80)
    const svg = SchematicSvgRenderer.render([
        {
            type: 'source_component',
            source_component_id: 'source_long_generated_label',
            name: longLabel,
            ftype: 'simple_chip'
        },
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_generated_labels',
            name: 'Generated labels'
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'component_long_generated_label',
            source_component_id: 'source_long_generated_label',
            center: { x: 0, y: 0 },
            size: { width: 4, height: 3 }
        },
        {
            type: 'schematic_symbol',
            schematic_symbol_id: 'symbol_long_generated_label',
            source_component_id: 'source_long_generated_label',
            center: { x: 0, y: 5 },
            width: 4,
            height: 3
        },
        {
            type: 'schematic_group',
            schematic_group_id: 'group_long_generated_label',
            name: longLabel,
            center: { x: 0, y: 10 },
            width: 4,
            height: 3
        },
        {
            type: 'schematic_table',
            schematic_table_id: 'table_long_generated_label',
            anchor_position: { x: -2, y: 15 },
            column_widths: [4],
            row_heights: [2]
        },
        {
            type: 'schematic_table_cell',
            schematic_table_cell_id: 'cell_long_generated_label',
            schematic_table_id: 'table_long_generated_label',
            row: 0,
            column: 0,
            text: longLabel
        }
    ])
    const [, , width] = (svg.match(/viewBox="([^"]+)"/u)?.[1] || '')
        .split(' ')
        .map(Number)

    assert.equal(width >= 80, true)
})

test('SchematicSvgRenderer sanitizes non-XML model-derived labels', () => {
    const svg = SchematicSvgRenderer.render([
        {
            type: 'source_component',
            source_component_id: 'source_invalid_xml_label',
            name: 'X\u0000Y\ud800Z',
            ftype: 'simple_chip'
        },
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_invalid_xml_label',
            name: 'Invalid XML label'
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'component_invalid_xml_label',
            source_component_id: 'source_invalid_xml_label',
            center: { x: 0, y: 0 },
            size: { width: 4, height: 3 }
        }
    ])

    assert.equal(svg.includes('\u0000'), false)
    assert.equal(svg.includes('\ud800'), false)
    assert.equal(svg.includes('X�Y�Z'), true)
})

test('SchematicTextBounds handles very many empty lines without argument spread', () => {
    assert.doesNotThrow(() =>
        SchematicTextBounds.resolve({ x: 0, y: 0 }, '\n'.repeat(20000))
    )
})

/**
 * Builds two valid CircuitJSON schematic sheets for selection tests.
 * @returns {object[]} Schematic CircuitJSON model.
 */
function createSchematicDocument() {
    return [
        {
            type: 'source_component',
            source_component_id: 'source_main',
            name: 'U1',
            ftype: 'simple_chip'
        },
        {
            type: 'source_port',
            source_port_id: 'source_port_main',
            source_component_id: 'source_main',
            name: 'CLK',
            pin_number: 7
        },
        {
            type: 'source_port',
            source_port_id: 'source_port_other',
            source_component_id: 'source_other',
            name: 'OTHER_PIN',
            pin_number: 8
        },
        {
            type: 'source_component',
            source_component_id: 'source_other',
            name: 'U2',
            ftype: 'simple_chip'
        },
        {
            type: 'source_component',
            source_component_id: 'source_group_member',
            name: 'U3',
            ftype: 'simple_chip'
        },
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_main',
            name: 'Main',
            subcircuit_id: 'shared_subcircuit'
        },
        {
            type: 'schematic_sheet',
            schematic_sheet_id: 'schematic_sheet_other',
            name: 'Other',
            subcircuit_id: 'shared_subcircuit'
        },
        {
            type: 'schematic_symbol',
            schematic_symbol_id: 'schematic_symbol_main',
            source_component_id: 'source_main',
            center: { x: 0, y: 0 },
            width: 4,
            height: 3
        },
        {
            type: 'schematic_symbol',
            schematic_symbol_id: 'schematic_symbol_other',
            source_component_id: 'source_other',
            center: { x: 10, y: 0 },
            width: 4,
            height: 3
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'schematic_component_main',
            schematic_symbol_id: 'schematic_symbol_main',
            schematic_sheet_id: 'schematic_sheet_main',
            subcircuit_id: 'shared_subcircuit',
            source_component_id: 'source_main',
            center: { x: 0, y: 0 },
            size: { width: 4, height: 3 }
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'schematic_component_other',
            schematic_symbol_id: 'schematic_symbol_other',
            schematic_sheet_id: 'schematic_sheet_other',
            subcircuit_id: 'shared_subcircuit',
            source_component_id: 'source_other',
            center: { x: 10, y: 0 },
            size: { width: 4, height: 3 }
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_port_main',
            schematic_component_id: 'schematic_component_main',
            source_port_id: 'source_port_main',
            center: { x: 1, y: 0 }
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_port_other',
            schematic_component_id: 'schematic_component_other',
            source_port_id: 'source_port_other',
            center: { x: 11, y: 0 }
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'schematic_component_group_member',
            source_component_id: 'source_group_member',
            center: { x: 0, y: -4 },
            size: { width: 4, height: 3 }
        },
        {
            type: 'schematic_group',
            schematic_group_id: 'schematic_group_explicit',
            schematic_sheet_id: 'schematic_sheet_main',
            source_group_id: 'source_group_explicit',
            center: { x: 0, y: -4 },
            width: 5,
            height: 4,
            schematic_component_ids: ['schematic_component_group_member'],
            name: 'Explicit group'
        },
        {
            type: 'schematic_group',
            schematic_group_id: 'schematic_group_derived',
            source_group_id: 'source_group_derived',
            center: { x: 0, y: 0 },
            width: 5,
            height: 4,
            schematic_component_ids: ['schematic_component_main'],
            name: 'Derived group'
        },
        {
            type: 'schematic_trace',
            schematic_trace_id: 'schematic_trace_main',
            schematic_sheet_id: 'schematic_sheet_main',
            color: 'url(https://attacker.invalid/paint.svg#p)',
            junctions: [],
            edges: [
                {
                    from: { x: 0, y: 0 },
                    to: { x: 2, y: 0 },
                    from_schematic_port_id: 'schematic_port_main'
                },
                {
                    from: { x: 2, y: 0 },
                    to: { x: 2, y: 2 },
                    to_schematic_port_id: 'schematic_port_main'
                }
            ]
        },
        {
            type: 'schematic_arc',
            schematic_arc_id: 'schematic_arc_clockwise',
            schematic_sheet_id: 'schematic_sheet_main',
            center: { x: 20, y: 0 },
            radius: 2,
            start_angle_degrees: 0,
            end_angle_degrees: 90,
            direction: 'clockwise',
            color: '#123456',
            is_dashed: false
        },
        {
            type: 'schematic_arc',
            schematic_arc_id: 'schematic_arc_counterclockwise',
            schematic_sheet_id: 'schematic_sheet_main',
            center: { x: 20, y: 5 },
            radius: 2,
            start_angle_degrees: 0,
            end_angle_degrees: 90,
            direction: 'counterclockwise',
            color: '#654321',
            is_dashed: false
        },
        {
            type: 'schematic_arc',
            schematic_arc_id: 'schematic_arc_default_direction',
            schematic_sheet_id: 'schematic_sheet_main',
            center: { x: 20, y: 10 },
            radius: 2,
            start_angle_degrees: 0,
            end_angle_degrees: 90,
            color: '#abcdef',
            is_dashed: false
        },
        {
            type: 'schematic_arc',
            schematic_arc_id: 'schematic_arc_full_turn',
            schematic_sheet_id: 'schematic_sheet_main',
            center: { x: 20, y: 15 },
            radius: 2,
            start_angle_degrees: 0,
            end_angle_degrees: 360,
            direction: 'counterclockwise',
            color: '#abcdef',
            is_dashed: false
        },
        {
            type: 'schematic_voltage_probe',
            schematic_voltage_probe_id: 'schematic_probe_main',
            schematic_trace_id: 'schematic_trace_main',
            position: { x: 1, y: 0 },
            name: 'VMAIN'
        },
        {
            type: 'schematic_table',
            schematic_table_id: 'schematic_table_main',
            schematic_component_id: 'schematic_component_main',
            anchor_position: { x: 0, y: 3 },
            column_widths: [3],
            row_heights: [1]
        },
        {
            type: 'schematic_table_cell',
            schematic_table_cell_id: 'schematic_table_cell_main',
            schematic_table_id: 'schematic_table_main',
            start_row_index: 0,
            end_row_index: 0,
            start_column_index: 0,
            end_column_index: 0,
            center: { x: 0, y: 3 },
            width: 3,
            height: 1,
            text: 'MAIN_TABLE_CELL'
        },
        {
            type: 'schematic_table',
            schematic_table_id: 'schematic_table_other',
            schematic_component_id: 'schematic_component_other',
            anchor_position: { x: 10, y: 3 },
            column_widths: [3],
            row_heights: [1]
        },
        {
            type: 'schematic_table_cell',
            schematic_table_cell_id: 'schematic_table_cell_other',
            schematic_table_id: 'schematic_table_other',
            start_row_index: 0,
            end_row_index: 0,
            start_column_index: 0,
            end_column_index: 0,
            center: { x: 10, y: 3 },
            width: 3,
            height: 1,
            text: 'OTHER_TABLE_CELL'
        },
        {
            type: 'pcb_board',
            pcb_board_id: 'pcb_board_other_domain',
            center: { x: 1000, y: 1000 },
            width: 100,
            height: 100
        },
        {
            type: 'pcb_trace_error',
            pcb_trace_error_id: 'pcb_error_other_domain',
            error_type: 'pcb_trace_error',
            message: 'PCB_ONLY_DIAGNOSTIC',
            center: { x: 1000, y: 1000 },
            pcb_trace_id: 'pcb_trace_other_domain',
            source_trace_id: 'source_trace_other_domain',
            pcb_component_ids: [],
            pcb_port_ids: []
        }
    ]
}

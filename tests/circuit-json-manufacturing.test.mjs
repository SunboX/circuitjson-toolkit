import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonParser } from '../src/index.mjs'

test('CircuitJsonParser includes drill features and routing guides in manufacturing metadata', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 0, y: 0 },
                width: 8,
                height: 4
            },
            {
                type: 'source_net',
                source_net_id: 'source_net_1',
                name: 'SIG'
            },
            {
                type: 'pcb_via',
                pcb_via_id: 'via_1',
                source_net_id: 'source_net_1',
                x: 2,
                y: 0,
                outer_diameter: 0.6,
                hole_diameter: 0.25,
                layers: ['top', 'bottom']
            },
            {
                type: 'pcb_plated_hole',
                shape: 'circle',
                pcb_plated_hole_id: 'hole_1',
                source_net_id: 'source_net_1',
                x: 3,
                y: 0,
                outer_diameter: 1.2,
                hole_diameter: 0.7,
                layers: ['top', 'bottom']
            },
            {
                type: 'pcb_trace_hint',
                pcb_trace_hint_id: 'hint_1',
                pcb_component_id: 'pcb_u1',
                pcb_port_id: 'port_1',
                source_net_id: 'source_net_1',
                route: [
                    { x: 1, y: 0, layer: 'top' },
                    { x: 2, y: 0, layer: 'top' }
                ]
            },
            {
                type: 'pcb_breakout_point',
                pcb_breakout_point_id: 'breakout_1',
                pcb_group_id: 'group_1',
                source_net_id: 'source_net_1',
                x: 0.5,
                y: -0.5
            }
        ]),
        { fileName: 'guided-routing.json' }
    )

    assert.match(
        model.manufacturing.routingDsn,
        /\(via via_1 2 0 0\.25 0\.6 top bottom\)/
    )
    assert.match(
        model.manufacturing.routingDsn,
        /\(plated_hole hole_1 3 0 0\.7 1\.2 top bottom\)/
    )
    assert.deepEqual(model.manufacturing.routingGuides, [
        {
            type: 'trace_hint',
            id: 'hint_1',
            pcbComponentId: 'pcb_u1',
            pcbPortId: 'port_1',
            sourceNetId: 'source_net_1',
            netName: 'SIG',
            subcircuitId: '',
            route: [
                { x: 1, y: 0, layer: 'top' },
                { x: 2, y: 0, layer: 'top' }
            ]
        },
        {
            type: 'breakout_point',
            id: 'breakout_1',
            pcbGroupId: 'group_1',
            sourceTraceId: '',
            sourcePortId: '',
            sourceNetId: 'source_net_1',
            netName: 'SIG',
            subcircuitId: '',
            point: { x: 0.5, y: -0.5 }
        }
    ])
})

test('CircuitJsonParser extracts fabrication notes for manufacturing export', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_fabrication_note_text',
                pcb_fabrication_note_text_id: 'fab_text_1',
                pcb_component_id: 'pcb_u1',
                pcb_group_id: 'group_1',
                layer: 'top_fabrication',
                text: 'Inspect solder jumpers',
                anchor_position: { x: 1, y: 2 },
                font_size: 0.8,
                color: '#336699'
            },
            {
                type: 'pcb_fabrication_note_dimension',
                pcb_fabrication_note_dimension_id: 'fab_dim_1',
                pcb_component_id: 'pcb_u1',
                layer: 'top_fabrication',
                from: { x: 0, y: 0 },
                to: { x: 3, y: 0 },
                text: '3 mm',
                offset_distance: 0.4,
                arrow_size: 0.25
            }
        ]),
        { fileName: 'fabrication-notes.json' }
    )

    assert.deepEqual(model.manufacturing.fabricationNotes, [
        {
            type: 'text',
            elementType: 'pcb_fabrication_note_text',
            id: 'fab_text_1',
            pcbComponentId: 'pcb_u1',
            pcbGroupId: 'group_1',
            subcircuitId: '',
            layer: 'top_fabrication',
            text: 'Inspect solder jumpers',
            anchor: { x: 1, y: 2 },
            rotation: 0,
            fontSize: 0.8,
            color: '#336699'
        },
        {
            type: 'dimension',
            elementType: 'pcb_fabrication_note_dimension',
            id: 'fab_dim_1',
            pcbComponentId: 'pcb_u1',
            pcbGroupId: '',
            subcircuitId: '',
            layer: 'top_fabrication',
            from: { x: 0, y: 0 },
            to: { x: 3, y: 0 },
            text: '3 mm',
            offset: 0,
            offsetDistance: 0.4,
            offsetDirection: null,
            rotation: 0,
            fontSize: 1,
            arrowSize: 0.25,
            color: ''
        }
    ])
})

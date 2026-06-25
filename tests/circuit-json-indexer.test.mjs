import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonIndexer } from '../src/index.mjs'

test('CircuitJsonIndexer groups PCB elements by type and id', () => {
    const board = {
        type: 'pcb_board',
        pcb_board_id: 'board_1',
        center: { x: 0, y: 0 },
        width: 10,
        height: 5
    }
    const sourceComponent = {
        type: 'source_component',
        source_component_id: 'source_r1',
        name: 'R1',
        ftype: 'simple_chip'
    }
    const pcbComponent = {
        type: 'pcb_component',
        pcb_component_id: 'pcb_r1',
        source_component_id: 'source_r1',
        center: { x: 1, y: 2 },
        layer: 'top',
        rotation: 0,
        width: 1,
        height: 1
    }

    const index = CircuitJsonIndexer.index([
        board,
        sourceComponent,
        pcbComponent
    ])

    assert.deepEqual(index.elementsByType.get('pcb_board'), [board])
    assert.equal(index.elementsById.get('pcb_board:board_1'), board)
    assert.equal(
        index.elementsById.get('source_component:source_r1'),
        sourceComponent
    )
    assert.equal(index.sourceComponentById.get('source_r1'), sourceComponent)
    assert.equal(index.pcbComponentById.get('pcb_r1'), pcbComponent)
})

test('CircuitJsonIndexer indexes courtyard artwork variant ids', () => {
    const model = [
        {
            type: 'pcb_courtyard_path',
            pcb_courtyard_path_id: 'courtyard_path_1',
            route: [
                { x: 0, y: 0 },
                { x: 1, y: 0 }
            ],
            layer: 'top_courtyard'
        },
        {
            type: 'pcb_courtyard_line',
            pcb_courtyard_line_id: 'courtyard_line_1',
            start: { x: 2, y: 0 },
            end: { x: 3, y: 0 },
            layer: 'top_courtyard'
        }
    ]

    const index = CircuitJsonIndexer.index(model)

    assert.equal(
        index.elementsById.get('pcb_courtyard_path:courtyard_path_1'),
        model[0]
    )
    assert.equal(
        index.elementsById.get('pcb_courtyard_line:courtyard_line_1'),
        model[1]
    )
})

test('CircuitJsonIndexer exposes relationships and diagnostics', () => {
    const model = [
        {
            type: 'source_component',
            source_component_id: 'source_u1',
            name: 'U1',
            ftype: 'simple_chip'
        },
        {
            type: 'source_port',
            source_port_id: 'source_u1_port_1',
            source_component_id: 'source_u1',
            name: 'IO',
            pin_number: 1
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            center: { x: 0, y: 0 },
            layer: 'top',
            rotation: 0,
            width: 1,
            height: 1
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'schematic_u1',
            source_component_id: 'source_u1',
            center: { x: 0, y: 0 },
            size: { width: 1, height: 1 }
        },
        {
            type: 'source_pin_missing_trace_warning',
            source_pin_missing_trace_warning_id: 'warning_1',
            warning_type: 'source_pin_missing_trace_warning',
            message: 'Pin is not connected',
            source_port_id: 'source_u1_port_1'
        }
    ]

    const index = CircuitJsonIndexer.index(model)

    assert.equal(
        index.relationsByField.get('source_component_id').get('source_u1')
            .length,
        3
    )
    assert.deepEqual(index.componentsBySourceId.get('source_u1'), {
        sourceComponent: model[0],
        sourcePorts: [model[1]],
        pcbComponents: [model[2]],
        schematicComponents: [model[3]]
    })
    assert.deepEqual(index.diagnostics, [
        {
            severity: 'warning',
            sourceFormat: 'circuitjson',
            type: 'source_pin_missing_trace_warning',
            category: 'connectivity',
            message: 'Pin is not connected',
            elementId: 'warning_1',
            sourcePortId: 'source_u1_port_1'
        }
    ])
})

test('CircuitJsonIndexer exposes source trace connectivity and reference diagnostics', () => {
    const model = [
        {
            type: 'source_net',
            source_net_id: 'source_net_sig',
            name: 'SIG'
        },
        {
            type: 'source_port',
            source_port_id: 'source_u1_pin1',
            source_component_id: 'source_u1',
            name: 'pin1'
        },
        {
            type: 'source_trace',
            source_trace_id: 'source_trace_sig',
            connected_source_port_ids: ['source_u1_pin1', 'source_u2_missing'],
            connected_source_net_ids: ['source_net_sig', 'source_net_missing']
        },
        {
            type: 'pcb_trace',
            pcb_trace_id: 'pcb_trace_sig',
            source_trace_id: 'source_trace_sig',
            route: [
                { route_type: 'wire', x: 0, y: 0, layer: 'top' },
                { route_type: 'wire', x: 1, y: 0, layer: 'top' }
            ]
        },
        {
            type: 'pcb_trace',
            pcb_trace_id: 'pcb_trace_orphan',
            source_trace_id: 'source_trace_missing',
            route: [
                { route_type: 'wire', x: 0, y: 1, layer: 'top' },
                { route_type: 'wire', x: 1, y: 1, layer: 'top' }
            ]
        }
    ]

    const index = CircuitJsonIndexer.index(model)

    assert.equal(index.sourceTraceById.get('source_trace_sig'), model[2])
    assert.deepEqual(index.sourceTraceConnectivity.get('source_trace_sig'), {
        sourceTraceId: 'source_trace_sig',
        connectedSourcePortIds: ['source_u1_pin1', 'source_u2_missing'],
        connectedSourceNetIds: ['source_net_sig', 'source_net_missing']
    })
    assert.deepEqual(
        index.diagnostics.map((diagnostic) => ({
            type: diagnostic.type,
            category: diagnostic.category,
            message: diagnostic.message,
            sourceTraceId: diagnostic.sourceTraceId,
            pcbTraceId: diagnostic.pcbTraceId,
            sourcePortId: diagnostic.sourcePortId,
            sourceNetId: diagnostic.sourceNetId
        })),
        [
            {
                type: 'source_trace_missing_source_port_warning',
                category: 'connectivity',
                message:
                    'Source trace source_trace_sig references missing source port source_u2_missing.',
                sourceTraceId: 'source_trace_sig',
                pcbTraceId: undefined,
                sourcePortId: 'source_u2_missing',
                sourceNetId: undefined
            },
            {
                type: 'source_trace_missing_source_net_warning',
                category: 'connectivity',
                message:
                    'Source trace source_trace_sig references missing source net source_net_missing.',
                sourceTraceId: 'source_trace_sig',
                pcbTraceId: undefined,
                sourcePortId: undefined,
                sourceNetId: 'source_net_missing'
            },
            {
                type: 'pcb_trace_missing_source_trace_warning',
                category: 'connectivity',
                message:
                    'PCB trace pcb_trace_orphan references missing source trace source_trace_missing.',
                sourceTraceId: 'source_trace_missing',
                pcbTraceId: 'pcb_trace_orphan',
                sourcePortId: undefined,
                sourceNetId: undefined
            }
        ]
    )
})

test('CircuitJsonIndexer generates schematic relationship diagnostics', () => {
    const model = [
        {
            type: 'schematic_symbol',
            schematic_symbol_id: 'symbol_existing',
            center: { x: 0, y: 0 },
            width: 4,
            height: 3
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'schematic_u1',
            schematic_symbol_id: 'symbol_missing',
            center: { x: 0, y: 0 },
            size: { width: 4, height: 3 }
        },
        {
            type: 'schematic_port',
            schematic_port_id: 'schematic_pin_1',
            schematic_component_id: 'schematic_missing',
            source_port_id: 'source_missing_pin_1',
            center: { x: 1, y: 0 }
        },
        {
            type: 'schematic_line',
            schematic_line_id: 'line_1',
            schematic_symbol_id: 'symbol_missing_line',
            schematic_component_id: 'schematic_missing_line',
            start: { x: 0, y: 0 },
            end: { x: 1, y: 0 }
        }
    ]

    const diagnostics = CircuitJsonIndexer.index(model).diagnostics.map(
        (diagnostic) => ({
            type: diagnostic.type,
            category: diagnostic.category,
            message: diagnostic.message,
            schematicSymbolId: diagnostic.schematicSymbolId,
            schematicComponentId: diagnostic.schematicComponentId,
            schematicPortId: diagnostic.schematicPortId,
            sourcePortId: diagnostic.sourcePortId,
            elementId: diagnostic.elementId
        })
    )

    assert.deepEqual(diagnostics, [
        {
            type: 'schematic_component_missing_schematic_symbol_warning',
            category: 'layout',
            message:
                'Schematic component schematic_u1 references missing schematic symbol symbol_missing.',
            schematicSymbolId: 'symbol_missing',
            schematicComponentId: 'schematic_u1',
            schematicPortId: undefined,
            sourcePortId: undefined,
            elementId: 'schematic_u1:missing-symbol:symbol_missing'
        },
        {
            type: 'schematic_port_missing_schematic_component_warning',
            category: 'layout',
            message:
                'Schematic port schematic_pin_1 references missing schematic component schematic_missing.',
            schematicSymbolId: undefined,
            schematicComponentId: 'schematic_missing',
            schematicPortId: 'schematic_pin_1',
            sourcePortId: undefined,
            elementId: 'schematic_pin_1:missing-component:schematic_missing'
        },
        {
            type: 'schematic_port_missing_source_port_warning',
            category: 'connectivity',
            message:
                'Schematic port schematic_pin_1 references missing source port source_missing_pin_1.',
            schematicSymbolId: undefined,
            schematicComponentId: undefined,
            schematicPortId: 'schematic_pin_1',
            sourcePortId: 'source_missing_pin_1',
            elementId:
                'schematic_pin_1:missing-source-port:source_missing_pin_1'
        },
        {
            type: 'schematic_primitive_missing_schematic_symbol_warning',
            category: 'layout',
            message:
                'Schematic primitive line_1 references missing schematic symbol symbol_missing_line.',
            schematicSymbolId: 'symbol_missing_line',
            schematicComponentId: undefined,
            schematicPortId: undefined,
            sourcePortId: undefined,
            elementId: 'line_1:missing-symbol:symbol_missing_line'
        },
        {
            type: 'schematic_primitive_missing_schematic_component_warning',
            category: 'layout',
            message:
                'Schematic primitive line_1 references missing schematic component schematic_missing_line.',
            schematicSymbolId: undefined,
            schematicComponentId: 'schematic_missing_line',
            schematicPortId: undefined,
            sourcePortId: undefined,
            elementId: 'line_1:missing-component:schematic_missing_line'
        }
    ])
})

test('CircuitJsonIndexer categorizes diagnostics by subsystem', () => {
    const diagnostics = CircuitJsonIndexer.collectDiagnostics([
        {
            type: 'pcb_pad_trace_clearance_error',
            pcb_pad_trace_clearance_error_id: 'clearance_1',
            error_type: 'pcb_pad_trace_clearance_error',
            message: 'Copper spacing failed'
        },
        {
            type: 'pcb_component_outside_board_error',
            pcb_component_outside_board_error_id: 'placement_1',
            error_type: 'pcb_component_outside_board_error',
            message: 'Component is outside the board'
        },
        {
            type: 'simulation_unknown_experiment_error',
            simulation_unknown_experiment_error_id: 'sim_1',
            error_type: 'simulation_unknown_experiment_error',
            message: 'Experiment is unavailable'
        },
        {
            type: 'source_no_power_pin_defined_warning',
            source_no_power_pin_defined_warning_id: 'pin_1',
            warning_type: 'source_no_power_pin_defined_warning',
            message: 'Power pin role is missing'
        },
        {
            type: 'source_missing_manufacturer_part_number_warning',
            source_missing_manufacturer_part_number_warning_id: 'metadata_1',
            warning_type: 'source_missing_manufacturer_part_number_warning',
            message: 'Manufacturer part number is missing'
        },
        {
            type: 'pcb_autorouting_error',
            pcb_autorouting_error_id: 'route_1',
            error_type: 'pcb_autorouting_error',
            message: 'Autorouting failed'
        }
    ])

    assert.deepEqual(
        diagnostics.map((diagnostic) => diagnostic.category),
        [
            'clearance',
            'placement',
            'simulation',
            'pin-definition',
            'metadata',
            'routing'
        ]
    )
})

test('CircuitJsonIndexer exposes group and subcircuit memberships', () => {
    const model = [
        {
            type: 'source_group',
            source_group_id: 'source_group_power',
            name: 'Power'
        },
        {
            type: 'pcb_group',
            pcb_group_id: 'pcb_group_regulator',
            name: 'Regulator'
        },
        {
            type: 'schematic_group',
            schematic_group_id: 'schematic_group_regulator',
            name: 'Regulator schematic'
        },
        {
            type: 'source_component',
            source_component_id: 'source_u1',
            source_group_id: 'source_group_power',
            subcircuit_id: 'subcircuit_regulator',
            name: 'U1',
            ftype: 'simple_chip'
        },
        {
            type: 'source_net',
            source_net_id: 'source_net_power',
            name: 'POWER',
            member_source_group_ids: ['source_group_power']
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            pcb_group_id: 'pcb_group_regulator',
            subcircuit_id: 'subcircuit_regulator',
            center: { x: 0, y: 0 },
            layer: 'top'
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'schematic_u1',
            source_component_id: 'source_u1',
            schematic_group_id: 'schematic_group_regulator',
            subcircuit_id: 'subcircuit_regulator',
            center: { x: 0, y: 0 },
            size: { width: 1, height: 1 }
        }
    ]

    const index = CircuitJsonIndexer.index(model)

    assert.deepEqual(
        index.groupsById
            .get('source_group_power')
            .members.map((element) => element.type),
        ['source_component', 'source_net']
    )
    assert.deepEqual(
        index.groupsById
            .get('pcb_group_regulator')
            .members.map((element) => element.type),
        ['pcb_component']
    )
    assert.deepEqual(
        index.groupsById
            .get('schematic_group_regulator')
            .members.map((element) => element.type),
        ['schematic_component']
    )
    assert.deepEqual(
        index.elementsBySubcircuitId
            .get('subcircuit_regulator')
            .map((element) => element.type),
        ['source_component', 'pcb_component', 'schematic_component']
    )
})

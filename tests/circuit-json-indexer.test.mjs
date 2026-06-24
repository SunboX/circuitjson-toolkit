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
            elementId: 'warning_1'
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
        ['source_component']
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

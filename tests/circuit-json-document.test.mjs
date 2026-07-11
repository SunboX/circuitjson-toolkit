import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocument, CircuitJsonUnits } from '../src/index.mjs'
import {
    CircuitJsonElementValidator,
    CircuitJsonParser,
    CircuitJsonSourceMetadata
} from '../src/extensions.mjs'

test('CircuitJsonDocument recognizes serialized CircuitJSON element arrays', () => {
    const model = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_1',
            center: { x: 0, y: 0 },
            width: 10,
            height: 5
        }
    ]

    assert.equal(CircuitJsonDocument.isModel(model), true)
})

test('CircuitJsonDocument rejects compatibility objects and malformed arrays', () => {
    assert.equal(
        CircuitJsonDocument.isModel({
            pcb: {
                components: []
            }
        }),
        false
    )
    assert.equal(
        CircuitJsonDocument.isModel([{ pcb_board_id: 'board_1' }]),
        false
    )
    assert.throws(
        () => CircuitJsonDocument.assertModel([{ pcb_board_id: 'board_1' }]),
        /CircuitJSON element type is required/
    )
})

test('CircuitJsonDocument rejects unknown element types', () => {
    assert.equal(
        CircuitJsonDocument.isModel([
            {
                type: 'made_up_element',
                made_up_element_id: 'made_up_1'
            }
        ]),
        false
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'made_up_element',
                    made_up_element_id: 'made_up_1'
                }
            ]),
        /Unsupported CircuitJSON element type: made_up_element/
    )
})

test('canonical validation rejects local courtyard aliases while the legacy parser maps them', () => {
    const model = [
        {
            type: 'pcb_courtyard_path',
            pcb_courtyard_path_id: 'courtyard_path_1',
            route: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 }
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

    assert.equal(CircuitJsonDocument.isModel(model), false)
    const parsed = CircuitJsonParser.parseText(JSON.stringify(model))
    assert.deepEqual(
        parsed.map((element) => element.type),
        ['pcb_courtyard_outline', 'pcb_courtyard_outline']
    )
})

test('CircuitJsonDocument rejects invalid core element fields', () => {
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'pcb_smtpad',
                    pcb_smtpad_id: 'pad_1',
                    x: 1,
                    y: 1,
                    width: 1,
                    height: 1,
                    layer: 'top'
                }
            ]),
        /does not match the pinned upstream schema/
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'source_port',
                    source_port_id: 'port_1',
                    name: 'IO',
                    pin_number: '1'
                }
            ]),
        /does not match the pinned upstream schema/
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'pcb_component',
                    pcb_component_id: 'pcb_u1',
                    source_component_id: 'source_u1',
                    center: { x: 0, y: 0 },
                    rotation: 0
                }
            ]),
        /does not match the pinned upstream schema/
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'schematic_component',
                    schematic_component_id: 'schematic_u1',
                    center: { x: 0, y: 0 }
                }
            ]),
        /does not match the pinned upstream schema/
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'source_component',
                    source_component_id: 'source_u1',
                    name: 'U1',
                    ftype: 'simple_chip',
                    supplier_part_numbers: []
                }
            ]),
        /does not match the pinned upstream schema/
    )
})

test('CircuitJsonDocument validates oscilloscope trace references and units', () => {
    assert.doesNotThrow(() =>
        CircuitJsonDocument.assertModel([
            {
                type: 'simulation_oscilloscope_trace',
                simulation_oscilloscope_trace_id: 'scope_trace_vout',
                simulation_transient_voltage_graph_id: 'graph_vout',
                display_name: 'VOUT',
                color: '#00aaff',
                volts_per_div: 1
            }
        ])
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'simulation_oscilloscope_trace',
                    simulation_oscilloscope_trace_id: 'scope_trace_invalid',
                    simulation_transient_voltage_graph_id: 'graph_vout',
                    simulation_voltage_probe_id: 'probe_vout',
                    volts_per_div: 1
                }
            ]),
        /does not match the pinned upstream schema/
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'simulation_oscilloscope_trace',
                    simulation_oscilloscope_trace_id: 'scope_trace_bad_units',
                    simulation_transient_voltage_graph_id: 'graph_vout',
                    amps_per_div: 0.01
                }
            ]),
        /does not match the pinned upstream schema/
    )
    assert.throws(
        () =>
            CircuitJsonDocument.assertModel([
                {
                    type: 'simulation_oscilloscope_trace',
                    simulation_oscilloscope_trace_id: 'scope_trace_bad_current',
                    simulation_current_probe_id: 'probe_iload',
                    volts_per_div: 1
                }
            ]),
        /does not match the pinned upstream schema/
    )
})

test('CircuitJsonDocument accepts string unit dimensions and rotations', () => {
    const model = [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_1',
            center: { x: '0mm', y: '0mm' },
            width: '10mm',
            height: '0.5in'
        },
        {
            type: 'source_component',
            source_component_id: 'source_u1',
            name: 'U1',
            ftype: 'simple_chip'
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            center: { x: '2.54mm', y: '100mil' },
            layer: 'top',
            rotation: '90deg',
            width: '1mm',
            height: '40mil'
        },
        {
            type: 'pcb_smtpad',
            shape: 'rotated_rect',
            pcb_smtpad_id: 'pad_u1_1',
            pcb_component_id: 'pcb_u1',
            x: '2.54mm',
            y: '100mil',
            width: 0.8,
            height: 0.4,
            ccw_rotation: '1.5707963268rad',
            layer: 'top'
        }
    ]

    assert.equal(CircuitJsonDocument.isModel(model), true)
    assert.deepEqual(CircuitJsonUnits.point(model[2].center), {
        x: 2.54,
        y: 2.54
    })
    assert.equal(CircuitJsonUnits.angle(model[3].ccw_rotation), 90)
})

test('CircuitJsonDocument accepts exact upstream circle pad radii', () => {
    const model = [
        {
            type: 'pcb_smtpad',
            shape: 'circle',
            pcb_smtpad_id: 'pad_diameter',
            x: 0,
            y: 0,
            radius: 0.5,
            layer: 'top'
        },
        {
            type: 'pcb_smtpad',
            shape: 'circle',
            pcb_smtpad_id: 'pad_size',
            x: 2,
            y: 0,
            radius: 0.5,
            layer: 'top'
        }
    ]

    assert.equal(CircuitJsonDocument.isModel(model), true)
    assert.doesNotThrow(() => CircuitJsonDocument.assertModel(model))
})

test('CircuitJsonDocument accepts exact required PCB component and port fields', () => {
    const model = [
        {
            type: 'source_component',
            source_component_id: 'source_u1',
            name: 'U1',
            ftype: 'simple_chip'
        },
        {
            type: 'source_port',
            source_port_id: 'source_port_1',
            source_component_id: 'source_u1',
            name: ''
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            center: { x: 0, y: 0 },
            layer: 'top',
            rotation: 0,
            width: 0,
            height: 0
        },
        {
            type: 'pcb_smtpad',
            shape: 'pill',
            pcb_smtpad_id: 'pad_u1_1',
            pcb_component_id: 'pcb_u1',
            x: 0,
            y: 0,
            width: 1,
            height: 0.4,
            radius: 0.2,
            layer: 'top'
        }
    ]

    assert.equal(CircuitJsonDocument.isModel(model), true)
    assert.doesNotThrow(() => CircuitJsonDocument.assertModel(model))
})

test('CircuitJsonElementValidator compares schema snapshots', () => {
    const comparison = CircuitJsonElementValidator.compareSchemaSnapshot({
        elementTypes: ['pcb_board', 'future_element'],
        idFieldExceptions: ['source_project_metadata', 'future_exception']
    })

    assert.deepEqual(comparison.missingElementTypes, ['future_element'])
    assert.equal(
        comparison.unexpectedElementTypes.includes('source_component'),
        true
    )
    assert.deepEqual(comparison.missingIdFieldExceptions, ['future_exception'])
    assert.equal(
        comparison.unexpectedIdFieldExceptions.includes('schematic_box'),
        true
    )
    assert.equal(comparison.matches, false)
})

test('CircuitJsonElementValidator compares schema variant snapshots', () => {
    const snapshot = CircuitJsonElementValidator.schemaSnapshot()
    const comparison = CircuitJsonElementValidator.compareSchemaSnapshot({
        elementTypes: snapshot.elementTypes,
        idFieldExceptions: snapshot.idFieldExceptions,
        variantSets: {
            ...snapshot.variantSets,
            pcbSmtPadShapes: ['rect'],
            sourceComponentFtypes: ['simple_resistor']
        }
    })

    assert.equal(
        snapshot.variantSets.pcbSmtPadShapes.includes('rotated_rect'),
        true
    )
    assert.equal(snapshot.variantSets.pcbHoleShapes.includes('circle'), true)
    assert.equal(snapshot.variantSets.pcbHoleShapes.includes('round'), false)
    assert.equal(
        snapshot.variantSets.pcbCopperPourShapes.includes('brep'),
        true
    )
    assert.equal(
        snapshot.variantSets.sourceComponentFtypes.includes('interconnect'),
        true
    )
    assert.equal(
        snapshot.variantSets.pcbPlatedHoleShapes.includes(
            'hole_with_polygon_pad'
        ),
        true
    )
    assert.equal(
        snapshot.variantSets.pcbSolderPasteShapes.includes('rotated_rect'),
        true
    )
    assert.equal(snapshot.variantSets.pcbBoardShapes.includes('polygon'), true)
    assert.equal(
        snapshot.variantSets.simulationWaveShapes.includes('sinewave'),
        true
    )
    assert.equal(
        snapshot.variantSets.simulationExperimentMethods.includes('gear'),
        true
    )
    assert.equal(snapshot.elementTypes.includes('source_interconnect'), false)
    assert.equal(comparison.matches, false)
    assert.deepEqual(comparison.missingVariants, [])
    assert.equal(
        comparison.unexpectedVariants.some(
            (variant) =>
                variant.set === 'pcbSmtPadShapes' &&
                variant.value === 'rotated_rect'
        ),
        true
    )
    assert.equal(
        comparison.unexpectedVariants.some(
            (variant) =>
                variant.set === 'sourceComponentFtypes' &&
                variant.value === 'simple_capacitor'
        ),
        true
    )
})

test('CircuitJsonDocument accepts interconnect source component ftype', () => {
    const model = [
        {
            type: 'source_component',
            source_component_id: 'source_link_1',
            name: 'LINK1',
            ftype: 'interconnect'
        }
    ]

    assert.equal(CircuitJsonDocument.isModel(model), true)
    assert.doesNotThrow(() => CircuitJsonDocument.assertModel(model))
})

test('CircuitJsonDocument accepts a valid selected-part element set', () => {
    const model = [
        {
            type: 'source_project_metadata',
            name: 'fake-board.kicad_pcb',
            software_used_string: 'kicad'
        },
        {
            type: 'source_component',
            source_component_id: 'source_component_u1',
            name: 'U1',
            ftype: 'simple_chip',
            manufacturer_part_number: 'MCU',
            supplier_part_numbers: {}
        },
        {
            type: 'schematic_component',
            schematic_component_id: 'schematic_component_u1',
            source_component_id: 'source_component_u1',
            center: { x: 0, y: 0 },
            size: { width: 2.54, height: 2.54 },
            rotation: 0
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_component_u1',
            source_component_id: 'source_component_u1',
            center: { x: 0, y: 0 },
            layer: 'top',
            rotation: 0,
            width: 1,
            height: 1
        },
        {
            type: 'source_port',
            source_port_id: 'source_component_u1_port_1',
            source_component_id: 'source_component_u1',
            name: 'IO',
            pin_number: 1,
            port_hints: ['1']
        },
        {
            type: 'pcb_smtpad',
            shape: 'rect',
            pcb_smtpad_id: 'pcb_component_u1_pad_1',
            pcb_component_id: 'pcb_component_u1',
            port_hints: ['1'],
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            layer: 'top'
        }
    ]

    assert.equal(CircuitJsonDocument.isModel(model), true)
    assert.doesNotThrow(() => CircuitJsonDocument.assertModel(model))
})

test('CircuitJsonDocument metadata survives structured cloning', () => {
    const model = CircuitJsonDocument.attachMetadata(
        [
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 0, y: 0 },
                width: 10,
                height: 5
            }
        ],
        {
            fileName: 'board.json'
        }
    )
    const clonedModel = structuredClone(model)

    assert.equal(clonedModel.fileName, 'board.json')
    assert.equal(clonedModel.fileType, 'circuitjson')
    assert.equal(clonedModel.kind, 'pcb')
    assert.equal(clonedModel.sourceFormat, 'circuitjson')
})

test('CircuitJsonParser resolves schematic-only kind and diagnostics', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'schematic_component',
                schematic_component_id: 'schematic_u1',
                source_component_id: 'source_u1',
                center: { x: 0, y: 0 },
                size: { width: 10, height: 5 }
            },
            {
                type: 'schematic_layout_error',
                schematic_layout_error_id: 'layout_error_1',
                error_type: 'schematic_layout_error',
                message: 'Overlapping symbols',
                schematic_component_ids: ['schematic_u1']
            }
        ]),
        { fileName: 'sheet.json' }
    )

    assert.equal(model.kind, 'schematic')
    assert.deepEqual(model.diagnostics, [
        {
            severity: 'error',
            sourceFormat: 'circuitjson',
            type: 'schematic_layout_error',
            category: 'layout',
            message: 'Overlapping symbols',
            elementId: 'layout_error_1'
        }
    ])
})

test('CircuitJsonParser derives BOM rows from source components', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 0, y: 0 },
                width: 10,
                height: 5
            },
            {
                type: 'source_component',
                source_component_id: 'source_r1',
                name: 'R1',
                ftype: 'simple_resistor',
                manufacturer_part_number: 'RC0402-10K',
                supplier_part_number: 'DIST-10K',
                resistance: '10k'
            },
            {
                type: 'source_component',
                source_component_id: 'source_r2',
                name: 'R2',
                ftype: 'simple_resistor',
                manufacturer_part_number: 'RC0402-10K',
                supplier_part_number: 'DIST-10K',
                resistance: '10k'
            }
        ]),
        { fileName: 'board.json' }
    )

    assert.deepEqual(model.bom, [
        {
            designators: ['R1', 'R2'],
            quantity: 2,
            value: '10k',
            pattern: 'simple_resistor',
            source: 'RC0402-10K',
            supplierPartNumber: 'DIST-10K',
            supplierPartNumbers: { supplier: 'DIST-10K' },
            sourceFtype: 'simple_resistor',
            componentType: 'resistor',
            componentIcon: 'resistor'
        }
    ])
})

test('CircuitJsonSourceMetadata normalizes source net and port names', () => {
    const usedNames = new Set(['net_1V8_A'])

    assert.equal(
        CircuitJsonSourceMetadata.normalizeSourceNetName('+3V3'),
        '_P3V3'
    )
    assert.equal(
        CircuitJsonSourceMetadata.normalizeSourceNetName('1V8-A', {
            usedNames
        }),
        'net_1V8_A_2'
    )
    assert.equal(
        CircuitJsonSourceMetadata.normalizeSourceNetName('GPIO[0]'),
        'GPIO_0'
    )
    assert.equal(CircuitJsonSourceMetadata.normalizeSourcePortName('1'), 'pin1')
    assert.equal(CircuitJsonSourceMetadata.normalizeSourcePortName(2), 'pin2')
    assert.equal(CircuitJsonSourceMetadata.normalizeSourcePortName('A1'), 'A1')
})

test('CircuitJsonParser normalizes source component type and supplier metadata', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 0, y: 0 },
                width: 10,
                height: 5
            },
            {
                type: 'source_component',
                source_component_id: 'source_d1',
                name: 'D1',
                footprint: 'Indicator_LED_0603',
                supplier_part_numbers: {
                    assembly: 'SUP-LED-0603'
                }
            },
            {
                type: 'source_component',
                source_component_id: 'source_tp1',
                name: 'TP1',
                supplier_part_number: 'SUP-TP-1'
            }
        ]),
        { fileName: 'board.json' }
    )

    assert.deepEqual(
        model.bom.map((row) => ({
            designators: row.designators,
            supplierPartNumber: row.supplierPartNumber,
            supplierPartNumbers: row.supplierPartNumbers,
            sourceFtype: row.sourceFtype,
            componentType: row.componentType,
            componentIcon: row.componentIcon
        })),
        [
            {
                designators: ['D1'],
                supplierPartNumber: 'SUP-LED-0603',
                supplierPartNumbers: { assembly: 'SUP-LED-0603' },
                sourceFtype: 'simple_led',
                componentType: 'led',
                componentIcon: 'led'
            },
            {
                designators: ['TP1'],
                supplierPartNumber: 'SUP-TP-1',
                supplierPartNumbers: { supplier: 'SUP-TP-1' },
                sourceFtype: 'simple_test_point',
                componentType: 'test-point',
                componentIcon: 'test-point'
            }
        ]
    )
})

test('CircuitJsonParser attaches support coverage metadata', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 0, y: 0 },
                width: 10,
                height: 5
            },
            {
                type: 'pcb_smtpad',
                pcb_smtpad_id: 'pad_1',
                shape: 'rect',
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                layer: 'top'
            },
            {
                type: 'schematic_debug_object',
                schematic_debug_object_id: 'debug_1',
                center: { x: 0, y: 0 },
                width: 2,
                height: 1
            },
            {
                type: 'cad_component',
                cad_component_id: 'cad_1',
                model_3mf_url: 'models/body.3mf'
            }
        ]),
        { fileName: 'coverage.json' }
    )

    assert.equal(model.supportMatrix.sourceFormat, 'circuitjson')
    assert.equal(model.supportMatrix.totals.presentElementTypes, 4)
    assert.equal(
        model.supportMatrix.rows.find((row) => row.type === 'pcb_smtpad')
            .capabilities.pcb,
        'rendered'
    )
    assert.equal(
        model.supportMatrix.rows.find(
            (row) => row.type === 'schematic_debug_object'
        ).capabilities.schematic,
        'rendered'
    )
    assert.equal(
        model.supportMatrix.rows.find((row) => row.type === 'cad_component')
            .capabilities.scene3d,
        'external-model'
    )
    assert.equal(
        model.supportMatrix.gaps.some(
            (gap) =>
                gap.type === 'pcb_smtpad' &&
                gap.capability === 'manufacturing' &&
                gap.status === 'partial'
        ),
        true
    )
    assert.equal(
        model.supportMatrix.variantRows.some(
            (row) =>
                row.type === 'pcb_smtpad' &&
                row.group === 'shape' &&
                row.value === 'rect' &&
                row.present
        ),
        true
    )
    assert.equal(
        model.supportMatrix.variantRows.some(
            (row) =>
                row.type === 'source_component' &&
                row.group === 'ftype' &&
                row.value === 'simple_resistor' &&
                !row.present
        ),
        true
    )
    assert.equal(model.supportMatrix.totals.knownVariantValues > 20, true)
})

test('CircuitJsonParser carries diagnostic relation metadata', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'source_component',
                source_component_id: 'source_u1',
                name: 'U1',
                ftype: 'simple_chip'
            },
            {
                type: 'source_component_pins_underspecified_warning',
                source_component_pins_underspecified_warning_id: 'warning_1',
                warning_type: 'source_component_pins_underspecified_warning',
                source_component_id: 'source_u1',
                source_port_id: 'source_port_1',
                message: 'Pin definition is incomplete.'
            }
        ]),
        { fileName: 'diagnostics.json' }
    )

    assert.deepEqual(model.diagnostics, [
        {
            severity: 'warning',
            sourceFormat: 'circuitjson',
            type: 'source_component_pins_underspecified_warning',
            category: 'pin-definition',
            message: 'Pin definition is incomplete.',
            elementId: 'warning_1',
            sourceComponentId: 'source_u1',
            sourcePortId: 'source_port_1'
        }
    ])
})

test('CircuitJsonParser derives manufacturing placement and routing exchange data', () => {
    const model = CircuitJsonParser.parseText(
        JSON.stringify([
            {
                type: 'pcb_board',
                pcb_board_id: 'board_1',
                center: { x: 0, y: 0 },
                width: 10,
                height: 5,
                num_layers: 2
            },
            {
                type: 'source_component',
                source_component_id: 'source_u1',
                name: 'U1',
                ftype: 'simple_chip',
                manufacturer_part_number: 'MCU-1'
            },
            {
                type: 'pcb_component',
                pcb_component_id: 'pcb_u1',
                source_component_id: 'source_u1',
                center: { x: 1.5, y: -0.5 },
                layer: 'bottom',
                rotation: 90
            },
            {
                type: 'source_net',
                source_net_id: 'source_net_1',
                name: 'SIG'
            },
            {
                type: 'pcb_smtpad',
                pcb_smtpad_id: 'pad_1',
                pcb_component_id: 'pcb_u1',
                source_net_id: 'source_net_1',
                shape: 'rect',
                x: 1.5,
                y: -0.8,
                width: 0.6,
                height: 0.3,
                layer: 'bottom',
                net: 'SIG'
            },
            {
                type: 'pcb_trace',
                pcb_trace_id: 'trace_1',
                net: 'SIG',
                route: [
                    { x: 1.5, y: -0.8, width: 0.15, layer: 'bottom' },
                    { x: 3, y: -0.8, width: 0.15, layer: 'bottom' }
                ]
            }
        ]),
        { fileName: 'assembly.json' }
    )

    assert.deepEqual(model.manufacturing.pickAndPlaceRows, [
        {
            designator: 'U1',
            componentId: 'pcb_u1',
            sourceComponentId: 'source_u1',
            x: 1.5,
            y: -0.5,
            rotation: 90,
            layer: 'bottom',
            side: 'bottom',
            value: '',
            package: 'simple_chip',
            manufacturerPartNumber: 'MCU-1'
        }
    ])
    assert.match(model.manufacturing.routingDsn, /\(pcb assembly\)/)
    assert.match(model.manufacturing.routingDsn, /\(component U1/)
    assert.match(model.manufacturing.routingDsn, /\(net SIG/)
    assert.match(
        model.manufacturing.routingDsn,
        /\(wire bottom 1\.5 -0\.8 3 -0\.8 0\.15\)/
    )
})

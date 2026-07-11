import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocument } from '../src/index.mjs'
import {
    SpiceCompatibilityPreprocessor,
    SpiceSimulationService
} from '../src/extensions.mjs'

test('SpiceCompatibilityPreprocessor rewrites supported compatibility syntax', () => {
    const source = [
        'R_U_EA_R1         COMP U_EA_N04642  350k TC=0,0',
        'C1 out 0 1u TC=0,0',
        'E_AND Y 0 VALUE {{IF(V(A) > 0.5  ^  V(B) > 0.5,1,0)}}',
        'B1 out 0 V={2 ^ 3}'
    ].join('\n')

    assert.equal(
        SpiceCompatibilityPreprocessor.rewrite(source),
        [
            'R_U_EA_R1         COMP U_EA_N04642  350k TC1=0 TC2=0',
            'C1 out 0 1u TC=0,0',
            'E_AND Y 0 VALUE {{IF(V(A) > 0.5  !=  V(B) > 0.5,1,0)}}',
            'B1 out 0 V={2 ^ 3}'
        ].join('\n')
    )
})

test('SpiceSimulationService emits voltage and current transient graph elements', async () => {
    const result = await SpiceSimulationService.simulate(`
Vmain out 0 DC 3.3
Iload out 0 DC 0.02
* ecadforge_voltage_probe {"simulation_voltage_probe_id":"probe_vout","name":"VOUT","spice_vector":"V(out)","source_node_name":"out","reference_node_name":"0"}
* ecadforge_current_probe {"simulation_current_probe_id":"probe_iload","name":"I_LOAD","spice_vector":"I(Iload)","source_component_id":"source_component_1","source_trace_id":"source_trace_1"}
.PRINT TRAN V(out) I(Iload)
.tran 1ms 3ms
.END
`)

    CircuitJsonDocument.assertModel(result.simulationResultCircuitJson)
    assert.equal(result.diagnostics.length, 0)
    assert.equal(result.simulationResultCircuitJson.length, 2)
    CircuitJsonDocument.assertModel(result.simulationCircuitJson)
    assert.deepEqual(result.simulationCircuitJson[0], {
        type: 'simulation_experiment',
        simulation_experiment_id: 'simulation_experiment_0',
        name: 'SPICE transient analysis',
        experiment_type: 'spice_transient_analysis'
    })
    assert.deepEqual(
        result.simulationCircuitJson.slice(1),
        result.simulationResultCircuitJson
    )

    const voltageGraph = result.simulationResultCircuitJson.find(
        (element) => element.type === 'simulation_transient_voltage_graph'
    )
    const currentGraph = result.simulationResultCircuitJson.find(
        (element) => element.type === 'simulation_transient_current_graph'
    )

    assert.deepEqual(voltageGraph, {
        type: 'simulation_transient_voltage_graph',
        simulation_experiment_id: 'simulation_experiment_0',
        simulation_transient_voltage_graph_id: 'simulation_graph_probe_vout',
        name: 'VOUT',
        voltage_levels: [3.3, 3.3, 3.3, 3.3],
        timestamps_ms: [0, 1, 2, 3],
        start_time_ms: 0,
        time_per_step: 1,
        end_time_ms: 3,
        source_probe_id: 'probe_vout',
        source_probe_name: 'VOUT',
        source_node_name: 'out',
        reference_node_name: '0'
    })
    assert.deepEqual(currentGraph, {
        type: 'simulation_transient_current_graph',
        simulation_experiment_id: 'simulation_experiment_0',
        simulation_transient_current_graph_id: 'simulation_graph_probe_iload',
        name: 'I_LOAD',
        current_levels: [0.02, 0.02, 0.02, 0.02],
        timestamps_ms: [0, 1, 2, 3],
        start_time_ms: 0,
        time_per_step: 1,
        end_time_ms: 3,
        source_probe_id: 'probe_iload',
        source_probe_name: 'I_LOAD',
        source_component_id: 'source_component_1',
        source_trace_id: 'source_trace_1'
    })
})

test('SpiceSimulationService accepts neutral probe metadata aliases', async () => {
    const result = await SpiceSimulationService.simulate(`
Vmain out 0 DC 1.8
Vref ref 0 DC 0.9
Iload out 0 DC 0.01
Isense ref 0 DC 0.02
* circuitjson_voltage_probe {"simulation_voltage_probe_id":"probe_vout_alias","name":"VOUT_ALIAS","spice_vector":"V(out)","source_node_name":"out","reference_node_name":"0"}
* simulation_voltage_probe {"simulation_voltage_probe_id":"probe_vref_alias","name":"VREF_ALIAS","spice_vector":"V(ref)","source_node_name":"ref","reference_node_name":"0"}
* circuitjson_current_probe {"simulation_current_probe_id":"probe_iload_alias","name":"ILOAD_ALIAS","spice_vector":"I(Iload)","source_component_id":"source_component_load","source_trace_id":"source_trace_load"}
* simulation_current_probe {"simulation_current_probe_id":"probe_isense_alias","name":"ISENSE_ALIAS","spice_vector":"I(Isense)","source_component_id":"source_component_sense","source_trace_id":"source_trace_sense"}
.PRINT TRAN V(out) V(ref) I(Iload) I(Isense)
.tran 1ms 1ms
.END
`)

    const graphsByName = new Map(
        result.simulationResultCircuitJson.map((graph) => [graph.name, graph])
    )

    assert.equal(result.diagnostics.length, 0)
    assert.deepEqual(graphsByName.get('VOUT_ALIAS'), {
        type: 'simulation_transient_voltage_graph',
        simulation_experiment_id: 'simulation_experiment_0',
        simulation_transient_voltage_graph_id:
            'simulation_graph_probe_vout_alias',
        name: 'VOUT_ALIAS',
        voltage_levels: [1.8, 1.8],
        timestamps_ms: [0, 1],
        start_time_ms: 0,
        time_per_step: 1,
        end_time_ms: 1,
        source_probe_id: 'probe_vout_alias',
        source_probe_name: 'VOUT_ALIAS',
        source_node_name: 'out',
        reference_node_name: '0'
    })
    assert.deepEqual(graphsByName.get('VREF_ALIAS'), {
        type: 'simulation_transient_voltage_graph',
        simulation_experiment_id: 'simulation_experiment_0',
        simulation_transient_voltage_graph_id:
            'simulation_graph_probe_vref_alias',
        name: 'VREF_ALIAS',
        voltage_levels: [0.9, 0.9],
        timestamps_ms: [0, 1],
        start_time_ms: 0,
        time_per_step: 1,
        end_time_ms: 1,
        source_probe_id: 'probe_vref_alias',
        source_probe_name: 'VREF_ALIAS',
        source_node_name: 'ref',
        reference_node_name: '0'
    })
    assert.deepEqual(graphsByName.get('ILOAD_ALIAS'), {
        type: 'simulation_transient_current_graph',
        simulation_experiment_id: 'simulation_experiment_0',
        simulation_transient_current_graph_id:
            'simulation_graph_probe_iload_alias',
        name: 'ILOAD_ALIAS',
        current_levels: [0.01, 0.01],
        timestamps_ms: [0, 1],
        start_time_ms: 0,
        time_per_step: 1,
        end_time_ms: 1,
        source_probe_id: 'probe_iload_alias',
        source_probe_name: 'ILOAD_ALIAS',
        source_component_id: 'source_component_load',
        source_trace_id: 'source_trace_load'
    })
    assert.deepEqual(graphsByName.get('ISENSE_ALIAS'), {
        type: 'simulation_transient_current_graph',
        simulation_experiment_id: 'simulation_experiment_0',
        simulation_transient_current_graph_id:
            'simulation_graph_probe_isense_alias',
        name: 'ISENSE_ALIAS',
        current_levels: [0.02, 0.02],
        timestamps_ms: [0, 1],
        start_time_ms: 0,
        time_per_step: 1,
        end_time_ms: 1,
        source_probe_id: 'probe_isense_alias',
        source_probe_name: 'ISENSE_ALIAS',
        source_component_id: 'source_component_sense',
        source_trace_id: 'source_trace_sense'
    })
})

test('SpiceSimulationService reports malformed probe metadata diagnostics', async () => {
    const result = await SpiceSimulationService.simulate(
        [
            'Vmain out 0 DC 2',
            'Iload out 0 DC 0.01',
            '* simulation_voltage_probe {"simulation_voltage_probe_id":',
            '* circuitjson_voltage_probe {"name":"bad voltage","spice_vector":"V(out)"}',
            '* simulation_current_probe {not-json}',
            '* circuitjson_current_probe {"simulation_current_probe_id":"probe_bad_current"}',
            '.PRINT TRAN V(out) I(Iload)',
            '.tran 1ms 1ms',
            '.END'
        ].join('\n')
    )

    assert.deepEqual(
        result.diagnostics.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            lineNumber: diagnostic.lineNumber,
            probeType: diagnostic.probeType
        })),
        [
            {
                severity: 'warning',
                code: 'spice_probe_metadata_invalid_json',
                lineNumber: 3,
                probeType: 'voltage'
            },
            {
                severity: 'warning',
                code: 'spice_probe_metadata_invalid_shape',
                lineNumber: 4,
                probeType: 'voltage'
            },
            {
                severity: 'warning',
                code: 'spice_probe_metadata_invalid_json',
                lineNumber: 5,
                probeType: 'current'
            },
            {
                severity: 'warning',
                code: 'spice_probe_metadata_invalid_shape',
                lineNumber: 6,
                probeType: 'current'
            }
        ]
    )
})

test('SpiceSimulationService derives differential voltage graphs from node data', async () => {
    const result = await SpiceSimulationService.simulate(`
Vmain out 0 DC 5
Vref ref 0 DC 2
.PRINT TRAN V(out, ref)
.tran 0.5ms 1ms
.END
`)

    assert.deepEqual(result.simulationResultCircuitJson, [
        {
            type: 'simulation_transient_voltage_graph',
            simulation_experiment_id: 'simulation_experiment_0',
            simulation_transient_voltage_graph_id: 'simulation_graph_0_out-ref',
            name: 'out-ref',
            voltage_levels: [3, 3, 3],
            timestamps_ms: [0, 0.5, 1],
            start_time_ms: 0,
            time_per_step: 0.5,
            end_time_ms: 1,
            source_probe_id: undefined,
            source_probe_name: undefined,
            source_node_name: undefined,
            reference_node_name: undefined
        }
    ])
})

test('SpiceSimulationService normalizes injected engine result data', async () => {
    const receivedNetlists = []
    const service = new SpiceSimulationService({
        engine: {
            simulate: async (netlist) => {
                receivedNetlists.push(netlist)
                return {
                    dataType: 'real',
                    data: [
                        { name: 'time', type: 'time', values: [0, 0.001] },
                        {
                            name: 'v(out)',
                            type: 'voltage',
                            values: [1.2, 1.4]
                        }
                    ]
                }
            }
        }
    })

    const result = await service.simulate(`
R1 out 0 1k TC=0,0
.PRINT TRAN V(out)
.tran 1ms 1ms
.END
`)

    assert.match(receivedNetlists[0], /TC1=0 TC2=0/)
    assert.deepEqual(result.simulationResultCircuitJson, [
        {
            type: 'simulation_transient_voltage_graph',
            simulation_experiment_id: 'simulation_experiment_0',
            simulation_transient_voltage_graph_id: 'simulation_graph_0_out',
            name: 'out',
            voltage_levels: [1.2, 1.4],
            timestamps_ms: [0, 1],
            start_time_ms: 0,
            time_per_step: 1,
            end_time_ms: 1,
            source_probe_id: undefined,
            source_probe_name: undefined,
            source_node_name: undefined,
            reference_node_name: undefined
        }
    ])
})

test('SpiceSimulationService resamples injected engine data to the transient grid', async () => {
    const service = new SpiceSimulationService({
        engine: {
            simulate: async () => ({
                dataType: 'real',
                data: [
                    { name: 'time', type: 'time', values: [0, 0.0015, 0.003] },
                    {
                        name: 'v(out)',
                        type: 'voltage',
                        values: [0, 1.5, 3]
                    }
                ]
            })
        }
    })

    const result = await service.simulate(`
Vmain out 0 DC 3
.PRINT TRAN V(out)
.tran 1ms 3ms
.END
`)

    assert.deepEqual(result.simulationResultCircuitJson, [
        {
            type: 'simulation_transient_voltage_graph',
            simulation_experiment_id: 'simulation_experiment_0',
            simulation_transient_voltage_graph_id: 'simulation_graph_0_out',
            name: 'out',
            voltage_levels: [0, 1, 2, 3],
            timestamps_ms: [0, 1, 2, 3],
            start_time_ms: 0,
            time_per_step: 1,
            end_time_ms: 3,
            source_probe_id: undefined,
            source_probe_name: undefined,
            source_node_name: undefined,
            reference_node_name: undefined
        }
    ])
})

test('SpiceSimulationService reports unsupported local syntax diagnostics', async () => {
    const result = await SpiceSimulationService.simulate(
        [
            '.lib generic_models.lib',
            '.include generic_subckt.cir',
            'Bshape out 0 PWL REPEAT FOREVER (0 0 1ms 1)',
            '.model alias_model AKO:base_model NPN (BF=100)',
            'Dlimit out 0 clamp_model 2',
            'Etable ctrl 0 TABLE {V(out)} = (0 0 1 5)',
            '.model switch_model VSWITCH(RON=1 ROFF=1MEG VON=2 VOFF=1)',
            'Vmain out 0 DC 1',
            '.PRINT TRAN V(out)',
            '.tran 1ms 1ms',
            '.END'
        ].join('\n')
    )

    assert.deepEqual(
        result.diagnostics.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            lineNumber: diagnostic.lineNumber
        })),
        [
            {
                severity: 'warning',
                code: 'spice_external_library_unsupported',
                lineNumber: 1
            },
            {
                severity: 'warning',
                code: 'spice_external_include_unsupported',
                lineNumber: 2
            },
            {
                severity: 'warning',
                code: 'spice_pwl_repeat_unsupported',
                lineNumber: 3
            },
            {
                severity: 'warning',
                code: 'spice_pspice_ako_model_unsupported',
                lineNumber: 4
            },
            {
                severity: 'warning',
                code: 'spice_pspice_diode_area_factor_unsupported',
                lineNumber: 5
            },
            {
                severity: 'warning',
                code: 'spice_pspice_table_source_unsupported',
                lineNumber: 6
            },
            {
                severity: 'warning',
                code: 'spice_pspice_vswitch_model_unsupported',
                lineNumber: 7
            }
        ]
    )
})

test('SpiceSimulationService reports requested plots that produce no graph', async () => {
    const service = new SpiceSimulationService({
        engine: {
            simulate: async () => ({
                dataType: 'real',
                data: [
                    { name: 'time', type: 'time', values: [0, 0.001] },
                    {
                        name: 'v(out)',
                        type: 'voltage',
                        values: [1, 1]
                    }
                ]
            })
        }
    })

    const result = await service.simulate(`
Vmain out 0 DC 1
.PRINT TRAN V(out) I(Vsense) V(missing)
.tran 1ms 1ms
.END
`)

    assert.equal(result.simulationResultCircuitJson.length, 1)
    assert.deepEqual(
        result.diagnostics
            .filter(
                (diagnostic) =>
                    diagnostic.code === 'spice_requested_plot_missing'
            )
            .map((diagnostic) => ({
                severity: diagnostic.severity,
                code: diagnostic.code,
                plot: diagnostic.plot
            })),
        [
            {
                severity: 'warning',
                code: 'spice_requested_plot_missing',
                plot: 'I(Vsense)'
            },
            {
                severity: 'warning',
                code: 'spice_requested_plot_missing',
                plot: 'V(missing)'
            }
        ]
    )
})

test('SpiceSimulationService returns a deterministic transient graph summary', async () => {
    const result = await SpiceSimulationService.simulate(`
Vmain out 0 DC 3.3
Iload out 0 DC 0.02
.PRINT TRAN V(out) I(Iload)
.tran 1ms 2ms
.END
`)

    assert.deepEqual(result.graphSummary, {
        graphCount: 2,
        voltageGraphCount: 1,
        currentGraphCount: 1,
        graphs: [
            {
                id: 'simulation_graph_0_out',
                graphType: 'voltage',
                name: 'out',
                pointCount: 3,
                startTimeMs: 0,
                endTimeMs: 2,
                timePerStepMs: 1,
                min: 3.3,
                max: 3.3,
                firstValue: 3.3,
                lastValue: 3.3
            },
            {
                id: 'simulation_graph_1_Iload',
                graphType: 'current',
                name: 'Iload',
                pointCount: 3,
                startTimeMs: 0,
                endTimeMs: 2,
                timePerStepMs: 1,
                min: 0.02,
                max: 0.02,
                firstValue: 0.02,
                lastValue: 0.02
            }
        ]
    })
})

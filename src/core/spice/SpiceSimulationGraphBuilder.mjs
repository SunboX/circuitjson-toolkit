import { SpiceDirectiveParser } from './SpiceDirectiveParser.mjs'
import { SpiceTimeSeriesNormalizer } from './SpiceTimeSeriesNormalizer.mjs'

/**
 * Converts simulator result rows into CircuitJSON transient graph elements.
 */
export class SpiceSimulationGraphBuilder {
    /**
     * Builds CircuitJSON transient graph elements from a simulation result.
     * @param {object} result Simulator result.
     * @param {string} spiceString Preprocessed SPICE netlist text.
     * @param {{ simulationExperimentId?: string }} [options] Graph output options.
     * @returns {object[]}
     */
    static buildCircuitJsonGraphs(result, spiceString, options = {}) {
        const tran = SpiceDirectiveParser.parseTransient(spiceString)
        const graphs = SpiceTimeSeriesNormalizer.resampleGraphs(
            SpiceSimulationGraphBuilder.#buildGraphs(result, spiceString),
            tran
        )
        const simulationExperimentId =
            options.simulationExperimentId || 'simulation_experiment_0'

        return graphs.map((graph, index) =>
            graph.graphType === 'voltage'
                ? SpiceSimulationGraphBuilder.#voltageGraphElement(
                      graph,
                      index,
                      tran,
                      simulationExperimentId
                  )
                : SpiceSimulationGraphBuilder.#currentGraphElement(
                      graph,
                      index,
                      tran,
                      simulationExperimentId
                  )
        )
    }

    /**
     * Builds a complete simulation experiment element set.
     * @param {object} result Simulator result.
     * @param {string} spiceString Preprocessed SPICE netlist text.
     * @param {{ simulationExperimentId?: string, name?: string }} [options] Experiment output options.
     * @returns {object[]}
     */
    static buildCircuitJsonExperiment(result, spiceString, options = {}) {
        const simulationExperimentId =
            options.simulationExperimentId || 'simulation_experiment_0'
        const graphs = SpiceSimulationGraphBuilder.buildCircuitJsonGraphs(
            result,
            spiceString,
            { simulationExperimentId }
        )

        return [
            {
                type: 'simulation_experiment',
                simulation_experiment_id: simulationExperimentId,
                name: options.name || 'SPICE transient analysis',
                experiment_type: 'spice_transient_analysis'
            },
            ...graphs
        ]
    }

    /**
     * Finds requested transient plot tokens that did not produce graph models.
     * @param {object} result Simulator result.
     * @param {string} spiceString Preprocessed SPICE netlist text.
     * @returns {{ normalizedToken: string, originalToken: string }[]}
     */
    static findMissingRequestedPlots(result, spiceString) {
        const requestedPlots =
            SpiceDirectiveParser.parseRequestedPlots(spiceString)
        if (!requestedPlots) return []

        const fulfilledTokens = new Set(
            SpiceSimulationGraphBuilder.#buildGraphs(result, spiceString)
                .map((graph) => graph.normalizedToken)
                .filter(Boolean)
        )

        return [...requestedPlots]
            .filter(
                ([normalizedToken]) => !fulfilledTokens.has(normalizedToken)
            )
            .map(([normalizedToken, originalToken]) => ({
                normalizedToken,
                originalToken
            }))
    }

    /**
     * Builds normalized graph models from simulator data rows.
     * @param {object} result Simulator result.
     * @param {string} spiceString Preprocessed SPICE netlist text.
     * @returns {object[]}
     */
    static #buildGraphs(result, spiceString) {
        if (!result?.data || result.dataType !== 'real') return []

        const timeRow = result.data.find((row) => row.type === 'time')
        if (!Array.isArray(timeRow?.values)) return []

        const timeValues = timeRow.values
        const voltageRows = result.data.filter(
            (row) => row.type === 'voltage' && Array.isArray(row.values)
        )
        const currentRows = result.data.filter(
            (row) => row.type === 'current' && Array.isArray(row.values)
        )
        const voltageData = new Map(
            voltageRows.map((row) => [
                SpiceDirectiveParser.normalizeVector(row.name),
                row.values
            ])
        )
        const currentData = new Map(
            currentRows.map((row) => [
                SpiceDirectiveParser.normalizeVector(row.name),
                row.values
            ])
        )
        const requestedPlots =
            SpiceDirectiveParser.parseRequestedPlots(spiceString)
        const voltageMetadata =
            SpiceDirectiveParser.extractVoltageProbeMetadata(spiceString)
        const currentMetadata =
            SpiceDirectiveParser.extractCurrentProbeMetadata(spiceString)

        if (!requestedPlots) {
            return [
                ...voltageRows.map((row) =>
                    SpiceSimulationGraphBuilder.#voltageGraphFromRow(
                        row,
                        timeValues,
                        voltageMetadata
                    )
                ),
                ...currentRows.map((row) =>
                    SpiceSimulationGraphBuilder.#currentGraphFromRow(
                        row,
                        timeValues,
                        currentMetadata
                    )
                )
            ]
        }

        const graphs = []
        for (const [normalizedToken, originalToken] of requestedPlots) {
            const graph =
                SpiceSimulationGraphBuilder.#voltageGraphFromPlot({
                    normalizedToken,
                    originalToken,
                    timeValues,
                    voltageData,
                    voltageMetadata
                }) ??
                SpiceSimulationGraphBuilder.#currentGraphFromPlot({
                    normalizedToken,
                    originalToken,
                    timeValues,
                    currentData,
                    currentMetadata
                })

            if (graph) graphs.push(graph)
        }

        return graphs
    }

    /**
     * Builds one voltage graph from an available result row.
     * @param {object} row Simulator data row.
     * @param {number[]} timeValues Time values in seconds.
     * @param {Map<string, object>} voltageMetadata Probe metadata by vector.
     * @returns {object}
     */
    static #voltageGraphFromRow(row, timeValues, voltageMetadata) {
        const normalized = SpiceDirectiveParser.normalizeVector(row.name)
        const metadata = voltageMetadata.get(normalized)

        return {
            graphType: 'voltage',
            name:
                metadata?.name ??
                SpiceSimulationGraphBuilder.#voltageName(row.name),
            time: timeValues,
            values: row.values,
            metadata
        }
    }

    /**
     * Builds one current graph from an available result row.
     * @param {object} row Simulator data row.
     * @param {number[]} timeValues Time values in seconds.
     * @param {Map<string, object>} currentMetadata Probe metadata by vector.
     * @returns {object}
     */
    static #currentGraphFromRow(row, timeValues, currentMetadata) {
        const normalized = SpiceDirectiveParser.normalizeVector(row.name)
        const metadata = currentMetadata.get(normalized)

        return {
            graphType: 'current',
            name:
                metadata?.name ??
                SpiceSimulationGraphBuilder.#currentName(row.name),
            time: timeValues,
            values: row.values,
            metadata
        }
    }

    /**
     * Builds one voltage graph for a requested plot token.
     * @param {object} options Plot options.
     * @returns {object | null}
     */
    static #voltageGraphFromPlot(options) {
        const {
            normalizedToken,
            originalToken,
            timeValues,
            voltageData,
            voltageMetadata
        } = options
        if (!normalizedToken.startsWith('v(')) return null

        const diffMatch = originalToken.match(/^v\(([^,]+),\s*([^)]+)\)$/i)
        let values = voltageData.get(normalizedToken)

        if (!values && diffMatch?.[1] && diffMatch?.[2]) {
            values = SpiceSimulationGraphBuilder.#differentialValues(
                diffMatch[1],
                diffMatch[2],
                voltageData
            )
        }

        if (!values) return null

        const metadata = voltageMetadata.get(normalizedToken)
        return {
            graphType: 'voltage',
            normalizedToken,
            name:
                metadata?.name ??
                SpiceSimulationGraphBuilder.#voltageName(originalToken),
            time: timeValues,
            values,
            metadata
        }
    }

    /**
     * Builds one current graph for a requested plot token.
     * @param {object} options Plot options.
     * @returns {object | null}
     */
    static #currentGraphFromPlot(options) {
        const {
            normalizedToken,
            originalToken,
            timeValues,
            currentData,
            currentMetadata
        } = options
        if (!normalizedToken.startsWith('i(')) return null

        const values = currentData.get(normalizedToken)
        if (!values) return null

        const metadata = currentMetadata.get(normalizedToken)
        return {
            graphType: 'current',
            normalizedToken,
            name:
                metadata?.name ??
                SpiceSimulationGraphBuilder.#currentName(originalToken),
            time: timeValues,
            values,
            metadata
        }
    }

    /**
     * Resolves differential voltage values from two node vectors.
     * @param {string} positiveNode Positive node name.
     * @param {string} referenceNode Reference node name.
     * @param {Map<string, number[]>} voltageData Voltage data map.
     * @returns {number[] | undefined}
     */
    static #differentialValues(positiveNode, referenceNode, voltageData) {
        const positiveValues = voltageData.get(
            `v(${String(positiveNode).trim().toLowerCase()})`
        )
        const referenceValues = voltageData.get(
            `v(${String(referenceNode).trim().toLowerCase()})`
        )

        if (!positiveValues || !referenceValues) return undefined

        return positiveValues.map((value, index) =>
            SpiceSimulationGraphBuilder.#round(
                value - (referenceValues[index] ?? 0)
            )
        )
    }

    /**
     * Converts a normalized graph to a voltage graph element.
     * @param {object} graph Graph model.
     * @param {number} index Graph index.
     * @param {object | null} tran Transient timing parameters.
     * @param {string} simulationExperimentId Simulation experiment id.
     * @returns {object}
     */
    static #voltageGraphElement(graph, index, tran, simulationExperimentId) {
        const graphIdSource =
            graph.metadata?.simulation_voltage_probe_id ??
            `${index}_${graph.name}`

        return {
            type: 'simulation_transient_voltage_graph',
            simulation_experiment_id: simulationExperimentId,
            simulation_transient_voltage_graph_id:
                'simulation_graph_' + graphIdSource,
            name: graph.name,
            voltage_levels: graph.values.map((value) =>
                SpiceSimulationGraphBuilder.#round(value)
            ),
            timestamps_ms: graph.time.map((time) =>
                SpiceSimulationGraphBuilder.#round(time * 1000)
            ),
            start_time_ms: (tran?.tstart ?? 0) * 1000,
            time_per_step: (tran?.tstep ?? 0) * 1000,
            end_time_ms: (tran?.tstop ?? 0) * 1000,
            source_probe_id: graph.metadata?.simulation_voltage_probe_id,
            source_probe_name: graph.metadata?.name,
            source_node_name: graph.metadata?.source_node_name,
            reference_node_name: graph.metadata?.reference_node_name
        }
    }

    /**
     * Converts a normalized graph to a current graph element.
     * @param {object} graph Graph model.
     * @param {number} index Graph index.
     * @param {object | null} tran Transient timing parameters.
     * @param {string} simulationExperimentId Simulation experiment id.
     * @returns {object}
     */
    static #currentGraphElement(graph, index, tran, simulationExperimentId) {
        const graphIdSource =
            graph.metadata?.simulation_current_probe_id ??
            `${index}_${graph.name}`

        return {
            type: 'simulation_transient_current_graph',
            simulation_experiment_id: simulationExperimentId,
            simulation_transient_current_graph_id:
                'simulation_graph_' + graphIdSource,
            name: graph.name,
            current_levels: graph.values.map((value) =>
                SpiceSimulationGraphBuilder.#round(value)
            ),
            timestamps_ms: graph.time.map((time) =>
                SpiceSimulationGraphBuilder.#round(time * 1000)
            ),
            start_time_ms: (tran?.tstart ?? 0) * 1000,
            time_per_step: (tran?.tstep ?? 0) * 1000,
            end_time_ms: (tran?.tstop ?? 0) * 1000,
            source_probe_id: graph.metadata?.simulation_current_probe_id,
            source_probe_name: graph.metadata?.name,
            source_component_id: graph.metadata?.source_component_id,
            source_trace_id: graph.metadata?.source_trace_id
        }
    }

    /**
     * Returns a display name for a voltage vector token.
     * @param {string} rawName Raw vector token.
     * @returns {string}
     */
    static #voltageName(rawName) {
        const diffMatch = String(rawName || '').match(
            /^v\(([^,]+),\s*([^)]+)\)$/i
        )
        if (diffMatch?.[1] && diffMatch?.[2]) {
            return `${diffMatch[1].trim()}-${diffMatch[2].trim()}`
        }

        const match = String(rawName || '').match(/^v\((.*)\)$/i)
        return match?.[1] ?? String(rawName || '')
    }

    /**
     * Returns a display name for a current vector token.
     * @param {string} rawName Raw vector token.
     * @returns {string}
     */
    static #currentName(rawName) {
        const match = String(rawName || '').match(/^i\((.*)\)$/i)
        return match?.[1] ?? String(rawName || '')
    }

    /**
     * Rounds numeric output to a stable precision.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value).toPrecision(12))
    }
}

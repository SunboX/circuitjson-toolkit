/**
 * Builds deterministic summaries for transient graph elements.
 */
export class SpiceSimulationGraphSummary {
    /**
     * Summarizes transient graph elements for renderer and test callers.
     * @param {object[]} simulationResultCircuitJson Graph-only CircuitJSON elements.
     * @returns {object}
     */
    static summarize(simulationResultCircuitJson) {
        const graphs = Array.isArray(simulationResultCircuitJson)
            ? simulationResultCircuitJson.filter((element) =>
                  SpiceSimulationGraphSummary.#isTransientGraph(element)
              )
            : []

        return {
            graphCount: graphs.length,
            voltageGraphCount: graphs.filter(
                (element) =>
                    element.type === 'simulation_transient_voltage_graph'
            ).length,
            currentGraphCount: graphs.filter(
                (element) =>
                    element.type === 'simulation_transient_current_graph'
            ).length,
            graphs: graphs.map((element) =>
                SpiceSimulationGraphSummary.#summarizeGraph(element)
            )
        }
    }

    /**
     * Returns true when an element is a transient graph.
     * @param {object} element Candidate CircuitJSON element.
     * @returns {boolean}
     */
    static #isTransientGraph(element) {
        return (
            element?.type === 'simulation_transient_voltage_graph' ||
            element?.type === 'simulation_transient_current_graph'
        )
    }

    /**
     * Summarizes one transient graph element.
     * @param {object} element Transient graph element.
     * @returns {object}
     */
    static #summarizeGraph(element) {
        const isVoltage = element.type === 'simulation_transient_voltage_graph'
        const values = isVoltage
            ? element.voltage_levels
            : element.current_levels
        const finiteValues = Array.isArray(values)
            ? values.filter(Number.isFinite)
            : []

        return {
            id: isVoltage
                ? element.simulation_transient_voltage_graph_id
                : element.simulation_transient_current_graph_id,
            graphType: isVoltage ? 'voltage' : 'current',
            name: element.name,
            pointCount: Array.isArray(values) ? values.length : 0,
            startTimeMs: element.start_time_ms,
            endTimeMs: element.end_time_ms,
            timePerStepMs: element.time_per_step,
            min: SpiceSimulationGraphSummary.#round(
                finiteValues.length ? Math.min(...finiteValues) : undefined
            ),
            max: SpiceSimulationGraphSummary.#round(
                finiteValues.length ? Math.max(...finiteValues) : undefined
            ),
            firstValue: SpiceSimulationGraphSummary.#round(values?.[0]),
            lastValue: SpiceSimulationGraphSummary.#round(values?.at(-1))
        }
    }

    /**
     * Rounds finite numeric output to a stable precision.
     * @param {unknown} value Numeric value.
     * @returns {number | undefined}
     */
    static #round(value) {
        return Number.isFinite(value)
            ? Number(Number(value).toPrecision(12))
            : undefined
    }
}

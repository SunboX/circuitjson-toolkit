import { CircuitJsonDocument } from '../CircuitJsonDocument.mjs'
import { SpiceCompatibilityPreprocessor } from './SpiceCompatibilityPreprocessor.mjs'
import { SpiceFallbackSimulationEngine } from './SpiceFallbackSimulationEngine.mjs'
import { SpiceSimulationDiagnostics } from './SpiceSimulationDiagnostics.mjs'
import { SpiceSimulationGraphBuilder } from './SpiceSimulationGraphBuilder.mjs'
import { SpiceSimulationGraphSummary } from './SpiceSimulationGraphSummary.mjs'

/**
 * Runs SPICE transient simulations through an injectable engine boundary.
 */
export class SpiceSimulationService {
    /** @type {{ simulate: (spiceString: string) => Promise<object> | object }} */
    #engine

    /**
     * @param {{ engine?: { simulate: (spiceString: string) => Promise<object> | object } }} [dependencies] Service dependencies.
     */
    constructor(dependencies = {}) {
        this.#engine =
            dependencies.engine || new SpiceFallbackSimulationEngine()
    }

    /**
     * Simulates a netlist with the default local fallback engine.
     * @param {string} spiceString SPICE netlist text.
     * @returns {Promise<{ simulationResultCircuitJson: object[], simulationCircuitJson: object[], graphSummary: object, diagnostics: object[] }>}
     */
    static async simulate(spiceString) {
        return new SpiceSimulationService().simulate(spiceString)
    }

    /**
     * Simulates a netlist and returns CircuitJSON transient graph elements.
     * @param {string} spiceString SPICE netlist text.
     * @returns {Promise<{ simulationResultCircuitJson: object[], simulationCircuitJson: object[], graphSummary: object, diagnostics: object[] }>}
     */
    async simulate(spiceString) {
        const preprocessedNetlist =
            SpiceCompatibilityPreprocessor.rewrite(spiceString)
        const diagnostics = SpiceSimulationDiagnostics.analyze(spiceString)

        try {
            const rawResult = await this.#engine.simulate(preprocessedNetlist)
            diagnostics.push(
                ...SpiceSimulationDiagnostics.requestedPlotDiagnostics(
                    SpiceSimulationGraphBuilder.findMissingRequestedPlots(
                        rawResult,
                        preprocessedNetlist
                    )
                )
            )
            const simulationCircuitJson =
                SpiceSimulationGraphBuilder.buildCircuitJsonExperiment(
                    rawResult,
                    preprocessedNetlist
                )
            const simulationResultCircuitJson = simulationCircuitJson.filter(
                (element) =>
                    element.type === 'simulation_transient_voltage_graph' ||
                    element.type === 'simulation_transient_current_graph'
            )
            const graphSummary = SpiceSimulationGraphSummary.summarize(
                simulationResultCircuitJson
            )

            CircuitJsonDocument.assertModel(simulationResultCircuitJson)
            CircuitJsonDocument.assertModel(simulationCircuitJson)

            return {
                simulationResultCircuitJson,
                simulationCircuitJson,
                graphSummary,
                diagnostics
            }
        } catch (error) {
            diagnostics.push({
                severity: 'error',
                message:
                    error instanceof Error
                        ? error.message
                        : 'SPICE simulation failed.'
            })

            return {
                simulationResultCircuitJson: [],
                simulationCircuitJson: [],
                graphSummary: SpiceSimulationGraphSummary.summarize([]),
                diagnostics
            }
        }
    }
}

const PROBE_METADATA_COMMENT_PATTERNS = [
    {
        probeType: 'voltage',
        pattern:
            /^\s*\*\s*(?:ecadforge_voltage_probe|circuitjson_voltage_probe|simulation_voltage_probe)\s+(.+)\s*$/,
        requiredFields: [
            'simulation_voltage_probe_id',
            'spice_vector',
            'source_node_name'
        ]
    },
    {
        probeType: 'current',
        pattern:
            /^\s*\*\s*(?:ecadforge_current_probe|circuitjson_current_probe|simulation_current_probe)\s+(.+)\s*$/,
        requiredFields: ['simulation_current_probe_id', 'spice_vector']
    }
]

/**
 * Builds diagnostics for SPICE syntax that local helpers cannot resolve.
 */
export class SpiceSimulationDiagnostics {
    /**
     * Returns syntax diagnostics for a netlist.
     * @param {string} spiceString SPICE netlist text.
     * @returns {object[]}
     */
    static analyze(spiceString) {
        const diagnostics = []
        const lines = String(spiceString || '').split(/\r?\n/)

        lines.forEach((line, index) => {
            const lineNumber = index + 1
            diagnostics.push(
                ...SpiceSimulationDiagnostics.#probeMetadataDiagnostics(
                    line,
                    lineNumber
                )
            )

            if (/^\s*\.lib\b/i.test(line)) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_external_library_unsupported',
                        lineNumber,
                        message:
                            'External .lib directives are not resolved by the local simulator fallback.'
                    })
                )
            }

            if (/^\s*\.include\b/i.test(line)) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_external_include_unsupported',
                        lineNumber,
                        message:
                            'External .include directives are not resolved by the local simulator fallback.'
                    })
                )
            }

            if (/\bpwl\s+repeat\b/i.test(line)) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_pwl_repeat_unsupported',
                        lineNumber,
                        message:
                            'PWL REPEAT source syntax is reported for callers that need a full simulator.'
                    })
                )
            }

            if (/^\s*\.model\b.*\bako\s*:/i.test(line)) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_pspice_ako_model_unsupported',
                        lineNumber,
                        message:
                            'PSPICE AKO model aliases are not resolved by the local simulator fallback.'
                    })
                )
            }

            if (/^\s*d\S*\s+\S+\s+\S+\s+\S+\s+[+-]?\d/i.test(line)) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_pspice_diode_area_factor_unsupported',
                        lineNumber,
                        message:
                            'PSPICE diode area factor syntax is not evaluated by the local simulator fallback.'
                    })
                )
            }

            if (/\btable\s*\{/i.test(line)) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_pspice_table_source_unsupported',
                        lineNumber,
                        message:
                            'PSPICE TABLE source syntax is not evaluated by the local simulator fallback.'
                    })
                )
            }

            if (/^\s*\.model\b.*\bvswitch\s*\(/i.test(line)) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_pspice_vswitch_model_unsupported',
                        lineNumber,
                        message:
                            'PSPICE VSWITCH model syntax is not evaluated by the local simulator fallback.'
                    })
                )
            }
        })

        return diagnostics
    }

    /**
     * Returns diagnostics for requested plots that did not produce graphs.
     * @param {{ normalizedToken: string, originalToken: string }[]} missingPlots Missing requested plot tokens.
     * @returns {object[]}
     */
    static requestedPlotDiagnostics(missingPlots) {
        return missingPlots.map((plot) => ({
            severity: 'warning',
            code: 'spice_requested_plot_missing',
            plot: plot.originalToken,
            normalizedPlot: plot.normalizedToken,
            message:
                'Requested transient plot did not match simulator output: ' +
                plot.originalToken
        }))
    }

    /**
     * Returns diagnostics for malformed probe metadata comments on one line.
     * @param {string} line SPICE netlist line.
     * @param {number} lineNumber One-based source line number.
     * @returns {object[]}
     */
    static #probeMetadataDiagnostics(line, lineNumber) {
        const diagnostics = []

        for (const definition of PROBE_METADATA_COMMENT_PATTERNS) {
            const match = line.match(definition.pattern)
            if (!match?.[1]) continue

            let parsed
            try {
                parsed = JSON.parse(match[1])
            } catch {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_probe_metadata_invalid_json',
                        lineNumber,
                        probeType: definition.probeType,
                        message:
                            SpiceSimulationDiagnostics.#probeTypeLabel(
                                definition.probeType
                            ) + ' probe metadata comment contains invalid JSON.'
                    })
                )
                continue
            }

            if (
                !SpiceSimulationDiagnostics.#hasRequiredStringFields(
                    parsed,
                    definition.requiredFields
                )
            ) {
                diagnostics.push(
                    SpiceSimulationDiagnostics.#diagnostic({
                        code: 'spice_probe_metadata_invalid_shape',
                        lineNumber,
                        probeType: definition.probeType,
                        message:
                            SpiceSimulationDiagnostics.#probeTypeLabel(
                                definition.probeType
                            ) +
                            ' probe metadata comment is missing required string fields.'
                    })
                )
            }
        }

        return diagnostics
    }

    /**
     * Returns true when parsed metadata contains all required string fields.
     * @param {unknown} parsed Parsed metadata value.
     * @param {string[]} requiredFields Required field names.
     * @returns {boolean}
     */
    static #hasRequiredStringFields(parsed, requiredFields) {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return false
        }

        return requiredFields.every(
            (field) => typeof parsed[field] === 'string'
        )
    }

    /**
     * Returns a display label for a probe type.
     * @param {string} probeType Probe metadata type.
     * @returns {string}
     */
    static #probeTypeLabel(probeType) {
        return probeType === 'voltage' ? 'Voltage' : 'Current'
    }

    /**
     * Builds a warning diagnostic object.
     * @param {{ code: string, lineNumber: number, message: string, probeType?: string }} options Diagnostic options.
     * @returns {object}
     */
    static #diagnostic(options) {
        return {
            severity: 'warning',
            code: options.code,
            lineNumber: options.lineNumber,
            ...(options.probeType ? { probeType: options.probeType } : {}),
            message: options.message
        }
    }
}

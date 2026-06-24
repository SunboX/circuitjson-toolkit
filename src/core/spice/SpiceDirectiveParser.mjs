const NUMBER_SUFFIX_MULTIPLIERS = {
    t: 1e12,
    g: 1e9,
    meg: 1e6,
    k: 1e3,
    m: 1e-3,
    ms: 1e-3,
    u: 1e-6,
    us: 1e-6,
    n: 1e-9,
    ns: 1e-9,
    p: 1e-12,
    ps: 1e-12,
    f: 1e-15,
    fs: 1e-15,
    s: 1
}
const VOLTAGE_PROBE_COMMENT_PATTERN =
    /^\s*\*\s*(?:ecadforge_voltage_probe|circuitjson_voltage_probe|simulation_voltage_probe)\s+(.+)\s*$/
const CURRENT_PROBE_COMMENT_PATTERN =
    /^\s*\*\s*(?:ecadforge_current_probe|circuitjson_current_probe|simulation_current_probe)\s+(.+)\s*$/

/**
 * Parses SPICE directives and metadata comments used by simulation helpers.
 */
export class SpiceDirectiveParser {
    /**
     * Parses transient directive timing parameters.
     * @param {string} spiceString SPICE netlist text.
     * @returns {{ tstep?: number, tstop?: number, tstart?: number, tmax?: number, uic?: boolean } | null}
     */
    static parseTransient(spiceString) {
        for (const rawLine of String(spiceString || '').split(/\r?\n/)) {
            const line = rawLine.trim()
            if (!line || line.startsWith('*')) continue
            if (!line.toLowerCase().startsWith('.tran')) continue

            const [withoutComment = ''] = line.split(';')
            const tokens = withoutComment.split(/\s+/).filter(Boolean)
            const values = []
            let uic = false

            for (const token of tokens.slice(1)) {
                if (token.toLowerCase() === 'uic') {
                    uic = true
                    continue
                }

                const value = SpiceDirectiveParser.parseNumber(token)
                if (value !== undefined) values.push(value)
            }

            return {
                ...(values[0] !== undefined ? { tstep: values[0] } : {}),
                ...(values[1] !== undefined ? { tstop: values[1] } : {}),
                ...(values[2] !== undefined ? { tstart: values[2] } : {}),
                ...(values[3] !== undefined ? { tmax: values[3] } : {}),
                ...(uic ? { uic: true } : {})
            }
        }

        return null
    }

    /**
     * Parses requested transient plot tokens from the first PRINT directive.
     * @param {string} spiceString SPICE netlist text.
     * @returns {Map<string, string> | null}
     */
    static parseRequestedPlots(spiceString) {
        const match = String(spiceString || '').match(/\.print\s+tran\s+(.*)/i)
        if (!match?.[1]) return null

        const tokens = match[1].match(/[VI]\s*\([^)]+\)/gi)
        if (!tokens) return null

        const plots = new Map()
        for (const token of tokens) {
            const normalizedToken = SpiceDirectiveParser.normalizeVector(token)
            if (!plots.has(normalizedToken)) {
                plots.set(normalizedToken, token)
            }
        }

        return plots
    }

    /**
     * Extracts voltage probe metadata comments from a netlist.
     * @param {string} spiceString SPICE netlist text.
     * @returns {Map<string, object>}
     */
    static extractVoltageProbeMetadata(spiceString) {
        return SpiceDirectiveParser.#extractProbeMetadata(
            spiceString,
            VOLTAGE_PROBE_COMMENT_PATTERN,
            (parsed) => {
                if (
                    typeof parsed.simulation_voltage_probe_id !== 'string' ||
                    typeof parsed.spice_vector !== 'string' ||
                    typeof parsed.source_node_name !== 'string'
                ) {
                    return null
                }

                return {
                    simulation_voltage_probe_id:
                        parsed.simulation_voltage_probe_id,
                    name:
                        typeof parsed.name === 'string'
                            ? parsed.name
                            : undefined,
                    spice_vector: parsed.spice_vector,
                    source_node_name: parsed.source_node_name,
                    reference_node_name:
                        typeof parsed.reference_node_name === 'string'
                            ? parsed.reference_node_name
                            : undefined
                }
            }
        )
    }

    /**
     * Extracts current probe metadata comments from a netlist.
     * @param {string} spiceString SPICE netlist text.
     * @returns {Map<string, object>}
     */
    static extractCurrentProbeMetadata(spiceString) {
        return SpiceDirectiveParser.#extractProbeMetadata(
            spiceString,
            CURRENT_PROBE_COMMENT_PATTERN,
            (parsed) => {
                if (
                    typeof parsed.simulation_current_probe_id !== 'string' ||
                    typeof parsed.spice_vector !== 'string'
                ) {
                    return null
                }

                return {
                    simulation_current_probe_id:
                        parsed.simulation_current_probe_id,
                    name:
                        typeof parsed.name === 'string'
                            ? parsed.name
                            : undefined,
                    spice_vector: parsed.spice_vector,
                    source_component_id:
                        typeof parsed.source_component_id === 'string'
                            ? parsed.source_component_id
                            : undefined,
                    source_trace_id:
                        typeof parsed.source_trace_id === 'string'
                            ? parsed.source_trace_id
                            : undefined
                }
            }
        )
    }

    /**
     * Normalizes a simulator vector token for map lookups.
     * @param {string} value Raw vector token.
     * @returns {string}
     */
    static normalizeVector(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/\s/g, '')
    }

    /**
     * Parses a SPICE numeric token with common suffix multipliers.
     * @param {string} token Numeric token.
     * @returns {number | undefined}
     */
    static parseNumber(token) {
        const normalized = String(token || '')
            .replace(/[,]/g, '')
            .toLowerCase()
        const match = normalized.match(
            /^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)([a-z]+)?$/i
        )

        if (!match) return undefined

        const base = Number.parseFloat(match[1] || '')
        if (!Number.isFinite(base)) return undefined

        const suffix = match[2] || ''
        if (!suffix) return base

        const multiplier =
            NUMBER_SUFFIX_MULTIPLIERS[suffix] ??
            NUMBER_SUFFIX_MULTIPLIERS[suffix.replace(/s$/, '')] ??
            1

        return base * multiplier
    }

    /**
     * Extracts JSON probe metadata comments with a validator callback.
     * @param {string} spiceString SPICE netlist text.
     * @param {RegExp} pattern Comment matcher.
     * @param {(parsed: object) => object | null} shapeMetadata Metadata shaper.
     * @returns {Map<string, object>}
     */
    static #extractProbeMetadata(spiceString, pattern, shapeMetadata) {
        const metadata = new Map()

        for (const line of String(spiceString || '').split(/\r?\n/)) {
            const match = line.match(pattern)
            if (!match?.[1]) continue

            try {
                const shapedMetadata = shapeMetadata(JSON.parse(match[1]))
                if (!shapedMetadata) continue

                metadata.set(
                    SpiceDirectiveParser.normalizeVector(
                        shapedMetadata.spice_vector
                    ),
                    shapedMetadata
                )
            } catch {}
        }

        return metadata
    }
}

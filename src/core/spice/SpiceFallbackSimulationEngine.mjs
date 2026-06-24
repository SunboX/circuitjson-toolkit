import { SpiceDirectiveParser } from './SpiceDirectiveParser.mjs'

/**
 * Provides a deterministic local fallback for simple transient examples.
 */
export class SpiceFallbackSimulationEngine {
    /**
     * Simulates constant independent sources from a SPICE netlist.
     * @param {string} spiceString SPICE netlist text.
     * @returns {Promise<object>}
     */
    async simulate(spiceString) {
        const timeValues =
            SpiceFallbackSimulationEngine.#buildTimeValues(spiceString)
        const voltageRows =
            SpiceFallbackSimulationEngine.#buildVoltageRows(spiceString)
        const currentRows =
            SpiceFallbackSimulationEngine.#buildCurrentRows(spiceString)

        return {
            dataType: 'real',
            data: [
                { name: 'time', type: 'time', values: timeValues },
                ...voltageRows.map((row) => ({
                    name: row.name,
                    type: 'voltage',
                    values: timeValues.map(() => row.value)
                })),
                ...currentRows.map((row) => ({
                    name: row.name,
                    type: 'current',
                    values: timeValues.map(() => row.value)
                }))
            ]
        }
    }

    /**
     * Builds transient timestamps from the netlist TRAN directive.
     * @param {string} spiceString SPICE netlist text.
     * @returns {number[]}
     */
    static #buildTimeValues(spiceString) {
        const tran = SpiceDirectiveParser.parseTransient(spiceString)
        const tstep = tran?.tstep && tran.tstep > 0 ? tran.tstep : 0.001
        const tstart = tran?.tstart ?? 0
        const tstop = tran?.tstop && tran.tstop >= tstart ? tran.tstop : tstart
        const stepCount = Math.max(0, Math.round((tstop - tstart) / tstep))

        return Array.from({ length: stepCount + 1 }, (_, index) =>
            SpiceFallbackSimulationEngine.#round(tstart + index * tstep)
        )
    }

    /**
     * Builds constant voltage result rows from independent DC voltage sources.
     * @param {string} spiceString SPICE netlist text.
     * @returns {{ name: string, value: number }[]}
     */
    static #buildVoltageRows(spiceString) {
        const nodeVoltages = new Map([['0', 0]])

        for (const line of SpiceFallbackSimulationEngine.#componentLines(
            spiceString
        )) {
            const tokens = line.split(/\s+/).filter(Boolean)
            const name = tokens[0] || ''
            if (!/^v/i.test(name) || tokens.length < 4) continue

            const positiveNode = tokens[1]
            const negativeNode = tokens[2]
            const value =
                SpiceFallbackSimulationEngine.#parseDcValue(tokens.slice(3)) ??
                0
            const negativeValue =
                SpiceFallbackSimulationEngine.#lookupNodeValue(
                    nodeVoltages,
                    negativeNode
                ) ?? 0

            nodeVoltages.set(
                String(positiveNode).toLowerCase(),
                negativeValue + value
            )
        }

        return [...nodeVoltages.entries()]
            .filter(([node]) => node !== '0')
            .map(([node, value]) => ({
                name: `v(${node})`,
                value: SpiceFallbackSimulationEngine.#round(value)
            }))
    }

    /**
     * Builds constant current result rows from independent DC current sources.
     * @param {string} spiceString SPICE netlist text.
     * @returns {{ name: string, value: number }[]}
     */
    static #buildCurrentRows(spiceString) {
        const rows = []

        for (const line of SpiceFallbackSimulationEngine.#componentLines(
            spiceString
        )) {
            const tokens = line.split(/\s+/).filter(Boolean)
            const name = tokens[0] || ''
            if (!/^i/i.test(name) || tokens.length < 4) continue

            rows.push({
                name: `i(${name})`,
                value:
                    SpiceFallbackSimulationEngine.#parseDcValue(
                        tokens.slice(3)
                    ) ?? 0
            })
        }

        return rows
    }

    /**
     * Returns non-comment component lines from a netlist.
     * @param {string} spiceString SPICE netlist text.
     * @returns {string[]}
     */
    static #componentLines(spiceString) {
        return String(spiceString || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(
                (line) => line && !line.startsWith('*') && !line.startsWith('.')
            )
    }

    /**
     * Parses a DC source value from component tail tokens.
     * @param {string[]} tokens Component tokens after node names.
     * @returns {number | undefined}
     */
    static #parseDcValue(tokens) {
        const dcIndex = tokens.findIndex(
            (token) => token.toLowerCase() === 'dc'
        )
        const valueToken = dcIndex >= 0 ? tokens[dcIndex + 1] : tokens[0]

        return SpiceDirectiveParser.parseNumber(valueToken)
    }

    /**
     * Looks up a node voltage by normalized node name.
     * @param {Map<string, number>} nodeVoltages Node voltage map.
     * @param {string} nodeName Node name.
     * @returns {number | undefined}
     */
    static #lookupNodeValue(nodeVoltages, nodeName) {
        return nodeVoltages.get(String(nodeName || '').toLowerCase())
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

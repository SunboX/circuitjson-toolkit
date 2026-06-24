import { CircuitJsonElementValidator } from './CircuitJsonElementValidator.mjs'

const PCB_RENDERED_TYPES = new Set([
    'pcb_board',
    'pcb_breakout_point',
    'pcb_component',
    'pcb_copper_pour',
    'pcb_copper_text',
    'pcb_courtyard',
    'pcb_courtyard_circle',
    'pcb_courtyard_outline',
    'pcb_courtyard_pill',
    'pcb_courtyard_polygon',
    'pcb_courtyard_rect',
    'pcb_cutout',
    'pcb_fabrication_note_dimension',
    'pcb_fabrication_note_path',
    'pcb_fabrication_note_rect',
    'pcb_fabrication_note_text',
    'pcb_ground_plane',
    'pcb_ground_plane_region',
    'pcb_group',
    'pcb_hole',
    'pcb_keepout',
    'pcb_note_dimension',
    'pcb_note_line',
    'pcb_note_path',
    'pcb_note_rect',
    'pcb_note_text',
    'pcb_panel',
    'pcb_plated_hole',
    'pcb_port',
    'pcb_silkscreen_circle',
    'pcb_silkscreen_graphic',
    'pcb_silkscreen_line',
    'pcb_silkscreen_oval',
    'pcb_silkscreen_path',
    'pcb_silkscreen_pill',
    'pcb_silkscreen_rect',
    'pcb_silkscreen_text',
    'pcb_smtpad',
    'pcb_solder_paste',
    'pcb_text',
    'pcb_thermal_spoke',
    'pcb_trace',
    'pcb_trace_hint',
    'pcb_via'
])

const SCHEMATIC_RENDERED_TYPES = new Set([
    'schematic_arc',
    'schematic_box',
    'schematic_circle',
    'schematic_component',
    'schematic_debug_object',
    'schematic_group',
    'schematic_line',
    'schematic_net_label',
    'schematic_path',
    'schematic_port',
    'schematic_rect',
    'schematic_sheet',
    'schematic_symbol',
    'schematic_table',
    'schematic_table_cell',
    'schematic_text',
    'schematic_trace',
    'schematic_voltage_probe'
])

const ROUTING_DSN_TYPES = new Set([
    'pcb_board',
    'pcb_component',
    'pcb_smtpad',
    'pcb_trace',
    'pcb_via',
    'pcb_plated_hole',
    'source_net'
])

/**
 * Builds document-level support coverage reports from known element metadata.
 */
export class CircuitJsonSupportMatrixBuilder {
    /**
     * Builds a support matrix for the known schema snapshot and present rows.
     * @param {object[]} [circuitJson] Parsed element array.
     * @returns {{ sourceFormat: string, totals: object, rows: object[], gaps: object[] }}
     */
    static build(circuitJson = []) {
        const elements = Array.isArray(circuitJson) ? circuitJson : []
        const presentTypes = new Set(
            elements
                .map((element) => String(element?.type || ''))
                .filter(Boolean)
        )
        const rows = CircuitJsonElementValidator.knownElementTypes().map(
            (type) =>
                CircuitJsonSupportMatrixBuilder.#row(
                    type,
                    presentTypes.has(type)
                )
        )

        return {
            sourceFormat: 'circuitjson',
            totals: CircuitJsonSupportMatrixBuilder.#totals(rows, presentTypes),
            rows,
            gaps: rows.flatMap((row) =>
                CircuitJsonSupportMatrixBuilder.#gaps(row)
            )
        }
    }

    /**
     * Builds one matrix row.
     * @param {string} type Element type.
     * @param {boolean} present Whether the current document contains the type.
     * @returns {object}
     */
    static #row(type, present) {
        const capabilities = CircuitJsonSupportMatrixBuilder.#capabilities(type)
        return {
            type,
            family: CircuitJsonSupportMatrixBuilder.#family(type),
            present,
            status: CircuitJsonSupportMatrixBuilder.#status(capabilities),
            capabilities
        }
    }

    /**
     * Resolves capability labels for one type.
     * @param {string} type Element type.
     * @returns {Record<string, string>}
     */
    static #capabilities(type) {
        const capabilities = {
            validation: 'known',
            parser: 'preserved',
            indexer: 'indexed',
            diagnostics: CircuitJsonSupportMatrixBuilder.#diagnostics(type),
            schematic: SCHEMATIC_RENDERED_TYPES.has(type) ? 'rendered' : 'none',
            pcb: PCB_RENDERED_TYPES.has(type) ? 'rendered' : 'none',
            bom: type === 'source_component' ? 'grouped' : 'none',
            manufacturing: CircuitJsonSupportMatrixBuilder.#manufacturing(type),
            simulation: type.startsWith('simulation_') ? 'preserved' : 'none'
        }

        if (type === 'pcb_component') {
            capabilities.manufacturing = 'pick-and-place'
        }

        return capabilities
    }

    /**
     * Resolves diagnostic support for one type.
     * @param {string} type Element type.
     * @returns {string}
     */
    static #diagnostics(type) {
        return /(?:error|warning)/u.test(type) ? 'normalized' : 'none'
    }

    /**
     * Resolves manufacturing support for one type.
     * @param {string} type Element type.
     * @returns {string}
     */
    static #manufacturing(type) {
        if (ROUTING_DSN_TYPES.has(type)) return 'routing-dsn'
        return 'none'
    }

    /**
     * Resolves an overall support status.
     * @param {Record<string, string>} capabilities Capability labels.
     * @returns {'full' | 'partial' | 'metadata'}
     */
    static #status(capabilities) {
        if (
            capabilities.pcb === 'rendered' ||
            capabilities.schematic === 'rendered' ||
            capabilities.diagnostics === 'normalized'
        ) {
            return capabilities.manufacturing === 'routing-dsn'
                ? 'partial'
                : 'full'
        }

        return 'metadata'
    }

    /**
     * Builds gap rows for present partially supported capabilities.
     * @param {object} row Matrix row.
     * @returns {object[]}
     */
    static #gaps(row) {
        if (!row.present) return []
        if (row.capabilities.manufacturing === 'routing-dsn') {
            return [
                {
                    type: row.type,
                    capability: 'manufacturing',
                    status: 'partial',
                    detail: 'Routing exchange metadata is generated without full fabrication packaging.'
                }
            ]
        }
        if (row.status === 'metadata') {
            return [
                {
                    type: row.type,
                    capability: 'rendering',
                    status: 'metadata',
                    detail: 'The element is preserved for downstream consumers.'
                }
            ]
        }
        return []
    }

    /**
     * Builds aggregate matrix counts.
     * @param {object[]} rows Matrix rows.
     * @param {Set<string>} presentTypes Present element types.
     * @returns {object}
     */
    static #totals(rows, presentTypes) {
        return {
            knownElementTypes: rows.length,
            presentElementTypes: rows.filter((row) => row.present).length,
            renderedElementTypes: rows.filter(
                (row) =>
                    row.present &&
                    (row.capabilities.pcb === 'rendered' ||
                        row.capabilities.schematic === 'rendered')
            ).length,
            diagnosticElementTypes: rows.filter(
                (row) =>
                    row.present && row.capabilities.diagnostics === 'normalized'
            ).length,
            unknownPresentElementTypes: [...presentTypes].filter(
                (type) => !rows.some((row) => row.type === type)
            ).length
        }
    }

    /**
     * Resolves the top-level element family.
     * @param {string} type Element type.
     * @returns {string}
     */
    static #family(type) {
        return String(type || '').split('_')[0] || 'unknown'
    }
}

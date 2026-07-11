import { CircuitJsonElementValidator } from './CircuitJsonElementValidator.mjs'

const PCB_RENDERED_TYPES = new Set([
    'pcb_board',
    'pcb_breakout_point',
    'pcb_component',
    'pcb_copper_pour',
    'pcb_copper_text',
    'pcb_courtyard',
    'pcb_courtyard_circle',
    'pcb_courtyard_line',
    'pcb_courtyard_outline',
    'pcb_courtyard_path',
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
    'schematic_image',
    'schematic_line',
    'schematic_net_label',
    'schematic_path',
    'schematic_port',
    'schematic_rect',
    'schematic_sheet',
    'schematic_sheet_symbol',
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

const VARIANT_ROWS_BY_SET = {
    sourceComponentFtypes: {
        type: 'source_component',
        group: 'ftype',
        capability: 'bom',
        status: 'grouped'
    },
    pcbBoardShapes: {
        type: 'pcb_board',
        group: 'shape',
        capability: 'pcb',
        status: 'rendered'
    },
    pcbSmtPadShapes: {
        type: 'pcb_smtpad',
        group: 'shape',
        capability: 'pcb',
        status: 'rendered'
    },
    pcbHoleShapes: {
        type: 'pcb_hole',
        group: 'hole_shape',
        capability: 'pcb',
        status: 'rendered'
    },
    pcbPlatedHoleShapes: {
        type: 'pcb_plated_hole',
        group: 'shape',
        capability: 'pcb',
        status: 'rendered'
    },
    pcbPlatedHoleHoleShapes: {
        type: 'pcb_plated_hole',
        group: 'hole_shape',
        capability: 'pcb',
        status: 'rendered'
    },
    pcbSolderPasteShapes: {
        type: 'pcb_solder_paste',
        group: 'shape',
        capability: 'pcb',
        status: 'rendered'
    },
    pcbCutoutShapes: {
        type: 'pcb_cutout',
        group: 'shape',
        capability: 'pcb',
        status: 'rendered'
    },
    pcbCopperPourShapes: {
        type: 'pcb_copper_pour',
        group: 'shape',
        capability: 'pcb',
        status: 'rendered'
    },
    simulationSourceKinds: {
        type: 'simulation_voltage_source',
        group: 'kind',
        capability: 'simulation',
        status: 'summarized'
    },
    simulationWaveShapes: {
        type: 'simulation_voltage_source',
        group: 'wave_shape',
        capability: 'simulation',
        status: 'summarized'
    },
    simulationExperimentMethods: {
        type: 'simulation_experiment',
        group: 'spice_options.method',
        capability: 'simulation',
        status: 'summarized'
    }
}

/**
 * Builds document-level support coverage reports from known element metadata.
 */
export class CircuitJsonSupportMatrixBuilder {
    /**
     * Builds a support matrix for the known schema snapshot and present rows.
     * @param {object[]} [circuitJson] Parsed element array.
     * @returns {{ sourceFormat: string, totals: object, rows: object[], variantRows: object[], gaps: object[] }}
     */
    static build(circuitJson = []) {
        const elements = Array.isArray(circuitJson) ? circuitJson : []
        const presentTypes = new Set(
            elements
                .map((element) => String(element?.type || ''))
                .filter(Boolean)
        )
        const rows = CircuitJsonElementValidator.canonicalElementTypes().map(
            (type) =>
                CircuitJsonSupportMatrixBuilder.#row(
                    type,
                    presentTypes.has(type)
                )
        )
        const variantRows =
            CircuitJsonSupportMatrixBuilder.#variantRows(elements)

        return {
            sourceFormat: 'circuitjson',
            totals: CircuitJsonSupportMatrixBuilder.#totals(
                rows,
                presentTypes,
                variantRows
            ),
            rows,
            variantRows,
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
            scene3d: type === 'cad_component' ? 'external-model' : 'none',
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
            capabilities.scene3d === 'external-model' ||
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
     * Builds variant coverage rows from active schema metadata.
     * @param {object[]} elements Parsed element rows.
     * @returns {object[]}
     */
    static #variantRows(elements) {
        const schema = CircuitJsonElementValidator.variantSets()
        const present =
            CircuitJsonSupportMatrixBuilder.#presentVariants(elements)
        return Object.entries(schema).flatMap(([setName, values]) => {
            const definition = VARIANT_ROWS_BY_SET[setName]
            if (!definition) return []
            return values.map((value) =>
                CircuitJsonSupportMatrixBuilder.#variantRow(
                    setName,
                    definition,
                    value,
                    present
                )
            )
        })
    }

    /**
     * Builds one variant coverage row.
     * @param {string} setName Variant set name.
     * @param {object} definition Row definition.
     * @param {string} value Variant value.
     * @param {Map<string, Set<string>>} present Present variant values.
     * @returns {object}
     */
    static #variantRow(setName, definition, value, present) {
        const isPresent = Boolean(present.get(setName)?.has(value))
        return {
            set: setName,
            type: definition.type,
            group: definition.group,
            value,
            present: isPresent,
            capability: definition.capability,
            status: definition.status,
            note: CircuitJsonSupportMatrixBuilder.#variantNote(
                definition,
                value,
                isPresent
            )
        }
    }

    /**
     * Builds a short human-readable variant support note.
     * @param {object} definition Variant row definition.
     * @param {string} value Variant value.
     * @param {boolean} present Whether the variant is present.
     * @returns {string}
     */
    static #variantNote(definition, value, present) {
        const label =
            definition.type + '.' + definition.group + ' ' + value + ' is '
        if (!present) return label + 'known but not present.'
        if (definition.status === 'rendered') return label + 'rendered.'
        if (definition.status === 'grouped') {
            return label + 'used for BOM grouping.'
        }
        if (definition.status === 'summarized') {
            return label + 'summarized in simulation setup.'
        }
        return label + 'preserved as metadata.'
    }

    /**
     * Extracts variant values present in the current document.
     * @param {object[]} elements Parsed element rows.
     * @returns {Map<string, Set<string>>}
     */
    static #presentVariants(elements) {
        const present = new Map()
        const add = (setName, value) => {
            const text = String(value || '').trim()
            if (!text) return
            if (!present.has(setName)) present.set(setName, new Set())
            present.get(setName).add(text)
        }

        for (const element of elements) {
            if (element?.type === 'source_component') {
                add('sourceComponentFtypes', element.ftype)
            }
            if (element?.type === 'pcb_board') {
                add('pcbBoardShapes', element.shape || 'rect')
            }
            if (element?.type === 'pcb_smtpad') {
                add('pcbSmtPadShapes', element.shape)
            }
            if (element?.type === 'pcb_hole') {
                add('pcbHoleShapes', element.hole_shape || element.shape)
            }
            if (element?.type === 'pcb_plated_hole') {
                add('pcbPlatedHoleShapes', element.shape || 'circle')
                add('pcbPlatedHoleHoleShapes', element.hole_shape)
            }
            if (element?.type === 'pcb_solder_paste') {
                add('pcbSolderPasteShapes', element.shape)
            }
            if (element?.type === 'pcb_cutout') {
                add('pcbCutoutShapes', element.shape || 'rect')
            }
            if (element?.type === 'pcb_copper_pour') {
                add('pcbCopperPourShapes', element.shape || 'polygon')
            }
            if (
                element?.type === 'simulation_voltage_source' ||
                element?.type === 'simulation_current_source'
            ) {
                add(
                    'simulationSourceKinds',
                    element.source_type || element.sourceType || element.kind
                )
                add('simulationWaveShapes', element.wave_shape)
            }
            if (element?.type === 'simulation_experiment') {
                add(
                    'simulationExperimentMethods',
                    element.spice_options?.method
                )
            }
        }

        return present
    }

    /**
     * Builds aggregate matrix counts.
     * @param {object[]} rows Matrix rows.
     * @param {Set<string>} presentTypes Present element types.
     * @param {object[]} variantRows Variant coverage rows.
     * @returns {object}
     */
    static #totals(rows, presentTypes, variantRows) {
        return {
            knownElementTypes: rows.length,
            presentElementTypes: rows.filter((row) => row.present).length,
            renderedElementTypes: rows.filter(
                (row) =>
                    row.present &&
                    (row.capabilities.pcb === 'rendered' ||
                        row.capabilities.schematic === 'rendered' ||
                        row.capabilities.scene3d === 'external-model')
            ).length,
            diagnosticElementTypes: rows.filter(
                (row) =>
                    row.present && row.capabilities.diagnostics === 'normalized'
            ).length,
            unknownPresentElementTypes: [...presentTypes].filter(
                (type) => !rows.some((row) => row.type === type)
            ).length,
            knownVariantValues: variantRows.length,
            presentVariantValues: variantRows.filter((row) => row.present)
                .length
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

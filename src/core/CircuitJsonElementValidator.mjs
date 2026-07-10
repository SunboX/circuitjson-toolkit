import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'
import { CircuitJsonValidationProof } from './context/CircuitJsonValidationProof.mjs'

const KNOWN_ELEMENT_TYPES = new Set([
    'cad_component',
    'circuit_json_footprint_load_error',
    'external_footprint_load_error',
    'pcb_autorouting_error',
    'pcb_board',
    'pcb_breakout_point',
    'pcb_component',
    'pcb_component_invalid_layer_error',
    'pcb_component_not_on_board_edge_error',
    'pcb_component_outside_board_error',
    'pcb_connector_not_in_accessible_orientation_warning',
    'pcb_copper_pour',
    'pcb_copper_text',
    'pcb_courtyard',
    'pcb_courtyard_circle',
    'pcb_courtyard_line',
    'pcb_courtyard_outline',
    'pcb_courtyard_path',
    'pcb_courtyard_overlap_error',
    'pcb_courtyard_pill',
    'pcb_courtyard_polygon',
    'pcb_courtyard_rect',
    'pcb_cutout',
    'pcb_fabrication_note_dimension',
    'pcb_fabrication_note_path',
    'pcb_fabrication_note_rect',
    'pcb_fabrication_note_text',
    'pcb_footprint_overlap_error',
    'pcb_ground_plane',
    'pcb_ground_plane_region',
    'pcb_group',
    'pcb_hole',
    'pcb_keepout',
    'pcb_manual_edit_conflict_warning',
    'pcb_missing_footprint_error',
    'pcb_net',
    'pcb_note_dimension',
    'pcb_note_line',
    'pcb_note_path',
    'pcb_note_rect',
    'pcb_note_text',
    'pcb_pad_pad_clearance_error',
    'pcb_pad_trace_clearance_error',
    'pcb_panel',
    'pcb_panelization_placement_error',
    'pcb_placement_error',
    'pcb_plated_hole',
    'pcb_port',
    'pcb_port_not_connected_error',
    'pcb_port_not_matched_error',
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
    'pcb_trace_error',
    'pcb_trace_hint',
    'pcb_trace_missing_error',
    'pcb_trace_warning',
    'pcb_via',
    'pcb_via_clearance_error',
    'pcb_via_trace_clearance_error',
    'schematic_arc',
    'schematic_box',
    'schematic_circle',
    'schematic_component',
    'schematic_debug_object',
    'schematic_error',
    'schematic_group',
    'schematic_layout_error',
    'schematic_line',
    'schematic_manual_edit_conflict_warning',
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
    'schematic_voltage_probe',
    'simulation_current_probe',
    'simulation_current_source',
    'simulation_experiment',
    'simulation_op_amp',
    'simulation_oscilloscope_trace',
    'simulation_spice_subcircuit',
    'simulation_switch',
    'simulation_transient_current_graph',
    'simulation_transient_voltage_graph',
    'simulation_unknown_experiment_error',
    'simulation_voltage_probe',
    'simulation_voltage_source',
    'source_ambiguous_port_reference',
    'source_board',
    'source_component',
    'source_component_internal_connection',
    'source_component_misconfigured_error',
    'source_component_pins_underspecified_warning',
    'source_failed_to_create_component_error',
    'source_group',
    'source_i2c_misconfigured_error',
    'source_invalid_component_property_error',
    'source_manually_placed_via',
    'source_missing_manufacturer_part_number_warning',
    'source_missing_property_error',
    'source_net',
    'source_no_ground_pin_defined_warning',
    'source_no_power_pin_defined_warning',
    'source_pcb_ground_plane',
    'source_pin_missing_trace_warning',
    'source_pin_must_be_connected_error',
    'source_port',
    'source_project_metadata',
    'source_property_ignored_warning',
    'source_trace',
    'source_trace_not_connected_error',
    'supplier_footprint_mismatch_warning',
    'unknown_error_finding_part'
])

const ID_FIELD_EXCEPTIONS = new Set([
    'pcb_autorouting_error',
    'pcb_courtyard_overlap_error',
    'pcb_footprint_overlap_error',
    'pcb_port_not_matched_error',
    'pcb_via_clearance_error',
    'schematic_box',
    'schematic_debug_object',
    'source_project_metadata'
])

const SOURCE_COMPONENT_FTYPES = new Set([
    'interconnect',
    'simple_ammeter',
    'simple_battery',
    'simple_capacitor',
    'simple_chip',
    'simple_connector',
    'simple_crystal',
    'simple_current_source',
    'simple_diode',
    'simple_fiducial',
    'simple_fuse',
    'simple_ground',
    'simple_inductor',
    'simple_led',
    'simple_mosfet',
    'simple_op_amp',
    'simple_pin_header',
    'simple_pinout',
    'simple_potentiometer',
    'simple_power_source',
    'simple_push_button',
    'simple_resistor',
    'simple_resonator',
    'simple_switch',
    'simple_test_point',
    'simple_transistor',
    'simple_voltage_probe',
    'simple_voltage_source'
])

const LAYERS = new Set(
    'top bottom inner1 inner2 inner3 inner4 inner5 inner6'.split(' ')
)

const SMT_PAD_SHAPES = new Set([
    'circle',
    'rect',
    'rotated_rect',
    'rotated_pill',
    'pill',
    'polygon',
    'rounded_rect'
])

const PCB_HOLE_SHAPES = new Set([
    'circle',
    'circle_or_square',
    'oval',
    'pill',
    'rect',
    'rotated_pill',
    'round'
])

const PCB_PLATED_HOLE_SHAPES = new Set([
    'circle',
    'circular_hole_with_rect_pad',
    'hole_with_polygon_pad',
    'oval',
    'pill',
    'pill_hole_with_rect_pad',
    'rotated_pill_hole_with_rect_pad'
])

const PCB_PLATED_HOLE_HOLE_SHAPES = new Set([
    'circle',
    'oval',
    'pill',
    'rotated_pill'
])

const PCB_SOLDER_PASTE_SHAPES = new Set([
    'circle',
    'oval',
    'pill',
    'rect',
    'rotated_rect'
])

const PCB_BOARD_SHAPES = new Set(['polygon', 'rect'])

const PCB_CUTOUT_SHAPES = new Set(['circle', 'path', 'polygon', 'rect'])

const PCB_COPPER_POUR_SHAPES = new Set(['brep', 'polygon', 'rect'])

const SIMULATION_SOURCE_KINDS = new Set(['ac', 'dc'])

const SIMULATION_WAVE_SHAPES = new Set(
    'sawtooth sinewave square triangle'.split(' ')
)

const SIMULATION_EXPERIMENT_METHODS = new Set(['gear', 'trap'])

const VARIANT_SETS = {
    sourceComponentFtypes: SOURCE_COMPONENT_FTYPES,
    pcbBoardShapes: PCB_BOARD_SHAPES,
    pcbSmtPadShapes: SMT_PAD_SHAPES,
    pcbHoleShapes: PCB_HOLE_SHAPES,
    pcbPlatedHoleShapes: PCB_PLATED_HOLE_SHAPES,
    pcbPlatedHoleHoleShapes: PCB_PLATED_HOLE_HOLE_SHAPES,
    pcbSolderPasteShapes: PCB_SOLDER_PASTE_SHAPES,
    pcbCutoutShapes: PCB_CUTOUT_SHAPES,
    pcbCopperPourShapes: PCB_COPPER_POUR_SHAPES,
    simulationSourceKinds: SIMULATION_SOURCE_KINDS,
    simulationWaveShapes: SIMULATION_WAVE_SHAPES,
    simulationExperimentMethods: SIMULATION_EXPERIMENT_METHODS
}

const SORTED_VARIANT_SET_NAMES = Object.keys(VARIANT_SETS).sort()

/**
 * @typedef {{ set: string, value: string }} CircuitJsonVariantDiff
 */

/**
 * @typedef {{ elementTypes: string[], idFieldExceptions: string[], variantSets: Record<string, string[]> }} CircuitJsonSchemaSnapshot
 */

/**
 * @typedef {{ matches: boolean, missingElementTypes: string[], unexpectedElementTypes: string[], missingIdFieldExceptions: string[], unexpectedIdFieldExceptions: string[], missingVariants: CircuitJsonVariantDiff[], unexpectedVariants: CircuitJsonVariantDiff[] }} CircuitJsonSchemaSnapshotComparison
 */

/**
 * Validates serialized CircuitJSON element objects without external runtime
 * dependencies.
 */
export class CircuitJsonElementValidator {
    /**
     * Returns validation errors for a candidate model.
     * @param {unknown} value Candidate model.
     * @param {{ freeze?: boolean }} [options] Validation options.
     * @returns {string[]}
     */
    static validateModel(value, options = {}) {
        if (!Array.isArray(value)) {
            return ['Expected a CircuitJSON element array.']
        }

        const freezeTraversal = CircuitJsonValidationProof.freezeTraversal(
            value,
            options.freeze === true
        )
        const errors = value.flatMap((element, index) => {
            freezeTraversal.visit(element)
            return CircuitJsonElementValidator.validateElement(element, index)
        })
        freezeTraversal.commit(errors.length === 0)
        return errors
    }

    /**
     * Returns validation errors for one candidate element.
     * @param {unknown} value Candidate element.
     * @param {number} [index] Element index.
     * @returns {string[]}
     */
    static validateElement(value, index = -1) {
        const location = index >= 0 ? ' at index ' + index : ''
        if (!CircuitJsonElementValidator.#isObject(value)) {
            return ['Expected a CircuitJSON element object' + location + '.']
        }

        const type = String(value.type || '').trim()
        if (!type) {
            return ['CircuitJSON element type is required' + location + '.']
        }

        if (!KNOWN_ELEMENT_TYPES.has(type)) {
            return ['Unsupported CircuitJSON element type: ' + type + '.']
        }

        const errors = []
        CircuitJsonElementValidator.#validateId(value, type, errors)
        CircuitJsonElementValidator.#validateCoreShape(value, type, errors)
        return errors
    }

    /**
     * Returns all known serialized element type names.
     * @returns {string[]}
     */
    static knownElementTypes() {
        return [...KNOWN_ELEMENT_TYPES]
    }

    /**
     * Returns id convention exceptions from the current schema snapshot.
     * @returns {string[]}
     */
    static idFieldExceptions() {
        return [...ID_FIELD_EXCEPTIONS]
    }

    /**
     * Returns schema metadata suitable for drift snapshots.
     * @returns {CircuitJsonSchemaSnapshot}
     */
    static schemaSnapshot() {
        return {
            elementTypes: CircuitJsonElementValidator.knownElementTypes(),
            idFieldExceptions: CircuitJsonElementValidator.idFieldExceptions(),
            variantSets: CircuitJsonElementValidator.variantSets()
        }
    }

    /**
     * Returns known variant discriminants from the active schema metadata.
     * @returns {Record<string, string[]>}
     */
    static variantSets() {
        return Object.fromEntries(
            SORTED_VARIANT_SET_NAMES.map((name) => [
                name,
                [...VARIANT_SETS[name]].sort()
            ])
        )
    }

    /**
     * Compares current schema metadata against a saved snapshot.
     * @param {{ elementTypes?: string[], idFieldExceptions?: string[], variantSets?: Record<string, string[]> }} snapshot Schema snapshot.
     * @returns {CircuitJsonSchemaSnapshotComparison}
     */
    static compareSchemaSnapshot(snapshot = {}) {
        const elementComparison = CircuitJsonElementValidator.#compareSets(
            new Set(snapshot.elementTypes || []),
            KNOWN_ELEMENT_TYPES
        )
        const exceptionComparison = CircuitJsonElementValidator.#compareSets(
            new Set(snapshot.idFieldExceptions || []),
            ID_FIELD_EXCEPTIONS
        )
        const variantComparison =
            CircuitJsonElementValidator.#compareVariantSets(
                snapshot.variantSets || {}
            )

        return {
            matches:
                elementComparison.missing.length === 0 &&
                elementComparison.unexpected.length === 0 &&
                exceptionComparison.missing.length === 0 &&
                exceptionComparison.unexpected.length === 0 &&
                variantComparison.missing.length === 0 &&
                variantComparison.unexpected.length === 0,
            missingElementTypes: elementComparison.missing,
            unexpectedElementTypes: elementComparison.unexpected,
            missingIdFieldExceptions: exceptionComparison.missing,
            unexpectedIdFieldExceptions: exceptionComparison.unexpected,
            missingVariants: variantComparison.missing,
            unexpectedVariants: variantComparison.unexpected
        }
    }

    /**
     * Validates the common id convention.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validateId(element, type, errors) {
        if (ID_FIELD_EXCEPTIONS.has(type)) {
            return
        }

        const idField = type + '_id'
        if (!CircuitJsonElementValidator.#isNonEmptyString(element[idField])) {
            errors.push(type + ' ' + idField + ' is required.')
        }
    }

    /**
     * Validates type-specific fields used by core consumers.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validateCoreShape(element, type, errors) {
        if (type === 'source_component') {
            CircuitJsonElementValidator.#validateSourceComponent(
                element,
                errors
            )
            return
        }

        if (type === 'source_port') {
            CircuitJsonElementValidator.#validateSourcePort(element, errors)
            return
        }

        if (type === 'schematic_component') {
            CircuitJsonElementValidator.#validateSchematicComponent(
                element,
                errors
            )
            return
        }

        if (type === 'pcb_board') {
            CircuitJsonElementValidator.#validatePcbBoard(element, errors)
            return
        }

        if (type === 'pcb_component') {
            CircuitJsonElementValidator.#validatePcbComponent(element, errors)
            return
        }

        if (type === 'pcb_smtpad') {
            CircuitJsonElementValidator.#validatePcbSmtPad(element, errors)
            return
        }

        if (type === 'simulation_oscilloscope_trace') {
            CircuitJsonElementValidator.#validateSimulationOscilloscopeTrace(
                element,
                errors
            )
        }
    }

    /**
     * Validates a source component.
     * @param {Record<string, unknown>} element Element.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validateSourceComponent(element, errors) {
        CircuitJsonElementValidator.#requireString(
            element,
            'source_component',
            'name',
            errors
        )

        if (
            Object.hasOwn(element, 'supplier_part_numbers') &&
            !CircuitJsonElementValidator.#isPlainObject(
                element.supplier_part_numbers
            )
        ) {
            errors.push(
                'source_component supplier_part_numbers must be an object.'
            )
        }

        if (
            Object.hasOwn(element, 'ftype') &&
            !SOURCE_COMPONENT_FTYPES.has(String(element.ftype || ''))
        ) {
            errors.push('source_component ftype is not supported.')
        }
    }

    /**
     * Validates a source port.
     * @param {Record<string, unknown>} element Element.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validateSourcePort(element, errors) {
        if (
            Object.hasOwn(element, 'pin_number') &&
            !Number.isFinite(element.pin_number)
        ) {
            errors.push('source_port pin_number must be a number.')
        }
    }

    /**
     * Validates a schematic component.
     * @param {Record<string, unknown>} element Element.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validateSchematicComponent(element, errors) {
        CircuitJsonElementValidator.#requirePoint(
            element,
            'schematic_component',
            'center',
            errors
        )
        CircuitJsonElementValidator.#requireSize(
            element,
            'schematic_component',
            'size',
            errors
        )
    }

    /**
     * Validates a PCB board.
     * @param {Record<string, unknown>} element Element.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validatePcbBoard(element, errors) {
        CircuitJsonElementValidator.#requirePoint(
            element,
            'pcb_board',
            'center',
            errors
        )
    }

    /**
     * Validates a PCB component.
     * @param {Record<string, unknown>} element Element.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validatePcbComponent(element, errors) {
        CircuitJsonElementValidator.#requireString(
            element,
            'pcb_component',
            'source_component_id',
            errors
        )
        CircuitJsonElementValidator.#requirePoint(
            element,
            'pcb_component',
            'center',
            errors
        )
        CircuitJsonElementValidator.#requireLayer(
            element,
            'pcb_component',
            'layer',
            errors
        )
        CircuitJsonElementValidator.#optionalAngle(
            element,
            'pcb_component',
            'rotation',
            errors
        )
        CircuitJsonElementValidator.#optionalLength(
            element,
            'pcb_component',
            'width',
            errors
        )
        CircuitJsonElementValidator.#optionalLength(
            element,
            'pcb_component',
            'height',
            errors
        )
    }

    /**
     * Validates an SMT pad.
     * @param {Record<string, unknown>} element Element.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validatePcbSmtPad(element, errors) {
        const shape = String(element.shape || '')
        if (!SMT_PAD_SHAPES.has(shape)) {
            errors.push(
                'pcb_smtpad shape must be one of: ' +
                    [...SMT_PAD_SHAPES].join(', ') +
                    '.'
            )
            return
        }

        CircuitJsonElementValidator.#requireLayer(
            element,
            'pcb_smtpad',
            'layer',
            errors
        )

        if (shape === 'polygon') {
            if (!Array.isArray(element.points)) {
                errors.push('pcb_smtpad points is required.')
            }
            return
        }

        CircuitJsonElementValidator.#requireLength(
            element,
            'pcb_smtpad',
            'x',
            errors
        )
        CircuitJsonElementValidator.#requireLength(
            element,
            'pcb_smtpad',
            'y',
            errors
        )

        if (shape === 'circle') {
            if (
                !CircuitJsonElementValidator.#hasLength(element, 'radius') &&
                !CircuitJsonElementValidator.#hasLength(element, 'diameter') &&
                !(
                    CircuitJsonElementValidator.#hasLength(element, 'width') &&
                    CircuitJsonElementValidator.#hasLength(element, 'height')
                )
            ) {
                errors.push(
                    'pcb_smtpad radius, diameter, or width and height is required.'
                )
            }
            return
        }

        CircuitJsonElementValidator.#requireLength(
            element,
            'pcb_smtpad',
            'width',
            errors
        )
        CircuitJsonElementValidator.#requireLength(
            element,
            'pcb_smtpad',
            'height',
            errors
        )

        if (shape.startsWith('rotated_')) {
            CircuitJsonElementValidator.#requireAngle(
                element,
                'pcb_smtpad',
                'ccw_rotation',
                errors
            )
        }

        if (shape.endsWith('pill')) {
            CircuitJsonElementValidator.#optionalLength(
                element,
                'pcb_smtpad',
                'radius',
                errors
            )
        }
    }

    /**
     * Validates oscilloscope trace reference and unit constraints.
     * @param {Record<string, unknown>} element Element.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #validateSimulationOscilloscopeTrace(element, errors) {
        const voltageReferences = [
            element.simulation_transient_voltage_graph_id,
            element.simulation_voltage_probe_id
        ].filter((value) =>
            CircuitJsonElementValidator.#isNonEmptyString(value)
        ).length
        const currentReferences = [
            element.simulation_transient_current_graph_id,
            element.simulation_current_probe_id
        ].filter((value) =>
            CircuitJsonElementValidator.#isNonEmptyString(value)
        ).length

        if (voltageReferences + currentReferences !== 1) {
            errors.push(
                'simulation_oscilloscope_trace must reference exactly one graph or probe.'
            )
        }
        if (voltageReferences > 0 && Object.hasOwn(element, 'amps_per_div')) {
            errors.push(
                'voltage oscilloscope traces must use volts_per_div, not amps_per_div.'
            )
        }
        if (currentReferences > 0 && Object.hasOwn(element, 'volts_per_div')) {
            errors.push(
                'current oscilloscope traces must use amps_per_div, not volts_per_div.'
            )
        }
        CircuitJsonElementValidator.#optionalPositiveNumber(
            element,
            'simulation_oscilloscope_trace',
            'volts_per_div',
            errors
        )
        CircuitJsonElementValidator.#optionalPositiveNumber(
            element,
            'simulation_oscilloscope_trace',
            'amps_per_div',
            errors
        )
    }

    /**
     * Requires a non-empty string field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #requireString(element, type, field, errors) {
        if (!CircuitJsonElementValidator.#isNonEmptyString(element[field])) {
            errors.push(type + ' ' + field + ' is required.')
        }
    }

    /**
     * Requires a finite number field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #requireNumber(element, type, field, errors) {
        if (!Number.isFinite(element[field])) {
            errors.push(type + ' ' + field + ' is required.')
        }
    }

    /**
     * Requires a finite length field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #requireLength(element, type, field, errors) {
        if (CircuitJsonUnits.optionalLength(element[field]) === null) {
            errors.push(type + ' ' + field + ' is required.')
        }
    }

    /**
     * Returns true when a field is a finite length.
     * @param {Record<string, unknown>} element Element.
     * @param {string} field Field name.
     * @returns {boolean}
     */
    static #hasLength(element, field) {
        return CircuitJsonUnits.optionalLength(element[field]) !== null
    }

    /**
     * Requires a finite angle field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #requireAngle(element, type, field, errors) {
        if (CircuitJsonUnits.optionalAngle(element[field]) === null) {
            errors.push(type + ' ' + field + ' is required.')
        }
    }

    /**
     * Validates an optional finite length field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #optionalLength(element, type, field, errors) {
        if (
            Object.hasOwn(element, field) &&
            CircuitJsonUnits.optionalLength(element[field]) === null
        ) {
            errors.push(type + ' ' + field + ' must be a finite length.')
        }
    }

    /**
     * Validates an optional finite angle field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #optionalAngle(element, type, field, errors) {
        if (
            Object.hasOwn(element, field) &&
            CircuitJsonUnits.optionalAngle(element[field]) === null
        ) {
            errors.push(type + ' ' + field + ' must be a finite angle.')
        }
    }

    /**
     * Validates an optional positive finite number field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #optionalPositiveNumber(element, type, field, errors) {
        if (!Object.hasOwn(element, field)) {
            return
        }
        const value = Number(element[field])
        if (!Number.isFinite(value) || value <= 0) {
            errors.push(type + ' ' + field + ' must be a positive number.')
        }
    }

    /**
     * Requires a finite point object field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #requirePoint(element, type, field, errors) {
        const point = element[field]
        if (!CircuitJsonElementValidator.#isObject(point)) {
            errors.push(type + ' ' + field + ' is required.')
            return
        }

        if (CircuitJsonUnits.optionalPoint(point) === null) {
            errors.push(type + ' ' + field + ' is required.')
        }
    }

    /**
     * Requires a finite size object field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #requireSize(element, type, field, errors) {
        const size = element[field]
        if (!CircuitJsonElementValidator.#isObject(size)) {
            errors.push(type + ' ' + field + ' is required.')
            return
        }

        if (CircuitJsonUnits.optionalSize(size) === null) {
            errors.push(type + ' ' + field + ' is required.')
        }
    }

    /**
     * Requires a known layer field.
     * @param {Record<string, unknown>} element Element.
     * @param {string} type Element type.
     * @param {string} field Field name.
     * @param {string[]} errors Error sink.
     * @returns {void}
     */
    static #requireLayer(element, type, field, errors) {
        const layer =
            typeof element[field] === 'object' && element[field] !== null
                ? element[field].name
                : element[field]
        if (!LAYERS.has(String(layer || ''))) {
            errors.push(type + ' ' + field + ' is required.')
        }
    }

    /**
     * Returns true for non-null objects.
     * @param {unknown} value Candidate.
     * @returns {boolean}
     */
    static #isObject(value) {
        return Boolean(value) && typeof value === 'object'
    }

    /**
     * Returns true for plain object values.
     * @param {unknown} value Candidate.
     * @returns {boolean}
     */
    static #isPlainObject(value) {
        return (
            CircuitJsonElementValidator.#isObject(value) &&
            !Array.isArray(value)
        )
    }

    /**
     * Returns true for non-empty strings.
     * @param {unknown} value Candidate.
     * @returns {boolean}
     */
    static #isNonEmptyString(value) {
        return typeof value === 'string' && value.trim().length > 0
    }

    /**
     * Compares expected and actual string sets.
     * @param {Set<string>} expected Expected values.
     * @param {Set<string>} actual Actual values.
     * @returns {{ missing: string[], unexpected: string[] }}
     */
    static #compareSets(expected, actual) {
        return {
            missing: [...expected]
                .filter((value) => !actual.has(value))
                .sort((left, right) => left.localeCompare(right)),
            unexpected: [...actual]
                .filter((value) => !expected.has(value))
                .sort((left, right) => left.localeCompare(right))
        }
    }

    /**
     * Compares expected and actual variant metadata sets.
     * @param {Record<string, string[]>} snapshotSets Snapshot variant sets.
     * @returns {{ missing: CircuitJsonVariantDiff[], unexpected: CircuitJsonVariantDiff[] }}
     */
    static #compareVariantSets(snapshotSets) {
        const missing = []
        const unexpected = []
        const setNames = new Set([
            ...SORTED_VARIANT_SET_NAMES,
            ...Object.keys(snapshotSets || {})
        ])

        for (const setName of [...setNames].sort()) {
            const comparison = CircuitJsonElementValidator.#compareSets(
                new Set((snapshotSets?.[setName] || []).map(String)),
                new Set(VARIANT_SETS[setName] || [])
            )
            missing.push(
                ...comparison.missing.map((value) => ({
                    set: setName,
                    value
                }))
            )
            unexpected.push(
                ...comparison.unexpected.map((value) => ({
                    set: setName,
                    value
                }))
            )
        }

        return { missing, unexpected }
    }
}

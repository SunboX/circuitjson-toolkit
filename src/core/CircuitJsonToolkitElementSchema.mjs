const TOOLKIT_ELEMENT_TYPES = new Set([
    'schematic_image',
    'schematic_sheet_symbol'
])

/**
 * Validates canonical toolkit element types that are newer than the pinned
 * upstream CircuitJSON union.
 */
export class CircuitJsonToolkitElementSchema {
    /**
     * Returns the toolkit-owned canonical element types.
     * @returns {string[]} Stable element type names.
     */
    static elementTypes() {
        return [...TOOLKIT_ELEMENT_TYPES]
    }

    /**
     * Returns whether a type is owned by the canonical toolkit overlay.
     * @param {unknown} type Element type.
     * @returns {boolean} Whether the type is recognized.
     */
    static has(type) {
        return typeof type === 'string' && TOOLKIT_ELEMENT_TYPES.has(type)
    }

    /**
     * Validates one toolkit-owned canonical element.
     * @param {Record<string, any>} value Element value.
     * @param {string} type Element type.
     * @param {string} [location] Human-readable location suffix.
     * @returns {string[]} Empty on success or one validation error.
     */
    static validate(value, type, location = '') {
        const valid =
            (type === 'schematic_image' &&
                CircuitJsonToolkitElementSchema.#schematicImage(value)) ||
            (type === 'schematic_sheet_symbol' &&
                CircuitJsonToolkitElementSchema.#schematicSheetSymbol(value))
        return valid
            ? []
            : [
                  `CircuitJSON element ${type}${location} does not match the canonical toolkit schema.`
              ]
    }

    /**
     * Validates an asset-backed schematic image.
     * @param {Record<string, any>} value Image element.
     * @returns {boolean} Whether the complete image contract matches.
     */
    static #schematicImage(value) {
        if (
            value.type !== 'schematic_image' ||
            !CircuitJsonToolkitElementSchema.#requiredString(
                value.schematic_image_id
            ) ||
            !CircuitJsonToolkitElementSchema.#requiredString(value.asset_id) ||
            !CircuitJsonToolkitElementSchema.#point(value.center) ||
            !CircuitJsonToolkitElementSchema.#size(value.size)
        ) {
            return false
        }
        for (const field of [
            'schematic_sheet_id',
            'schematic_component_id',
            'subcircuit_id',
            'source_path',
            'source_name'
        ]) {
            if (
                value[field] !== undefined &&
                typeof value[field] !== 'string'
            ) {
                return false
            }
        }
        if (
            value.rotation !== undefined &&
            !CircuitJsonToolkitElementSchema.#number(value.rotation)
        ) {
            return false
        }
        if (
            value.opacity !== undefined &&
            (!CircuitJsonToolkitElementSchema.#number(value.opacity) ||
                value.opacity < 0 ||
                value.opacity > 1)
        ) {
            return false
        }
        if (
            value.preserve_aspect_ratio !== undefined &&
            typeof value.preserve_aspect_ratio !== 'boolean'
        ) {
            return false
        }
        return (
            value.render_order === undefined ||
            Number.isSafeInteger(value.render_order)
        )
    }

    /**
     * Validates one hierarchical child-sheet symbol.
     * @param {Record<string, any>} value Sheet-symbol element.
     * @returns {boolean} Whether the complete symbol contract matches.
     */
    static #schematicSheetSymbol(value) {
        if (
            value.type !== 'schematic_sheet_symbol' ||
            !CircuitJsonToolkitElementSchema.#requiredString(
                value.schematic_sheet_symbol_id
            ) ||
            typeof value.name !== 'string' ||
            !CircuitJsonToolkitElementSchema.#point(value.center) ||
            !CircuitJsonToolkitElementSchema.#positive(value.width) ||
            !CircuitJsonToolkitElementSchema.#positive(value.height)
        ) {
            return false
        }
        for (const field of [
            'schematic_sheet_id',
            'schematic_group_id',
            'subcircuit_id',
            'source_file_name',
            'color',
            'fill_color'
        ]) {
            if (
                value[field] !== undefined &&
                typeof value[field] !== 'string'
            ) {
                return false
            }
        }
        for (const field of ['is_dashed', 'is_filled']) {
            if (
                value[field] !== undefined &&
                typeof value[field] !== 'boolean'
            ) {
                return false
            }
        }
        if (
            value.stroke_width !== undefined &&
            (!CircuitJsonToolkitElementSchema.#number(value.stroke_width) ||
                value.stroke_width < 0)
        ) {
            return false
        }
        return (
            value.render_order === undefined ||
            Number.isSafeInteger(value.render_order)
        )
    }

    /**
     * Validates a required non-empty string.
     * @param {unknown} value Candidate.
     * @returns {boolean} Whether the value is valid.
     */
    static #requiredString(value) {
        return typeof value === 'string' && value.length > 0
    }

    /**
     * Validates a finite number.
     * @param {unknown} value Candidate.
     * @returns {boolean} Whether the value is valid.
     */
    static #number(value) {
        return typeof value === 'number' && Number.isFinite(value)
    }

    /**
     * Validates a positive finite number.
     * @param {unknown} value Candidate.
     * @returns {boolean} Whether the value is valid.
     */
    static #positive(value) {
        return CircuitJsonToolkitElementSchema.#number(value) && value > 0
    }

    /**
     * Validates one finite point.
     * @param {unknown} value Candidate.
     * @returns {boolean} Whether the point is valid.
     */
    static #point(value) {
        return Boolean(
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            CircuitJsonToolkitElementSchema.#number(value.x) &&
            CircuitJsonToolkitElementSchema.#number(value.y)
        )
    }

    /**
     * Validates one positive image size.
     * @param {unknown} value Candidate.
     * @returns {boolean} Whether the size is valid.
     */
    static #size(value) {
        return Boolean(
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            CircuitJsonToolkitElementSchema.#positive(value.width) &&
            CircuitJsonToolkitElementSchema.#positive(value.height)
        )
    }
}

Object.freeze(CircuitJsonToolkitElementSchema.prototype)
Object.freeze(CircuitJsonToolkitElementSchema)

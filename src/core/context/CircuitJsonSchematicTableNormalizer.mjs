import { CircuitJsonUnits } from '../CircuitJsonUnits.mjs'

/**
 * Projects grid-addressed table cells onto upstream CircuitJSON geometry.
 */
export class CircuitJsonSchematicTableNormalizer {
    /**
     * Normalizes every table cell in one model.
     * @param {object[]} rows Model rows.
     * @param {boolean} owned Whether rows may be mutated in place.
     * @returns {boolean} Whether any cell changed.
     */
    static normalize(rows, owned) {
        const tables = new Map()
        for (let index = 0; index < rows.length; index += 1) {
            const table = CircuitJsonSchematicTableNormalizer.#table(
                rows[index]
            )
            if (table) tables.set(table.id, table)
        }
        if (!tables.size) return false

        let changed = false
        for (let index = 0; index < rows.length; index += 1) {
            const descriptors = CircuitJsonSchematicTableNormalizer.#record(
                rows[index]
            )
            if (descriptors?.type?.value !== 'schematic_table_cell') continue
            const fields =
                CircuitJsonSchematicTableNormalizer.#fields(descriptors)
            const table = tables.get(String(fields.schematic_table_id || ''))
            const normalized = CircuitJsonSchematicTableNormalizer.#cell(
                fields,
                table
            )
            if (
                !normalized ||
                !CircuitJsonSchematicTableNormalizer.#changed(
                    normalized,
                    descriptors
                )
            ) {
                continue
            }
            changed = true
            if (owned) {
                for (const key of Object.keys(rows[index])) {
                    delete rows[index][key]
                }
                Object.assign(rows[index], normalized)
            } else {
                rows[index] = normalized
            }
        }
        return changed
    }

    /**
     * Builds table grid offsets from one table row.
     * @param {unknown} row Table row candidate.
     * @returns {Record<string, any> | null} Table geometry.
     */
    static #table(row) {
        const descriptors = CircuitJsonSchematicTableNormalizer.#record(row)
        if (descriptors?.type?.value !== 'schematic_table') return null
        const fields = CircuitJsonSchematicTableNormalizer.#fields(descriptors)
        const id = String(fields.schematic_table_id || '').trim()
        const columns = CircuitJsonSchematicTableNormalizer.#lengths(
            fields.column_widths
        )
        const rows = CircuitJsonSchematicTableNormalizer.#lengths(
            fields.row_heights
        )
        const anchor = CircuitJsonUnits.optionalPoint(fields.anchor_position)
        if (!id || !columns.length || !rows.length || !anchor) return null
        const width = columns.reduce((total, value) => total + value, 0)
        const height = rows.reduce((total, value) => total + value, 0)
        const name = String(fields.anchor || 'top_left').toLowerCase()
        const [vertical, horizontal] =
            name === 'center' || name === 'middle'
                ? ['center', 'center']
                : name.split('_')
        return {
            id,
            x: CircuitJsonSchematicTableNormalizer.#anchorCoordinate(
                anchor.x,
                width,
                horizontal
            ),
            y: CircuitJsonSchematicTableNormalizer.#anchorCoordinate(
                anchor.y,
                height,
                vertical
            ),
            columns,
            rows,
            columnOffsets:
                CircuitJsonSchematicTableNormalizer.#offsets(columns),
            rowOffsets: CircuitJsonSchematicTableNormalizer.#offsets(rows)
        }
    }

    /**
     * Converts one grid-addressed cell to canonical geometry and indexes.
     * @param {Record<string, any>} fields Cell fields.
     * @param {Record<string, any> | undefined} table Parent table geometry.
     * @returns {Record<string, any> | null} Canonical cell fields.
     */
    static #cell(fields, table) {
        if (!table) return null
        const startRow = CircuitJsonSchematicTableNormalizer.#index(
            fields.start_row_index ??
                fields.row ??
                fields.row_index ??
                fields.rowIndex
        )
        const startColumn = CircuitJsonSchematicTableNormalizer.#index(
            fields.start_column_index ??
                fields.column ??
                fields.col ??
                fields.column_index ??
                fields.columnIndex
        )
        if (
            startRow === null ||
            startColumn === null ||
            startRow >= table.rows.length ||
            startColumn >= table.columns.length
        ) {
            return null
        }
        const endRow = CircuitJsonSchematicTableNormalizer.#endIndex(
            fields.end_row_index,
            startRow,
            fields.row_span ?? fields.rowSpan,
            table.rows.length
        )
        const endColumn = CircuitJsonSchematicTableNormalizer.#endIndex(
            fields.end_column_index,
            startColumn,
            fields.col_span ?? fields.column_span ?? fields.colSpan,
            table.columns.length
        )
        if (endRow < startRow || endColumn < startColumn) return null
        const x = table.x + table.columnOffsets[startColumn]
        const y = table.y + table.rowOffsets[startRow]
        const width =
            table.columnOffsets[endColumn + 1] -
            table.columnOffsets[startColumn]
        const height = table.rowOffsets[endRow + 1] - table.rowOffsets[startRow]
        const normalized = {
            ...fields,
            start_row_index: startRow,
            end_row_index: endRow,
            start_column_index: startColumn,
            end_column_index: endColumn,
            center: { x: x + width / 2, y: y + height / 2 },
            width,
            height
        }
        for (const key of [
            'row',
            'row_index',
            'rowIndex',
            'row_span',
            'rowSpan',
            'column',
            'col',
            'column_index',
            'columnIndex',
            'col_span',
            'column_span',
            'colSpan'
        ]) {
            delete normalized[key]
        }
        return normalized
    }

    /**
     * Resolves an anchored axis coordinate.
     * @param {number} coordinate Anchor coordinate.
     * @param {number} length Axis length.
     * @param {string} alignment Axis alignment.
     * @returns {number} Leading coordinate.
     */
    static #anchorCoordinate(coordinate, length, alignment) {
        if (alignment === 'right' || alignment === 'bottom') {
            return coordinate - length
        }
        return alignment === 'center' || alignment === 'middle'
            ? coordinate - length / 2
            : coordinate
    }

    /**
     * Resolves a bounded inclusive ending index.
     * @param {unknown} explicit Explicit ending index.
     * @param {number} start Starting index.
     * @param {unknown} span Span candidate.
     * @param {number} length Axis length.
     * @returns {number} Inclusive ending index.
     */
    static #endIndex(explicit, start, span, length) {
        return Math.min(
            CircuitJsonSchematicTableNormalizer.#index(explicit) ??
                start + CircuitJsonSchematicTableNormalizer.#span(span) - 1,
            length - 1
        )
    }

    /**
     * Normalizes a table dimension array.
     * @param {unknown} values Dimension candidates.
     * @returns {number[]} Positive lengths.
     */
    static #lengths(values) {
        return (Array.isArray(values) ? values : [])
            .map((value) => CircuitJsonUnits.optionalLength(value))
            .filter((value) => value !== null && value > 0)
    }

    /**
     * Builds cumulative table grid offsets.
     * @param {number[]} values Lengths.
     * @returns {number[]} Boundary offsets.
     */
    static #offsets(values) {
        const offsets = [0]
        for (const value of values) {
            offsets.push(offsets[offsets.length - 1] + value)
        }
        return offsets
    }

    /**
     * Normalizes a zero-based table index.
     * @param {unknown} value Index candidate.
     * @returns {number | null} Normalized index.
     */
    static #index(value) {
        const number = Number(value)
        return Number.isInteger(number) && number >= 0 ? number : null
    }

    /**
     * Normalizes a positive table span.
     * @param {unknown} value Span candidate.
     * @returns {number} Normalized span.
     */
    static #span(value) {
        const number = Number(value)
        return Number.isInteger(number) && number > 0 ? number : 1
    }

    /**
     * Copies own data descriptors into a plain record.
     * @param {Record<string, PropertyDescriptor>} descriptors Descriptors.
     * @returns {Record<string, any>} Plain fields.
     */
    static #fields(descriptors) {
        return Object.fromEntries(
            Object.entries(descriptors).map(([key, descriptor]) => [
                key,
                descriptor.value
            ])
        )
    }

    /**
     * Returns whether normalized fields differ from original descriptors.
     * @param {Record<string, any>} fields Normalized fields.
     * @param {Record<string, PropertyDescriptor>} descriptors Original fields.
     * @returns {boolean} Whether fields changed.
     */
    static #changed(fields, descriptors) {
        const keys = Object.keys(fields)
        return (
            keys.length !== Object.keys(descriptors).length ||
            keys.some(
                (key) =>
                    !descriptors[key] || fields[key] !== descriptors[key].value
            )
        )
    }

    /**
     * Reads a safe plain record through data descriptors only.
     * @param {unknown} value Record candidate.
     * @returns {Record<string, PropertyDescriptor> | null} Safe descriptors.
     */
    static #record(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null
        }
        try {
            const prototype = Object.getPrototypeOf(value)
            const descriptors = Object.getOwnPropertyDescriptors(value)
            if (prototype !== Object.prototype && prototype !== null) {
                return null
            }
            return Object.values(descriptors).some(
                (descriptor) => !Object.hasOwn(descriptor, 'value')
            )
                ? null
                : descriptors
        } catch {
            return null
        }
    }
}

Object.freeze(CircuitJsonSchematicTableNormalizer.prototype)
Object.freeze(CircuitJsonSchematicTableNormalizer)

import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'

/**
 * Resolves shared schematic table rectangles and nine-point anchors.
 */
export class SchematicTableGeometry {
    /**
     * Builds table models keyed by their canonical ids.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {Map<string, object>} Table models.
     */
    static models(index) {
        const models = new Map()
        for (const element of index.elementsByType.get('schematic_table') ||
            []) {
            const model = SchematicTableGeometry.model(element)
            if (model) models.set(model.id, model)
        }
        return models
    }

    /**
     * Builds one reusable schematic table model.
     * @param {object} element Table element.
     * @returns {object | null} Table model.
     */
    static model(element) {
        const id = String(element.schematic_table_id || '').trim()
        const columns = SchematicTableGeometry.lengths(
            element.column_widths || element.columnWidths || element.columns
        )
        const rows = SchematicTableGeometry.lengths(
            element.row_heights || element.rowHeights || element.rows
        )
        const rect = SchematicTableGeometry.rect(
            element,
            SchematicTableGeometry.sum(columns),
            SchematicTableGeometry.sum(rows)
        )
        if (!id || !rect) return null
        return {
            id,
            element,
            ...rect,
            columns,
            rows,
            columnOffsets: SchematicTableGeometry.#offsets(columns),
            rowOffsets: SchematicTableGeometry.#offsets(rows),
            padding: CircuitJsonUnits.length(element.cell_padding, 0),
            borderWidth:
                CircuitJsonUnits.optionalLength(element.border_width) ??
                CircuitJsonUnits.optionalLength(element.borderWidth)
        }
    }

    /**
     * Resolves one complete table rectangle from its grid dimensions.
     * @param {object} element Table element.
     * @returns {{ x: number, y: number, width: number, height: number } | null} Table rectangle.
     */
    static tableRect(element) {
        const columns = SchematicTableGeometry.lengths(
            element.column_widths || element.columnWidths || element.columns
        )
        const rows = SchematicTableGeometry.lengths(
            element.row_heights || element.rowHeights || element.rows
        )
        return SchematicTableGeometry.rect(
            element,
            SchematicTableGeometry.sum(columns),
            SchematicTableGeometry.sum(rows)
        )
    }

    /**
     * Resolves a rectangle from center/size or anchor metadata.
     * @param {object} element Element row.
     * @param {number} [fallbackWidth] Fallback width.
     * @param {number} [fallbackHeight] Fallback height.
     * @returns {{ x: number, y: number, width: number, height: number } | null} Rectangle.
     */
    static rect(element, fallbackWidth = 0, fallbackHeight = 0) {
        const size = SchematicTableGeometry.#size(
            element,
            fallbackWidth,
            fallbackHeight
        )
        const anchor = CircuitJsonUnits.optionalPoint(element.anchor_position)
        if (size && anchor) {
            return SchematicTableGeometry.#anchoredRect(
                anchor,
                size,
                element.anchor
            )
        }
        const center = CircuitJsonUnits.optionalPoint(element.center || element)
        if (!center || !size) return null
        return {
            x: center.x - size.width / 2,
            y: center.y - size.height / 2,
            ...size
        }
    }

    /**
     * Resolves one direct or grid-addressed table-cell rectangle.
     * @param {object} element Cell element.
     * @param {object | undefined} table Parent table model.
     * @returns {object | null} Cell rectangle.
     */
    static cellRect(element, table) {
        if (!table?.columns?.length || !table?.rows?.length) {
            return SchematicTableGeometry.rect(element)
        }
        const row = SchematicTableGeometry.#index(
            element.row ??
                element.row_index ??
                element.rowIndex ??
                element.start_row_index
        )
        const column = SchematicTableGeometry.#index(
            element.column ??
                element.col ??
                element.column_index ??
                element.columnIndex ??
                element.start_column_index
        )
        if (row === null || column === null) return null
        if (row >= table.rows.length || column >= table.columns.length) {
            return null
        }
        const endRow = SchematicTableGeometry.#index(element.end_row_index)
        const endColumn = SchematicTableGeometry.#index(
            element.end_column_index
        )
        const rowSpan = SchematicTableGeometry.#span(
            element.row_span ??
                element.rowSpan ??
                (endRow === null ? undefined : endRow - row + 1)
        )
        const columnSpan = SchematicTableGeometry.#span(
            element.col_span ??
                element.column_span ??
                element.colSpan ??
                (endColumn === null ? undefined : endColumn - column + 1)
        )
        const columnEnd = Math.min(column + columnSpan, table.columns.length)
        const rowEnd = Math.min(row + rowSpan, table.rows.length)
        const width =
            (table.columnOffsets[columnEnd] ?? 0) -
            (table.columnOffsets[column] ?? 0)
        const height =
            (table.rowOffsets[rowEnd] ?? 0) - (table.rowOffsets[row] ?? 0)
        if (width <= 0 || height <= 0) return null
        return {
            x: table.x + (table.columnOffsets[column] || 0),
            y: table.y + (table.rowOffsets[row] || 0),
            width,
            height
        }
    }

    /**
     * Resolves one table-cell text anchor shared by bounds and SVG output.
     * @param {object} element Cell element.
     * @param {object | undefined} table Parent table model.
     * @param {object} rect Cell rectangle.
     * @returns {{ x: number, y: number, anchor: string, baseline: string, namedAnchor: string }} Text position.
     */
    static textPosition(element, table, rect) {
        const padding = Number(table?.padding || 0)
        const horizontal = String(
            element.horizontal_align || element.horizontalAlign || ''
        ).toLowerCase()
        const vertical = String(
            element.vertical_align || element.verticalAlign || ''
        ).toLowerCase()
        const horizontalName =
            horizontal === 'left' || horizontal === 'start'
                ? 'left'
                : horizontal === 'right' || horizontal === 'end'
                  ? 'right'
                  : 'center'
        const verticalName =
            vertical === 'top'
                ? 'top'
                : vertical === 'bottom'
                  ? 'bottom'
                  : 'center'
        return {
            x:
                horizontalName === 'left'
                    ? rect.x + padding
                    : horizontalName === 'right'
                      ? rect.x + rect.width - padding
                      : rect.x + rect.width / 2,
            y:
                verticalName === 'top'
                    ? rect.y + padding
                    : verticalName === 'bottom'
                      ? rect.y + rect.height - padding
                      : rect.y + rect.height / 2,
            anchor:
                horizontalName === 'left'
                    ? 'start'
                    : horizontalName === 'right'
                      ? 'end'
                      : 'middle',
            baseline:
                verticalName === 'top'
                    ? 'hanging'
                    : verticalName === 'bottom'
                      ? 'text-after-edge'
                      : 'central',
            namedAnchor: `${verticalName}_${horizontalName}`
        }
    }

    /**
     * Resolves an array of positive table lengths.
     * @param {unknown} value Length array candidate.
     * @returns {number[]} Positive lengths.
     */
    static lengths(value) {
        return (Array.isArray(value) ? value : [])
            .map((entry) =>
                CircuitJsonUnits.optionalLength(
                    entry?.width ?? entry?.height ?? entry
                )
            )
            .filter((entry) => entry !== null && entry > 0)
    }

    /**
     * Sums numeric table lengths.
     * @param {number[]} values Values.
     * @returns {number} Sum.
     */
    static sum(values) {
        return values.reduce((total, value) => total + value, 0)
    }

    /**
     * Builds cumulative boundary offsets for a length list.
     * @param {number[]} values Length values.
     * @returns {number[]} Cumulative boundaries from zero through total.
     */
    static #offsets(values) {
        const offsets = [0]
        let total = 0
        for (const value of values) {
            total += value
            offsets.push(total)
        }
        return offsets
    }

    /**
     * Resolves a zero-based row or column index.
     * @param {unknown} value Index candidate.
     * @returns {number | null} Index.
     */
    static #index(value) {
        const number = Number(value)
        return Number.isInteger(number) && number >= 0 ? number : null
    }

    /**
     * Resolves a positive row or column span.
     * @param {unknown} value Span candidate.
     * @returns {number} Span.
     */
    static #span(value) {
        const number = Number(value)
        return Number.isInteger(number) && number > 0 ? number : 1
    }

    /**
     * Resolves a positive width/height pair.
     * @param {object} element Element row.
     * @param {number} fallbackWidth Fallback width.
     * @param {number} fallbackHeight Fallback height.
     * @returns {{ width: number, height: number } | null} Size.
     */
    static #size(element, fallbackWidth, fallbackHeight) {
        const size = CircuitJsonUnits.optionalSize(element.size || element)
        const width = size?.width ?? fallbackWidth
        const height = size?.height ?? fallbackHeight
        return width > 0 && height > 0 ? { width, height } : null
    }

    /**
     * Builds a rectangle from an exact nine-point anchor.
     * @param {{ x: number, y: number }} point Anchor point.
     * @param {{ width: number, height: number }} size Size.
     * @param {unknown} anchor Anchor name.
     * @returns {{ x: number, y: number, width: number, height: number }} Rectangle.
     */
    static #anchoredRect(point, size, anchor) {
        const text = String(anchor || 'top_left').toLowerCase()
        const [vertical, horizontal] =
            text === 'center' || text === 'middle'
                ? ['center', 'center']
                : text.split('_')
        const x =
            horizontal === 'right'
                ? point.x - size.width
                : horizontal === 'center' || horizontal === 'middle'
                  ? point.x - size.width / 2
                  : point.x
        const y =
            vertical === 'bottom'
                ? point.y - size.height
                : vertical === 'center' || vertical === 'middle'
                  ? point.y - size.height / 2
                  : point.y
        return { x, y, ...size }
    }
}

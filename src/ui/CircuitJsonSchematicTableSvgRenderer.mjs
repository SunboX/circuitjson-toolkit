import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'

/**
 * Renders schematic table frames and cells from element-array metadata.
 */
export class CircuitJsonSchematicTableSvgRenderer {
    /**
     * Renders all schematic table markup.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {{ escapeHtml: (value: unknown) => string, formatNumber: (value: number) => string }} formatters Formatting helpers.
     * @returns {string}
     */
    static render(index, formatters) {
        const tables = CircuitJsonSchematicTableSvgRenderer.#tableModels(index)
        const tableMarkup = [...tables.values()]
            .map((table) =>
                CircuitJsonSchematicTableSvgRenderer.#tableElement(
                    table,
                    formatters
                )
            )
            .filter(Boolean)
        const cellMarkup = CircuitJsonSchematicTableSvgRenderer.#all(
            index,
            'schematic_table_cell'
        )
            .map((cell) =>
                CircuitJsonSchematicTableSvgRenderer.#tableCellElement(
                    cell,
                    tables.get(String(cell.schematic_table_id || '').trim()),
                    formatters
                )
            )
            .filter(Boolean)
        const markup = [...tableMarkup, ...cellMarkup]
        return markup.length
            ? '<g class="schematic-tables">' + markup.join('') + '</g>'
            : ''
    }

    /**
     * Builds table models keyed by table id.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {Map<string, object>}
     */
    static #tableModels(index) {
        const tables = new Map()
        for (const table of CircuitJsonSchematicTableSvgRenderer.#all(
            index,
            'schematic_table'
        )) {
            const model =
                CircuitJsonSchematicTableSvgRenderer.#tableModel(table)
            if (model) tables.set(model.id, model)
        }
        return tables
    }

    /**
     * Builds one schematic table model.
     * @param {object} element Table element.
     * @returns {object | null}
     */
    static #tableModel(element) {
        const id = String(element.schematic_table_id || '').trim()
        const columns = CircuitJsonSchematicTableSvgRenderer.#lengths(
            element.column_widths || element.columnWidths || element.columns
        )
        const rows = CircuitJsonSchematicTableSvgRenderer.#lengths(
            element.row_heights || element.rowHeights || element.rows
        )
        const gridWidth = CircuitJsonSchematicTableSvgRenderer.#sum(columns)
        const gridHeight = CircuitJsonSchematicTableSvgRenderer.#sum(rows)
        const rect = CircuitJsonSchematicTableSvgRenderer.#rect(
            element,
            gridWidth,
            gridHeight
        )
        if (!id || !rect) return null

        return {
            id,
            element,
            ...rect,
            columns,
            rows,
            columnOffsets:
                CircuitJsonSchematicTableSvgRenderer.#offsets(columns),
            rowOffsets: CircuitJsonSchematicTableSvgRenderer.#offsets(rows),
            padding: CircuitJsonUnits.length(element.cell_padding, 0),
            borderWidth:
                CircuitJsonUnits.optionalLength(element.border_width) ??
                CircuitJsonUnits.optionalLength(element.borderWidth)
        }
    }

    /**
     * Renders one table frame.
     * @param {object} table Table model.
     * @param {{ escapeHtml: (value: unknown) => string, formatNumber: (value: number) => string }} formatters Formatting helpers.
     * @returns {string}
     */
    static #tableElement(table, formatters) {
        return (
            '<rect class="schematic-table" data-schematic-table-id="' +
            formatters.escapeHtml(table.id) +
            '" ' +
            CircuitJsonSchematicTableSvgRenderer.#rectAttributes(
                table,
                table.borderWidth,
                formatters
            ) +
            '></rect>'
        )
    }

    /**
     * Renders one table cell.
     * @param {object} element Cell element.
     * @param {object | undefined} table Parent table model.
     * @param {{ escapeHtml: (value: unknown) => string, formatNumber: (value: number) => string }} formatters Formatting helpers.
     * @returns {string}
     */
    static #tableCellElement(element, table, formatters) {
        const rect = CircuitJsonSchematicTableSvgRenderer.#cellRect(
            element,
            table
        )
        if (!rect) return ''
        const text = CircuitJsonSchematicTableSvgRenderer.#textPosition(
            element,
            table,
            rect
        )
        const fontSize = CircuitJsonUnits.optionalLength(element.font_size)

        return (
            '<g class="schematic-table-cell" data-schematic-table-id="' +
            formatters.escapeHtml(element.schematic_table_id || '') +
            '" data-schematic-table-cell-id="' +
            formatters.escapeHtml(element.schematic_table_cell_id || '') +
            '"><rect ' +
            CircuitJsonSchematicTableSvgRenderer.#rectAttributes(
                rect,
                table?.borderWidth,
                formatters
            ) +
            '></rect><text x="' +
            formatters.formatNumber(text.x) +
            '" y="' +
            formatters.formatNumber(text.y) +
            '" text-anchor="' +
            text.anchor +
            '" dominant-baseline="' +
            text.baseline +
            '"' +
            CircuitJsonSchematicTableSvgRenderer.#fontSizeAttribute(
                fontSize,
                formatters
            ) +
            '>' +
            formatters.escapeHtml(element.text || '') +
            '</text></g>'
        )
    }

    /**
     * Resolves one cell rectangle.
     * @param {object} element Cell element.
     * @param {object | undefined} table Parent table model.
     * @returns {object | null}
     */
    static #cellRect(element, table) {
        if (table?.columns?.length && table?.rows?.length) {
            return CircuitJsonSchematicTableSvgRenderer.#gridCellRect(
                element,
                table
            )
        }
        return CircuitJsonSchematicTableSvgRenderer.#rect(element)
    }

    /**
     * Resolves one grid cell rectangle.
     * @param {object} element Cell element.
     * @param {object} table Parent table model.
     * @returns {object | null}
     */
    static #gridCellRect(element, table) {
        const row = CircuitJsonSchematicTableSvgRenderer.#index(
            element.row ?? element.row_index ?? element.rowIndex
        )
        const column = CircuitJsonSchematicTableSvgRenderer.#index(
            element.column ??
                element.col ??
                element.column_index ??
                element.columnIndex
        )
        if (row === null || column === null) return null
        const rowSpan = CircuitJsonSchematicTableSvgRenderer.#span(
            element.row_span ?? element.rowSpan
        )
        const columnSpan = CircuitJsonSchematicTableSvgRenderer.#span(
            element.col_span ?? element.column_span ?? element.colSpan
        )
        const width = CircuitJsonSchematicTableSvgRenderer.#sum(
            table.columns.slice(column, column + columnSpan)
        )
        const height = CircuitJsonSchematicTableSvgRenderer.#sum(
            table.rows.slice(row, row + rowSpan)
        )
        if (width <= 0 || height <= 0) return null

        return {
            x: table.x + (table.columnOffsets[column] || 0),
            y: table.y + (table.rowOffsets[row] || 0),
            width,
            height
        }
    }

    /**
     * Resolves one text position inside a cell.
     * @param {object} element Cell element.
     * @param {object | undefined} table Parent table model.
     * @param {object} rect Cell rectangle.
     * @returns {{ x: number, y: number, anchor: string, baseline: string }}
     */
    static #textPosition(element, table, rect) {
        const padding = Number(table?.padding || 0)
        const horizontal = String(
            element.horizontal_align || element.horizontalAlign || ''
        ).toLowerCase()
        const vertical = String(
            element.vertical_align || element.verticalAlign || ''
        ).toLowerCase()
        const x =
            horizontal === 'left' || horizontal === 'start'
                ? rect.x + padding
                : horizontal === 'right' || horizontal === 'end'
                  ? rect.x + rect.width - padding
                  : rect.x + rect.width / 2
        const y =
            vertical === 'top'
                ? rect.y + padding
                : vertical === 'bottom'
                  ? rect.y + rect.height - padding
                  : rect.y + rect.height / 2
        return {
            x,
            y,
            anchor:
                horizontal === 'left' || horizontal === 'start'
                    ? 'start'
                    : horizontal === 'right' || horizontal === 'end'
                      ? 'end'
                      : 'middle',
            baseline:
                vertical === 'top'
                    ? 'hanging'
                    : vertical === 'bottom'
                      ? 'text-after-edge'
                      : 'central'
        }
    }

    /**
     * Builds SVG rect attributes.
     * @param {object} rect Rect model.
     * @param {number | null | undefined} borderWidth Border width.
     * @param {{ formatNumber: (value: number) => string }} formatters Formatting helpers.
     * @returns {string}
     */
    static #rectAttributes(rect, borderWidth, formatters) {
        const attributes = [
            ['x', rect.x],
            ['y', rect.y],
            ['width', rect.width],
            ['height', rect.height]
        ].map(
            ([name, value]) =>
                name + '="' + formatters.formatNumber(value) + '"'
        )
        if (borderWidth !== null && borderWidth !== undefined) {
            attributes.push(
                'stroke-width="' + formatters.formatNumber(borderWidth) + '"'
            )
        }
        return attributes.join(' ')
    }

    /**
     * Builds an optional font-size attribute.
     * @param {number | null} fontSize Font size.
     * @param {{ formatNumber: (value: number) => string }} formatters Formatting helpers.
     * @returns {string}
     */
    static #fontSizeAttribute(fontSize, formatters) {
        return fontSize === null
            ? ''
            : ' font-size="' + formatters.formatNumber(fontSize) + '"'
    }

    /**
     * Resolves a rectangle from center/size or anchor metadata.
     * @param {object} element Element row.
     * @param {number} [fallbackWidth] Fallback width.
     * @param {number} [fallbackHeight] Fallback height.
     * @returns {object | null}
     */
    static #rect(element, fallbackWidth = 0, fallbackHeight = 0) {
        const size = CircuitJsonSchematicTableSvgRenderer.#size(
            element,
            fallbackWidth,
            fallbackHeight
        )
        const anchor =
            CircuitJsonUnits.optionalPoint(element.anchor_position) || null
        if (size && anchor) {
            return CircuitJsonSchematicTableSvgRenderer.#anchoredRect(
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
     * Resolves a width/height pair.
     * @param {object} element Element row.
     * @param {number} fallbackWidth Fallback width.
     * @param {number} fallbackHeight Fallback height.
     * @returns {{ width: number, height: number } | null}
     */
    static #size(element, fallbackWidth, fallbackHeight) {
        const size = CircuitJsonUnits.optionalSize(element.size || element)
        const width = size?.width ?? fallbackWidth
        const height = size?.height ?? fallbackHeight
        if (width <= 0 || height <= 0) return null
        return { width, height }
    }

    /**
     * Builds an anchored rectangle.
     * @param {{ x: number, y: number }} point Anchor point.
     * @param {{ width: number, height: number }} size Size.
     * @param {unknown} anchor Anchor name.
     * @returns {object}
     */
    static #anchoredRect(point, size, anchor) {
        const text = String(anchor || 'top_left').toLowerCase()
        const x = text.includes('right')
            ? point.x - size.width
            : text.includes('center')
              ? point.x - size.width / 2
              : point.x
        const y = text.includes('bottom')
            ? point.y - size.height
            : text.includes('middle') || text === 'center'
              ? point.y - size.height / 2
              : point.y
        return { x, y, ...size }
    }

    /**
     * Resolves an array of positive lengths.
     * @param {unknown} value Length array candidate.
     * @returns {number[]}
     */
    static #lengths(value) {
        return (Array.isArray(value) ? value : [])
            .map((entry) =>
                CircuitJsonUnits.optionalLength(
                    entry?.width ?? entry?.height ?? entry
                )
            )
            .filter((entry) => entry !== null && entry > 0)
    }

    /**
     * Builds cumulative offsets for a length list.
     * @param {number[]} values Length values.
     * @returns {number[]}
     */
    static #offsets(values) {
        let total = 0
        return values.map((value) => {
            const offset = total
            total += value
            return offset
        })
    }

    /**
     * Sums numeric values.
     * @param {number[]} values Values.
     * @returns {number}
     */
    static #sum(values) {
        return values.reduce((total, value) => total + value, 0)
    }

    /**
     * Resolves a zero-based row or column index.
     * @param {unknown} value Index candidate.
     * @returns {number | null}
     */
    static #index(value) {
        const number = Number(value)
        return Number.isInteger(number) && number >= 0 ? number : null
    }

    /**
     * Resolves a positive row or column span.
     * @param {unknown} value Span candidate.
     * @returns {number}
     */
    static #span(value) {
        const number = Number(value)
        return Number.isInteger(number) && number > 0 ? number : 1
    }

    /**
     * Returns indexed element rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {string} type Element type.
     * @returns {object[]}
     */
    static #all(index, type) {
        return index.elementsByType.get(type) || []
    }
}

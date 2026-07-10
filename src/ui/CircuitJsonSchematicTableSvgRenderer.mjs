import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'
import { SchematicTableGeometry } from './SchematicTableGeometry.mjs'

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
        const tables = SchematicTableGeometry.models(index)
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
        const rect = SchematicTableGeometry.cellRect(element, table)
        if (!rect) return ''
        const text = SchematicTableGeometry.textPosition(element, table, rect)
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
     * Returns indexed element rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {string} type Element type.
     * @returns {object[]}
     */
    static #all(index, type) {
        return index.elementsByType.get(type) || []
    }
}

import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'
import { CircuitJsonSchematicSvgPrimitiveAttributes } from './CircuitJsonSchematicSvgPrimitiveAttributes.mjs'
import { SafeXmlText } from './SafeXmlText.mjs'

/** Renders hierarchical child-sheet symbols without treating them as pages. */
export class CircuitJsonSchematicSheetSymbolSvgRenderer {
    /**
     * Renders child-sheet symbols in their authored order.
     * @param {object[]} symbols Canonical sheet-symbol rows.
     * @returns {string} SVG group or an empty string.
     */
    static render(symbols) {
        const markup = (symbols || [])
            .map((symbol, index) => ({ symbol, index }))
            .sort(
                (left, right) =>
                    CircuitJsonSchematicSheetSymbolSvgRenderer.#order(
                        left.symbol
                    ) -
                        CircuitJsonSchematicSheetSymbolSvgRenderer.#order(
                            right.symbol
                        ) || left.index - right.index
            )
            .map(({ symbol }) =>
                CircuitJsonSchematicSheetSymbolSvgRenderer.#symbol(symbol)
            )
            .filter(Boolean)
        return markup.length
            ? '<g class="schematic-sheet-symbols">' + markup.join('') + '</g>'
            : ''
    }

    /**
     * Renders one child-sheet box and label.
     * @param {object} symbol Sheet-symbol row.
     * @returns {string} SVG markup or an empty string.
     */
    static #symbol(symbol) {
        const center = CircuitJsonUnits.optionalPoint(symbol.center)
        const size = CircuitJsonUnits.optionalSize(symbol)
        if (!center || !size || size.width <= 0 || size.height <= 0) return ''
        const sourceFileName = String(symbol.source_file_name || '')
        return (
            '<g class="schematic-sheet-symbol" data-schematic-sheet-symbol-id="' +
            SafeXmlText.escape(symbol.schematic_sheet_symbol_id || '') +
            '"' +
            (sourceFileName
                ? ' data-source-file-name="' +
                  SafeXmlText.escape(sourceFileName) +
                  '"'
                : '') +
            '><rect class="schematic-sheet-symbol__body" x="' +
            CircuitJsonSchematicSheetSymbolSvgRenderer.#number(
                center.x - size.width / 2
            ) +
            '" y="' +
            CircuitJsonSchematicSheetSymbolSvgRenderer.#number(
                center.y - size.height / 2
            ) +
            '" width="' +
            CircuitJsonSchematicSheetSymbolSvgRenderer.#number(size.width) +
            '" height="' +
            CircuitJsonSchematicSheetSymbolSvgRenderer.#number(size.height) +
            '"' +
            CircuitJsonSchematicSvgPrimitiveAttributes.attributes(symbol) +
            '></rect><text class="schematic-sheet-symbol__label" x="' +
            CircuitJsonSchematicSheetSymbolSvgRenderer.#number(center.x) +
            '" y="' +
            CircuitJsonSchematicSheetSymbolSvgRenderer.#number(center.y) +
            '" text-anchor="middle" dominant-baseline="central">' +
            SafeXmlText.escapeText(symbol.name || '') +
            '</text></g>'
        )
    }

    /**
     * Resolves one authored render order.
     * @param {object} symbol Sheet-symbol row.
     * @returns {number} Sort value.
     */
    static #order(symbol) {
        return Number.isSafeInteger(symbol?.render_order)
            ? symbol.render_order
            : Number.MAX_SAFE_INTEGER
    }

    /**
     * Formats one deterministic SVG number.
     * @param {number} value Number value.
     * @returns {string} SVG number.
     */
    static #number(value) {
        return Number(Number(value).toFixed(6)).toString()
    }
}

Object.freeze(CircuitJsonSchematicSheetSymbolSvgRenderer.prototype)
Object.freeze(CircuitJsonSchematicSheetSymbolSvgRenderer)

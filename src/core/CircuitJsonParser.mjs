import { CircuitJsonDocument } from './CircuitJsonDocument.mjs'
import { CircuitJsonBomBuilder } from './CircuitJsonBomBuilder.mjs'
import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonManufacturingBuilder } from './CircuitJsonManufacturingBuilder.mjs'
import { CircuitJsonSupportMatrixBuilder } from './CircuitJsonSupportMatrixBuilder.mjs'

/**
 * Parses standalone CircuitJSON files.
 */
export class CircuitJsonParser {
    /**
     * Parses standalone CircuitJSON text.
     * @param {string} text JSON text.
     * @param {{ fileName?: string }} [options] Parse metadata.
     * @returns {object[]}
     */
    static parseText(text, options = {}) {
        let parsed
        try {
            parsed = JSON.parse(String(text || ''))
        } catch (error) {
            throw new SyntaxError(
                'CircuitJSON file is not valid JSON: ' +
                    String(error?.message || error || 'Unknown error.')
            )
        }

        CircuitJsonDocument.assertModel(parsed)
        const index = CircuitJsonIndexer.index(parsed)
        return CircuitJsonDocument.attachMetadata(parsed, {
            fileName: options.fileName || '',
            fileType: 'circuitjson',
            kind: CircuitJsonParser.#resolveKind(index),
            diagnostics: index.diagnostics,
            bom: CircuitJsonBomBuilder.build(parsed),
            supportMatrix: CircuitJsonSupportMatrixBuilder.build(parsed),
            manufacturing: CircuitJsonManufacturingBuilder.build(parsed, index)
        })
    }

    /**
     * Parses standalone CircuitJSON bytes.
     * @param {ArrayBuffer | Uint8Array} bytes File bytes.
     * @param {{ fileName?: string }} [options] Parse metadata.
     * @returns {object[]}
     */
    static parseBytes(bytes, options = {}) {
        const view =
            bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
        const text = new TextDecoder().decode(view)
        return CircuitJsonParser.parseText(text, options)
    }

    /**
     * Resolves a broad document kind from available elements.
     * @param {{ elementsByType?: Map<string, object[]> }} index Model index.
     * @returns {string}
     */
    static #resolveKind(index) {
        if (index.elementsByType?.has('pcb_board')) return 'pcb'
        if (
            [...(index.elementsByType?.keys() || [])].some((type) =>
                String(type).startsWith('schematic_')
            )
        ) {
            return 'schematic'
        }

        return 'circuitjson'
    }
}

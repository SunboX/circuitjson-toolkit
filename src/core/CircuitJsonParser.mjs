import { CircuitJsonDocument } from './CircuitJsonDocument.mjs'

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
        return CircuitJsonDocument.attachMetadata(parsed, {
            fileName: options.fileName || '',
            fileType: 'circuitjson',
            kind: CircuitJsonParser.#resolveKind(parsed)
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
     * @param {object[]} model CircuitJSON model.
     * @returns {string}
     */
    static #resolveKind(model) {
        return model.some((element) => String(element?.type) === 'pcb_board')
            ? 'pcb'
            : 'circuitjson'
    }
}

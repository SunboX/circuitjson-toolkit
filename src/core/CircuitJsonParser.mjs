import { CircuitJsonBomBuilder } from './CircuitJsonBomBuilder.mjs'
import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonManufacturingBuilder } from './CircuitJsonManufacturingBuilder.mjs'
import { CircuitJsonSupportMatrixBuilder } from './CircuitJsonSupportMatrixBuilder.mjs'
import { Parser } from './Parser.mjs'
import { CircuitJsonLegacyModel } from './context/CircuitJsonLegacyModel.mjs'
import { CircuitJsonValidationProof } from './context/CircuitJsonValidationProof.mjs'

const SUPPORT_VARIANT_TYPES = new Set([
    'source_component',
    'pcb_board',
    'pcb_smtpad',
    'pcb_hole',
    'pcb_plated_hole',
    'pcb_solder_paste',
    'pcb_cutout',
    'pcb_copper_pour',
    'simulation_voltage_source',
    'simulation_current_source',
    'simulation_experiment'
])

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
        let document
        try {
            document = Parser.parse(
                {
                    fileName: options.fileName || '',
                    data: String(text || '')
                },
                { extensions: 'full' }
            )
        } catch (error) {
            throw CircuitJsonParser.#legacyError(error)
        }

        const parsed = CircuitJsonLegacyModel.create(document)
        const index = CircuitJsonIndexer.index(
            document.model,
            CircuitJsonValidationProof.indexOptions(document)
        )
        CircuitJsonLegacyModel.setPreparedIndex(parsed, index)
        return CircuitJsonLegacyModel.attachValidated(parsed, {
            fileName: options.fileName || '',
            fileType: 'circuitjson',
            kind: CircuitJsonParser.#resolveKind(index),
            diagnostics: structuredClone(index.diagnostics),
            bom: CircuitJsonBomBuilder.build(
                index.elementsByType.get('source_component') || []
            ),
            supportMatrix: CircuitJsonSupportMatrixBuilder.build(
                CircuitJsonParser.#supportElements(index)
            ),
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
     * Restores the source-derived exception type and invalid-JSON message.
     * @param {unknown} error Canonical parser failure.
     * @returns {Error} Legacy parser error.
     */
    static #legacyError(error) {
        const cause = error?.cause
        if (error?.code !== 'ERR_CIRCUITJSON_PARSE' || !cause) return error
        if (cause.name === 'SyntaxError') {
            return new SyntaxError(
                'CircuitJSON file is not valid JSON: ' + cause.message
            )
        }
        if (cause.name === 'TypeError') return new TypeError(cause.message)
        return new Error(cause.message)
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

    /**
     * Selects one presence row per type plus all variant-bearing rows.
     * @param {{ elementsByType?: Map<string, object[]> }} index Full element index.
     * @returns {object[]} Minimal support-matrix input with identical semantics.
     */
    static #supportElements(index) {
        const elements = []
        for (const [type, rows] of index.elementsByType || []) {
            if (!rows.length) continue
            if (SUPPORT_VARIANT_TYPES.has(type)) {
                elements.push(...rows)
            } else {
                elements.push(rows[0])
            }
        }
        return elements
    }
}

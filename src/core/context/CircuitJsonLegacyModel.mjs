import { CircuitJsonValidationProof } from './CircuitJsonValidationProof.mjs'

const PROVEN_SOURCES = new WeakMap()
const PREPARED_INDEXES = new WeakMap()

/**
 * Owns the temporary hybrid-array migration view without repeating validation.
 */
export class CircuitJsonLegacyModel {
    /**
     * Creates a mutable metadata envelope over proven immutable elements.
     * @param {Record<string, any>} document Proven canonical document.
     * @returns {object[]} Fresh legacy array view.
     */
    static create(document) {
        if (!CircuitJsonValidationProof.has(document)) {
            throw new TypeError(
                'Legacy CircuitJSON views require a validated document.'
            )
        }
        const view = [...document.model]
        PROVEN_SOURCES.set(view, document.model)
        return view
    }

    /**
     * Attaches metadata after public validation has already succeeded.
     * @template {object[]} T
     * @param {T} model Validated CircuitJSON model.
     * @param {Record<string, any>} metadata Legacy metadata fields.
     * @returns {T} The supplied hybrid model.
     */
    static attachValidated(model, metadata) {
        Object.defineProperties(model, {
            fileName: CircuitJsonLegacyModel.#property(
                String(metadata.fileName || '')
            ),
            fileType: CircuitJsonLegacyModel.#property(
                String(metadata.fileType || 'circuitjson')
            ),
            kind: CircuitJsonLegacyModel.#property(
                String(metadata.kind || 'pcb')
            ),
            sourceFormat: CircuitJsonLegacyModel.#property('circuitjson'),
            diagnostics: CircuitJsonLegacyModel.#property(
                Array.isArray(metadata.diagnostics) ? metadata.diagnostics : []
            ),
            bom: CircuitJsonLegacyModel.#property(
                Array.isArray(metadata.bom) ? metadata.bom : []
            ),
            supportMatrix: CircuitJsonLegacyModel.#property(
                metadata.supportMatrix || null
            ),
            manufacturing: CircuitJsonLegacyModel.#property(
                metadata.manufacturing || {
                    pickAndPlaceRows: [],
                    routingDsn: ''
                }
            )
        })
        return model
    }

    /**
     * Returns whether a legacy view still exactly references its proven model.
     * @param {unknown} model Legacy model candidate.
     * @returns {boolean} Whether element validation may be reused.
     */
    static permitsIndex(model) {
        return CircuitJsonLegacyModel.#matches(model)
    }

    /**
     * Stores an unexposed full index for the next legacy consumer.
     * @param {object[]} model Owned legacy model view.
     * @param {Record<string, any>} index Full prepared index.
     * @returns {void}
     */
    static setPreparedIndex(model, index) {
        if (!CircuitJsonLegacyModel.#matches(model)) {
            throw new TypeError(
                'Prepared legacy indexes require an unchanged proven view.'
            )
        }
        PREPARED_INDEXES.set(model, { ...index, elements: model })
    }

    /**
     * Takes a full index once when its legacy model is still unchanged.
     * @param {unknown} model Legacy model candidate.
     * @returns {Record<string, any> | null} Prepared index or null.
     */
    static takePreparedIndex(model) {
        const index = PREPARED_INDEXES.get(model)
        if (!index) return null
        PREPARED_INDEXES.delete(model)
        return CircuitJsonLegacyModel.#matches(model) ? index : null
    }

    /**
     * Returns whether a legacy view still has its original dense element slots.
     * @param {unknown} model Legacy model candidate.
     * @returns {boolean} Whether the proof-bound elements are unchanged.
     */
    static #matches(model) {
        if (!Array.isArray(model)) return false
        const source = PROVEN_SOURCES.get(model)
        if (
            !source ||
            Object.getPrototypeOf(model) !== Array.prototype ||
            model.length !== source.length
        ) {
            return false
        }
        for (let index = 0; index < source.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(
                model,
                String(index)
            )
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.value !== source[index]
            ) {
                return false
            }
        }
        return true
    }

    /**
     * Creates one writable enumerable configurable metadata descriptor.
     * @param {unknown} value Property value.
     * @returns {PropertyDescriptor} Property descriptor.
     */
    static #property(value) {
        return {
            configurable: true,
            enumerable: true,
            value,
            writable: true
        }
    }
}

Object.freeze(CircuitJsonLegacyModel.prototype)
Object.freeze(CircuitJsonLegacyModel)

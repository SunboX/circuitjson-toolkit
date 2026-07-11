import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonLegacyNormalizer } from './context/CircuitJsonLegacyNormalizer.mjs'

/**
 * Builds PCB primitive element indexes with a tolerant local fallback.
 */
export class CircuitJsonPcbPrimitiveIndex {
    /**
     * Builds an element index while tolerating newer drawable row types.
     * @param {object[]} elements CircuitJSON elements.
     * @returns {{ elements: object[], elementsByType: Map<string, object[]>, sourceComponentById: Map<string, object>, pcbComponentById: Map<string, object> }}
     */
    static build(elements) {
        try {
            return CircuitJsonIndexer.index(elements)
        } catch (error) {
            const normalized = CircuitJsonLegacyNormalizer.normalize(elements)
            if (normalized === elements) {
                if (CircuitJsonPcbPrimitiveIndex.#isUnknownTypeError(error)) {
                    return CircuitJsonPcbPrimitiveIndex.#localIndex(elements)
                }
                throw error
            }
            try {
                return CircuitJsonIndexer.index(normalized)
            } catch (normalizedError) {
                if (
                    CircuitJsonPcbPrimitiveIndex.#isUnknownTypeError(
                        normalizedError
                    )
                ) {
                    return CircuitJsonPcbPrimitiveIndex.#localIndex(normalized)
                }
                throw normalizedError
            }
        }
    }

    /**
     * Returns true when a validator error is limited to a newer type name.
     * @param {unknown} error Candidate error.
     * @returns {boolean}
     */
    static #isUnknownTypeError(error) {
        return /Unsupported CircuitJSON element type:/u.test(
            String(error?.message || '')
        )
    }

    /**
     * Builds the subset of index data required by PCB primitive projection.
     * @param {object[]} elements CircuitJSON elements.
     * @returns {{ elements: object[], elementsByType: Map<string, object[]>, sourceComponentById: Map<string, object>, pcbComponentById: Map<string, object> }}
     */
    static #localIndex(elements) {
        const index = {
            elements,
            elementsByType: new Map(),
            sourceComponentById: new Map(),
            pcbComponentById: new Map()
        }

        for (const element of elements) {
            const type = String(element?.type || '')
            if (!index.elementsByType.has(type)) {
                index.elementsByType.set(type, [])
            }
            index.elementsByType.get(type).push(element)

            const id = CircuitJsonIndexer.getElementId(element)
            if (type === 'source_component' && id) {
                index.sourceComponentById.set(id, element)
            }
            if (type === 'pcb_component' && id) {
                index.pcbComponentById.set(id, element)
            }
        }

        return index
    }
}

import { CircuitJsonSourceMetadata } from './CircuitJsonSourceMetadata.mjs'

/**
 * Builds app-compatible BOM rows from source component elements.
 */
export class CircuitJsonBomBuilder {
    /**
     * Builds grouped BOM rows from a CircuitJSON element array.
     * @param {object[]} circuitJson CircuitJSON model.
     * @returns {object[]}
     */
    static build(circuitJson) {
        const groups = new Map()
        for (const component of circuitJson || []) {
            if (component?.type !== 'source_component') continue
            const designator = CircuitJsonBomBuilder.#designator(component)
            if (!designator) continue

            const metadata =
                CircuitJsonSourceMetadata.normalizeSourceComponent(component)
            const key = CircuitJsonBomBuilder.#groupKey(component, metadata)
            if (!groups.has(key)) {
                groups.set(key, {
                    designators: [],
                    quantity: 0,
                    value: CircuitJsonBomBuilder.#value(component),
                    pattern: CircuitJsonBomBuilder.#pattern(
                        component,
                        metadata
                    ),
                    source: CircuitJsonBomBuilder.#source(component),
                    supplierPartNumber: metadata.supplierPartNumber,
                    supplierPartNumbers: metadata.supplierPartNumbers,
                    sourceFtype: metadata.sourceFtype,
                    componentType: metadata.componentType,
                    componentIcon: metadata.componentIcon
                })
            }
            const row = groups.get(key)
            row.designators.push(designator)
            row.quantity = row.designators.length
        }

        return [...groups.values()].map((row) => ({
            ...row,
            designators: row.designators.sort(
                CircuitJsonBomBuilder.#compareDesignators
            )
        }))
    }

    /**
     * Resolves the display designator for one source component.
     * @param {object} component Source component.
     * @returns {string}
     */
    static #designator(component) {
        return String(
            component.name ||
                component.reference ||
                component.designator ||
                component.source_component_id ||
                ''
        ).trim()
    }

    /**
     * Builds a stable grouping key from BOM-facing fields.
     * @param {object} component Source component.
     * @param {object} metadata Normalized source metadata.
     * @returns {string}
     */
    static #groupKey(component, metadata) {
        return [
            CircuitJsonBomBuilder.#value(component),
            CircuitJsonBomBuilder.#pattern(component, metadata),
            CircuitJsonBomBuilder.#source(component),
            metadata.supplierPartNumber,
            metadata.sourceFtype
        ].join('\u001f')
    }

    /**
     * Resolves a BOM value from common source component fields.
     * @param {object} component Source component.
     * @returns {string}
     */
    static #value(component) {
        return String(
            component.value ??
                component.resistance ??
                component.capacitance ??
                component.inductance ??
                component.frequency ??
                component.voltage ??
                ''
        ).trim()
    }

    /**
     * Resolves a footprint/package pattern label.
     * @param {object} component Source component.
     * @param {object} metadata Normalized source metadata.
     * @returns {string}
     */
    static #pattern(component, metadata) {
        return String(
            component.footprint ??
                component.package ??
                component.package_name ??
                metadata.sourceFtype ??
                ''
        ).trim()
    }

    /**
     * Resolves manufacturer or catalog source text.
     * @param {object} component Source component.
     * @returns {string}
     */
    static #source(component) {
        return String(
            component.manufacturer_part_number ??
                component.mpn ??
                component.part_number ??
                component.supplier_part_number ??
                ''
        ).trim()
    }

    /**
     * Compares designators using natural ordering.
     * @param {string} left Left designator.
     * @param {string} right Right designator.
     * @returns {number}
     */
    static #compareDesignators(left, right) {
        return String(left).localeCompare(String(right), undefined, {
            numeric: true,
            sensitivity: 'base'
        })
    }
}

import { CircuitJsonBomBuilder } from '../CircuitJsonBomBuilder.mjs'
import { CanonicalBomOrder } from './CanonicalBomOrder.mjs'

/**
 * Normalizes deterministic canonical BOM presentation without changing legacy grouping.
 */
export class CanonicalBomRows {
    /**
     * Builds stable rows while keeping canonical electrical values as group identity.
     * @param {object[]} model CircuitJSON model.
     * @returns {object[]} Canonical BOM rows.
     */
    static build(model) {
        const labelsByDesignator = new Map()
        for (const element of model || []) {
            if (element?.type !== 'source_component') continue
            const designator = CanonicalBomRows.#designator(element)
            if (!designator) continue
            const label = CanonicalBomRows.#displayValue(element)
            if (!label) continue
            const state = labelsByDesignator.get(designator)
            if (!state) {
                labelsByDesignator.set(designator, {
                    label,
                    ambiguous: false
                })
            } else if (state.label !== label) {
                state.ambiguous = true
            }
        }
        return CircuitJsonBomBuilder.build(model)
            .map((row) => {
                const designators = [...row.designators].sort(
                    CanonicalBomOrder.compareDesignators
                )
                let displayLabel = ''
                let ambiguous = false
                for (const designator of designators) {
                    const state = labelsByDesignator.get(designator)
                    if (!state) continue
                    if (
                        state.ambiguous ||
                        (displayLabel && displayLabel !== state.label)
                    ) {
                        ambiguous = true
                        break
                    }
                    displayLabel = state.label
                }
                return {
                    ...row,
                    designators,
                    value:
                        displayLabel && !ambiguous
                            ? displayLabel
                            : String(row.value)
                }
            })
            .sort(CanonicalBomOrder.compareRows)
    }

    /**
     * Resolves the designator used by the legacy BOM grouping contract.
     * @param {object} component Source component.
     * @returns {string} Designator.
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
     * Resolves standard display-only electrical fields.
     * @param {object} component Source component.
     * @returns {string} Display label.
     */
    static #displayValue(component) {
        return String(
            component.display_value ??
                component.display_resistance ??
                component.display_capacitance ??
                component.display_inductance ??
                component.display_max_resistance ??
                ''
        ).trim()
    }
}

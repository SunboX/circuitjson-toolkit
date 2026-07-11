/**
 * Normalizes CircuitJSON warning and error elements for shared indexes.
 */
export class CircuitJsonDiagnosticIndexer {
    /**
     * Returns true when an element is a warning or error row.
     * @param {object} element Element.
     * @returns {boolean}
     */
    static isElement(element) {
        return (
            CircuitJsonDiagnosticIndexer.isType(String(element?.type || '')) ||
            Boolean(element?.error_type || element?.warning_type)
        )
    }

    /**
     * Returns true for upstream warning and error discriminants.
     * @param {string} type Element type.
     * @returns {boolean}
     */
    static isType(type) {
        return (
            type.includes('error') ||
            type.endsWith('_warning') ||
            type === 'source_ambiguous_port_reference'
        )
    }

    /**
     * Builds one normalized diagnostic.
     * @param {object} element Diagnostic element.
     * @param {string} elementId Stable element id.
     * @returns {object}
     */
    static fromElement(element, elementId) {
        const type = String(
            element?.error_type || element?.warning_type || element?.type || ''
        )
        return {
            severity: element?.warning_type ? 'warning' : 'error',
            sourceFormat: 'circuitjson',
            type,
            category: CircuitJsonDiagnosticIndexer.#category(type),
            message: String(element?.message || type || 'CircuitJSON issue'),
            elementId,
            ...CircuitJsonDiagnosticIndexer.#relations(element)
        }
    }

    /**
     * Extracts optional relation ids from one diagnostic element.
     * @param {object} element Diagnostic element.
     * @returns {object}
     */
    static #relations(element) {
        const scalar = Object.fromEntries(
            [
                ['sourceComponentId', element?.source_component_id],
                ['sourcePortId', element?.source_port_id],
                ['sourceNetId', element?.source_net_id],
                ['sourceTraceId', element?.source_trace_id],
                ['pcbComponentId', element?.pcb_component_id],
                ['pcbPortId', element?.pcb_port_id],
                ['pcbTraceId', element?.pcb_trace_id],
                ['pcbSmtpadId', element?.pcb_smtpad_id],
                ['pcbViaId', element?.pcb_via_id],
                ['pcbPlatedHoleId', element?.pcb_plated_hole_id],
                ['pcbHoleId', element?.pcb_hole_id],
                ['schematicComponentId', element?.schematic_component_id],
                ['schematicSymbolId', element?.schematic_symbol_id],
                ['schematicPortId', element?.schematic_port_id]
            ]
                .map(([key, value]) => [key, String(value || '').trim()])
                .filter(([_key, value]) => value)
        )
        const plural = Object.fromEntries(
            [
                [
                    'sourceComponentIds',
                    element?.source_component_ids,
                    element?.source_component_id
                ],
                [
                    'sourcePortIds',
                    element?.source_port_ids,
                    element?.source_port_id
                ],
                [
                    'sourceNetIds',
                    element?.source_net_ids,
                    element?.source_net_id
                ],
                [
                    'sourceTraceIds',
                    element?.source_trace_ids,
                    element?.source_trace_id
                ],
                [
                    'pcbComponentIds',
                    element?.pcb_component_ids,
                    element?.pcb_component_id
                ],
                ['pcbPortIds', element?.pcb_port_ids, element?.pcb_port_id],
                ['pcbTraceIds', element?.pcb_trace_ids, element?.pcb_trace_id],
                [
                    'pcbPadIds',
                    element?.pcb_pad_ids ?? element?.pcb_smtpad_ids,
                    element?.pcb_pad_id ?? element?.pcb_smtpad_id
                ],
                ['pcbViaIds', element?.pcb_via_ids, element?.pcb_via_id],
                [
                    'pcbPlatedHoleIds',
                    element?.pcb_plated_hole_ids,
                    element?.pcb_plated_hole_id
                ],
                ['pcbHoleIds', element?.pcb_hole_ids, element?.pcb_hole_id]
            ]
                .map(([key, values, singular]) => {
                    const ids = Array.isArray(values)
                        ? [...new Set(values.map(String).filter(Boolean))]
                        : []
                    const singularId = String(singular || '').trim()
                    return [
                        key,
                        ids.length === 1 && ids[0] === singularId ? [] : ids
                    ]
                })
                .filter(([_key, values]) => values.length)
        )
        return { ...scalar, ...plural }
    }

    /**
     * Resolves a broad diagnostic category.
     * @param {string} type Diagnostic type or code.
     * @returns {string}
     */
    static #category(type) {
        const text = String(type || '').toLowerCase()
        if (text.includes('clearance')) return 'clearance'
        if (text.includes('autorouting') || text.includes('trace_error')) {
            return 'routing'
        }
        if (text.includes('placement') || text.includes('outside_board')) {
            return 'placement'
        }
        if (
            text.includes('trace_missing') ||
            text.includes('not_connected') ||
            text.includes('missing_trace') ||
            text.includes('pin_missing_trace') ||
            text.includes('pin_must_be_connected')
        ) {
            return 'connectivity'
        }
        if (text.includes('layout')) return 'layout'
        if (text.includes('simulation')) return 'simulation'
        if (text.includes('footprint')) return 'footprint'
        if (
            text.includes('pin_defined') ||
            text.includes('pins_underspecified') ||
            text.includes('ground_pin') ||
            text.includes('power_pin')
        ) {
            return 'pin-definition'
        }
        if (
            text.includes('manufacturer_part') ||
            text.includes('missing_property') ||
            text.includes('property_ignored')
        ) {
            return 'metadata'
        }
        if (text.includes('manual_edit_conflict')) return 'edit-conflict'
        if (text.includes('property') || text.includes('misconfigured')) {
            return 'configuration'
        }
        return 'general'
    }
}

Object.freeze(CircuitJsonDiagnosticIndexer.prototype)
Object.freeze(CircuitJsonDiagnosticIndexer)

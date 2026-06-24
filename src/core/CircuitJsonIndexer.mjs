import { CircuitJsonDocument } from './CircuitJsonDocument.mjs'

const ID_FIELDS_BY_TYPE = {
    pcb_board: 'pcb_board_id',
    pcb_component: 'pcb_component_id',
    pcb_group: 'pcb_group_id',
    pcb_hole: 'pcb_hole_id',
    pcb_plated_hole: 'pcb_plated_hole_id',
    pcb_port: 'pcb_port_id',
    pcb_smtpad: 'pcb_smtpad_id',
    pcb_trace: 'pcb_trace_id',
    pcb_via: 'pcb_via_id',
    schematic_group: 'schematic_group_id',
    source_component: 'source_component_id',
    source_group: 'source_group_id',
    source_net: 'source_net_id',
    source_port: 'source_port_id',
    source_trace: 'source_trace_id'
}

const GROUP_TYPES = new Set(['source_group', 'pcb_group', 'schematic_group'])

/**
 * Builds lookup maps for CircuitJSON element arrays.
 */
export class CircuitJsonIndexer {
    /**
     * Indexes a CircuitJSON model.
     * @param {object[]} circuitJson CircuitJSON model.
     * @returns {{ elements: object[], elementsByType: Map<string, object[]>, elementsById: Map<string, object>, relationsByField: Map<string, Map<string, object[]>>, sourceComponentById: Map<string, object>, pcbComponentById: Map<string, object>, componentsBySourceId: Map<string, object>, groupsById: Map<string, object>, elementsByGroupId: Map<string, object[]>, elementsBySubcircuitId: Map<string, object[]>, diagnostics: object[] }}
     */
    static index(circuitJson) {
        CircuitJsonDocument.assertModel(circuitJson)
        const elementsByType = new Map()
        const elementsById = new Map()
        const relationsByField = new Map()
        const sourceComponentById = new Map()
        const pcbComponentById = new Map()

        circuitJson.forEach((element) => {
            const type = String(element?.type || '')
            if (!elementsByType.has(type)) {
                elementsByType.set(type, [])
            }
            elementsByType.get(type).push(element)

            const id = CircuitJsonIndexer.getElementId(element)
            if (id) {
                elementsById.set(`${type}:${id}`, element)
            }
            if (type === 'source_component' && id) {
                sourceComponentById.set(id, element)
            }
            if (type === 'pcb_component' && id) {
                pcbComponentById.set(id, element)
            }
            CircuitJsonIndexer.#indexRelations(element, relationsByField)
        })

        return {
            elements: circuitJson,
            elementsByType,
            elementsById,
            relationsByField,
            sourceComponentById,
            pcbComponentById,
            componentsBySourceId: CircuitJsonIndexer.#componentsBySourceId(
                sourceComponentById,
                relationsByField
            ),
            groupsById: CircuitJsonIndexer.#groupsById(circuitJson),
            elementsByGroupId:
                CircuitJsonIndexer.#elementsByGroupId(circuitJson),
            elementsBySubcircuitId:
                CircuitJsonIndexer.#elementsBySubcircuitId(circuitJson),
            diagnostics: CircuitJsonIndexer.collectDiagnostics(circuitJson)
        }
    }

    /**
     * Resolves the primary id for one element.
     * @param {object} element Element.
     * @returns {string}
     */
    static getElementId(element) {
        const type = String(element?.type || '')
        const idField = ID_FIELDS_BY_TYPE[type] || type + '_id'
        return String(element?.[idField] || '').trim()
    }

    /**
     * Collects normalized diagnostic rows from warning and error elements.
     * @param {object[]} circuitJson CircuitJSON model.
     * @returns {object[]}
     */
    static collectDiagnostics(circuitJson) {
        CircuitJsonDocument.assertModel(circuitJson)
        return circuitJson
            .filter((element) => CircuitJsonIndexer.#isDiagnostic(element))
            .map((element) => CircuitJsonIndexer.#diagnostic(element))
    }

    /**
     * Adds relation fields from one element into lookup maps.
     * @param {object} element Element.
     * @param {Map<string, Map<string, object[]>>} relationsByField Relation map.
     * @returns {void}
     */
    static #indexRelations(element, relationsByField) {
        const primaryIdField =
            ID_FIELDS_BY_TYPE[String(element?.type || '')] ||
            String(element?.type || '') + '_id'
        for (const [field, value] of Object.entries(element || {})) {
            if (!field.endsWith('_id') && !field.endsWith('_ids')) continue
            if (field === primaryIdField) continue

            if (!relationsByField.has(field)) {
                relationsByField.set(field, new Map())
            }
            const byValue = relationsByField.get(field)
            for (const relationValue of CircuitJsonIndexer.#relationValues(
                value
            )) {
                if (!byValue.has(relationValue)) {
                    byValue.set(relationValue, [])
                }
                byValue.get(relationValue).push(element)
            }
        }
    }

    /**
     * Returns normalized relation values from scalar or array fields.
     * @param {unknown} value Relation value.
     * @returns {string[]}
     */
    static #relationValues(value) {
        const values = Array.isArray(value) ? value : [value]
        return values.map((entry) => String(entry || '').trim()).filter(Boolean)
    }

    /**
     * Builds component bundles keyed by source component id.
     * @param {Map<string, object>} sourceComponentById Source component lookup.
     * @param {Map<string, Map<string, object[]>>} relationsByField Relation map.
     * @returns {Map<string, object>}
     */
    static #componentsBySourceId(sourceComponentById, relationsByField) {
        const bySource = new Map()
        const sourceRelations =
            relationsByField.get('source_component_id') || new Map()

        for (const [sourceId, sourceComponent] of sourceComponentById) {
            const linked = sourceRelations.get(sourceId) || []
            bySource.set(sourceId, {
                sourceComponent,
                sourcePorts: linked.filter(
                    (element) => element?.type === 'source_port'
                ),
                pcbComponents: linked.filter(
                    (element) => element?.type === 'pcb_component'
                ),
                schematicComponents: linked.filter(
                    (element) => element?.type === 'schematic_component'
                )
            })
        }

        return bySource
    }

    /**
     * Builds group rows keyed by group id.
     * @param {object[]} elements Element rows.
     * @returns {Map<string, object>}
     */
    static #groupsById(elements) {
        const elementsByGroupId =
            CircuitJsonIndexer.#elementsByGroupId(elements)
        const groups = new Map()
        for (const element of elements) {
            if (!GROUP_TYPES.has(String(element?.type || ''))) continue
            const id = CircuitJsonIndexer.getElementId(element)
            if (!id) continue
            groups.set(id, {
                id,
                type: String(element.type || ''),
                name: String(element.name || id),
                group: element,
                members: elementsByGroupId.get(id) || []
            })
        }
        return groups
    }

    /**
     * Builds element membership by group id.
     * @param {object[]} elements Element rows.
     * @returns {Map<string, object[]>}
     */
    static #elementsByGroupId(elements) {
        const byGroupId = new Map()
        for (const element of elements) {
            if (GROUP_TYPES.has(String(element?.type || ''))) continue
            for (const groupId of CircuitJsonIndexer.#groupIds(element)) {
                if (!byGroupId.has(groupId)) byGroupId.set(groupId, [])
                byGroupId.get(groupId).push(element)
            }
        }
        return byGroupId
    }

    /**
     * Builds elements by subcircuit id.
     * @param {object[]} elements Element rows.
     * @returns {Map<string, object[]>}
     */
    static #elementsBySubcircuitId(elements) {
        const bySubcircuitId = new Map()
        for (const element of elements) {
            const id = String(element?.subcircuit_id || '').trim()
            if (!id) continue
            if (!bySubcircuitId.has(id)) bySubcircuitId.set(id, [])
            bySubcircuitId.get(id).push(element)
        }
        return bySubcircuitId
    }

    /**
     * Resolves group ids from common group fields.
     * @param {object} element Element row.
     * @returns {string[]}
     */
    static #groupIds(element) {
        return [
            element?.source_group_id,
            element?.pcb_group_id,
            element?.schematic_group_id,
            element?.group_id,
            ...(Array.isArray(element?.group_ids) ? element.group_ids : [])
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    }

    /**
     * Returns true when an element is a warning or error row.
     * @param {object} element Element.
     * @returns {boolean}
     */
    static #isDiagnostic(element) {
        const type = String(element?.type || '')
        return (
            type.endsWith('_error') ||
            type.endsWith('_warning') ||
            Boolean(element?.error_type || element?.warning_type)
        )
    }

    /**
     * Builds one normalized diagnostic.
     * @param {object} element Diagnostic element.
     * @returns {object}
     */
    static #diagnostic(element) {
        const type = String(
            element?.error_type || element?.warning_type || element?.type || ''
        )
        return {
            severity: element?.warning_type ? 'warning' : 'error',
            sourceFormat: 'circuitjson',
            type,
            category: CircuitJsonIndexer.#diagnosticCategory(type),
            message: String(element?.message || type || 'CircuitJSON issue'),
            elementId: CircuitJsonIndexer.getElementId(element)
        }
    }

    /**
     * Resolves a broad diagnostic category.
     * @param {string} type Diagnostic type or code.
     * @returns {string}
     */
    static #diagnosticCategory(type) {
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

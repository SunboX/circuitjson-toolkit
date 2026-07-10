import { CircuitJsonDocument } from './CircuitJsonDocument.mjs'
import { CircuitJsonValidationProof } from './context/CircuitJsonValidationProof.mjs'

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
const SCHEMATIC_PRIMITIVE_TYPES = new Set([
    'schematic_arc',
    'schematic_box',
    'schematic_circle',
    'schematic_line',
    'schematic_net_label',
    'schematic_path',
    'schematic_rect',
    'schematic_table',
    'schematic_table_cell',
    'schematic_text',
    'schematic_trace',
    'schematic_voltage_probe'
])

/**
 * Builds lookup maps for CircuitJSON element arrays.
 */
export class CircuitJsonIndexer {
    /**
     * Indexes a CircuitJSON model.
     * @param {object[]} circuitJson CircuitJSON model.
     * @param {{ validated?: boolean, families?: string[] | null }} [options] Internal validation options.
     * @returns {Record<string, any>} Full legacy index or requested index families.
     */
    static index(circuitJson, options = {}) {
        const trusted = CircuitJsonValidationProof.permitsIndex(
            circuitJson,
            options
        )
        if (!trusted) {
            CircuitJsonDocument.assertModel(circuitJson)
        }
        const families = trusted
            ? CircuitJsonValidationProof.indexFamilies(circuitJson, options)
            : null
        const requested = new Set(families || [])
        const full = families === null
        const wants = (name) => full || requested.has(name)
        const buildElements = wants('elements')
        const buildRelations = wants('relations')
        const buildConnectivity = wants('connectivity')
        const elementsByType = new Map()
        const elementsById = new Map()
        const relationsByField = new Map()
        const sourceComponentById = new Map()
        const pcbComponentById = new Map()
        const sourceTraceById = new Map()

        if (buildElements || buildRelations || buildConnectivity) {
            circuitJson.forEach((element) => {
                const type = String(element?.type || '')
                const id = CircuitJsonIndexer.getElementId(element)
                if (buildElements || buildConnectivity) {
                    if (!elementsByType.has(type)) {
                        elementsByType.set(type, [])
                    }
                    elementsByType.get(type).push(element)
                }
                if (buildElements && id) {
                    elementsById.set(`${type}:${id}`, element)
                }
                if ((buildElements || buildRelations) && id) {
                    if (type === 'source_component') {
                        sourceComponentById.set(id, element)
                    }
                    if (buildElements && type === 'pcb_component') {
                        pcbComponentById.set(id, element)
                    }
                }
                if ((buildElements || buildConnectivity) && id) {
                    if (type === 'source_trace') {
                        sourceTraceById.set(id, element)
                    }
                }
                if (buildRelations) {
                    CircuitJsonIndexer.#indexRelations(
                        element,
                        relationsByField
                    )
                }
            })
        }

        const result = {}
        if (buildElements || wants('spatial')) {
            result.elements = circuitJson
        }
        if (buildElements) {
            Object.assign(result, {
                elementsByType,
                elementsById,
                sourceComponentById,
                pcbComponentById,
                sourceTraceById
            })
        }
        if (buildRelations) {
            Object.assign(result, {
                relationsByField,
                componentsBySourceId: CircuitJsonIndexer.#componentsBySourceId(
                    sourceComponentById,
                    relationsByField
                ),
                groupsById: CircuitJsonIndexer.#groupsById(circuitJson),
                elementsByGroupId:
                    CircuitJsonIndexer.#elementsByGroupId(circuitJson),
                elementsBySubcircuitId:
                    CircuitJsonIndexer.#elementsBySubcircuitId(circuitJson)
            })
        }
        if (buildConnectivity) {
            const sourceTraceConnectivity =
                CircuitJsonIndexer.#sourceTraceConnectivity(sourceTraceById)
            Object.assign(result, {
                sourceTraceById,
                sourceTraceConnectivity,
                diagnostics: [
                    ...CircuitJsonIndexer.#collectDiagnostics(circuitJson),
                    ...CircuitJsonIndexer.#referenceDiagnostics(
                        elementsByType,
                        sourceTraceById,
                        sourceTraceConnectivity
                    )
                ]
            })
        }
        return result
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
        return CircuitJsonIndexer.#collectDiagnostics(circuitJson)
    }

    /**
     * Collects normalized diagnostic rows from an already validated model.
     * @param {object[]} circuitJson CircuitJSON model.
     * @returns {object[]}
     */
    static #collectDiagnostics(circuitJson) {
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
        const values = Array.isArray(value)
            ? value.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
            : [value]
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
     * Builds connectivity summaries keyed by source trace id.
     * @param {Map<string, object>} sourceTraceById Source trace lookup.
     * @returns {Map<string, object>}
     */
    static #sourceTraceConnectivity(sourceTraceById) {
        const connectivity = new Map()
        for (const [sourceTraceId, sourceTrace] of sourceTraceById) {
            connectivity.set(sourceTraceId, {
                sourceTraceId,
                connectedSourcePortIds: CircuitJsonIndexer.#relationValues([
                    sourceTrace.connected_source_port_id,
                    sourceTrace.source_port_id,
                    sourceTrace.connected_source_port_ids,
                    sourceTrace.source_port_ids
                ]),
                connectedSourceNetIds: CircuitJsonIndexer.#relationValues([
                    sourceTrace.connected_source_net_id,
                    sourceTrace.source_net_id,
                    sourceTrace.connected_source_net_ids,
                    sourceTrace.source_net_ids
                ])
            })
        }
        return connectivity
    }

    /**
     * Builds generated diagnostics for broken source-trace references.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {Map<string, object>} sourceTraceById Source trace lookup.
     * @param {Map<string, object>} sourceTraceConnectivity Connectivity lookup.
     * @returns {object[]}
     */
    static #referenceDiagnostics(
        elementsByType,
        sourceTraceById,
        sourceTraceConnectivity
    ) {
        const sourcePortIds = new Set(
            CircuitJsonIndexer.#all(elementsByType, 'source_port')
                .map((port) => String(port.source_port_id || '').trim())
                .filter(Boolean)
        )
        const sourceNetIds = new Set(
            CircuitJsonIndexer.#all(elementsByType, 'source_net')
                .map((net) => String(net.source_net_id || '').trim())
                .filter(Boolean)
        )
        const schematicSymbolIds = CircuitJsonIndexer.#elementIds(
            elementsByType,
            'schematic_symbol'
        )
        const schematicComponentIds = CircuitJsonIndexer.#elementIds(
            elementsByType,
            'schematic_component'
        )
        return [
            ...CircuitJsonIndexer.#missingSourceTracePortDiagnostics(
                sourceTraceConnectivity,
                sourcePortIds
            ),
            ...CircuitJsonIndexer.#missingSourceTraceNetDiagnostics(
                sourceTraceConnectivity,
                sourceNetIds
            ),
            ...CircuitJsonIndexer.#missingPcbSourceTraceDiagnostics(
                elementsByType,
                sourceTraceById
            ),
            ...CircuitJsonIndexer.#missingSchematicComponentSymbolDiagnostics(
                elementsByType,
                schematicSymbolIds
            ),
            ...CircuitJsonIndexer.#missingSchematicPortComponentDiagnostics(
                elementsByType,
                schematicComponentIds
            ),
            ...CircuitJsonIndexer.#missingSchematicPortSourcePortDiagnostics(
                elementsByType,
                sourcePortIds
            ),
            ...CircuitJsonIndexer.#missingSchematicPrimitiveDiagnostics(
                elementsByType,
                schematicSymbolIds,
                schematicComponentIds
            )
        ]
    }

    /**
     * Builds source-trace missing source-port diagnostics.
     * @param {Map<string, object>} sourceTraceConnectivity Connectivity lookup.
     * @param {Set<string>} sourcePortIds Known source port ids.
     * @returns {object[]}
     */
    static #missingSourceTracePortDiagnostics(
        sourceTraceConnectivity,
        sourcePortIds
    ) {
        return [...sourceTraceConnectivity.values()].flatMap((trace) =>
            trace.connectedSourcePortIds
                .filter((sourcePortId) => !sourcePortIds.has(sourcePortId))
                .map((sourcePortId) => ({
                    isGenerated: true,
                    severity: 'warning',
                    sourceFormat: 'circuitjson',
                    type: 'source_trace_missing_source_port_warning',
                    category: 'connectivity',
                    message:
                        'Source trace ' +
                        trace.sourceTraceId +
                        ' references missing source port ' +
                        sourcePortId +
                        '.',
                    elementId:
                        trace.sourceTraceId + ':missing-port:' + sourcePortId,
                    sourceTraceId: trace.sourceTraceId,
                    sourcePortId
                }))
        )
    }

    /**
     * Builds source-trace missing source-net diagnostics.
     * @param {Map<string, object>} sourceTraceConnectivity Connectivity lookup.
     * @param {Set<string>} sourceNetIds Known source net ids.
     * @returns {object[]}
     */
    static #missingSourceTraceNetDiagnostics(
        sourceTraceConnectivity,
        sourceNetIds
    ) {
        return [...sourceTraceConnectivity.values()].flatMap((trace) =>
            trace.connectedSourceNetIds
                .filter((sourceNetId) => !sourceNetIds.has(sourceNetId))
                .map((sourceNetId) => ({
                    isGenerated: true,
                    severity: 'warning',
                    sourceFormat: 'circuitjson',
                    type: 'source_trace_missing_source_net_warning',
                    category: 'connectivity',
                    message:
                        'Source trace ' +
                        trace.sourceTraceId +
                        ' references missing source net ' +
                        sourceNetId +
                        '.',
                    elementId:
                        trace.sourceTraceId + ':missing-net:' + sourceNetId,
                    sourceTraceId: trace.sourceTraceId,
                    sourceNetId
                }))
        )
    }

    /**
     * Builds PCB-trace missing source-trace diagnostics.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {Map<string, object>} sourceTraceById Source trace lookup.
     * @returns {object[]}
     */
    static #missingPcbSourceTraceDiagnostics(elementsByType, sourceTraceById) {
        return CircuitJsonIndexer.#all(elementsByType, 'pcb_trace')
            .map((trace) => ({
                pcbTraceId: String(trace.pcb_trace_id || '').trim(),
                sourceTraceId: String(trace.source_trace_id || '').trim()
            }))
            .filter(
                (trace) =>
                    trace.sourceTraceId &&
                    !sourceTraceById.has(trace.sourceTraceId)
            )
            .map((trace) => ({
                isGenerated: true,
                severity: 'warning',
                sourceFormat: 'circuitjson',
                type: 'pcb_trace_missing_source_trace_warning',
                category: 'connectivity',
                message:
                    'PCB trace ' +
                    trace.pcbTraceId +
                    ' references missing source trace ' +
                    trace.sourceTraceId +
                    '.',
                elementId:
                    trace.pcbTraceId +
                    ':missing-source-trace:' +
                    trace.sourceTraceId,
                sourceTraceId: trace.sourceTraceId,
                pcbTraceId: trace.pcbTraceId
            }))
    }

    /**
     * Builds schematic-component missing symbol diagnostics.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {Set<string>} schematicSymbolIds Known schematic symbol ids.
     * @returns {object[]}
     */
    static #missingSchematicComponentSymbolDiagnostics(
        elementsByType,
        schematicSymbolIds
    ) {
        return CircuitJsonIndexer.#all(elementsByType, 'schematic_component')
            .map((component) => ({
                schematicComponentId:
                    CircuitJsonIndexer.getElementId(component),
                schematicSymbolId: String(
                    component.schematic_symbol_id || ''
                ).trim()
            }))
            .filter(
                (component) =>
                    component.schematicSymbolId &&
                    !schematicSymbolIds.has(component.schematicSymbolId)
            )
            .map((component) => ({
                isGenerated: true,
                severity: 'warning',
                sourceFormat: 'circuitjson',
                type: 'schematic_component_missing_schematic_symbol_warning',
                category: 'layout',
                message:
                    'Schematic component ' +
                    component.schematicComponentId +
                    ' references missing schematic symbol ' +
                    component.schematicSymbolId +
                    '.',
                elementId:
                    component.schematicComponentId +
                    ':missing-symbol:' +
                    component.schematicSymbolId,
                schematicComponentId: component.schematicComponentId,
                schematicSymbolId: component.schematicSymbolId
            }))
    }

    /**
     * Builds schematic-port missing component diagnostics.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {Set<string>} schematicComponentIds Known schematic component ids.
     * @returns {object[]}
     */
    static #missingSchematicPortComponentDiagnostics(
        elementsByType,
        schematicComponentIds
    ) {
        return CircuitJsonIndexer.#all(elementsByType, 'schematic_port')
            .map((port) => ({
                schematicPortId: CircuitJsonIndexer.getElementId(port),
                schematicComponentId: String(
                    port.schematic_component_id || ''
                ).trim()
            }))
            .filter(
                (port) =>
                    port.schematicComponentId &&
                    !schematicComponentIds.has(port.schematicComponentId)
            )
            .map((port) => ({
                isGenerated: true,
                severity: 'warning',
                sourceFormat: 'circuitjson',
                type: 'schematic_port_missing_schematic_component_warning',
                category: 'layout',
                message:
                    'Schematic port ' +
                    port.schematicPortId +
                    ' references missing schematic component ' +
                    port.schematicComponentId +
                    '.',
                elementId:
                    port.schematicPortId +
                    ':missing-component:' +
                    port.schematicComponentId,
                schematicComponentId: port.schematicComponentId,
                schematicPortId: port.schematicPortId
            }))
    }

    /**
     * Builds schematic-port missing source-port diagnostics.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {Set<string>} sourcePortIds Known source port ids.
     * @returns {object[]}
     */
    static #missingSchematicPortSourcePortDiagnostics(
        elementsByType,
        sourcePortIds
    ) {
        return CircuitJsonIndexer.#all(elementsByType, 'schematic_port')
            .map((port) => ({
                schematicPortId: CircuitJsonIndexer.getElementId(port),
                sourcePortId: String(port.source_port_id || '').trim()
            }))
            .filter(
                (port) =>
                    port.sourcePortId && !sourcePortIds.has(port.sourcePortId)
            )
            .map((port) => ({
                isGenerated: true,
                severity: 'warning',
                sourceFormat: 'circuitjson',
                type: 'schematic_port_missing_source_port_warning',
                category: 'connectivity',
                message:
                    'Schematic port ' +
                    port.schematicPortId +
                    ' references missing source port ' +
                    port.sourcePortId +
                    '.',
                elementId:
                    port.schematicPortId +
                    ':missing-source-port:' +
                    port.sourcePortId,
                schematicPortId: port.schematicPortId,
                sourcePortId: port.sourcePortId
            }))
    }

    /**
     * Builds schematic primitive missing relation diagnostics.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {Set<string>} schematicSymbolIds Known schematic symbol ids.
     * @param {Set<string>} schematicComponentIds Known schematic component ids.
     * @returns {object[]}
     */
    static #missingSchematicPrimitiveDiagnostics(
        elementsByType,
        schematicSymbolIds,
        schematicComponentIds
    ) {
        return [...SCHEMATIC_PRIMITIVE_TYPES].flatMap((type) =>
            CircuitJsonIndexer.#all(elementsByType, type).flatMap((element) =>
                CircuitJsonIndexer.#missingSchematicPrimitiveElementDiagnostics(
                    element,
                    schematicSymbolIds,
                    schematicComponentIds
                )
            )
        )
    }

    /**
     * Builds schematic primitive diagnostics for one element.
     * @param {object} element Schematic primitive row.
     * @param {Set<string>} schematicSymbolIds Known schematic symbol ids.
     * @param {Set<string>} schematicComponentIds Known schematic component ids.
     * @returns {object[]}
     */
    static #missingSchematicPrimitiveElementDiagnostics(
        element,
        schematicSymbolIds,
        schematicComponentIds
    ) {
        const primitiveId = CircuitJsonIndexer.getElementId(element)
        const diagnostics = []
        const schematicSymbolId = String(
            element.schematic_symbol_id || ''
        ).trim()
        const schematicComponentId = String(
            element.schematic_component_id || ''
        ).trim()

        if (schematicSymbolId && !schematicSymbolIds.has(schematicSymbolId)) {
            diagnostics.push({
                isGenerated: true,
                severity: 'warning',
                sourceFormat: 'circuitjson',
                type: 'schematic_primitive_missing_schematic_symbol_warning',
                category: 'layout',
                message:
                    'Schematic primitive ' +
                    primitiveId +
                    ' references missing schematic symbol ' +
                    schematicSymbolId +
                    '.',
                elementId: primitiveId + ':missing-symbol:' + schematicSymbolId,
                schematicSymbolId
            })
        }
        if (
            schematicComponentId &&
            !schematicComponentIds.has(schematicComponentId)
        ) {
            diagnostics.push({
                isGenerated: true,
                severity: 'warning',
                sourceFormat: 'circuitjson',
                type: 'schematic_primitive_missing_schematic_component_warning',
                category: 'layout',
                message:
                    'Schematic primitive ' +
                    primitiveId +
                    ' references missing schematic component ' +
                    schematicComponentId +
                    '.',
                elementId:
                    primitiveId + ':missing-component:' + schematicComponentId,
                schematicComponentId
            })
        }

        return diagnostics
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
     * Builds a set of known element ids for one type.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {string} type Element type.
     * @returns {Set<string>}
     */
    static #elementIds(elementsByType, type) {
        return new Set(
            CircuitJsonIndexer.#all(elementsByType, type)
                .map((element) => CircuitJsonIndexer.getElementId(element))
                .filter(Boolean)
        )
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
            element?.member_source_group_id,
            element?.member_pcb_group_id,
            element?.member_schematic_group_id,
            element?.member_group_id,
            ...CircuitJsonIndexer.#relationValues(element?.group_ids),
            ...CircuitJsonIndexer.#relationValues(
                element?.member_source_group_ids
            ),
            ...CircuitJsonIndexer.#relationValues(
                element?.member_pcb_group_ids
            ),
            ...CircuitJsonIndexer.#relationValues(
                element?.member_schematic_group_ids
            ),
            ...CircuitJsonIndexer.#relationValues(element?.member_group_ids)
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    }

    /**
     * Returns indexed element rows by type.
     * @param {Map<string, object[]>} elementsByType Element rows by type.
     * @param {string} type Element type.
     * @returns {object[]}
     */
    static #all(elementsByType, type) {
        return elementsByType.get(type) || []
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
            elementId: CircuitJsonIndexer.getElementId(element),
            ...CircuitJsonIndexer.#diagnosticRelations(element)
        }
    }

    /**
     * Extracts optional relation ids from one diagnostic element.
     * @param {object} element Diagnostic element.
     * @returns {object}
     */
    static #diagnosticRelations(element) {
        return Object.fromEntries(
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

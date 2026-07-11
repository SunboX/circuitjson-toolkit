import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'
import { CircuitJsonPcbClearanceDiagnostics } from './CircuitJsonPcbClearanceDiagnostics.mjs'

const VIRTUAL_LAYER_ORDER = [
    'top_silkscreen',
    'bottom_silkscreen',
    'top_fabrication',
    'bottom_fabrication',
    'top_courtyard',
    'bottom_courtyard',
    'top_soldermask',
    'bottom_soldermask',
    'top_paste',
    'bottom_paste',
    'keepouts',
    'cutouts',
    'diagnostics',
    'groups',
    'anchor_offsets',
    'trace_lengths',
    'ratsnest'
]

/**
 * Builds non-geometric inspection overlays for CircuitJSON PCB primitives.
 */
export class CircuitJsonPcbPrimitiveOverlays {
    /**
     * Builds virtual layers, diagnostics, and airwires.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @param {object[]} primitives Primitive rows.
     * @param {object} bounds Board bounds.
     * @param {{ groups?: object[], anchorOffsets?: object[] }} [groupModel] Group overlay rows.
     * @param {object[]} [extraDiagnostics] Precomputed diagnostic rows.
     * @returns {{ virtualLayers: object[], diagnostics: object[], airwires: object[] }}
     */
    static build(
        index,
        componentsByPcbId,
        primitives,
        bounds,
        groupModel = {},
        extraDiagnostics = []
    ) {
        const ports = CircuitJsonPcbPrimitiveOverlays.#ports(index)
        const diagnostics = [
            ...CircuitJsonPcbPrimitiveOverlays.#diagnostics(
                index,
                componentsByPcbId,
                bounds,
                primitives
            ),
            ...CircuitJsonPcbPrimitiveOverlays.#extraDiagnostics(
                extraDiagnostics,
                bounds,
                index,
                primitives
            ),
            ...CircuitJsonPcbPrimitiveOverlays.#clearanceDiagnostics(
                index,
                primitives
            )
        ]
        const airwires = CircuitJsonPcbPrimitiveOverlays.#airwires(ports)

        return {
            virtualLayers: CircuitJsonPcbPrimitiveOverlays.#virtualLayers({
                primitives,
                diagnostics,
                airwires,
                groups: groupModel.groups || [],
                anchorOffsets: groupModel.anchorOffsets || []
            }),
            diagnostics,
            airwires
        }
    }

    /**
     * Builds source-net-aware PCB port rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {object[]}
     */
    static #ports(index) {
        const sourceNetNames =
            CircuitJsonPcbPrimitiveOverlays.#sourceNetNames(index)
        const sourcePortNetNames =
            CircuitJsonPcbPrimitiveOverlays.#sourcePortNetNames(
                index,
                sourceNetNames
            )

        return CircuitJsonPcbPrimitiveOverlays.#all(index, 'pcb_port')
            .map((port) => {
                const point = CircuitJsonPcbPrimitiveOverlays.#center(port)
                if (!point) return null
                const sourcePortId = String(port.source_port_id || '').trim()
                return {
                    id: String(port.pcb_port_id || '').trim(),
                    netName:
                        CircuitJsonPcbPrimitiveOverlays.#netName(port) ||
                        sourcePortNetNames.get(sourcePortId) ||
                        '',
                    point
                }
            })
            .filter(Boolean)
    }

    /**
     * Builds source net display names.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {Map<string, string>}
     */
    static #sourceNetNames(index) {
        return new Map(
            CircuitJsonPcbPrimitiveOverlays.#all(index, 'source_net')
                .map((net) => [
                    String(net.source_net_id || '').trim(),
                    String(
                        net.name || net.net || net.source_net_id || ''
                    ).trim()
                ])
                .filter(([id, name]) => id && name)
        )
    }

    /**
     * Builds source-port to source-net display-name lookup data.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, string>} sourceNetNames Source net names.
     * @returns {Map<string, string>}
     */
    static #sourcePortNetNames(index, sourceNetNames) {
        const names = new Map()
        for (const port of CircuitJsonPcbPrimitiveOverlays.#all(
            index,
            'source_port'
        )) {
            const portId = String(port.source_port_id || '').trim()
            if (!portId) continue
            const netId = CircuitJsonPcbPrimitiveOverlays.#firstString([
                port.source_net_id,
                ...(Array.isArray(port.source_net_ids)
                    ? port.source_net_ids
                    : []),
                ...(Array.isArray(port.connected_source_net_ids)
                    ? port.connected_source_net_ids
                    : [])
            ])
            const name =
                sourceNetNames.get(netId) ||
                CircuitJsonPcbPrimitiveOverlays.#netName(port)
            if (name) names.set(portId, name)
        }
        return names
    }

    /**
     * Builds diagnostic marker rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @param {object} bounds Board bounds.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #diagnostics(index, componentsByPcbId, bounds, primitives) {
        return CircuitJsonPcbPrimitiveOverlays.#elements(index)
            .filter((element) => {
                const type = String(element?.type || '').toLowerCase()
                return type.includes('error') || type.includes('warning')
            })
            .map((element, rowIndex) =>
                CircuitJsonPcbPrimitiveOverlays.#diagnostic(
                    element,
                    index,
                    rowIndex,
                    componentsByPcbId,
                    bounds,
                    primitives
                )
            )
    }

    /**
     * Builds one diagnostic marker.
     * @param {object} element Diagnostic-like element.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {number} rowIndex Diagnostic row index.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @param {object} bounds Board bounds.
     * @param {object[]} primitives Primitive rows.
     * @returns {object}
     */
    static #diagnostic(
        element,
        index,
        rowIndex,
        componentsByPcbId,
        bounds,
        primitives
    ) {
        const component =
            componentsByPcbId.get(
                String(element.pcb_component_id || '').trim()
            ) ||
            CircuitJsonPcbPrimitiveOverlays.#sourceComponent(
                element,
                componentsByPcbId
            )
        const relatedPrimitives =
            CircuitJsonPcbPrimitiveOverlays.#relatedPrimitives(
                element,
                index,
                primitives
            )
        const relatedBounds = CircuitJsonPcbPrimitiveOverlays.#mergeBounds(
            relatedPrimitives.map((primitive) => primitive.bounds)
        )
        const point = CircuitJsonPcbPrimitiveOverlays.#center(element) ||
            (relatedBounds
                ? CircuitJsonPcbPrimitiveOverlays.#boundsCenter(relatedBounds)
                : null) ||
            (component ? { x: component.x, y: component.y } : null) || {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2
            }
        const severity = String(element.severity || '').toLowerCase()
        const type = String(element.type || '').toLowerCase()
        const isWarning = severity === 'warning' || type.includes('warning')

        const code = String(
            element.error_type ||
                element.warning_type ||
                element.code ||
                element.type ||
                ''
        )

        const diagnostic = {
            id:
                CircuitJsonIndexer.getElementId(element) ||
                'diagnostic:' + rowIndex,
            kind: isWarning ? 'warning' : 'error',
            severity: isWarning ? 'warning' : 'error',
            category: CircuitJsonPcbPrimitiveOverlays.#diagnosticCategory(code),
            code,
            message: String(element.message || 'PCB diagnostic.'),
            point,
            componentKey: String(
                component?.componentKey ||
                    relatedPrimitives.find(
                        (primitive) => primitive.componentKey
                    )?.componentKey ||
                    ''
            ),
            netName:
                CircuitJsonPcbPrimitiveOverlays.#netName(element) ||
                relatedPrimitives.find((primitive) => primitive.netName)
                    ?.netName ||
                ''
        }
        if (relatedPrimitives.length) {
            diagnostic.bounds = relatedBounds
            diagnostic.relatedPrimitiveIds = relatedPrimitives
                .map((primitive) => primitive.id)
                .filter(Boolean)
        }
        return diagnostic
    }

    /**
     * Applies defaults to precomputed diagnostic rows.
     * @param {object[]} diagnostics Diagnostic rows.
     * @param {object} bounds Board bounds.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #extraDiagnostics(diagnostics, bounds, index, primitives) {
        return (diagnostics || []).map((diagnostic, rowIndex) => {
            const relatedPrimitives =
                CircuitJsonPcbPrimitiveOverlays.#relatedPrimitivesForDiagnostic(
                    diagnostic,
                    index,
                    primitives
                )
            const relatedBounds =
                diagnostic.bounds ||
                CircuitJsonPcbPrimitiveOverlays.#mergeBounds(
                    relatedPrimitives.map((primitive) => primitive.bounds)
                )
            return {
                id: String(
                    diagnostic.id ||
                        diagnostic.elementId ||
                        'diagnostic:extra:' + rowIndex
                ),
                kind: String(diagnostic.kind || 'warning'),
                severity: String(diagnostic.severity || 'warning'),
                category: String(diagnostic.category || 'general'),
                code: String(
                    diagnostic.code ||
                        diagnostic.type ||
                        diagnostic.warningType ||
                        diagnostic.errorType ||
                        'pcb_diagnostic'
                ),
                message: String(diagnostic.message || 'PCB diagnostic.'),
                point:
                    diagnostic.point ||
                    (relatedBounds
                        ? CircuitJsonPcbPrimitiveOverlays.#boundsCenter(
                              relatedBounds
                          )
                        : CircuitJsonPcbPrimitiveOverlays.#boundsCenter(
                              bounds
                          )),
                bounds: relatedBounds || null,
                relatedPrimitiveIds:
                    CircuitJsonPcbPrimitiveOverlays.#relatedPrimitiveIds(
                        diagnostic,
                        relatedPrimitives
                    ),
                componentKey: String(diagnostic.componentKey || ''),
                netName: String(diagnostic.netName || ''),
                ...CircuitJsonPcbPrimitiveOverlays.#diagnosticRelationFields(
                    diagnostic
                )
            }
        })
    }

    /**
     * Finds primitives related to a normalized diagnostic row.
     * @param {object} diagnostic Diagnostic row.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #relatedPrimitivesForDiagnostic(diagnostic, index, primitives) {
        const explicitIds = CircuitJsonPcbPrimitiveOverlays.#idValues([
            diagnostic?.relatedPrimitiveIds,
            diagnostic?.related_primitive_ids
        ])
        const explicit = primitives.filter((primitive) =>
            explicitIds.includes(String(primitive.id || '').trim())
        )
        const direct = CircuitJsonPcbPrimitiveOverlays.#matchingPrimitives(
            CircuitJsonPcbPrimitiveOverlays.#relatedPrimitiveIdPairs({
                pcb_trace_id:
                    diagnostic?.pcbTraceId || diagnostic?.pcb_trace_id,
                pcb_trace_ids:
                    diagnostic?.pcbTraceIds || diagnostic?.pcb_trace_ids,
                pcb_smtpad_id:
                    diagnostic?.pcbSmtpadId ||
                    diagnostic?.pcb_smtpad_id ||
                    diagnostic?.pcbPadId ||
                    diagnostic?.pcb_pad_id,
                pcb_smtpad_ids:
                    diagnostic?.pcbSmtpadIds ||
                    diagnostic?.pcb_smtpad_ids ||
                    diagnostic?.pcbPadIds ||
                    diagnostic?.pcb_pad_ids,
                pcb_via_id: diagnostic?.pcbViaId || diagnostic?.pcb_via_id,
                pcb_via_ids: diagnostic?.pcbViaIds || diagnostic?.pcb_via_ids,
                pcb_plated_hole_id:
                    diagnostic?.pcbPlatedHoleId ||
                    diagnostic?.pcb_plated_hole_id,
                pcb_plated_hole_ids:
                    diagnostic?.pcbPlatedHoleIds ||
                    diagnostic?.pcb_plated_hole_ids,
                pcb_hole_id: diagnostic?.pcbHoleId || diagnostic?.pcb_hole_id,
                pcb_hole_ids:
                    diagnostic?.pcbHoleIds || diagnostic?.pcb_hole_ids,
                pcb_port_id: diagnostic?.pcbPortId || diagnostic?.pcb_port_id,
                pcb_port_ids: diagnostic?.pcbPortIds || diagnostic?.pcb_port_ids
            }),
            primitives
        )
        const sourceTrace =
            CircuitJsonPcbPrimitiveOverlays.#sourceTracePrimitives(
                diagnostic,
                primitives
            )
        const sourcePortIds =
            CircuitJsonPcbPrimitiveOverlays.#pcbPortIdsForSourcePort(
                index,
                diagnostic?.sourcePortId || diagnostic?.source_port_id
            )
        const sourcePort = CircuitJsonPcbPrimitiveOverlays.#matchingPrimitives(
            sourcePortIds.map((id) => ['pcb_port_id', id]),
            primitives
        )
        return CircuitJsonPcbPrimitiveOverlays.#uniquePrimitives([
            ...explicit,
            ...direct,
            ...sourceTrace,
            ...sourcePort
        ])
    }

    /**
     * Finds primitives that came from one source trace id.
     * @param {object} diagnostic Diagnostic row.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #sourceTracePrimitives(diagnostic, primitives) {
        const sourceTraceIds = CircuitJsonPcbPrimitiveOverlays.#idValues([
            diagnostic?.sourceTraceId,
            diagnostic?.source_trace_id,
            diagnostic?.sourceTraceIds,
            diagnostic?.source_trace_ids
        ])
        if (!sourceTraceIds.length) return []
        return primitives.filter((primitive) =>
            sourceTraceIds.includes(
                String(
                    primitive.sourceTraceId ||
                        primitive.source?.source_trace_id ||
                        ''
                ).trim()
            )
        )
    }

    /**
     * Builds related primitive ids for a diagnostic.
     * @param {object} diagnostic Diagnostic row.
     * @param {object[]} relatedPrimitives Matched primitives.
     * @returns {string[]}
     */
    static #relatedPrimitiveIds(diagnostic, relatedPrimitives) {
        return CircuitJsonPcbPrimitiveOverlays.#idValues([
            diagnostic?.relatedPrimitiveIds,
            diagnostic?.related_primitive_ids,
            relatedPrimitives.map((primitive) => primitive.id)
        ])
    }

    /**
     * Keeps the first instance of each primitive id.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #uniquePrimitives(primitives) {
        const seen = new Set()
        return primitives.filter((primitive) => {
            const id = String(primitive.id || '').trim()
            if (!id || seen.has(id)) return false
            seen.add(id)
            return true
        })
    }

    /**
     * Extracts normalized relation fields from a diagnostic row.
     * @param {object} diagnostic Diagnostic row.
     * @returns {object}
     */
    static #diagnosticRelationFields(diagnostic) {
        return Object.fromEntries(
            [
                ['sourceTraceId', diagnostic?.sourceTraceId],
                ['sourcePortId', diagnostic?.sourcePortId],
                ['sourceNetId', diagnostic?.sourceNetId],
                ['pcbTraceId', diagnostic?.pcbTraceId],
                ['pcbPortId', diagnostic?.pcbPortId],
                ['pcbSmtpadId', diagnostic?.pcbSmtpadId],
                ['pcbViaId', diagnostic?.pcbViaId],
                ['pcbPlatedHoleId', diagnostic?.pcbPlatedHoleId],
                ['pcbHoleId', diagnostic?.pcbHoleId]
            ]
                .map(([key, value]) => [key, String(value || '').trim()])
                .filter(([_key, value]) => value)
        )
    }

    /**
     * Builds generic copper clearance diagnostics when board rules are present.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #clearanceDiagnostics(index, primitives) {
        return CircuitJsonPcbClearanceDiagnostics.build(index, primitives)
    }

    /**
     * Builds simple source connectivity airwires.
     * @param {object[]} ports PCB port rows.
     * @returns {object[]}
     */
    static #airwires(ports) {
        const byNet = new Map()
        for (const port of ports) {
            const netName = String(port.netName || '').trim()
            if (!netName) continue
            if (!byNet.has(netName)) byNet.set(netName, [])
            byNet.get(netName).push(port)
        }

        const lines = []
        for (const [netName, netPorts] of byNet) {
            const sorted = [...netPorts].sort((left, right) =>
                String(left.id).localeCompare(String(right.id))
            )
            for (let index = 1; index < sorted.length; index += 1) {
                lines.push({
                    id: 'airwire:' + netName + ':' + (index - 1),
                    netName,
                    start: { ...sorted[0].point },
                    end: { ...sorted[index].point }
                })
            }
        }
        return lines
    }

    /**
     * Builds virtual layer rows for detail and overlay primitives.
     * @param {{ primitives: object[], diagnostics: object[], airwires: object[], groups?: object[], anchorOffsets?: object[] }} model Model fragments.
     * @returns {object[]}
     */
    static #virtualLayers(model) {
        const keys = new Set()
        for (const primitive of model.primitives) {
            if (
                ['silkscreen', 'silkscreen_text', 'silkscreen_line'].includes(
                    primitive.kind
                )
            ) {
                keys.add(primitive.layer)
            }
            if (primitive.kind === 'fabrication') keys.add(primitive.layer)
            if (primitive.kind === 'courtyard') keys.add(primitive.layer)
            if (primitive.kind === 'solder-mask') keys.add(primitive.layer)
            if (primitive.kind === 'solder-paste') keys.add(primitive.layer)
            if (primitive.kind === 'keepout') keys.add('keepouts')
            if (primitive.kind === 'cutout') keys.add('cutouts')
            if (primitive.kind === 'track') keys.add('trace_lengths')
            if (String(primitive.netName || '').trim()) keys.add('ratsnest')
        }
        if (model.diagnostics.length) keys.add('diagnostics')
        if (model.groups?.length) keys.add('groups')
        if (model.anchorOffsets?.length) keys.add('anchor_offsets')
        if (model.airwires.length) keys.add('ratsnest')

        return VIRTUAL_LAYER_ORDER.filter((key) => keys.has(key)).map(
            (key) => ({
                key,
                id: key,
                layer: key,
                name: CircuitJsonPcbPrimitiveOverlays.#displayLayerName(key),
                side: CircuitJsonPcbPrimitiveOverlays.#side(key),
                type: 'drawing',
                sourceFormat: 'circuitjson'
            })
        )
    }

    /**
     * Returns indexed element rows by type.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {string} type Element type.
     * @returns {object[]}
     */
    static #all(index, type) {
        return index.elementsByType.get(type) || []
    }

    /**
     * Returns all indexed element rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {object[]}
     */
    static #elements(index) {
        return Array.from(index.elementsByType.values()).flat()
    }

    /**
     * Finds primitives referenced by a diagnostic element.
     * @param {object} element Diagnostic element.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #relatedPrimitives(element, index, primitives) {
        const directIds =
            CircuitJsonPcbPrimitiveOverlays.#relatedPrimitiveIdPairs(element)
        const direct = CircuitJsonPcbPrimitiveOverlays.#matchingPrimitives(
            directIds,
            primitives
        )
        if (direct.length) return direct

        const portIds =
            CircuitJsonPcbPrimitiveOverlays.#pcbPortIdsForSourcePort(
                index,
                element?.source_port_id
            )
        const sourcePort = CircuitJsonPcbPrimitiveOverlays.#matchingPrimitives(
            portIds.map((id) => ['pcb_port_id', id]),
            primitives
        )
        if (sourcePort.length) return sourcePort

        const sourceComponentId = String(
            element?.source_component_id || ''
        ).trim()
        if (sourceComponentId) {
            const sourceComponent = primitives.filter(
                (primitive) =>
                    String(primitive.sourceComponentId || '').trim() ===
                        sourceComponentId &&
                    CircuitJsonPcbPrimitiveOverlays.#isDiagnosticPrimitive(
                        primitive
                    )
            )
            if (sourceComponent.length) return sourceComponent
        }

        const componentIds = CircuitJsonPcbPrimitiveOverlays.#idValues([
            element?.pcb_component_id,
            element?.pcb_component_ids
        ])
        if (componentIds.length) {
            return primitives.filter(
                (primitive) =>
                    componentIds.includes(
                        String(primitive.componentId || '').trim()
                    ) &&
                    CircuitJsonPcbPrimitiveOverlays.#isDiagnosticPrimitive(
                        primitive
                    )
            )
        }

        return []
    }

    /**
     * Builds source field/value pairs for directly related primitives.
     * @param {object} element Diagnostic row.
     * @returns {Array<[string, string]>}
     */
    static #relatedPrimitiveIdPairs(element) {
        return [
            ['pcb_trace_id', [element?.pcb_trace_id, element?.pcb_trace_ids]],
            [
                'pcb_smtpad_id',
                [
                    element?.pcb_smtpad_id,
                    element?.pcb_smtpad_ids,
                    element?.pcb_pad_id,
                    element?.pcb_pad_ids
                ]
            ],
            ['pcb_via_id', [element?.pcb_via_id, element?.pcb_via_ids]],
            [
                'pcb_plated_hole_id',
                [element?.pcb_plated_hole_id, element?.pcb_plated_hole_ids]
            ],
            ['pcb_hole_id', [element?.pcb_hole_id, element?.pcb_hole_ids]],
            ['pcb_port_id', [element?.pcb_port_id, element?.pcb_port_ids]]
        ].flatMap(([field, values]) =>
            CircuitJsonPcbPrimitiveOverlays.#idValues(values).map((value) => [
                field,
                value
            ])
        )
    }

    /**
     * Normalizes scalar or array ID values.
     * @param {unknown[]} values Candidate values.
     * @returns {string[]}
     */
    static #idValues(values) {
        return [
            ...new Set(
                values
                    .flatMap((value) =>
                        Array.isArray(value) ? value : [value]
                    )
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            )
        ]
    }

    /**
     * Returns true when a component-owned primitive should shape diagnostics.
     * @param {object} primitive Primitive row.
     * @returns {boolean}
     */
    static #isDiagnosticPrimitive(primitive) {
        return [
            'pad',
            'track',
            'via',
            'zone',
            'solder-mask',
            'solder-paste'
        ].includes(primitive.kind)
    }

    /**
     * Finds primitives matching source id fields.
     * @param {Array<[string, unknown]>} ids Field/value pairs.
     * @param {object[]} primitives Primitive rows.
     * @returns {object[]}
     */
    static #matchingPrimitives(ids, primitives) {
        if (!ids.length) return []
        return primitives.filter((primitive) =>
            ids.some(
                ([field, value]) =>
                    String(primitive.source?.[field] || '').trim() ===
                    String(value || '').trim()
            )
        )
    }

    /**
     * Resolves PCB port ids linked to one source port.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {unknown} sourcePortId Source port id.
     * @returns {string[]}
     */
    static #pcbPortIdsForSourcePort(index, sourcePortId) {
        const id = String(sourcePortId || '').trim()
        if (!id) return []
        return CircuitJsonPcbPrimitiveOverlays.#all(index, 'pcb_port')
            .filter((port) => String(port.source_port_id || '').trim() === id)
            .map((port) => String(port.pcb_port_id || '').trim())
            .filter(Boolean)
    }

    /**
     * Resolves a PCB component by source component id.
     * @param {object} element Diagnostic element.
     * @param {Map<string, object>} componentsByPcbId Component lookup.
     * @returns {object | undefined}
     */
    static #sourceComponent(element, componentsByPcbId) {
        const sourceId = String(element?.source_component_id || '').trim()
        if (!sourceId) return undefined
        return [...componentsByPcbId.values()].find(
            (component) =>
                String(component.sourceComponentId || '').trim() === sourceId
        )
    }

    /**
     * Resolves the center point of bounds.
     * @param {object} bounds Bounds record.
     * @returns {{ x: number, y: number }}
     */
    static #boundsCenter(bounds) {
        return {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2
        }
    }

    /**
     * Merges bounds rows.
     * @param {object[]} rows Bounds rows.
     * @returns {object | null}
     */
    static #mergeBounds(rows) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const bounds of rows) {
            if (!bounds) continue
            minX = Math.min(minX, bounds.minX)
            minY = Math.min(minY, bounds.minY)
            maxX = Math.max(maxX, bounds.maxX)
            maxY = Math.max(maxY, bounds.maxY)
        }
        if (!Number.isFinite(minX)) return null
        return {
            minX: CircuitJsonPcbPrimitiveOverlays.#round(minX),
            minY: CircuitJsonPcbPrimitiveOverlays.#round(minY),
            maxX: CircuitJsonPcbPrimitiveOverlays.#round(maxX),
            maxY: CircuitJsonPcbPrimitiveOverlays.#round(maxY),
            width: CircuitJsonPcbPrimitiveOverlays.#round(maxX - minX),
            height: CircuitJsonPcbPrimitiveOverlays.#round(maxY - minY)
        }
    }

    /**
     * Rounds one computed geometry value.
     * @param {number} value Numeric value.
     * @returns {number}
     */
    static #round(value) {
        return Number(Number(value).toFixed(6))
    }

    /**
     * Resolves a center point.
     * @param {object} element Element row.
     * @returns {{ x: number, y: number } | null}
     */
    static #center(element) {
        return CircuitJsonUnits.optionalPoint(element?.center || element)
    }

    /**
     * Resolves a net name from common fields.
     * @param {object} element Element row.
     * @returns {string}
     */
    static #netName(element) {
        return String(
            element?.netName ??
                element?.net ??
                element?.net_name ??
                element?.source_net_name ??
                ''
        ).trim()
    }

    /**
     * Resolves a broad diagnostic category from a diagnostic code.
     * @param {string} code Diagnostic code.
     * @returns {string}
     */
    static #diagnosticCategory(code) {
        const text = String(code || '').toLowerCase()
        if (text.includes('clearance')) return 'clearance'
        if (text.includes('autorouting') || text.includes('trace_error')) {
            return 'routing'
        }
        if (text.includes('placement') || text.includes('outside_board')) {
            return 'placement'
        }
        if (
            text.includes('trace_missing') ||
            text.includes('missing_trace') ||
            text.includes('not_connected') ||
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
        if (text.includes('configuration')) return 'configuration'
        return 'general'
    }

    /**
     * Resolves the first non-empty string.
     * @param {unknown[]} values Candidate values.
     * @returns {string}
     */
    static #firstString(values) {
        for (const value of values) {
            const text = String(value ?? '').trim()
            if (text) return text
        }
        return ''
    }

    /**
     * Resolves a side from a layer key.
     * @param {string} layer Layer key.
     * @returns {'top' | 'bottom' | ''}
     */
    static #side(layer) {
        const text = String(layer || '').toLowerCase()
        if (/\b(bottom|back)\b|\bb[._-]/u.test(text)) return 'bottom'
        if (/\b(top|front)\b|\bf[._-]/u.test(text)) return 'top'
        return ''
    }

    /**
     * Formats a virtual layer name.
     * @param {string} key Layer key.
     * @returns {string}
     */
    static #displayLayerName(key) {
        return String(key)
            .replaceAll('_', ' ')
            .replace(/\b\w/gu, (match) => match.toUpperCase())
    }
}

import { ToolkitDiagnostic } from '../contracts/ToolkitDiagnostic.mjs'
import { ComponentGrouping } from './ComponentGrouping.mjs'

/**
 * Builds one clone-safe query netlist from prepared CircuitJSON indexes.
 */
export class QueryNetlistBuilder {
    /**
     * Builds the canonical query netlist for one document context.
     * @param {import('../context/CircuitJsonDocumentContext.mjs').CircuitJsonDocumentContext} context Prepared document context.
     * @returns {Record<string, any>} Canonical query netlist.
     */
    static build(context) {
        const elements = context.getIndex('elements')
        const relations = context.getIndex('relations')
        const connectivity = context.getIndex('connectivity')
        const portsById = new Map(
            (elements.elementsByType.get('source_port') || []).map((port) => [
                String(port.source_port_id || '').trim(),
                port
            ])
        )
        const internalConnections =
            QueryNetlistBuilder.#internalConnections(elements)
        const internalConnectionIdsByPort =
            QueryNetlistBuilder.#internalConnectionIdsByPort(
                internalConnections
            )
        const traces = [...connectivity.sourceTraceConnectivity.values()]
            .map((trace) =>
                QueryNetlistBuilder.#trace(
                    trace,
                    portsById,
                    internalConnectionIdsByPort
                )
            )
            .filter((trace) => trace.id)
            .sort((left, right) =>
                ComponentGrouping.compareIds(left.id, right.id)
            )
        const components = QueryNetlistBuilder.#connectComponents(
            ComponentGrouping.components(elements, relations),
            traces
        )
        const nets = ComponentGrouping.nets(elements, traces)
        const diagnostics = (connectivity.diagnostics || []).map((row) =>
            ToolkitDiagnostic.create({
                code: row.code || row.type || 'QUERY_CONNECTIVITY_DIAGNOSTIC',
                severity: row.severity || 'warning',
                message: row.message || '',
                source: context.source.fileName || '',
                details: row
            })
        )
        return {
            schema: 'ecad-toolkit.netlist.v1',
            components,
            nets,
            traces,
            internalConnections,
            diagnostics,
            statistics: {
                componentCount: components.length,
                netCount: nets.length,
                traceCount: traces.length,
                internalConnectionCount: internalConnections.length
            }
        }
    }

    /**
     * Builds explicit electrical bridges between source-component ports.
     * @param {Record<string, any>} elements Prepared elements index.
     * @returns {object[]} Stable internal-connection records.
     */
    static #internalConnections(elements) {
        const records = []
        for (const component of elements.elementsByType.get(
            'source_component'
        ) || []) {
            const sourceComponentId = String(
                component.source_component_id || ''
            ).trim()
            const groups = Array.isArray(
                component.internally_connected_source_port_ids
            )
                ? component.internally_connected_source_port_ids
                : []
            groups.forEach((sourcePortIds, index) => {
                const normalizedPortIds =
                    QueryNetlistBuilder.#ids(sourcePortIds)
                if (!sourceComponentId || normalizedPortIds.length < 2) return
                records.push({
                    id: `${sourceComponentId}:internal:${index}`,
                    sourceComponentId,
                    sourcePortIds: normalizedPortIds
                })
            })
        }
        for (const connection of elements.elementsByType.get(
            'source_component_internal_connection'
        ) || []) {
            const id = String(
                connection.source_component_internal_connection_id || ''
            ).trim()
            const sourceComponentId = String(
                connection.source_component_id || ''
            ).trim()
            const sourcePortIds = QueryNetlistBuilder.#ids(
                connection.source_port_ids
            )
            if (!id || !sourceComponentId || sourcePortIds.length < 2) continue
            records.push({ id, sourceComponentId, sourcePortIds })
        }
        return records.sort((left, right) =>
            ComponentGrouping.compareIds(left.id, right.id)
        )
    }

    /**
     * Indexes internal-connection ids by every participating source port.
     * @param {object[]} internalConnections Internal-connection records.
     * @returns {Map<string, string[]>} Stable ids by source-port id.
     */
    static #internalConnectionIdsByPort(internalConnections) {
        const result = new Map()
        for (const connection of internalConnections) {
            for (const sourcePortId of connection.sourcePortIds) {
                if (!result.has(sourcePortId)) result.set(sourcePortId, [])
                result.get(sourcePortId).push(connection.id)
            }
        }
        for (const ids of result.values()) {
            ids.sort(ComponentGrouping.compareIds)
        }
        return result
    }

    /**
     * Adds trace-derived net ids to detached component pin records.
     * @param {object[]} components Component records.
     * @param {object[]} traces Trace records.
     * @returns {object[]} Connected component records.
     */
    static #connectComponents(components, traces) {
        const netIdsByPort = new Map()
        for (const trace of traces) {
            for (const portId of trace.sourcePortIds) {
                if (!netIdsByPort.has(portId)) {
                    netIdsByPort.set(portId, new Set())
                }
                const netIds = netIdsByPort.get(portId)
                for (const netId of trace.sourceNetIds) netIds.add(netId)
            }
        }
        return components.map((component) => ({
            ...component,
            pins: component.pins.map((pin) => ({
                ...pin,
                netIds: [
                    ...new Set([
                        ...(pin.netIds || []),
                        ...(netIdsByPort.get(pin.id) || [])
                    ])
                ].sort(ComponentGrouping.compareIds)
            }))
        }))
    }

    /**
     * Builds one canonical trace record and its stable endpoints.
     * @param {Record<string, any>} trace Connectivity index row.
     * @param {Map<string, object>} portsById Source ports by id.
     * @param {Map<string, string[]>} internalConnectionIdsByPort Internal connections by port.
     * @returns {Record<string, any>} Trace record.
     */
    static #trace(trace, portsById, internalConnectionIdsByPort) {
        const sourcePortIds = QueryNetlistBuilder.#ids(
            trace.connectedSourcePortIds
        )
        const sourceNetIds = QueryNetlistBuilder.#ids(
            trace.connectedSourceNetIds
        )
        const sourceComponentIds = [
            ...new Set(
                sourcePortIds
                    .map((id) => portsById.get(id))
                    .map((port) =>
                        String(port?.source_component_id || '').trim()
                    )
                    .filter(Boolean)
            )
        ].sort(ComponentGrouping.compareIds)
        const internalConnectionIds = [
            ...new Set(
                sourcePortIds.flatMap(
                    (id) => internalConnectionIdsByPort.get(id) || []
                )
            )
        ].sort(ComponentGrouping.compareIds)
        const endpoints = [
            ...sourcePortIds.map((id) => ({
                id,
                kind: 'port',
                componentId: String(
                    portsById.get(id)?.source_component_id || ''
                ).trim()
            })),
            ...sourceNetIds.map((id) => ({ id, kind: 'net' }))
        ].sort((left, right) => {
            const kindOrder = ComponentGrouping.compareIds(
                left.kind,
                right.kind
            )
            return kindOrder || ComponentGrouping.compareIds(left.id, right.id)
        })
        return {
            id: String(trace.sourceTraceId || '').trim(),
            sourcePortIds,
            sourceNetIds,
            sourceComponentIds,
            internalConnectionIds,
            endpoints
        }
    }

    /**
     * Normalizes stable relation ids.
     * @param {unknown} values Relation values.
     * @returns {string[]} Unique sorted ids.
     */
    static #ids(values) {
        const candidates = Array.isArray(values) ? values : [values]
        return [
            ...new Set(candidates.map((value) => String(value || '').trim()))
        ]
            .filter(Boolean)
            .sort(ComponentGrouping.compareIds)
    }
}

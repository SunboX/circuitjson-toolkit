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
        const traces = [...connectivity.sourceTraceConnectivity.values()]
            .map((trace) => QueryNetlistBuilder.#trace(trace, portsById))
            .filter((trace) => trace.id)
            .sort((left, right) =>
                ComponentGrouping.compareIds(left.id, right.id)
            )
        const components = ComponentGrouping.components(elements, relations)
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
            diagnostics,
            statistics: {
                componentCount: components.length,
                netCount: nets.length,
                traceCount: traces.length
            }
        }
    }

    /**
     * Builds one canonical trace record and its stable endpoints.
     * @param {Record<string, any>} trace Connectivity index row.
     * @param {Map<string, object>} portsById Source ports by id.
     * @returns {Record<string, any>} Trace record.
     */
    static #trace(trace, portsById) {
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

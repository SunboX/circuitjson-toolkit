import { ComponentGrouping } from './ComponentGrouping.mjs'

/**
 * Traverses canonical trace connectivity with stable bounded breadth-first work.
 */
export class CircuitTraversal {
    /**
     * Prepares reusable trace and membership indexes without expanding edges.
     * @param {Record<string, any>} netlist Canonical query netlist.
     * @returns {{ tracesById: Map<string, object>, traceIdsByMembership: Map<string, string[]>, traceIdsByComponent: Map<string, string[]> }} Traversal graph.
     */
    static prepare(netlist) {
        const tracesById = new Map()
        const traceIdsByMembership = new Map()
        const traceIdsByComponent = new Map()
        for (const trace of netlist.traces || []) {
            tracesById.set(trace.id, trace)
            for (const key of CircuitTraversal.#membershipKeys(trace)) {
                if (!traceIdsByMembership.has(key)) {
                    traceIdsByMembership.set(key, [])
                }
                traceIdsByMembership.get(key).push(trace.id)
            }
            for (const componentId of trace.sourceComponentIds || []) {
                if (!traceIdsByComponent.has(componentId)) {
                    traceIdsByComponent.set(componentId, [])
                }
                traceIdsByComponent.get(componentId).push(trace.id)
            }
        }
        for (const ids of [
            ...traceIdsByMembership.values(),
            ...traceIdsByComponent.values()
        ]) {
            ids.sort(ComponentGrouping.compareIds)
        }
        return { tracesById, traceIdsByMembership, traceIdsByComponent }
    }

    /**
     * Traverses from one or more canonical source ids.
     * @param {{ tracesById: Map<string, object>, traceIdsByMembership: Map<string, string[]>, traceIdsByComponent: Map<string, string[]> }} graph Prepared graph.
     * @param {Record<string, string>} request Starting source ids.
     * @param {{ maxDepth: number, maxResults: number }} options Bounds.
     * @returns {object[]} Ordered connectivity records.
     */
    static trace(graph, request, options) {
        const initial = CircuitTraversal.#initialTraceIds(
            graph,
            request,
            options.maxResults
        )
        const queue = initial.map((id) => ({
            id,
            depth: 0,
            path: [{ traceId: id, via: null }]
        }))
        const queued = new Set(initial)
        const visited = new Set()
        const expandedMemberships = new Set()
        const results = []
        let cursor = 0

        while (cursor < queue.length && results.length < options.maxResults) {
            const current = queue[cursor]
            cursor += 1
            if (visited.has(current.id)) continue
            visited.add(current.id)
            const trace = graph.tracesById.get(current.id)
            if (!trace) continue
            results.push({
                ...structuredClone(trace),
                depth: current.depth,
                path: [...current.path]
            })
            if (results.length >= options.maxResults) break
            if (current.depth >= options.maxDepth) continue

            const neighbors = new Map()
            for (const key of CircuitTraversal.#membershipKeys(trace).sort(
                ComponentGrouping.compareIds
            )) {
                if (expandedMemberships.has(key)) continue
                expandedMemberships.add(key)
                const via = CircuitTraversal.#connector(key)
                for (const id of graph.traceIdsByMembership.get(key) || []) {
                    if (!visited.has(id) && !queued.has(id)) {
                        neighbors.set(id, via)
                    }
                }
            }
            for (const id of [...neighbors.keys()].sort(
                ComponentGrouping.compareIds
            )) {
                if (queue.length >= options.maxResults) break
                queued.add(id)
                queue.push({
                    id,
                    depth: current.depth + 1,
                    path: [
                        ...current.path,
                        { traceId: id, via: neighbors.get(id) }
                    ]
                })
            }
        }
        return results
    }

    /**
     * Resolves starting traces from direct selector indexes.
     * @param {{ tracesById: Map<string, object>, traceIdsByMembership: Map<string, string[]>, traceIdsByComponent: Map<string, string[]> }} graph Prepared graph.
     * @param {Record<string, string>} request Start request.
     * @param {number} maxResults Maximum starting records.
     * @returns {string[]} Stable starting trace ids.
     */
    static #initialTraceIds(graph, request, maxResults) {
        const ids = new Set()
        if (
            request.sourceTraceId &&
            graph.tracesById.has(request.sourceTraceId)
        ) {
            ids.add(request.sourceTraceId)
        }
        if (request.sourceComponentId) {
            for (const id of graph.traceIdsByComponent.get(
                request.sourceComponentId
            ) || []) {
                ids.add(id)
            }
        }
        if (request.sourcePortId) {
            for (const id of graph.traceIdsByMembership.get(
                `port:${request.sourcePortId}`
            ) || []) {
                ids.add(id)
            }
        }
        if (request.sourceNetId) {
            for (const id of graph.traceIdsByMembership.get(
                `net:${request.sourceNetId}`
            ) || []) {
                ids.add(id)
            }
        }
        return [...ids].sort(ComponentGrouping.compareIds).slice(0, maxResults)
    }

    /**
     * Builds shared-membership keys for one trace.
     * @param {Record<string, any>} trace Trace record.
     * @returns {string[]} Membership keys.
     */
    static #membershipKeys(trace) {
        return [
            ...(trace.sourcePortIds || []).map((id) => `port:${id}`),
            ...(trace.sourceNetIds || []).map((id) => `net:${id}`),
            ...(trace.internalConnectionIds || []).map(
                (id) => `internalConnection:${id}`
            )
        ]
    }

    /**
     * Converts one membership key into a clone-safe path connector.
     * @param {string} key Membership key.
     * @returns {{ kind: 'port' | 'net' | 'internalConnection', id: string }} Connector record.
     */
    static #connector(key) {
        const separator = key.indexOf(':')
        return {
            kind: key.slice(0, separator),
            id: key.slice(separator + 1)
        }
    }
}

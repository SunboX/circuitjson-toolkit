import { ComponentGrouping } from './ComponentGrouping.mjs'

/**
 * Traverses canonical trace connectivity with stable bounded breadth-first work.
 */
export class CircuitTraversal {
    /**
     * Prepares reusable trace and membership indexes without expanding edges.
     * @param {Record<string, any>} netlist Canonical query netlist.
     * @returns {{ tracesById: Map<string, object>, traceIdsByMembership: Map<string, string[]> }} Traversal graph.
     */
    static prepare(netlist) {
        const tracesById = new Map()
        const traceIdsByMembership = new Map()
        for (const trace of netlist.traces || []) {
            tracesById.set(trace.id, trace)
            for (const key of CircuitTraversal.#membershipKeys(trace)) {
                if (!traceIdsByMembership.has(key)) {
                    traceIdsByMembership.set(key, [])
                }
                traceIdsByMembership.get(key).push(trace.id)
            }
        }
        for (const ids of traceIdsByMembership.values()) {
            ids.sort(ComponentGrouping.compareIds)
        }
        return { tracesById, traceIdsByMembership }
    }

    /**
     * Traverses from one or more canonical source ids.
     * @param {{ tracesById: Map<string, object>, traceIdsByMembership: Map<string, string[]> }} graph Prepared graph.
     * @param {Record<string, string>} request Starting source ids.
     * @param {{ maxDepth: number, maxResults: number }} options Bounds.
     * @returns {object[]} Ordered connectivity records.
     */
    static trace(graph, request, options) {
        const initial = [...graph.tracesById.values()]
            .filter((trace) => CircuitTraversal.#matches(trace, request))
            .map((trace) => trace.id)
            .sort(ComponentGrouping.compareIds)
        const queue = initial.map((id) => ({ id, depth: 0, path: [id] }))
        const queued = new Set(initial)
        const visited = new Set()
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
            if (current.depth >= options.maxDepth) continue

            const neighbors = new Set()
            for (const key of CircuitTraversal.#membershipKeys(trace)) {
                for (const id of graph.traceIdsByMembership.get(key) || []) {
                    if (!visited.has(id) && !queued.has(id)) neighbors.add(id)
                }
            }
            for (const id of [...neighbors].sort(
                ComponentGrouping.compareIds
            )) {
                queued.add(id)
                queue.push({
                    id,
                    depth: current.depth + 1,
                    path: [...current.path, id]
                })
            }
        }
        return results
    }

    /**
     * Tests a trace against every supplied starting id.
     * @param {Record<string, any>} trace Trace record.
     * @param {Record<string, string>} request Start request.
     * @returns {boolean} Whether the trace is a start record.
     */
    static #matches(trace, request) {
        return (
            (request.sourceTraceId && trace.id === request.sourceTraceId) ||
            (request.sourceComponentId &&
                trace.sourceComponentIds.includes(request.sourceComponentId)) ||
            (request.sourcePortId &&
                trace.sourcePortIds.includes(request.sourcePortId)) ||
            (request.sourceNetId &&
                trace.sourceNetIds.includes(request.sourceNetId))
        )
    }

    /**
     * Builds shared-membership keys for one trace.
     * @param {Record<string, any>} trace Trace record.
     * @returns {string[]} Membership keys.
     */
    static #membershipKeys(trace) {
        return [
            ...(trace.sourceComponentIds || []).map((id) => `component:${id}`),
            ...(trace.sourcePortIds || []).map((id) => `port:${id}`),
            ...(trace.sourceNetIds || []).map((id) => `net:${id}`)
        ]
    }
}

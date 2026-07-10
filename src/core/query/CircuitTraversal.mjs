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

            const sources = []
            for (const key of CircuitTraversal.#membershipKeys(trace).sort(
                ComponentGrouping.compareIds
            )) {
                if (expandedMemberships.has(key)) continue
                expandedMemberships.add(key)
                const ids = graph.traceIdsByMembership.get(key)
                if (!ids) continue
                sources.push({
                    key,
                    ids,
                    via: CircuitTraversal.#connector(key)
                })
            }
            const capacity = options.maxResults - queue.length
            for (const neighbor of CircuitTraversal.#takeSortedUnique(
                sources,
                capacity,
                new Set([...visited, ...queued])
            )) {
                queued.add(neighbor.id)
                queue.push({
                    id: neighbor.id,
                    depth: current.depth + 1,
                    path: [
                        ...current.path,
                        { traceId: neighbor.id, via: neighbor.via }
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
        const sources = []
        if (
            request.sourceTraceId &&
            graph.tracesById.has(request.sourceTraceId)
        ) {
            sources.push({
                key: 'trace',
                ids: [request.sourceTraceId],
                via: null
            })
        }
        if (request.sourceComponentId) {
            const ids = graph.traceIdsByComponent.get(request.sourceComponentId)
            if (ids) {
                sources.push({ key: 'component', ids, via: null })
            }
        }
        if (request.sourcePortId) {
            const ids = graph.traceIdsByMembership.get(
                `port:${request.sourcePortId}`
            )
            if (ids) {
                sources.push({ key: 'port', ids, via: null })
            }
        }
        if (request.sourceNetId) {
            const ids = graph.traceIdsByMembership.get(
                `net:${request.sourceNetId}`
            )
            if (ids) {
                sources.push({ key: 'net', ids, via: null })
            }
        }
        return CircuitTraversal.#takeSortedUnique(sources, maxResults).map(
            (row) => row.id
        )
    }

    /**
     * Takes a bounded sorted union without materializing complete source lists.
     * @param {{ key: string, ids: Iterable<string>, via: object | null }[]} sources Sorted id sources.
     * @param {number} limit Maximum returned rows.
     * @param {Set<string>} [excluded] Ids that must not be returned.
     * @returns {{ id: string, via: object | null }[]} Stable unique rows.
     */
    static #takeSortedUnique(sources, limit, excluded = new Set()) {
        if (limit <= 0) return []
        const states = sources
            .map((source, index) =>
                CircuitTraversal.#iteratorState(source, index)
            )
            .filter(Boolean)
        const seen = new Set(excluded)
        const result = []

        while (states.length && result.length < limit) {
            states.sort(CircuitTraversal.#compareIteratorStates)
            const current = states.shift()
            const accepted = !seen.has(current.id)
            if (accepted) {
                seen.add(current.id)
                result.push({ id: current.id, via: current.via })
                if (result.length >= limit) break
            }
            const next = current.iterator.next()
            if (!next.done) {
                current.id = String(next.value)
                states.push(current)
            }
        }
        return result
    }

    /**
     * Opens one sorted source iterator and reads only its first id.
     * @param {{ key: string, ids: Iterable<string>, via: object | null }} source Id source.
     * @param {number} index Stable source index.
     * @returns {object | null} Active iterator state.
     */
    static #iteratorState(source, index) {
        const iterator = source.ids[Symbol.iterator]()
        const first = iterator.next()
        return first.done
            ? null
            : {
                  id: String(first.value),
                  index,
                  iterator,
                  key: source.key,
                  via: source.via
              }
    }

    /**
     * Orders active iterator heads by id and deterministic connector source.
     * @param {object} left Left iterator state.
     * @param {object} right Right iterator state.
     * @returns {number} Stable sort order.
     */
    static #compareIteratorStates(left, right) {
        return (
            ComponentGrouping.compareIds(left.id, right.id) ||
            ComponentGrouping.compareIds(left.key, right.key) ||
            left.index - right.index
        )
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

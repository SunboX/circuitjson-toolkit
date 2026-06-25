/**
 * Normalizes PCB net metadata and applies it to PCB primitive rows.
 */
export class CircuitJsonPcbNetMetadata {
    /**
     * Decorates primitive rows with explicit net metadata when available.
     * @param {object[]} primitives Primitive rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {object[]}
     */
    static decoratePrimitives(primitives, index) {
        const lookup = CircuitJsonPcbNetMetadata.#lookup(index)
        return primitives.map((primitive) =>
            CircuitJsonPcbNetMetadata.#decoratePrimitive(primitive, lookup)
        )
    }

    /**
     * Builds unique net rows from explicit metadata and primitive usage.
     * @param {object[]} primitives Primitive rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {object[]}
     */
    static nets(primitives, index) {
        const entries = CircuitJsonPcbNetMetadata.#entries(index)
        const byName = new Map(entries.map((entry) => [entry.name, entry]))

        for (const primitive of primitives) {
            const name = String(primitive.netName || '').trim()
            if (name && !byName.has(name)) byName.set(name, { name })
        }

        return [...byName.values()]
    }

    /**
     * Applies metadata to one primitive row.
     * @param {object} primitive Primitive row.
     * @param {Map<string, object>} lookup Net lookup map.
     * @returns {object}
     */
    static #decoratePrimitive(primitive, lookup) {
        const entry = CircuitJsonPcbNetMetadata.#primitiveNetEntry(
            primitive,
            lookup
        )
        if (!entry) return primitive

        return {
            ...primitive,
            netName: entry.name || primitive.netName,
            sourceNetId: entry.sourceNetId || primitive.sourceNetId || '',
            pcbNetId: entry.pcbNetId || primitive.pcbNetId || '',
            groupIds: CircuitJsonPcbNetMetadata.#uniqueStrings([
                ...(primitive.groupIds || []),
                ...(entry.groupIds || [])
            ]),
            ...(entry.highlightColor ? { netColor: entry.highlightColor } : {})
        }
    }

    /**
     * Resolves the explicit net entry matching one primitive.
     * @param {object} primitive Primitive row.
     * @param {Map<string, object>} lookup Net lookup map.
     * @returns {object | null}
     */
    static #primitiveNetEntry(primitive, lookup) {
        for (const candidate of [
            primitive.netName,
            primitive.sourceNetId,
            primitive.pcbNetId,
            primitive.source?.source_net_id,
            primitive.source?.pcb_net_id
        ]) {
            const key = String(candidate || '').trim()
            if (key && lookup.has(key)) return lookup.get(key)
        }
        return null
    }

    /**
     * Builds a lookup keyed by net names and source IDs.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {Map<string, object>}
     */
    static #lookup(index) {
        const lookup = new Map()
        for (const entry of CircuitJsonPcbNetMetadata.#entries(index)) {
            for (const key of [entry.name, entry.sourceNetId, entry.pcbNetId]) {
                const text = String(key || '').trim()
                if (text) lookup.set(text, entry)
            }
        }
        return lookup
    }

    /**
     * Builds explicit net entries from source and PCB net rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @returns {object[]}
     */
    static #entries(index) {
        const sourceRows = CircuitJsonPcbNetMetadata.#all(index, 'source_net')
        const pcbRows = CircuitJsonPcbNetMetadata.#all(index, 'pcb_net')
        const pcbBySourceId = new Map(
            pcbRows
                .map((row) => [String(row.source_net_id || '').trim(), row])
                .filter(([id]) => id)
        )
        const entries = []

        for (const source of sourceRows) {
            const sourceNetId = String(source.source_net_id || '').trim()
            const pcbNet = pcbBySourceId.get(sourceNetId) || {}
            const entry = CircuitJsonPcbNetMetadata.#entry(source, pcbNet)
            if (entry) entries.push(entry)
        }

        for (const pcbNet of pcbRows) {
            const sourceNetId = String(pcbNet.source_net_id || '').trim()
            if (sourceNetId && pcbBySourceId.has(sourceNetId)) continue
            const entry = CircuitJsonPcbNetMetadata.#entry({}, pcbNet)
            if (entry) entries.push(entry)
        }

        return entries
    }

    /**
     * Builds one explicit net entry.
     * @param {object} source Source net row.
     * @param {object} pcbNet PCB net row.
     * @returns {object | null}
     */
    static #entry(source, pcbNet) {
        const sourceNetId = String(
            source.source_net_id || pcbNet.source_net_id || ''
        ).trim()
        const pcbNetId = String(pcbNet.pcb_net_id || '').trim()
        const name = String(
            pcbNet.name ||
                pcbNet.net ||
                source.name ||
                source.net ||
                sourceNetId ||
                pcbNetId ||
                ''
        ).trim()
        if (!name) return null

        return CircuitJsonPcbNetMetadata.#clean({
            name,
            sourceNetId,
            pcbNetId,
            groupIds: CircuitJsonPcbNetMetadata.#groupIds(source, pcbNet),
            highlightColor: CircuitJsonPcbNetMetadata.#safeColor(
                pcbNet.highlight_color || pcbNet.highlightColor || pcbNet.color
            )
        })
    }

    /**
     * Resolves group ids from explicit net metadata.
     * @param {object} source Source net row.
     * @param {object} pcbNet PCB net row.
     * @returns {string[]}
     */
    static #groupIds(source, pcbNet) {
        return CircuitJsonPcbNetMetadata.#uniqueStrings(
            [source, pcbNet].flatMap((row) => [
                row?.source_group_id,
                row?.pcb_group_id,
                row?.schematic_group_id,
                row?.group_id,
                row?.member_source_group_id,
                row?.member_pcb_group_id,
                row?.member_schematic_group_id,
                row?.member_group_id,
                ...CircuitJsonPcbNetMetadata.#arrayValues(row?.group_ids),
                ...CircuitJsonPcbNetMetadata.#arrayValues(
                    row?.member_source_group_ids
                ),
                ...CircuitJsonPcbNetMetadata.#arrayValues(
                    row?.member_pcb_group_ids
                ),
                ...CircuitJsonPcbNetMetadata.#arrayValues(
                    row?.member_schematic_group_ids
                ),
                ...CircuitJsonPcbNetMetadata.#arrayValues(row?.member_group_ids)
            ])
        )
    }

    /**
     * Returns array values when the candidate is an array.
     * @param {unknown} value Candidate value.
     * @returns {unknown[]}
     */
    static #arrayValues(value) {
        return Array.isArray(value) ? value : []
    }

    /**
     * Resolves unique non-empty strings.
     * @param {unknown[]} values Candidate values.
     * @returns {string[]}
     */
    static #uniqueStrings(values) {
        return [...new Set(values.map((value) => String(value || '').trim()))]
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right))
    }

    /**
     * Removes empty metadata fields.
     * @param {object} entry Net entry.
     * @returns {object}
     */
    static #clean(entry) {
        return Object.fromEntries(
            Object.entries(entry).filter(([_key, value]) =>
                String(value || '').trim()
            )
        )
    }

    /**
     * Resolves indexed element rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Element index.
     * @param {string} type Element type.
     * @returns {object[]}
     */
    static #all(index, type) {
        return index.elementsByType.get(type) || []
    }

    /**
     * Returns a color safe for SVG attributes and CSS variables.
     * @param {unknown} value Color candidate.
     * @returns {string}
     */
    static #safeColor(value) {
        const text = String(value || '').trim()
        return /^#[0-9a-f]{3,8}$/iu.test(text) ? text : ''
    }
}

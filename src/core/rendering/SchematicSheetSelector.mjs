const SELECTED_SCOPE = 1
const OTHER_SCOPE = 2

/**
 * Selects one CircuitJSON schematic sheet through explicit and owned relations.
 */
export class SchematicSheetSelector {
    /**
     * Builds an element-index view for one schematic sheet.
     * @param {{ elements?: object[], elementsByType: Map<string, object[]> }} index Full element index.
     * @param {string} sheetId Selected sheet id.
     * @returns {{ elements: object[], elementsByType: Map<string, object[]>, statistics: { scopeUpdates: number, scopedElements: number } }} Sheet index view.
     */
    static select(index, sheetId) {
        const elements = Array.isArray(index.elements)
            ? index.elements
            : Array.from(index.elementsByType.values()).flat()
        const sheetCount = (index.elementsByType.get('schematic_sheet') || [])
            .length
        const scoped = SchematicSheetSelector.#scopes(elements, sheetId)
        const elementsByType = new Map()
        const selectedElements = []
        for (const [type, rows] of index.elementsByType) {
            if (!type.startsWith('schematic_')) continue
            const selected = rows.filter((element) =>
                SchematicSheetSelector.#belongs(
                    element,
                    type,
                    sheetId,
                    sheetCount,
                    scoped.masks
                )
            )
            if (selected.length) {
                elementsByType.set(type, selected)
                for (const element of selected) {
                    selectedElements.push(element)
                }
            }
        }
        SchematicSheetSelector.#appendReferencedSources(
            index,
            selectedElements,
            elementsByType,
            'source_component',
            'source_component_id'
        )
        SchematicSheetSelector.#appendReferencedSources(
            index,
            selectedElements,
            elementsByType,
            'source_port',
            'source_port_id'
        )
        for (const [type, rows] of elementsByType) {
            if (!type.startsWith('source_')) continue
            for (const row of rows) selectedElements.push(row)
        }
        return {
            elements: selectedElements,
            elementsByType,
            statistics: {
                scopeUpdates: scoped.updates,
                scopedElements: scoped.masks.size
            }
        }
    }

    /**
     * Retains only source rows directly referenced by selected schematic rows.
     * @param {{ elementsByType: Map<string, object[]> }} index Full index.
     * @param {object[]} selectedElements Selected schematic rows.
     * @param {Map<string, object[]>} elementsByType Selected type map.
     * @param {string} sourceType Source element type.
     * @param {string} idField Qualified id field.
     * @returns {void}
     */
    static #appendReferencedSources(
        index,
        selectedElements,
        elementsByType,
        sourceType,
        idField
    ) {
        const ids = new Set(
            selectedElements
                .map((element) => String(element[idField] || ''))
                .filter(Boolean)
        )
        const sources = (index.elementsByType.get(sourceType) || []).filter(
            (element) => ids.has(String(element[idField] || ''))
        )
        if (sources.length) elementsByType.set(sourceType, sources)
    }

    /**
     * Resolves constant-size target/other scope masks through ownership.
     * @param {object[]} elements CircuitJSON elements.
     * @param {string} targetSheetId Selected sheet id.
     * @returns {{ masks: Map<object, number>, updates: number }} Scope state.
     */
    static #scopes(elements, targetSheetId) {
        const schematicElements = elements.filter((element) =>
            String(element.type || '').startsWith('schematic_')
        )
        const masks = new Map(schematicElements.map((element) => [element, 0]))
        const references = SchematicSheetSelector.#references(schematicElements)
        const subcircuitMasks = new Map()
        let updates = 0
        for (const element of schematicElements) {
            if (element.type !== 'schematic_sheet') continue
            const sheetId = String(element.schematic_sheet_id || '')
            const subcircuitId = String(element.subcircuit_id || '')
            if (!sheetId || !subcircuitId) continue
            const mask =
                sheetId === targetSheetId ? SELECTED_SCOPE : OTHER_SCOPE
            subcircuitMasks.set(
                subcircuitId,
                (subcircuitMasks.get(subcircuitId) || 0) | mask
            )
        }
        const explicit = new Set()
        for (const element of schematicElements) {
            const sheetId = String(element.schematic_sheet_id || '')
            if (!sheetId) continue
            masks.set(
                element,
                sheetId === targetSheetId ? SELECTED_SCOPE : OTHER_SCOPE
            )
            explicit.add(element)
            updates += 1
        }
        const dependents = SchematicSheetSelector.#dependents(
            schematicElements,
            references
        )
        updates += SchematicSheetSelector.#propagateScopes(
            masks,
            dependents,
            [...explicit],
            explicit
        )
        const authoritative = new Set(
            schematicElements.filter((element) => masks.get(element))
        )
        const fallback = []
        for (const element of schematicElements) {
            if (masks.get(element)) continue
            const mask =
                subcircuitMasks.get(String(element.subcircuit_id || '')) || 0
            if (!mask) continue
            masks.set(element, mask)
            fallback.push(element)
            updates += 1
        }
        updates += SchematicSheetSelector.#propagateScopes(
            masks,
            dependents,
            fallback,
            authoritative
        )
        return { masks, updates }
    }

    /**
     * Builds owner-to-dependent scope relationships.
     * @param {object[]} elements Schematic elements.
     * @param {Map<string, object>} references Qualified id lookup.
     * @returns {Map<object, Set<object>>} Dependency graph.
     */
    static #dependents(elements, references) {
        const dependents = new Map(
            elements.map((element) => [element, new Set()])
        )
        for (const element of elements) {
            for (const owner of SchematicSheetSelector.#owners(
                element,
                references
            )) {
                dependents.get(owner)?.add(element)
            }
            if (element.type === 'schematic_component') {
                const symbol = references.get(
                    'schematic_symbol_id:' +
                        String(element.schematic_symbol_id || '')
                )
                if (symbol) dependents.get(element)?.add(symbol)
            }
            if (element.type === 'schematic_group') {
                for (const member of SchematicSheetSelector.#groupMembers(
                    element,
                    references
                )) {
                    dependents.get(element)?.add(member)
                    dependents.get(member)?.add(element)
                }
            }
        }
        return dependents
    }

    /**
     * Propagates two-bit scope masks through ownership dependencies.
     * @param {Map<object, number>} masks Mutable masks.
     * @param {Map<object, Set<object>>} dependents Owner-to-dependent graph.
     * @param {object[]} seeds Initially resolved elements.
     * @param {Set<object>} protectedElements Authoritative elements.
     * @returns {number} Number of bounded mask updates.
     */
    static #propagateScopes(masks, dependents, seeds, protectedElements) {
        let updates = 0
        const queue = [...seeds]
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const owner = queue[cursor]
            for (const dependent of dependents.get(owner) || []) {
                if (protectedElements.has(dependent)) continue
                const current = masks.get(dependent) || 0
                const merged = current | (masks.get(owner) || 0)
                if (merged === current) continue
                masks.set(dependent, merged)
                queue.push(dependent)
                updates += 1
            }
        }
        return updates
    }

    /**
     * Builds ownership lookup maps for schematic relation ids.
     * @param {object[]} elements CircuitJSON elements.
     * @returns {Map<string, object>} Qualified owner lookup.
     */
    static #references(elements) {
        const result = new Map()
        for (const element of elements) {
            const field = String(element.type || '') + '_id'
            const value = element[field]
            if (
                field.startsWith('schematic_') &&
                typeof value === 'string' &&
                value
            ) {
                result.set(field + ':' + value, element)
            }
        }
        return result
    }

    /**
     * Resolves direct owner elements, including nested trace endpoints.
     * @param {object} element CircuitJSON element.
     * @param {Map<string, object>} references Qualified owner lookup.
     * @returns {object[]} Referenced owners.
     */
    static #owners(element, references) {
        const owners = new Set()
        const ownIdField = String(element.type || '') + '_id'
        for (const [field, value] of SchematicSheetSelector.#nestedFields(
            element
        )) {
            const match = field.match(/(schematic_[a-z0-9_]+_id)$/u)
            const ownerField = match?.[1] || ''
            if (
                !ownerField ||
                ownerField === 'schematic_sheet_id' ||
                ownerField === ownIdField ||
                typeof value !== 'string'
            ) {
                continue
            }
            const owner = references.get(ownerField + ':' + value)
            if (owner && owner !== element) owners.add(owner)
        }
        return [...owners]
    }

    /**
     * Resolves group member components for bidirectional scope inference.
     * @param {object} group Schematic group.
     * @param {Map<string, object>} references Qualified owner lookup.
     * @returns {object[]} Member components.
     */
    static #groupMembers(group, references) {
        return (
            Array.isArray(group.schematic_component_ids)
                ? group.schematic_component_ids
                : []
        )
            .map((id) =>
                references.get('schematic_component_id:' + String(id || ''))
            )
            .filter(Boolean)
    }

    /**
     * Streams scalar fields in validated nested CircuitJSON data.
     * @param {object} root Root element.
     * @returns {Generator<[string, unknown], void, unknown>} Field/value pairs.
     */
    static *#nestedFields(root) {
        const stack = [root]
        const seen = new WeakSet()
        while (stack.length) {
            const value = stack.pop()
            if (!value || typeof value !== 'object' || seen.has(value)) continue
            seen.add(value)
            if (Array.isArray(value)) {
                for (const entry of value) stack.push(entry)
                continue
            }
            for (const [field, entry] of Object.entries(value)) {
                yield [field, entry]
                if (entry && typeof entry === 'object') stack.push(entry)
            }
        }
    }

    /**
     * Returns whether one element belongs in the selected sheet view.
     * @param {object} element CircuitJSON element.
     * @param {string} type Element type.
     * @param {string} sheetId Selected sheet id.
     * @param {number} sheetCount Document sheet count.
     * @param {Map<object, number>} masks Resolved two-bit scopes.
     * @returns {boolean} Whether to retain the row.
     */
    static #belongs(element, type, sheetId, sheetCount, masks) {
        if (type === 'schematic_sheet') {
            return element.schematic_sheet_id === sheetId
        }
        const mask = masks.get(element) || 0
        if (mask) return Boolean(mask & SELECTED_SCOPE)
        return sheetCount <= 1
    }
}

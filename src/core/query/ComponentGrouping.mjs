const COMPONENT_VALUE_FIELDS_BY_TYPE = Object.freeze({
    simple_battery: ['capacity'],
    simple_capacitor: ['display_capacitance', 'capacitance'],
    simple_crystal: ['frequency'],
    simple_current_source: ['current'],
    simple_fuse: ['current_rating_amps'],
    simple_inductor: ['display_inductance', 'inductance'],
    simple_potentiometer: ['display_max_resistance', 'max_resistance'],
    simple_power_source: ['voltage'],
    simple_resistor: ['display_resistance', 'resistance'],
    simple_resonator: ['frequency'],
    simple_voltage_source: ['voltage']
})
const COMPONENT_VALUE_FALLBACK_FIELDS = [
    'display_resistance',
    'display_capacitance',
    'display_inductance',
    'display_max_resistance',
    'resistance',
    'capacitance',
    'inductance',
    'frequency',
    'max_resistance',
    'voltage',
    'current',
    'capacity'
]

/**
 * Builds deterministic component and net records from prepared CircuitJSON indexes.
 */
export class ComponentGrouping {
    /**
     * Builds source-component rows with their canonical source-port ids.
     * @param {Record<string, any>} elementsIndex Prepared elements index.
     * @param {Record<string, any>} relationsIndex Prepared relations index.
     * @returns {object[]} Stable component records.
     */
    static components(elementsIndex, relationsIndex) {
        const components =
            elementsIndex.elementsByType.get('source_component') || []
        const byComponent =
            relationsIndex.relationsByField.get('source_component_id') ||
            new Map()
        return components
            .map((component) => {
                const id = String(component.source_component_id || '').trim()
                const related = byComponent.get(id) || []
                const pins = related
                    .filter((element) => element?.type === 'source_port')
                    .map((port) => ComponentGrouping.#pin(port))
                    .sort((left, right) =>
                        ComponentGrouping.compareIds(left.id, right.id)
                    )
                return ComponentGrouping.#withoutEmpty({
                    id,
                    name: String(
                        component.display_name || component.name || id
                    ),
                    designator: String(component.name || id),
                    type: String(component.ftype || ''),
                    value: ComponentGrouping.#componentValue(component),
                    footprint: ComponentGrouping.#footprint(component, related),
                    mpn: ComponentGrouping.#mpn(component),
                    description: ComponentGrouping.#text(component.description),
                    doNotPopulate:
                        component.do_not_populate === true ||
                        component.exclude_from_bom === true,
                    pinIds: pins.map((pin) => pin.id),
                    pins
                })
            })
            .filter((component) => component.id)
            .sort((left, right) =>
                ComponentGrouping.compareIds(left.id, right.id)
            )
    }

    /**
     * Builds source-net rows with trace and port membership.
     * @param {Record<string, any>} elementsIndex Prepared elements index.
     * @param {object[]} traces Canonical trace records.
     * @returns {object[]} Stable net records.
     */
    static nets(elementsIndex, traces) {
        const nets = elementsIndex.elementsByType.get('source_net') || []
        const tracesByNetId = new Map()
        for (const trace of traces) {
            for (const netId of trace.sourceNetIds) {
                if (!tracesByNetId.has(netId)) {
                    tracesByNetId.set(netId, [])
                }
                tracesByNetId.get(netId).push(trace)
            }
        }
        return nets
            .map((net) => {
                const id = String(net.source_net_id || '').trim()
                const connected = tracesByNetId.get(id) || []
                return {
                    id,
                    name: String(net.name || id),
                    traceIds: connected.map((trace) => trace.id),
                    portIds: [
                        ...new Set(
                            connected.flatMap((trace) => trace.sourcePortIds)
                        )
                    ].sort(ComponentGrouping.compareIds)
                }
            })
            .filter((net) => net.id)
            .sort((left, right) =>
                ComponentGrouping.compareIds(left.id, right.id)
            )
    }

    /**
     * Compares stable ids without locale-dependent collation.
     * @param {unknown} left Left id.
     * @param {unknown} right Right id.
     * @returns {number} Sort order.
     */
    static compareIds(left, right) {
        const leftText = String(left || '')
        const rightText = String(right || '')
        return leftText < rightText ? -1 : leftText > rightText ? 1 : 0
    }

    /**
     * Builds one canonical source-port record.
     * @param {Record<string, any>} port Source port.
     * @returns {object} Port record.
     */
    static #pin(port) {
        return ComponentGrouping.#withoutEmpty({
            id: String(port.source_port_id || '').trim(),
            name: ComponentGrouping.#text(port.name),
            pinNumber:
                port.pin_number === undefined ? undefined : port.pin_number,
            netIds: ComponentGrouping.#ids([
                port.source_net_id,
                port.connected_source_net_id,
                port.source_net_ids,
                port.connected_source_net_ids
            ])
        })
    }

    /**
     * Resolves the first linked PCB footprint before legacy source fields.
     * @param {Record<string, any>} component Source component.
     * @param {object[]} related Elements related by source-component id.
     * @returns {string | undefined} Footprint name.
     */
    static #footprint(component, related) {
        const pcbComponents = related
            .filter((element) => element?.type === 'pcb_component')
            .sort((left, right) =>
                ComponentGrouping.compareIds(
                    left.pcb_component_id,
                    right.pcb_component_id
                )
            )
        for (const pcbComponent of pcbComponents) {
            const footprint = ComponentGrouping.#text(
                pcbComponent.metadata?.kicad_footprint?.footprintName
            )
            if (footprint) return footprint
        }
        return ComponentGrouping.#text(
            component.footprint || component.footprint_name
        )
    }

    /**
     * Resolves standard display and typed source-component values.
     * @param {Record<string, any>} component Source component.
     * @returns {string | undefined} Canonical display value.
     */
    static #componentValue(component) {
        const typedFields =
            COMPONENT_VALUE_FIELDS_BY_TYPE[String(component.ftype || '')] || []
        const fields = [
            'display_value',
            ...typedFields,
            'value',
            ...COMPONENT_VALUE_FALLBACK_FIELDS
        ]
        for (const field of new Set(fields)) {
            const value = ComponentGrouping.#scalarText(component[field])
            if (value !== undefined) return value
        }
        return undefined
    }

    /**
     * Resolves the first source-native manufacturer/supplier part number.
     * @param {Record<string, any>} component Source component.
     * @returns {string | undefined} Part number.
     */
    static #mpn(component) {
        const direct = ComponentGrouping.#text(
            component.manufacturer_part_number ||
                component.mpn ||
                component.part_number
        )
        if (direct) return direct
        const suppliers = component.supplier_part_numbers
        if (!suppliers || typeof suppliers !== 'object') return undefined
        for (const value of Object.values(suppliers)) {
            const candidates = Array.isArray(value) ? value : [value]
            for (const candidate of candidates) {
                const text = ComponentGrouping.#text(candidate)
                if (text) return text
            }
        }
        return undefined
    }

    /**
     * Flattens scalar/array relation ids into a stable unique list.
     * @param {unknown[]} values Relation values.
     * @returns {string[]} Stable ids.
     */
    static #ids(values) {
        return [
            ...new Set(
                values
                    .flatMap((value) =>
                        Array.isArray(value) ? value : [value]
                    )
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            )
        ].sort(ComponentGrouping.compareIds)
    }

    /**
     * Normalizes optional text without executing caller coercion hooks.
     * @param {unknown} value Text candidate.
     * @returns {string | undefined} Normalized text.
     */
    static #text(value) {
        return typeof value === 'string' && value.trim()
            ? value.trim()
            : undefined
    }

    /**
     * Normalizes a string or finite numeric scalar for query matching.
     * @param {unknown} value Scalar candidate.
     * @returns {string | undefined} Normalized scalar text.
     */
    static #scalarText(value) {
        if (typeof value === 'string') return ComponentGrouping.#text(value)
        return typeof value === 'number' && Number.isFinite(value)
            ? String(value)
            : undefined
    }

    /**
     * Omits undefined, empty-string, and false optional fields.
     * @param {Record<string, any>} record Record candidate.
     * @returns {Record<string, any>} Compact record.
     */
    static #withoutEmpty(record) {
        return Object.fromEntries(
            Object.entries(record).filter(([, value]) => {
                if (value === undefined || value === '') return false
                if (value === false) return false
                return true
            })
        )
    }
}

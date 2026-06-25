const COMPONENT_ICON_BY_TYPE = {
    battery: 'battery',
    capacitor: 'capacitor',
    chip: 'chip',
    connector: 'connector',
    crystal: 'crystal',
    current_source: 'source',
    diode: 'diode',
    fiducial: 'fiducial',
    fuse: 'fuse',
    ground: 'ground',
    inductor: 'inductor',
    interconnect: 'connector',
    led: 'led',
    mosfet: 'transistor',
    op_amp: 'op-amp',
    pin_header: 'connector',
    potentiometer: 'potentiometer',
    push_button: 'switch',
    resistor: 'resistor',
    resonator: 'crystal',
    switch: 'switch',
    test_point: 'test-point',
    transistor: 'transistor',
    voltage_probe: 'probe',
    voltage_source: 'source'
}

/**
 * Normalizes generic source-level CircuitJSON metadata for stable consumers.
 */
export class CircuitJsonSourceMetadata {
    /**
     * Builds a safe source net name from display-oriented text.
     * @param {unknown} value Source net label.
     * @param {{ fallback?: string, usedNames?: Set<string> }} [options]
     * @returns {string}
     */
    static normalizeSourceNetName(value, options = {}) {
        const fallback = String(options.fallback || 'net').trim() || 'net'
        let name = String(value || '').trim() || fallback
        name = name
            .replaceAll('+', '_P')
            .replaceAll('-', '_')
            .replace(/[^A-Za-z0-9_]+/gu, '_')
            .replace(/_+/gu, '_')
            .replace(/_+$/u, '')
        if (!name) {
            name = fallback.replace(/[^A-Za-z0-9_]+/gu, '_') || 'net'
        }
        if (/^[0-9]/u.test(name)) {
            name = 'net_' + name
        }
        return CircuitJsonSourceMetadata.#dedupeName(name, options.usedNames)
    }

    /**
     * Builds a stable source port name from a pad or pin label.
     * @param {unknown} value Source port label.
     * @param {{ fallback?: string, usedNames?: Set<string> }} [options]
     * @returns {string}
     */
    static normalizeSourcePortName(value, options = {}) {
        const text = String(value ?? '').trim()
        const fallback = String(options.fallback || 'pin').trim() || 'pin'
        const name = /^[0-9]+$/u.test(text) ? 'pin' + Number(text) : text
        return CircuitJsonSourceMetadata.#dedupeName(
            name || fallback,
            options.usedNames
        )
    }

    /**
     * Builds stable semantic metadata for one source component.
     * @param {object} component Source component row.
     * @returns {{ sourceFtype: string, componentType: string, componentIcon: string, supplierPartNumber: string, supplierPartNumbers: Record<string, string> }}
     */
    static normalizeSourceComponent(component) {
        const sourceFtype =
            CircuitJsonSourceMetadata.#sourceFtype(component) ||
            CircuitJsonSourceMetadata.#inferSourceFtype(component)
        const componentType = sourceFtype
            .replace(/^simple_/u, '')
            .replaceAll('_', '-')
        const supplierPartNumbers =
            CircuitJsonSourceMetadata.#supplierPartNumbers(component)
        return {
            sourceFtype,
            componentType,
            componentIcon:
                COMPONENT_ICON_BY_TYPE[componentType.replaceAll('-', '_')] ||
                componentType ||
                'component',
            supplierPartNumber: String(
                Object.values(supplierPartNumbers).find(Boolean) || ''
            ).trim(),
            supplierPartNumbers
        }
    }

    /**
     * Returns a unique name against an optional used-name set.
     * @param {string} name Base name.
     * @param {Set<string> | undefined} usedNames Existing names.
     * @returns {string}
     */
    static #dedupeName(name, usedNames) {
        if (!(usedNames instanceof Set) || !usedNames.has(name)) return name
        let index = 2
        let candidate = name + '_' + index
        while (usedNames.has(candidate)) {
            index += 1
            candidate = name + '_' + index
        }
        return candidate
    }

    /**
     * Resolves an explicit source component function type.
     * @param {object} component Source component row.
     * @returns {string}
     */
    static #sourceFtype(component) {
        return String(component?.ftype || component?.sourceFtype || '').trim()
    }

    /**
     * Infers a source component function type from generic fields.
     * @param {object} component Source component row.
     * @returns {string}
     */
    static #inferSourceFtype(component) {
        const reference = String(
            component?.name ||
                component?.reference ||
                component?.designator ||
                ''
        ).trim()
        const text = [
            reference,
            component?.footprint,
            component?.package,
            component?.package_name,
            component?.value,
            component?.description
        ]
            .map((value) => String(value || '').toLowerCase())
            .filter(Boolean)
            .join(' ')

        if (text.includes('led')) return 'simple_led'
        if (/^tp[0-9A-Z_-]*/iu.test(reference) || text.includes('test point')) {
            return 'simple_test_point'
        }
        if (/^fid[0-9A-Z_-]*/iu.test(reference) || text.includes('fiducial')) {
            return 'simple_fiducial'
        }
        if (/^sw[0-9A-Z_-]*/iu.test(reference) || text.includes('switch')) {
            return 'simple_switch'
        }
        if (/^r[0-9A-Z_-]*/iu.test(reference) || component?.resistance) {
            return 'simple_resistor'
        }
        if (/^c[0-9A-Z_-]*/iu.test(reference) || component?.capacitance) {
            return 'simple_capacitor'
        }
        if (/^l[0-9A-Z_-]*/iu.test(reference) || component?.inductance) {
            return 'simple_inductor'
        }
        if (text.includes('mosfet')) return 'simple_mosfet'
        if (/^q[0-9A-Z_-]*/iu.test(reference) || text.includes('transistor')) {
            return 'simple_transistor'
        }
        if (/^d[0-9A-Z_-]*/iu.test(reference)) return 'simple_diode'
        if (/^(u|ic)[0-9A-Z_-]*/iu.test(reference) || text.includes('chip')) {
            return 'simple_chip'
        }
        return ''
    }

    /**
     * Normalizes supplier part fields into a stable keyed object.
     * @param {object} component Source component row.
     * @returns {Record<string, string>}
     */
    static #supplierPartNumbers(component) {
        const numbers = {}
        for (const field of ['supplier_part_numbers', 'supplierPartNumbers']) {
            const value = component?.[field]
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                continue
            }
            for (const [key, entry] of Object.entries(value)) {
                const normalized = String(entry || '').trim()
                if (normalized) numbers[String(key || 'supplier')] = normalized
            }
        }
        CircuitJsonSourceMetadata.#addSupplierNumber(
            numbers,
            'supplier',
            component?.supplier_part_number ?? component?.supplierPartNumber
        )
        CircuitJsonSourceMetadata.#addSupplierNumber(
            numbers,
            'distributor',
            component?.distributor_part_number ??
                component?.distributorPartNumber
        )
        CircuitJsonSourceMetadata.#addSupplierNumber(
            numbers,
            'assembly',
            component?.assembly_part_number ?? component?.assemblyPartNumber
        )
        CircuitJsonSourceMetadata.#addSupplierNumber(
            numbers,
            'catalog',
            component?.catalog_part_number ?? component?.catalogPartNumber
        )
        return numbers
    }

    /**
     * Adds one supplier part number when present.
     * @param {Record<string, string>} numbers Supplier number map.
     * @param {string} key Supplier key.
     * @param {unknown} value Supplier part value.
     * @returns {void}
     */
    static #addSupplierNumber(numbers, key, value) {
        const normalized = String(value || '').trim()
        if (normalized && !numbers[key]) numbers[key] = normalized
    }
}

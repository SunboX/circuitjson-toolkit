import { CIRCUIT_JSON_UPSTREAM_SCHEMAS } from './CircuitJsonUpstreamSchema.mjs'
import { CircuitJsonToolkitElementSchema } from './CircuitJsonToolkitElementSchema.mjs'

const DATETIME_PATTERNS = new Map()
const OBJECT_KEYS = new WeakMap()

/**
 * Validates safe plain-data values against the generated upstream contract.
 */
export class CircuitJsonUpstreamValidator {
    /**
     * Validates one already descriptor-safe CircuitJSON element.
     * @param {Record<string, any>} value Element value.
     * @param {string} type Element type.
     * @param {string} [location] Human-readable location suffix.
     * @returns {string[]} Empty on success or one validation error.
     */
    static validate(value, type, location = '') {
        const schema = CIRCUIT_JSON_UPSTREAM_SCHEMAS[type]
        if (!schema) {
            if (CircuitJsonToolkitElementSchema.has(type)) {
                return CircuitJsonToolkitElementSchema.validate(
                    value,
                    type,
                    location
                )
            }
            return [`Unsupported CircuitJSON element type: ${type}.`]
        }
        const matches =
            type === 'source_net'
                ? CircuitJsonUpstreamValidator.#sourceNet(value)
                : CircuitJsonUpstreamValidator.#matches(schema, value)
        if (!matches) {
            return [
                `CircuitJSON element ${type}${location} does not match the pinned upstream schema.`
            ]
        }
        return CircuitJsonToolkitElementSchema.validateExtensions(
            value,
            type,
            location
        )
    }

    /**
     * Validates the benchmark-hot source-net schema without interpreter dispatch.
     * @param {Record<string, any>} value Source-net value.
     * @returns {boolean} Whether the complete upstream schema matches.
     */
    static #sourceNet(value) {
        if (
            value.type !== 'source_net' ||
            typeof value.source_net_id !== 'string' ||
            typeof value.name !== 'string' ||
            !CircuitJsonUpstreamValidator.#stringArray(
                value.member_source_group_ids
            )
        ) {
            return false
        }
        for (const field of [
            'is_power',
            'is_ground',
            'is_digital_signal',
            'is_analog_signal',
            'is_positive_voltage_source'
        ]) {
            if (
                value[field] !== undefined &&
                typeof value[field] !== 'boolean'
            ) {
                return false
            }
        }
        if (
            value.trace_width !== undefined &&
            (typeof value.trace_width !== 'number' ||
                Number.isNaN(value.trace_width))
        ) {
            return false
        }
        for (const field of [
            'subcircuit_id',
            'subcircuit_connectivity_map_key'
        ]) {
            if (
                value[field] !== undefined &&
                typeof value[field] !== 'string'
            ) {
                return false
            }
        }
        return true
    }

    /** @param {unknown} value String-array candidate. @returns {boolean} */
    static #stringArray(value) {
        if (!Array.isArray(value)) return false
        for (let index = 0; index < value.length; index += 1) {
            if (typeof value[index] !== 'string') return false
        }
        return true
    }

    /**
     * Interprets one compact generated schema node.
     * @param {any} node Compact schema node.
     * @param {unknown} value Candidate value.
     * @returns {boolean} Whether the value matches.
     */
    static #matches(node, value) {
        if (typeof node === 'string') {
            if (node === 'a') return true
            if (node === 'x') return false
            if (node === 'b') return typeof value === 'boolean'
            if (node === 's') return typeof value === 'string'
            if (node === 'n') {
                return typeof value === 'number' && !Number.isNaN(value)
            }
            return false
        }

        const tag = node[0]
        if (tag === 'l') return value === node[1]
        if (tag === 'e') return node[1].includes(value)
        if (tag === '?') {
            return (
                value === undefined ||
                CircuitJsonUpstreamValidator.#matches(node[1], value)
            )
        }
        if (tag === '0') {
            return (
                value === null ||
                CircuitJsonUpstreamValidator.#matches(node[1], value)
            )
        }
        if (tag === 's') {
            return CircuitJsonUpstreamValidator.#string(node[1], value)
        }
        if (tag === 'n') {
            return CircuitJsonUpstreamValidator.#number(node[1], value)
        }
        if (tag === 'A') {
            return CircuitJsonUpstreamValidator.#array(node, value)
        }
        if (tag === 't') {
            return CircuitJsonUpstreamValidator.#tuple(node[1], value)
        }
        if (tag === 'o') {
            return CircuitJsonUpstreamValidator.#object(node[1], value)
        }
        if (tag === 'r') {
            return CircuitJsonUpstreamValidator.#record(node, value)
        }
        if (tag === 'u') {
            for (let index = 1; index < node.length; index += 1) {
                if (CircuitJsonUpstreamValidator.#matches(node[index], value)) {
                    return true
                }
            }
            return false
        }
        if (tag === 'p') {
            return CircuitJsonUpstreamValidator.#percentagePipeline(node, value)
        }
        if (tag === 'c') {
            return CircuitJsonUpstreamValidator.#custom(node, value)
        }
        return false
    }

    /** @param {any[]} checks String checks. @param {unknown} value Candidate. @returns {boolean} */
    static #string(checks, value) {
        if (typeof value !== 'string') return false
        for (const check of checks) {
            if (check[0] === 'end') {
                if (!value.endsWith(check[1])) return false
                continue
            }
            if (check[0] === 'dt') {
                if (
                    !CircuitJsonUpstreamValidator.#datetime(check).test(value)
                ) {
                    return false
                }
                continue
            }
            return false
        }
        return true
    }

    /** @param {any[]} checks Number checks. @param {unknown} value Candidate. @returns {boolean} */
    static #number(checks, value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return false
        for (const [kind, limit, inclusive] of checks) {
            if (
                kind === 'min' &&
                (inclusive ? value < limit : value <= limit)
            ) {
                return false
            }
            if (
                kind === 'max' &&
                (inclusive ? value > limit : value >= limit)
            ) {
                return false
            }
            if (kind !== 'min' && kind !== 'max') return false
        }
        return true
    }

    /** @param {any[]} node Array node. @param {unknown} value Candidate. @returns {boolean} */
    static #array(node, value) {
        if (!Array.isArray(value)) return false
        const minimum = node[2]
        const maximum = node[3]
        if (minimum !== null && value.length < minimum) return false
        if (maximum !== null && value.length > maximum) return false
        for (let index = 0; index < value.length; index += 1) {
            if (!CircuitJsonUpstreamValidator.#matches(node[1], value[index])) {
                return false
            }
        }
        return true
    }

    /** @param {any[]} schemas Tuple item schemas. @param {unknown} value Candidate. @returns {boolean} */
    static #tuple(schemas, value) {
        if (!Array.isArray(value) || value.length !== schemas.length) {
            return false
        }
        for (let index = 0; index < schemas.length; index += 1) {
            if (
                !CircuitJsonUpstreamValidator.#matches(
                    schemas[index],
                    value[index]
                )
            ) {
                return false
            }
        }
        return true
    }

    /** @param {Record<string, any>} properties Property schemas. @param {unknown} value Candidate. @returns {boolean} */
    static #object(properties, value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false
        }
        let keys = OBJECT_KEYS.get(properties)
        if (!keys) {
            keys = Object.keys(properties)
            OBJECT_KEYS.set(properties, keys)
        }
        for (const key of keys) {
            const fieldSchema = properties[key]
            const present = Object.hasOwn(value, key)
            if (
                !present &&
                Array.isArray(fieldSchema) &&
                fieldSchema[0] === '?'
            ) {
                continue
            }
            const field = present ? value[key] : undefined
            if (!CircuitJsonUpstreamValidator.#matches(fieldSchema, field)) {
                return false
            }
        }
        return true
    }

    /** @param {any[]} node Record node. @param {unknown} value Candidate. @returns {boolean} */
    static #record(node, value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false
        }
        for (const [key, field] of Object.entries(value)) {
            if (
                !CircuitJsonUpstreamValidator.#matches(node[1], key) ||
                !CircuitJsonUpstreamValidator.#matches(node[2], field)
            ) {
                return false
            }
        }
        return true
    }

    /** @param {any[]} node Pipeline node. @param {unknown} value Candidate. @returns {boolean} */
    static #percentagePipeline(node, value) {
        if (!CircuitJsonUpstreamValidator.#matches(node[1], value)) return false
        let transformed = value
        if (typeof transformed === 'string') {
            transformed = transformed.endsWith('%')
                ? Number.parseFloat(transformed.slice(0, -1)) / 100
                : Number.parseFloat(transformed)
        }
        return CircuitJsonUpstreamValidator.#matches(node[2], transformed)
    }

    /** @param {any[]} node Custom node. @param {unknown} value Candidate. @returns {boolean} */
    static #custom(node, value) {
        if (!CircuitJsonUpstreamValidator.#matches(node[2], value)) return false
        if (node[1] === 'battery') {
            return (
                typeof value !== 'string' ||
                !Number.isNaN(Number.parseFloat(value.replace('mAh', '')))
            )
        }
        if (node[1] === 'siUnitTransform') {
            return CircuitJsonUpstreamValidator.#siUnitTransform(value)
        }
        if (node[1] === 'voltageProbe') {
            return CircuitJsonUpstreamValidator.#voltageProbe(value)
        }
        if (node[1] === 'currentProbe') {
            return CircuitJsonUpstreamValidator.#currentProbe(value)
        }
        if (node[1] === 'oscilloscopeTrace') {
            return CircuitJsonUpstreamValidator.#oscilloscopeTrace(value)
        }
        return false
    }

    /**
     * Preserves the pinned parseAndConvertSiUnit transform's throw boundary.
     * Transform outputs remain intentionally unmaterialized.
     * @param {unknown} value Transform input.
     * @returns {boolean} Whether the pinned transform completes.
     */
    static #siUnitTransform(value) {
        if (typeof value !== 'string') return true
        return /^-?[\d.]+$/u.test(value) || /[^\d\s]/u.test(value)
    }

    /** @param {Record<string, any>} value Voltage probe. @returns {boolean} */
    static #voltageProbe(value) {
        const differential =
            value.reference_input_source_port_id ||
            value.reference_input_source_net_id
        if (!differential) {
            return (
                Boolean(value.signal_input_source_port_id) !==
                Boolean(value.signal_input_source_net_id)
            )
        }
        const hasPorts = Boolean(
            value.signal_input_source_port_id ||
            value.reference_input_source_port_id
        )
        const hasNets = Boolean(
            value.signal_input_source_net_id ||
            value.reference_input_source_net_id
        )
        if (hasPorts && hasNets) return false
        if (hasPorts) {
            return Boolean(
                value.signal_input_source_port_id &&
                value.reference_input_source_port_id
            )
        }
        if (hasNets) {
            return Boolean(
                value.signal_input_source_net_id &&
                value.reference_input_source_net_id
            )
        }
        return true
    }

    /** @param {Record<string, any>} value Current probe. @returns {boolean} */
    static #currentProbe(value) {
        const positivePort = Boolean(value.positive_source_port_id)
        const negativePort = Boolean(value.negative_source_port_id)
        const positiveNet = Boolean(value.positive_source_net_id)
        const negativeNet = Boolean(value.negative_source_net_id)
        const hasPorts = positivePort || negativePort
        const hasNets = positiveNet || negativeNet
        if (hasPorts && hasNets) return false
        if (hasPorts) return positivePort && negativePort
        if (hasNets) return positiveNet && negativeNet
        return false
    }

    /** @param {Record<string, any>} value Trace. @returns {boolean} */
    static #oscilloscopeTrace(value) {
        const voltageReferences = [
            value.simulation_transient_voltage_graph_id,
            value.simulation_voltage_probe_id
        ].filter((field) => field !== undefined).length
        const currentReferences = [
            value.simulation_transient_current_graph_id,
            value.simulation_current_probe_id
        ].filter((field) => field !== undefined).length
        return Boolean(
            voltageReferences + currentReferences === 1 &&
            !(voltageReferences > 0 && value.amps_per_div !== undefined) &&
            !(currentReferences > 0 && value.volts_per_div !== undefined)
        )
    }

    /** @param {any[]} check Datetime instruction. @returns {RegExp} */
    static #datetime(check) {
        const key = check.slice(1).join(':')
        if (DATETIME_PATTERNS.has(key)) return DATETIME_PATTERNS.get(key)
        const [, precision, offset, local] = check
        const date =
            '((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))'
        let seconds = '[0-5]\\d'
        if (precision) seconds += `\\.\\d{${precision}}`
        else if (precision === null) seconds += '(\\.\\d+)?'
        const time = `([01]\\d|2[0-3]):[0-5]\\d(:${seconds})${precision ? '+' : '?'}`
        const zones = [local ? 'Z?' : 'Z']
        if (offset) zones.push('([+-]\\d{2}:?\\d{2})')
        const pattern = new RegExp(`^${date}T${time}(${zones.join('|')})$`)
        DATETIME_PATTERNS.set(key, pattern)
        return pattern
    }
}

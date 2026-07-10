import { ToolkitError } from '../contracts/ToolkitError.mjs'

const FIDELITIES = new Set(['auto', 'canonical', 'native'])
const SIDES = new Set(['top', 'bottom'])
const SAFE_STYLE_FUNCTIONS = new Set([
    'calc',
    'clamp',
    'color',
    'color-mix',
    'hsl',
    'hsla',
    'hwb',
    'lab',
    'lch',
    'max',
    'min',
    'oklab',
    'oklch',
    'rgb',
    'rgba'
])

/**
 * Normalizes safe plain-data options shared by canonical renderers.
 */
export class CanonicalRenderOptions {
    /**
     * Normalizes one renderer option record.
     * @param {unknown} options Option candidate.
     * @param {{ layers?: boolean, sheetId?: boolean, side?: boolean, svg?: boolean }} [features] Enabled option families.
     * @returns {{ fidelity: 'auto' | 'canonical' | 'native', layers?: string[] | null, sheetId?: string | null, side?: 'top' | 'bottom', svg?: Record<string, any> }} Normalized options.
     */
    static normalize(options = {}, features = {}) {
        const allowed = new Set(['fidelity'])
        if (features.layers) allowed.add('layers')
        if (features.sheetId) allowed.add('sheetId')
        if (features.side) allowed.add('side')
        if (features.svg) {
            for (const key of [
                'attributes',
                'className',
                'description',
                'id',
                'style',
                'title'
            ]) {
                allowed.add(key)
            }
        }
        const record = CanonicalRenderOptions.#record(options, allowed)
        const fidelity = record.fidelity ?? 'auto'
        if (!FIDELITIES.has(fidelity)) {
            throw CanonicalRenderOptions.error(
                'Render fidelity must be auto, canonical, or native.'
            )
        }
        const result = { fidelity }
        if (features.side)
            result.side = CanonicalRenderOptions.#side(record.side)
        if (features.layers) {
            result.layers = CanonicalRenderOptions.#layers(record.layers)
        }
        if (features.sheetId) {
            result.sheetId = CanonicalRenderOptions.#sheetId(record.sheetId)
        }
        if (features.svg) result.svg = CanonicalRenderOptions.#svg(record)
        return result
    }

    /**
     * Rejects native fidelity when no source-native extension hook exists.
     * @param {'auto' | 'canonical' | 'native'} fidelity Requested fidelity.
     * @returns {void}
     */
    static requireCanonicalFidelity(fidelity) {
        if (fidelity !== 'native') return
        throw new ToolkitError(
            'Native rendering requires source extension data.',
            {
                code: 'ERR_EXTENSION_DATA_REQUIRED',
                category: 'unsupported',
                format: 'circuitjson'
            }
        )
    }

    /**
     * Creates one stable renderer option error.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed renderer error.
     */
    static error(message) {
        return new ToolkitError(message, {
            code: 'ERR_RENDER_OPTIONS',
            category: 'validation',
            format: 'circuitjson'
        })
    }

    /**
     * Reads own enumerable data properties without invoking accessors.
     * @param {unknown} value Record candidate.
     * @param {Set<string>} allowed Allowed keys.
     * @returns {Record<string, any>} Safe shallow record.
     */
    static #record(value, allowed) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw CanonicalRenderOptions.error(
                'Render options must be a plain object.'
            )
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw CanonicalRenderOptions.error(
                'Render options could not be inspected safely.'
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw CanonicalRenderOptions.error(
                'Render options must be a plain object.'
            )
        }
        const result = {}
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                !allowed.has(key) ||
                descriptor.enumerable !== true ||
                descriptor.get ||
                descriptor.set
            ) {
                throw CanonicalRenderOptions.error(
                    'Render options contain an unsupported field.'
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Normalizes a public PCB side.
     * @param {unknown} value Side candidate.
     * @returns {'top' | 'bottom'} Canonical side.
     */
    static #side(value) {
        const side = value ?? 'top'
        if (!SIDES.has(side)) {
            throw CanonicalRenderOptions.error(
                'Render side must be top or bottom.'
            )
        }
        return side
    }

    /**
     * Normalizes an optional unique layer-id list.
     * @param {unknown} value Layer list candidate.
     * @returns {string[] | null} Normalized layer ids.
     */
    static #layers(value) {
        if (value === undefined) return null
        const values = CanonicalRenderOptions.#dataArray(value)
        if (
            !values?.length ||
            values.length > 256 ||
            values.some(
                (id) =>
                    typeof id !== 'string' ||
                    id.length > 256 ||
                    !CanonicalRenderOptions.#isXmlText(id)
            )
        ) {
            throw CanonicalRenderOptions.error(
                'Render layers must be a non-empty string array.'
            )
        }
        const layers = values.map((id) => id.trim())
        if (layers.some((id) => !id || id.length > 256)) {
            throw CanonicalRenderOptions.error(
                'Render layers must be a non-empty string array.'
            )
        }
        if (new Set(layers).size !== layers.length) {
            throw CanonicalRenderOptions.error(
                'Render layers must not contain duplicates.'
            )
        }
        return layers
    }

    /**
     * Normalizes an optional schematic sheet id.
     * @param {unknown} value Sheet id candidate.
     * @returns {string | null} Normalized sheet id.
     */
    static #sheetId(value) {
        if (value === undefined) return null
        if (
            typeof value !== 'string' ||
            value.length > 256 ||
            !CanonicalRenderOptions.#isXmlText(value) ||
            !value.trim()
        ) {
            throw CanonicalRenderOptions.error(
                'Render sheetId must be a non-empty string.'
            )
        }
        return value.trim()
    }

    /**
     * Normalizes common deterministic SVG metadata and style controls.
     * @param {Record<string, any>} record Safe top-level option record.
     * @returns {Record<string, any>} Normalized SVG controls.
     */
    static #svg(record) {
        const id = CanonicalRenderOptions.#svgId(record.id)
        const className = CanonicalRenderOptions.#className(record.className)
        const title = CanonicalRenderOptions.#text(record.title, 'title')
        const description = CanonicalRenderOptions.#text(
            record.description,
            'description'
        )
        const attributes = CanonicalRenderOptions.#valueRecord(
            record.attributes,
            'attributes',
            /^(?:aria|data)-[a-z][a-z0-9_-]*$/u,
            true
        )
        const style = CanonicalRenderOptions.#valueRecord(
            record.style,
            'style',
            /^--[a-zA-Z_][a-zA-Z0-9_-]*$/u,
            false
        )
        return { id, className, title, description, attributes, style }
    }

    /**
     * Normalizes an optional SVG id.
     * @param {unknown} value Id candidate.
     * @returns {string | null} SVG id.
     */
    static #svgId(value) {
        if (value === undefined) return null
        if (
            typeof value !== 'string' ||
            !/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(value) ||
            value.length > 256
        ) {
            throw CanonicalRenderOptions.error(
                'Render id must be a valid SVG identifier.'
            )
        }
        return value
    }

    /**
     * Normalizes optional extra SVG class tokens.
     * @param {unknown} value Class candidate.
     * @returns {string | null} Stable class list.
     */
    static #className(value) {
        if (value === undefined) return null
        if (
            typeof value !== 'string' ||
            value.length > 8192 ||
            !CanonicalRenderOptions.#isXmlText(value)
        ) {
            throw CanonicalRenderOptions.error(
                'Render className must contain CSS class tokens.'
            )
        }
        const tokens = value.trim().split(/\s+/u).filter(Boolean)
        if (
            !tokens.length ||
            tokens.length > 64 ||
            tokens.some(
                (token) =>
                    token.length > 128 ||
                    !/^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/u.test(token)
            )
        ) {
            throw CanonicalRenderOptions.error(
                'Render className must contain CSS class tokens.'
            )
        }
        return [...new Set(tokens)].join(' ')
    }

    /**
     * Normalizes optional SVG accessible text.
     * @param {unknown} value Text candidate.
     * @param {string} name Option name.
     * @returns {string | null} Text value.
     */
    static #text(value, name) {
        if (value === undefined) return null
        if (
            typeof value !== 'string' ||
            value.length > 10000 ||
            !CanonicalRenderOptions.#isXmlText(value)
        ) {
            throw CanonicalRenderOptions.error(
                `Render ${name} must be a bounded string.`
            )
        }
        return value
    }

    /**
     * Normalizes an accessor-free SVG attribute or style record.
     * @param {unknown} value Record candidate.
     * @param {string} name Option name.
     * @param {RegExp} keyPattern Allowed key pattern.
     * @param {boolean} booleanValues Whether boolean values are allowed.
     * @returns {Record<string, string | number | boolean>} Stable record.
     */
    static #valueRecord(value, name, keyPattern, booleanValues) {
        if (value === undefined) return {}
        const record = CanonicalRenderOptions.#plainDataRecord(value, name)
        const keys = Object.keys(record).sort(CanonicalRenderOptions.#compare)
        if (keys.length > 64) {
            throw CanonicalRenderOptions.error(
                `Render ${name} contains too many fields.`
            )
        }
        const result = {}
        for (const key of keys) {
            const entry = record[key]
            if (
                !keyPattern.test(key) ||
                ![
                    'string',
                    'number',
                    ...(booleanValues ? ['boolean'] : [])
                ].includes(typeof entry) ||
                (typeof entry === 'number' && !Number.isFinite(entry)) ||
                String(entry).length > 4096 ||
                !CanonicalRenderOptions.#isXmlText(String(entry)) ||
                (name === 'style' &&
                    !CanonicalRenderOptions.#isStyleValue(String(entry)))
            ) {
                throw CanonicalRenderOptions.error(
                    `Render ${name} contains an unsupported field.`
                )
            }
            result[key] = entry
        }
        return result
    }

    /**
     * Copies a plain object through own data descriptors only.
     * @param {unknown} value Object candidate.
     * @param {string} name Option name.
     * @returns {Record<string, any>} Safe copy.
     */
    static #plainDataRecord(value, name) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw CanonicalRenderOptions.error(
                `Render ${name} must be a plain object.`
            )
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw CanonicalRenderOptions.error(
                `Render ${name} could not be inspected safely.`
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw CanonicalRenderOptions.error(
                `Render ${name} must be a plain object.`
            )
        }
        const result = {}
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                descriptor.enumerable !== true ||
                descriptor.get ||
                descriptor.set
            ) {
                throw CanonicalRenderOptions.error(
                    `Render ${name} contains an unsupported field.`
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Copies a dense plain array without reading indexed accessors.
     * @param {unknown} value Array candidate.
     * @returns {unknown[] | null} Safe array copy or null.
     */
    static #dataArray(value) {
        if (!Array.isArray(value)) return null
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            return null
        }
        const length = descriptors.length?.value
        if (
            prototype !== Array.prototype ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > 4096
        ) {
            return null
        }
        const result = []
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)]
            if (
                !descriptor ||
                descriptor.enumerable !== true ||
                descriptor.get ||
                descriptor.set
            ) {
                return null
            }
            result.push(descriptor.value)
        }
        const allowed = new Set([
            'length',
            ...Array.from({ length }, (_entry, index) => String(index))
        ])
        if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(key))) {
            return null
        }
        return result
    }

    /**
     * Compares stable option keys by code point.
     * @param {string} left Left key.
     * @param {string} right Right key.
     * @returns {number} Ordering value.
     */
    static #compare(left, right) {
        return left < right ? -1 : left > right ? 1 : 0
    }

    /**
     * Returns whether text contains only XML 1.0 scalar characters.
     * @param {string} value Text candidate.
     * @returns {boolean} Whether text is valid in an SVG document.
     */
    static #isXmlText(value) {
        for (const character of value) {
            const codePoint = character.codePointAt(0)
            if (
                codePoint !== 0x09 &&
                codePoint !== 0x0a &&
                codePoint !== 0x0d &&
                (codePoint < 0x20 ||
                    (codePoint > 0xd7ff && codePoint < 0xe000) ||
                    (codePoint > 0xfffd && codePoint < 0x10000) ||
                    codePoint > 0x10ffff)
            ) {
                return false
            }
        }
        return true
    }

    /**
     * Returns whether one CSS custom-property value is literal and resource-free.
     * @param {string} value CSS value candidate.
     * @returns {boolean} Whether the value is safe for deterministic SVG output.
     */
    static #isStyleValue(value) {
        if (!/^[#(),.%+\-/\sA-Za-z0-9_]*$/u.test(value)) return false
        for (const match of value.matchAll(
            /([A-Za-z_-][A-Za-z0-9_-]*)\s*\(/gu
        )) {
            if (!SAFE_STYLE_FUNCTIONS.has(match[1].toLowerCase())) return false
        }
        return true
    }
}

/**
 * Reads owned scene document metadata without accessors or object coercion.
 */
export class Scene3dDocumentMetadata {
    /**
     * Returns a primitive source format.
     * @param {object} context Prepared document context.
     * @returns {string} Source format.
     */
    static sourceFormat(context) {
        const value = context.source?.format
        if (value === undefined || value === null || value === '') {
            return 'circuitjson'
        }
        if (typeof value !== 'string') {
            throw new TypeError('CircuitJSON source format must be a string.')
        }
        return value
    }

    /**
     * Returns a primitive source file name.
     * @param {object} context Prepared document context.
     * @returns {string} Source file name.
     */
    static sourceFileName(context) {
        const value = context.source?.fileName
        if (value === undefined || value === null) return ''
        if (typeof value !== 'string') {
            throw new TypeError('CircuitJSON source fileName must be a string.')
        }
        return value
    }

    /**
     * Returns true when a source extension declares usable native scene data.
     * @param {string} format Source format.
     * @param {unknown} extension Source extension.
     * @returns {boolean} Whether native scene data is declared.
     */
    static hasNativeExtension(format, extension) {
        if (
            format === 'circuitjson' ||
            !extension ||
            typeof extension !== 'object' ||
            Array.isArray(extension)
        ) {
            return false
        }
        const metadata = extension.$meta
        Scene3dDocumentMetadata.#validateExtensionMetadata(metadata)
        const completeness = metadata?.completeness || 'none'
        if (!['canonical', 'full'].includes(completeness)) return false
        const included = metadata?.included || []
        return (
            included.some(
                (feature) =>
                    feature === 'scene3d' || feature.startsWith('scene3d.')
            ) || Boolean(extension.scene3d)
        )
    }

    /**
     * Validates extension metadata as primitive owned data.
     * @param {unknown} metadata Extension metadata candidate.
     * @returns {void}
     */
    static #validateExtensionMetadata(metadata) {
        if (metadata === undefined || metadata === null) return
        if (typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new TypeError(
                'Scene extension metadata must be a plain data object.'
            )
        }
        const prototype = Object.getPrototypeOf(metadata)
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                'Scene extension metadata must be a plain data object.'
            )
        }
        for (const key of Reflect.ownKeys(metadata)) {
            if (typeof key !== 'string') {
                throw new TypeError(
                    'Scene extension metadata keys must be strings.'
                )
            }
            const descriptor = Object.getOwnPropertyDescriptor(metadata, key)
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    'Scene extension metadata must contain only data properties.'
                )
            }
            Scene3dDocumentMetadata.#validateMetadataValue(
                key,
                descriptor.value
            )
        }
    }

    /**
     * Validates one primitive metadata field or primitive array.
     * @param {string} key Metadata field name.
     * @param {unknown} value Metadata value.
     * @returns {void}
     */
    static #validateMetadataValue(key, value) {
        if (key === 'schema' || key === 'completeness') {
            if (typeof value === 'string') return
            throw new TypeError(`Scene extension ${key} must be a string.`)
        }
        if (key === 'included' || key === 'omitted') {
            if (
                Array.isArray(value) &&
                Scene3dDocumentMetadata.#primitiveArray(value, true)
            ) {
                return
            }
            throw new TypeError(
                `Scene extension ${key} must contain only strings.`
            )
        }
        if (Array.isArray(value)) {
            if (Scene3dDocumentMetadata.#primitiveArray(value, false)) return
        } else if (Scene3dDocumentMetadata.#isPrimitive(value)) {
            return
        }
        throw new TypeError(
            `Scene extension ${key} must contain only primitive data.`
        )
    }

    /**
     * Tests a dense array of primitive extension entries.
     * @param {unknown[]} values Metadata entries.
     * @param {boolean} stringsOnly Whether every entry must be a string.
     * @returns {boolean} Whether all entries are accepted primitives.
     */
    static #primitiveArray(values, stringsOnly) {
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index]
            if (
                stringsOnly
                    ? typeof value !== 'string'
                    : !Scene3dDocumentMetadata.#isPrimitive(value)
            ) {
                return false
            }
        }
        return true
    }

    /**
     * Tests one clone-safe primitive without coercion.
     * @param {unknown} value Metadata value.
     * @returns {boolean} Whether the value is a supported primitive.
     */
    static #isPrimitive(value) {
        return (
            value === null ||
            value === undefined ||
            ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
        )
    }
}

Object.freeze(Scene3dDocumentMetadata.prototype)
Object.freeze(Scene3dDocumentMetadata)

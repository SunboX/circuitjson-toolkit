const VALUE_OWNERS = new WeakMap()

/**
 * Stores request-scoped derived values by namespace and key.
 */
export class CircuitJsonDerivedCache {
    #builds
    #namespaces = new Map()

    /**
     * Creates a request-scoped derived cache.
     * @param {Record<string, number>} builds Successful build counters.
     */
    constructor(builds) {
        this.#builds = builds
    }

    /**
     * Returns an existing value or creates and caches one successful result.
     * @param {string} namespace Cache namespace.
     * @param {string} key Cache key.
     * @param {() => any} factory Value factory.
     * @returns {any} Cached or newly built value.
     */
    getOrCreate(namespace, key, factory) {
        if (typeof factory !== 'function') {
            throw new TypeError('A derived value factory is required.')
        }

        const entries = this.#entries(namespace)
        if (entries.has(key)) return entries.get(key)

        const value = factory()
        if (
            value &&
            (typeof value === 'object' || typeof value === 'function') &&
            typeof value.then === 'function'
        ) {
            throw new TypeError(
                'Derived value factories must return synchronous values.'
            )
        }
        CircuitJsonDerivedCache.#bindValue(this, namespace, key, value)
        entries.set(key, value)
        const statisticKey = `${namespace}:${key}`
        this.#builds[statisticKey] = (this.#builds[statisticKey] || 0) + 1
        return value
    }

    /**
     * Returns whether an object value belongs to this exact cache entry.
     * @param {string} namespace Cache namespace.
     * @param {string} key Cache key.
     * @param {unknown} value Derived value candidate.
     * @returns {boolean} Whether ownership matches cache, namespace, and key.
     */
    owns(namespace, key, value) {
        if (!CircuitJsonDerivedCache.#isObject(value)) return false
        const owner = VALUE_OWNERS.get(value)
        return (
            owner?.cache === this &&
            owner.namespace === namespace &&
            owner.key === key
        )
    }

    /**
     * Returns the cache map for one namespace.
     * @param {string} namespace Cache namespace.
     * @returns {Map<string, any>} Namespace entries.
     */
    #entries(namespace) {
        if (!this.#namespaces.has(namespace)) {
            this.#namespaces.set(namespace, new Map())
        }
        return this.#namespaces.get(namespace)
    }

    /**
     * Binds one object value to exactly one request-scoped cache entry.
     * @param {CircuitJsonDerivedCache} cache Owning cache.
     * @param {string} namespace Cache namespace.
     * @param {string} key Cache key.
     * @param {unknown} value Derived value.
     * @returns {void}
     */
    static #bindValue(cache, namespace, key, value) {
        if (!CircuitJsonDerivedCache.#isObject(value)) return
        const owner = VALUE_OWNERS.get(value)
        if (
            owner &&
            (owner.cache !== cache ||
                owner.namespace !== namespace ||
                owner.key !== key)
        ) {
            throw new TypeError(
                'Derived object values cannot be transplanted between cache entries.'
            )
        }
        VALUE_OWNERS.set(value, { cache, namespace, key })
    }

    /**
     * Returns whether a value can be owned through a WeakMap.
     * @param {unknown} value Value candidate.
     * @returns {boolean} Whether the value is an object or function.
     */
    static #isObject(value) {
        return (
            value !== null &&
            (typeof value === 'object' || typeof value === 'function')
        )
    }
}

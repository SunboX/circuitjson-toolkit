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
        entries.set(key, value)
        const statisticKey = `${namespace}:${key}`
        this.#builds[statisticKey] = (this.#builds[statisticKey] || 0) + 1
        return value
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
}

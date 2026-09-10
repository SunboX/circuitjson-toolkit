/**
 * Memoizes named computations and dynamically tracks their observed input paths.
 */
export class SelfAdjustingComputation {
    /** @type {Map<string, { dependencies: object[], value: any, readerRoots: Set<PropertyKey>, readsWholeInput: boolean }>} */
    #computations

    /** @type {Map<PropertyKey, Set<string>>} */
    #readersByRoot

    /** @type {Set<string>} */
    #wholeInputReaders

    /** @type {object | null} */
    #propagationInput

    /** @type {Set<string> | null} */
    #affectedComputations

    /** @type {((value: object, path: PropertyKey[]) => boolean) | null} */
    #isAtomic

    /**
     * @param {{ isAtomic?: (value: object, path: PropertyKey[]) => boolean }} [options] Dependency-tracking options.
     */
    constructor(options = {}) {
        this.#computations = new Map()
        this.#readersByRoot = new Map()
        this.#wholeInputReaders = new Set()
        this.#propagationInput = null
        this.#affectedComputations = null
        this.#isAtomic =
            typeof options.isAtomic === 'function' ? options.isAtomic : null
    }

    /**
     * Propagates changed modifiable roots through named computations in order.
     * A null change set performs dependency validation for every existing trace.
     * @param {object} input Current input snapshot.
     * @param {PropertyKey[][] | null} changedPaths Changed input paths, or null when unknown.
     * @param {{ name: string, computation: (trackedInput: object) => any }[]} computations Ordered computations.
     * @returns {Map<string, { value: any, recomputed: boolean }>} Results by computation name.
     */
    propagate(input, changedPaths, computations) {
        this.#validateInput(input)
        if (!Array.isArray(computations)) {
            throw new TypeError(
                'Self-adjusting propagation requires an ordered computation array.'
            )
        }

        this.#propagationInput = input
        this.#affectedComputations =
            changedPaths === null
                ? null
                : this.#findAffectedComputations(changedPaths)
        const results = new Map()
        try {
            for (const entry of computations) {
                if (!entry || typeof entry !== 'object') {
                    throw new TypeError(
                        'Self-adjusting propagation entries must be objects.'
                    )
                }
                const key = String(entry.name)
                results.set(key, this.evaluate(key, input, entry.computation))
            }
            return results
        } finally {
            this.#propagationInput = null
            this.#affectedComputations = null
        }
    }

    /**
     * Evaluates one named computation or reuses its last successful result.
     * @param {string} name Stable computation name.
     * @param {object} input Current input snapshot.
     * @param {(trackedInput: object) => any} computation Synchronous computation.
     * @returns {{ value: any, recomputed: boolean }} Evaluation result.
     */
    evaluate(name, input, computation) {
        this.#validateInput(input)
        if (typeof computation !== 'function') {
            throw new TypeError(
                'Self-adjusting computation requires a computation function.'
            )
        }

        const key = String(name)
        const previous = this.#computations.get(key)
        if (previous && !this.#isPotentiallyAffected(key, input)) {
            return { value: previous.value, recomputed: false }
        }
        if (previous && this.#dependenciesMatch(previous.dependencies, input)) {
            return { value: previous.value, recomputed: false }
        }

        const trace = this.#trace(input, computation)
        this.#replaceTrace(key, trace)
        return { value: trace.value, recomputed: true }
    }

    /**
     * Removes one named trace and its reader-list entries.
     * @param {string} name Stable computation name.
     * @returns {boolean} Whether a trace was removed.
     */
    forget(name) {
        const key = String(name)
        if (!this.#computations.has(key)) return false
        this.#removeTrace(key)
        return true
    }

    /**
     * Removes all traces and reader-list entries.
     * @returns {void}
     */
    clear() {
        this.#computations.clear()
        this.#readersByRoot.clear()
        this.#wholeInputReaders.clear()
        this.#propagationInput = null
        this.#affectedComputations = null
    }

    /**
     * Returns bounded trace-storage counts for diagnostics and tests.
     * @returns {{ computations: number, dependencies: number, readerEdges: number }} Trace statistics.
     */
    getStatistics() {
        return {
            computations: this.#computations.size,
            dependencies: [...this.#computations.values()].reduce(
                (total, trace) => total + trace.dependencies.length,
                0
            ),
            readerEdges:
                [...this.#readersByRoot.values()].reduce(
                    (total, readers) => total + readers.size,
                    0
                ) + this.#wholeInputReaders.size
        }
    }

    /**
     * Validates one root input snapshot.
     * @param {unknown} input Candidate input.
     * @returns {void}
     */
    #validateInput(input) {
        if (!input || typeof input !== 'object') {
            throw new TypeError(
                'Self-adjusting computation input must be an object.'
            )
        }
    }

    /**
     * Finds prior computations that read a changed root.
     * @param {PropertyKey[][]} changedPaths Changed input paths.
     * @returns {Set<string>} Potentially affected computation names.
     */
    #findAffectedComputations(changedPaths) {
        if (!Array.isArray(changedPaths)) {
            throw new TypeError(
                'Self-adjusting change sets must be arrays of property paths.'
            )
        }

        const affected = new Set(this.#wholeInputReaders)
        for (const path of changedPaths) {
            if (!Array.isArray(path)) {
                throw new TypeError(
                    'Self-adjusting change-set entries must be property paths.'
                )
            }
            if (path.length === 0) {
                return new Set(this.#computations.keys())
            }
            const readers = this.#readersByRoot.get(path[0])
            readers?.forEach((name) => affected.add(name))
        }
        return affected
    }

    /**
     * Returns whether a prior trace must be checked in the active propagation.
     * @param {string} name Computation name.
     * @param {object} input Current input snapshot.
     * @returns {boolean} Whether dependency validation is required.
     */
    #isPotentiallyAffected(name, input) {
        return !(
            this.#propagationInput === input &&
            this.#affectedComputations instanceof Set &&
            !this.#affectedComputations.has(name)
        )
    }

    /**
     * Replaces a trace and its dynamic reader-list entries atomically.
     * @param {string} name Computation name.
     * @param {{ dependencies: object[], value: any }} trace New successful trace.
     * @returns {void}
     */
    #replaceTrace(name, trace) {
        this.#removeTrace(name)
        const readerRoots = new Set()
        let readsWholeInput = false
        for (const dependency of trace.dependencies) {
            if (dependency.path.length === 0) {
                readsWholeInput = true
            } else {
                readerRoots.add(dependency.path[0])
            }
        }
        const storedTrace = {
            ...trace,
            readerRoots,
            readsWholeInput
        }
        this.#computations.set(name, storedTrace)
        readerRoots.forEach((root) => {
            const readers = this.#readersByRoot.get(root) || new Set()
            readers.add(name)
            this.#readersByRoot.set(root, readers)
        })
        if (readsWholeInput) this.#wholeInputReaders.add(name)
    }

    /**
     * Removes one stored trace and all of its reverse dependency edges.
     * @param {string} name Computation name.
     * @returns {void}
     */
    #removeTrace(name) {
        const previous = this.#computations.get(name)
        if (!previous) return
        previous.readerRoots.forEach((root) => {
            const readers = this.#readersByRoot.get(root)
            readers?.delete(name)
            if (readers?.size === 0) this.#readersByRoot.delete(root)
        })
        if (previous.readsWholeInput) this.#wholeInputReaders.delete(name)
        this.#computations.delete(name)
    }

    /**
     * Executes one computation while collecting its dynamic dependencies.
     * @param {object} input Raw input snapshot.
     * @param {(trackedInput: object) => any} computation Computation callback.
     * @returns {{ dependencies: object[], value: any }} Successful trace.
     */
    #trace(input, computation) {
        const dependencies = []
        const proxyCache = new WeakMap()
        const proxyMetadata = new WeakMap()
        const trackedInput = this.#createProxy(
            { dependencies, proxyCache, proxyMetadata },
            input,
            { path: [], children: null, observations: null }
        )
        const trackedValue = computation(trackedInput)
        if (SelfAdjustingComputation.#isPromiseLike(trackedValue)) {
            throw new TypeError(
                'Self-adjusting computations must be synchronous so dependency tracing cannot escape.'
            )
        }
        const metadata =
            trackedValue &&
            (typeof trackedValue === 'object' ||
                typeof trackedValue === 'function')
                ? proxyMetadata.get(trackedValue)
                : null
        if (metadata) {
            this.#record(
                dependencies,
                metadata.pathNode,
                'value',
                metadata.target
            )
        }

        return {
            // Later reads of a returned container must not rewrite this trace.
            dependencies: dependencies.map((dependency) => ({ ...dependency })),
            value: metadata?.target ?? trackedValue
        }
    }

    /**
     * Creates a read-tracking proxy for one traversable input container.
     * @param {{ dependencies: object[], proxyCache: WeakMap<object, Map<object, object>>, proxyMetadata: WeakMap<object, { target: object, pathNode: object }> }} context Shared trace context.
     * @param {object} target Traversable raw input container.
     * @param {object} pathNode Interned input path in this trace.
     * @returns {object} Read-tracking proxy.
     */
    #createProxy(context, target, pathNode) {
        const cachedByPath = context.proxyCache.get(target)
        const cached = cachedByPath?.get(pathNode)
        if (cached) {
            return cached
        }

        const proxyContext = { ...context, pathNode }
        const proxy = new Proxy(target, {
            get: (target, property) =>
                this.#readProperty(proxyContext, target, property),
            has: (target, property) =>
                this.#readPresence(proxyContext, target, property),
            ownKeys: (target) => this.#readKeys(proxyContext, target),
            getOwnPropertyDescriptor: (target, property) =>
                this.#readDescriptor(proxyContext, target, property),
            set: () => this.#rejectWrite(),
            defineProperty: () => this.#rejectWrite(),
            deleteProperty: () => this.#rejectWrite(),
            setPrototypeOf: () => this.#rejectWrite(),
            preventExtensions: () => this.#rejectWrite()
        })
        const nextCachedByPath = cachedByPath || new Map()
        nextCachedByPath.set(pathNode, proxy)
        if (!cachedByPath) {
            context.proxyCache.set(target, nextCachedByPath)
        }
        context.proxyMetadata.set(proxy, {
            target,
            pathNode
        })
        return proxy
    }

    /**
     * Reads and records one property dependency.
     * @param {object} context Tracking context.
     * @param {object} target Current raw target.
     * @param {PropertyKey} property Requested property.
     * @returns {any} Raw atomic value or tracked container.
     */
    #readProperty(context, target, property) {
        const value = Reflect.get(target, property, target)
        const pathNode = this.#childPath(context.pathNode, property)
        if (this.#isTraversable(value, pathNode.path)) {
            this.#record(
                context.dependencies,
                pathNode,
                'kind',
                SelfAdjustingComputation.#valueKind(value)
            )
            return this.#createProxy(context, value, pathNode)
        }

        this.#record(context.dependencies, pathNode, 'value', value)
        return value
    }

    /**
     * Reads and records a property-existence dependency.
     * @param {object} context Tracking context.
     * @param {object} target Current raw target.
     * @param {PropertyKey} property Requested property.
     * @returns {boolean} Whether the property exists.
     */
    #readPresence(context, target, property) {
        const pathNode = this.#childPath(context.pathNode, property)
        const expected = Reflect.has(target, property)
        this.#record(context.dependencies, pathNode, 'has', expected)
        return expected
    }

    /**
     * Reads and records the ordered own-key set for one container.
     * @param {object} context Tracking context.
     * @param {object} target Current raw target.
     * @returns {PropertyKey[]} Own keys.
     */
    #readKeys(context, target) {
        const expected = Reflect.ownKeys(target)
        this.#record(context.dependencies, context.pathNode, 'keys', expected)
        return expected
    }

    /**
     * Reads and records whether one own property is enumerable.
     * @param {object} context Tracking context.
     * @param {object} target Current raw target.
     * @param {PropertyKey} property Requested property.
     * @returns {PropertyDescriptor | undefined} Raw property descriptor.
     */
    #readDescriptor(context, target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
        this.#record(
            context.dependencies,
            this.#childPath(context.pathNode, property),
            'descriptor',
            SelfAdjustingComputation.#descriptorState(descriptor)
        )
        return descriptor
    }

    /**
     * Returns whether a value should expose nested dependency reads.
     * @param {any} value Candidate value.
     * @param {PropertyKey[]} path Input path.
     * @returns {boolean} Whether the value is a traversable container.
     */
    #isTraversable(value, path) {
        if (!value || typeof value !== 'object') return false
        if (this.#isAtomic?.(value, [...path])) return false
        if (Array.isArray(value)) return true
        const prototype = Reflect.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }

    /**
     * Interns one child path using property identity without encoding its ancestors.
     * Path and proxy caches belong to one trace and are never reused by a later snapshot.
     * @param {object} parent Parent path node.
     * @param {PropertyKey} property Observed property key.
     * @returns {object} Canonical child path node for this trace.
     */
    #childPath(parent, property) {
        const previous = parent.children?.get(property)
        if (previous) return previous
        const child = {
            path: [...parent.path, property],
            children: null,
            observations: null
        }
        parent.children ??= new Map()
        parent.children.set(property, child)
        return child
    }

    /**
     * Stores the last observation of each dependency type at an interned path.
     * @param {object[]} dependencies Dependency registry in first-observed order.
     * @param {object} pathNode Interned path node.
     * @param {string} type Dependency comparison category.
     * @param {any} expected Most recently observed value or structural state.
     * @returns {void}
     */
    #record(dependencies, pathNode, type, expected) {
        const previous = pathNode.observations?.get(type)
        if (previous) {
            previous.expected = expected
            return
        }
        const dependency = { type, path: pathNode.path, expected }
        pathNode.observations ??= new Map()
        pathNode.observations.set(type, dependency)
        dependencies.push(dependency)
    }

    /**
     * Returns whether every dependency still matches a new input.
     * @param {object[]} dependencies Previous successful dependencies.
     * @param {object} input Current raw input.
     * @returns {boolean} Whether the computation can be reused.
     */
    #dependenciesMatch(dependencies, input) {
        return dependencies.every((dependency) =>
            this.#dependencyMatches(dependency, input)
        )
    }

    /**
     * Compares one recorded dependency against a new input.
     * @param {{ type: string, path: PropertyKey[], expected: any }} dependency Recorded dependency.
     * @param {object} input Current raw input.
     * @returns {boolean} Whether the dependency is unchanged.
     */
    #dependencyMatches(dependency, input) {
        if (dependency.type === 'has') {
            const parent = this.#readPath(input, dependency.path.slice(0, -1))
            return (
                parent.found &&
                Reflect.has(Object(parent.value), dependency.path.at(-1)) ===
                    dependency.expected
            )
        }

        const current = this.#readPath(input, dependency.path)
        if (dependency.type === 'value') {
            return (
                current.found && Object.is(current.value, dependency.expected)
            )
        }
        if (dependency.type === 'kind') {
            return (
                current.found &&
                SelfAdjustingComputation.#valueKind(current.value) ===
                    dependency.expected
            )
        }
        if (dependency.type === 'keys') {
            return (
                current.found &&
                current.value !== null &&
                typeof current.value === 'object' &&
                SelfAdjustingComputation.#sameKeys(
                    Reflect.ownKeys(current.value),
                    dependency.expected
                )
            )
        }
        if (dependency.type === 'descriptor') {
            const parent = this.#readPath(input, dependency.path.slice(0, -1))
            if (!parent.found || parent.value === null) return false
            const descriptor = Reflect.getOwnPropertyDescriptor(
                Object(parent.value),
                dependency.path.at(-1)
            )
            return (
                SelfAdjustingComputation.#descriptorState(descriptor) ===
                dependency.expected
            )
        }
        return false
    }

    /**
     * Resolves one raw input path without invoking dependency tracking.
     * @param {object} input Root input.
     * @param {PropertyKey[]} path Input path.
     * @returns {{ found: boolean, value: any }} Resolved value.
     */
    #readPath(input, path) {
        let value = input
        for (const property of path) {
            if (
                value === null ||
                (typeof value !== 'object' && typeof value !== 'function')
            ) {
                return { found: false, value: undefined }
            }
            value = Reflect.get(value, property, value)
        }
        return { found: true, value }
    }

    /**
     * Rejects mutation through a tracked snapshot.
     * @returns {never}
     */
    #rejectWrite() {
        throw new TypeError(
            'Self-adjusting computation inputs are read-only while tracked.'
        )
    }

    /**
     * Returns the comparison category for one container value.
     * @param {any} value Candidate value.
     * @returns {string} Value category.
     */
    static #valueKind(value) {
        if (value === null) return 'null'
        if (Array.isArray(value)) return 'array'
        return typeof value
    }

    /**
     * Returns the dependency-relevant state of a property descriptor.
     * @param {PropertyDescriptor | undefined} descriptor Property descriptor.
     * @returns {string} Descriptor state.
     */
    static #descriptorState(descriptor) {
        if (!descriptor) return 'missing'
        return descriptor.enumerable ? 'enumerable' : 'non-enumerable'
    }

    /**
     * Compares two ordered property-key arrays.
     * @param {PropertyKey[]} left Current keys.
     * @param {PropertyKey[]} right Recorded keys.
     * @returns {boolean} Whether both key sets and orders match.
     */
    static #sameKeys(left, right) {
        return (
            left.length === right.length &&
            left.every((key, index) => Object.is(key, right[index]))
        )
    }

    /**
     * Returns whether a computation result is a promise or thenable.
     * @param {unknown} value Candidate result.
     * @returns {boolean} Whether the result is asynchronous.
     */
    static #isPromiseLike(value) {
        return Boolean(
            value &&
            (typeof value === 'object' || typeof value === 'function') &&
            typeof value.then === 'function'
        )
    }
}

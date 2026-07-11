const IS_PROXY = (() => {
    try {
        const runtime = globalThis.process
        const getBuiltinModule = Object.getOwnPropertyDescriptor(
            runtime,
            'getBuiltinModule'
        )?.value
        if (typeof getBuiltinModule !== 'function') return null
        const utilities = Reflect.apply(getBuiltinModule, runtime, [
            'node:util'
        ])
        const types = Object.getOwnPropertyDescriptor(utilities, 'types')?.value
        const detector = Object.getOwnPropertyDescriptor(
            types,
            'isProxy'
        )?.value
        return typeof detector === 'function' ? detector : null
    } catch {
        return null
    }
})()

/**
 * Rejects executable Proxy containers before descriptor-based data handling.
 */
export class RuntimeProxyBoundary {
    /**
     * Rejects a Proxy without executing its traps when the host exposes a
     * trusted intrinsic detector. Browser message cloning remains the final
     * boundary in hosts without that optional detector.
     * @param {unknown} value Candidate value.
     * @param {string} label Human-readable value label.
     * @returns {void}
     */
    static assert(value, label) {
        if (
            IS_PROXY &&
            value !== null &&
            ['object', 'function'].includes(typeof value) &&
            Reflect.apply(IS_PROXY, undefined, [value])
        ) {
            throw new TypeError(`${label} must not be a Proxy.`)
        }
    }
}

Object.freeze(RuntimeProxyBoundary.prototype)
Object.freeze(RuntimeProxyBoundary)

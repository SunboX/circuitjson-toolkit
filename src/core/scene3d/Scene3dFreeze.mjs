/**
 * Freezes data-only scene graphs iteratively without recursing into binary data.
 * @param {unknown} value Scene value.
 * @returns {any} The same value.
 */
export function freezeScene(value) {
    if (!value || typeof value !== 'object') return value
    const seen = new WeakSet()
    const pending = [value]
    const ordered = []

    while (pending.length) {
        const current = pending.pop()
        if (
            !current ||
            typeof current !== 'object' ||
            seen.has(current) ||
            current instanceof ArrayBuffer ||
            ArrayBuffer.isView(current)
        ) {
            continue
        }
        seen.add(current)
        ordered.push(current)
        for (const key of Reflect.ownKeys(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key)
            if (descriptor && Object.hasOwn(descriptor, 'value')) {
                pending.push(descriptor.value)
            }
        }
    }

    for (let index = ordered.length - 1; index >= 0; index -= 1) {
        if (!Object.isFrozen(ordered[index])) Object.freeze(ordered[index])
    }
    return value
}

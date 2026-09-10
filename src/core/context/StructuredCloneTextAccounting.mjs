const TEXT_ACCOUNTING_CHUNK_CHARACTERS = 64 * 1_024
const SHORT_TEXT_CHARACTERS = 256
const STRING_CHAR_CODE_AT = String.prototype.charCodeAt
const STRING_SLICE = String.prototype.slice
const TEXT_ENCODER = new TextEncoder()
const TEXT_ENCODER_ENCODE = TextEncoder.prototype.encode

/**
 * Accounts immutable structured-clone text without one long UTF-8 scan.
 */
export class StructuredCloneTextAccounting {
    /**
     * Measures one string across bounded encoding slices.
     * @param {string} value Immutable text value.
     * @param {{ bytes: number, label: string, maxBytes: number }} state Shared accounting state.
     * @param {{ checkpoint: () => Generator<void, void, void>, reserve: (count: number) => void }} operations Traversal operations.
     * @returns {Generator<void, void, void>} Bounded text accounting pass.
     */
    static *reserve(value, state, operations) {
        if (state.maxBytes === Number.MAX_SAFE_INTEGER) return
        if (value.length <= SHORT_TEXT_CHARACTERS) {
            const length = StructuredCloneTextAccounting.#shortByteLength(value)
            if (state.bytes + length > state.maxBytes) {
                throw new TypeError(`${state.label} is too large.`)
            }
            operations.reserve(length)
            return
        }
        let length = 0
        let offset = 0
        while (offset < value.length) {
            let end = Math.min(
                value.length,
                offset + TEXT_ACCOUNTING_CHUNK_CHARACTERS
            )
            const trailing = Reflect.apply(STRING_CHAR_CODE_AT, value, [
                end - 1
            ])
            const next = Reflect.apply(STRING_CHAR_CODE_AT, value, [end])
            if (
                end < value.length &&
                trailing >= 0xd800 &&
                trailing <= 0xdbff &&
                next >= 0xdc00 &&
                next <= 0xdfff
            ) {
                end -= 1
            }
            const chunk = Reflect.apply(STRING_SLICE, value, [offset, end])
            length += Reflect.apply(TEXT_ENCODER_ENCODE, TEXT_ENCODER, [
                chunk
            ]).byteLength
            if (state.bytes + length > state.maxBytes) {
                throw new TypeError(`${state.label} is too large.`)
            }
            offset = end
            if (offset < value.length) yield* operations.checkpoint()
        }
        operations.reserve(length)
    }

    /**
     * Counts bounded short text without allocating an encoded byte buffer.
     * Lone surrogates consume the three UTF-8 bytes of a replacement character.
     * @param {string} value Short immutable text.
     * @returns {number} UTF-8 byte length.
     */
    static #shortByteLength(value) {
        let length = 0
        for (let index = 0; index < value.length; index += 1) {
            const code = STRING_CHAR_CODE_AT.call(value, index)
            if (code <= 0x7f) {
                length += 1
            } else if (code <= 0x7ff) {
                length += 2
            } else if (code >= 0xd800 && code <= 0xdbff) {
                const next = STRING_CHAR_CODE_AT.call(value, index + 1)
                if (next >= 0xdc00 && next <= 0xdfff) {
                    length += 4
                    index += 1
                } else {
                    length += 3
                }
            } else {
                length += 3
            }
        }
        return length
    }
}

Object.freeze(StructuredCloneTextAccounting.prototype)
Object.freeze(StructuredCloneTextAccounting)

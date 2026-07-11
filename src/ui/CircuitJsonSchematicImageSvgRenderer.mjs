import { BinaryDataSnapshot } from '../core/context/BinaryDataSnapshot.mjs'
import { CircuitJsonUnits } from '../core/CircuitJsonUnits.mjs'
import { SafeXmlText } from './SafeXmlText.mjs'

const IMAGE_MEDIA_TYPES = new Set([
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp'
])
const BASE64_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Renders canonical asset-backed schematic images into deterministic SVG. */
export class CircuitJsonSchematicImageSvgRenderer {
    /**
     * Renders every resolvable canonical image in authored order.
     * @param {object[]} images Canonical schematic image rows.
     * @param {object[]} assets Canonical document assets.
     * @returns {string} SVG image group or an empty string.
     */
    static render(images, assets) {
        const byId = CircuitJsonSchematicImageSvgRenderer.#assetIndex(
            assets || []
        )
        const markup = (images || [])
            .map((image, index) => ({ image, index }))
            .sort(
                (left, right) =>
                    CircuitJsonSchematicImageSvgRenderer.#order(left.image) -
                        CircuitJsonSchematicImageSvgRenderer.#order(
                            right.image
                        ) || left.index - right.index
            )
            .map(({ image }) =>
                CircuitJsonSchematicImageSvgRenderer.#image(
                    image,
                    byId.get(String(image.asset_id || ''))
                )
            )
            .filter(Boolean)
        return markup.length
            ? '<g class="schematic-images">' + markup.join('') + '</g>'
            : ''
    }

    /**
     * Builds an exact asset-id index and marks duplicate ids ambiguous.
     * @param {object[]} assets Canonical assets.
     * @returns {Map<string, object | null>} Assets by exact id.
     */
    static #assetIndex(assets) {
        const byId = new Map()
        for (const asset of assets) {
            const id = String(asset?.id || '')
            if (!id) continue
            byId.set(id, byId.has(id) ? null : asset)
        }
        return byId
    }

    /**
     * Renders one image when its exact payload is available.
     * @param {object} image Canonical image row.
     * @param {object | null | undefined} asset Resolved asset.
     * @returns {string} SVG image markup or an empty string.
     */
    static #image(image, asset) {
        if (!asset || asset.kind !== 'schematic-image') return ''
        const mediaType = String(asset.mediaType || '').toLowerCase()
        if (!IMAGE_MEDIA_TYPES.has(mediaType)) return ''
        const bytes = CircuitJsonSchematicImageSvgRenderer.#assetBytes(asset)
        if (!bytes?.byteLength) return ''
        const center = CircuitJsonUnits.optionalPoint(image.center)
        const size = CircuitJsonUnits.optionalSize(image.size)
        if (!center || !size || size.width <= 0 || size.height <= 0) return ''
        const rotation = CircuitJsonUnits.angle(image.rotation, 0)
        const opacity = CircuitJsonSchematicImageSvgRenderer.#opacity(
            image.opacity
        )
        const attributes = [
            'class="schematic-image"',
            'data-schematic-image-id="' +
                SafeXmlText.escape(image.schematic_image_id || '') +
                '"',
            'data-asset-id="' + SafeXmlText.escape(image.asset_id || '') + '"',
            'x="' +
                CircuitJsonSchematicImageSvgRenderer.#number(
                    center.x - size.width / 2
                ) +
                '"',
            'y="' +
                CircuitJsonSchematicImageSvgRenderer.#number(
                    center.y - size.height / 2
                ) +
                '"',
            'width="' +
                CircuitJsonSchematicImageSvgRenderer.#number(size.width) +
                '"',
            'height="' +
                CircuitJsonSchematicImageSvgRenderer.#number(size.height) +
                '"',
            'href="data:' +
                mediaType +
                ';base64,' +
                CircuitJsonSchematicImageSvgRenderer.#base64(bytes) +
                '"',
            'preserveAspectRatio="' +
                (image.preserve_aspect_ratio === false
                    ? 'none'
                    : 'xMidYMid meet') +
                '"'
        ]
        if (rotation) {
            attributes.push(
                'transform="rotate(' +
                    CircuitJsonSchematicImageSvgRenderer.#number(rotation) +
                    ' ' +
                    CircuitJsonSchematicImageSvgRenderer.#number(center.x) +
                    ' ' +
                    CircuitJsonSchematicImageSvgRenderer.#number(center.y) +
                    ')"'
            )
        }
        if (opacity !== null) {
            attributes.push(
                'opacity="' +
                    CircuitJsonSchematicImageSvgRenderer.#number(opacity) +
                    '"'
            )
        }
        return '<image ' + attributes.join(' ') + '></image>'
    }

    /**
     * Reads one exact binary asset range without accepting string payloads.
     * @param {object} asset Canonical asset.
     * @returns {Uint8Array | null} Isolated bytes.
     */
    static #assetBytes(asset) {
        let data
        try {
            data = asset.data
        } catch {
            return null
        }
        const range = BinaryDataSnapshot.describe(data)
        return range ? BinaryDataSnapshot.copyBytes(data, range) : null
    }

    /**
     * Encodes exact bytes without Node-only globals.
     * @param {Uint8Array} bytes Binary bytes.
     * @returns {string} RFC 4648 base64 text.
     */
    static #base64(bytes) {
        let result = ''
        for (let index = 0; index < bytes.length; index += 3) {
            const first = bytes[index]
            const hasSecond = index + 1 < bytes.length
            const hasThird = index + 2 < bytes.length
            const second = hasSecond ? bytes[index + 1] : 0
            const third = hasThird ? bytes[index + 2] : 0
            const bits = (first << 16) | (second << 8) | third
            result += BASE64_ALPHABET[(bits >>> 18) & 63]
            result += BASE64_ALPHABET[(bits >>> 12) & 63]
            result += hasSecond ? BASE64_ALPHABET[(bits >>> 6) & 63] : '='
            result += hasThird ? BASE64_ALPHABET[bits & 63] : '='
        }
        return result
    }

    /**
     * Resolves a valid optional opacity.
     * @param {unknown} value Candidate.
     * @returns {number | null} Opacity or null.
     */
    static #opacity(value) {
        return typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= 0 &&
            value <= 1
            ? value
            : null
    }

    /**
     * Resolves an authored render order.
     * @param {object} image Image row.
     * @returns {number} Sort value.
     */
    static #order(image) {
        return Number.isSafeInteger(image?.render_order)
            ? image.render_order
            : Number.MAX_SAFE_INTEGER
    }

    /**
     * Formats one deterministic SVG number.
     * @param {number} value Number value.
     * @returns {string} SVG number.
     */
    static #number(value) {
        return Number(Number(value).toFixed(6)).toString()
    }
}

Object.freeze(CircuitJsonSchematicImageSvgRenderer.prototype)
Object.freeze(CircuitJsonSchematicImageSvgRenderer)

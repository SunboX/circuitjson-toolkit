import { SafeXmlText } from './SafeXmlText.mjs'

/**
 * Resolves schematic port display metadata from linked source ports.
 */
export class CircuitJsonSchematicSvgPortMetadata {
    /**
     * Builds source port lookup rows.
     * @param {object[]} sourcePorts Source port rows.
     * @returns {Map<string, object>}
     */
    static sourcePorts(sourcePorts) {
        return new Map(
            sourcePorts
                .map((element) => [
                    String(element.source_port_id || '').trim(),
                    element
                ])
                .filter(([sourcePortId]) => sourcePortId)
        )
    }

    /**
     * Builds the schematic port group attributes.
     * @param {object} element Schematic port row.
     * @param {object | null} sourcePort Linked source port row.
     * @returns {string}
     */
    static attributes(element, sourcePort) {
        const sourcePortId = String(element.source_port_id || '').trim()
        const pinNumber = CircuitJsonSchematicSvgPortMetadata.#firstText([
            element.pin_number,
            sourcePort?.pin_number
        ])
        const direction = String(
            element.facing_direction || element.direction || ''
        ).trim()
        const attributes = [
            'class="schematic-port"',
            'data-schematic-port-id="' +
                CircuitJsonSchematicSvgPortMetadata.#escapeHtml(
                    element.schematic_port_id || ''
                ) +
                '"',
            'data-facing-direction="' +
                CircuitJsonSchematicSvgPortMetadata.#escapeHtml(direction) +
                '"'
        ]

        if (sourcePortId) {
            attributes.push(
                'data-source-port-id="' +
                    CircuitJsonSchematicSvgPortMetadata.#escapeHtml(
                        sourcePortId
                    ) +
                    '"'
            )
        }
        if (pinNumber) {
            attributes.push(
                'data-pin-number="' +
                    CircuitJsonSchematicSvgPortMetadata.#escapeHtml(pinNumber) +
                    '"'
            )
        }

        return attributes.join(' ')
    }

    /**
     * Resolves a visible schematic port label.
     * @param {object} element Schematic port row.
     * @param {object | null} sourcePort Linked source port row.
     * @param {WeakMap<object, string> | null} [hintCache] Render-scoped hint cache.
     * @returns {string}
     */
    static label(element, sourcePort, hintCache = null) {
        const direct = CircuitJsonSchematicSvgPortMetadata.#firstText([
            element.name,
            element.label,
            sourcePort?.name,
            sourcePort?.label,
            sourcePort?.pin_label,
            element.pin_number,
            sourcePort?.pin_number
        ])
        return direct
            ? direct
            : CircuitJsonSchematicSvgPortMetadata.#sourceHint(
                  sourcePort,
                  hintCache
              )
    }

    /**
     * Resolves one source-port hint fallback within a single render snapshot.
     * @param {object | null} sourcePort Source-port row.
     * @param {WeakMap<object, string> | null} hintCache Render-scoped cache.
     * @returns {string} First non-empty hint.
     */
    static #sourceHint(sourcePort, hintCache) {
        if (!sourcePort || typeof sourcePort !== 'object') return ''
        if (hintCache?.has(sourcePort)) {
            return hintCache.get(sourcePort)
        }
        const hints = Array.isArray(sourcePort.port_hints)
            ? sourcePort.port_hints
            : []
        const hint = CircuitJsonSchematicSvgPortMetadata.#firstText(hints)
        hintCache?.set(sourcePort, hint)
        return hint
    }

    /**
     * Resolves the first non-empty text and whether evaluated values are immutable.
     * @param {unknown[]} values Candidate values.
     * @returns {{ text: string, immutable: boolean }} Text metadata.
     */
    static #firstTextResult(values) {
        let immutable = true
        for (const value of values) {
            immutable =
                immutable &&
                CircuitJsonSchematicSvgPortMetadata.#isImmutableScalar(value)
            const text = String(value ?? '').trim()
            if (text) return { text, immutable }
        }
        return { text: '', immutable }
    }

    /**
     * Returns whether a label value is immutable primitive data.
     * @param {unknown} value Label value.
     * @returns {boolean} Whether the value can participate in memoization.
     */
    static #isImmutableScalar(value) {
        return (
            value === null ||
            value === undefined ||
            ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
        )
    }

    /**
     * Resolves the first non-empty display text value.
     * @param {unknown[]} values Candidate values.
     * @returns {string}
     */
    static #firstText(values) {
        return CircuitJsonSchematicSvgPortMetadata.#firstTextResult(values).text
    }

    /**
     * Escapes markup text.
     * @param {unknown} value Raw value.
     * @returns {string}
     */
    static #escapeHtml(value) {
        return SafeXmlText.escape(value)
    }
}

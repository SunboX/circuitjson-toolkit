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
        const pinNumber = CircuitJsonSchematicSvgPortMetadata.#firstText(
            element.pin_number,
            sourcePort?.pin_number
        )
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
     * @returns {string}
     */
    static label(element, sourcePort) {
        return CircuitJsonSchematicSvgPortMetadata.#firstText(
            element.name,
            element.label,
            sourcePort?.name,
            sourcePort?.label,
            sourcePort?.pin_label,
            element.pin_number,
            sourcePort?.pin_number,
            ...(Array.isArray(sourcePort?.port_hints)
                ? sourcePort.port_hints
                : [])
        )
    }

    /**
     * Resolves the first non-empty display text value.
     * @param {...unknown} values Candidate values.
     * @returns {string}
     */
    static #firstText(...values) {
        return (
            values
                .map((value) => String(value ?? '').trim())
                .find((value) => value) || ''
        )
    }

    /**
     * Escapes markup text.
     * @param {unknown} value Raw value.
     * @returns {string}
     */
    static #escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
    }
}

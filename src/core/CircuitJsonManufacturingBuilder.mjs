import { CircuitJsonIndexer } from './CircuitJsonIndexer.mjs'
import { CircuitJsonUnits } from './CircuitJsonUnits.mjs'

/**
 * Builds manufacturing-oriented metadata from element arrays.
 */
export class CircuitJsonManufacturingBuilder {
    /**
     * Builds pick-and-place rows and routing exchange text.
     * @param {object[]} circuitJson Parsed element array.
     * @param {{ elementsByType?: Map<string, object[]>, sourceComponentById?: Map<string, object> }} [index] Optional index.
     * @returns {{ pickAndPlaceRows: object[], routingDsn: string }}
     */
    static build(circuitJson, index = CircuitJsonIndexer.index(circuitJson)) {
        return {
            pickAndPlaceRows:
                CircuitJsonManufacturingBuilder.#pickAndPlaceRows(index),
            routingDsn: CircuitJsonManufacturingBuilder.#routingDsn(index)
        }
    }

    /**
     * Builds assembly placement rows.
     * @param {{ elementsByType?: Map<string, object[]>, sourceComponentById?: Map<string, object> }} index Element index.
     * @returns {object[]}
     */
    static #pickAndPlaceRows(index) {
        return CircuitJsonManufacturingBuilder.#all(index, 'pcb_component').map(
            (component) =>
                CircuitJsonManufacturingBuilder.#pickAndPlaceRow(
                    component,
                    index.sourceComponentById || new Map()
                )
        )
    }

    /**
     * Builds one placement row.
     * @param {object} component PCB component element.
     * @param {Map<string, object>} sourceComponentById Source lookup.
     * @returns {object}
     */
    static #pickAndPlaceRow(component, sourceComponentById) {
        const sourceId = String(component.source_component_id || '').trim()
        const source = sourceComponentById.get(sourceId) || {}
        const center = CircuitJsonUnits.optionalPoint(
            component.center || component
        ) || {
            x: 0,
            y: 0
        }
        const layer = CircuitJsonManufacturingBuilder.#layer(component.layer)

        return {
            designator: CircuitJsonManufacturingBuilder.#designator(
                component,
                source
            ),
            componentId: String(component.pcb_component_id || ''),
            sourceComponentId: sourceId,
            x: CircuitJsonManufacturingBuilder.#round(center.x),
            y: CircuitJsonManufacturingBuilder.#round(center.y),
            rotation: CircuitJsonUnits.angle(
                component.rotation ?? component.ccw_rotation,
                0
            ),
            layer,
            side: CircuitJsonManufacturingBuilder.#side(layer),
            value: CircuitJsonManufacturingBuilder.#value(source),
            package: String(
                source.ftype || source.package || source.footprint || ''
            ),
            manufacturerPartNumber: String(
                source.manufacturer_part_number ||
                    source.manufacturerPartNumber ||
                    ''
            )
        }
    }

    /**
     * Builds a compact routing exchange text payload.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @returns {string}
     */
    static #routingDsn(index) {
        const lines = ['(pcb assembly)', '  (unit mm)']
        lines.push(...CircuitJsonManufacturingBuilder.#boardLines(index))
        lines.push(...CircuitJsonManufacturingBuilder.#placementLines(index))
        lines.push(...CircuitJsonManufacturingBuilder.#networkLines(index))
        lines.push(')')
        return lines.join('\n')
    }

    /**
     * Builds board structure lines.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @returns {string[]}
     */
    static #boardLines(index) {
        const board = CircuitJsonManufacturingBuilder.#all(
            index,
            'pcb_board'
        )[0]
        const center = CircuitJsonUnits.optionalPoint(
            board?.center || board
        ) || {
            x: 0,
            y: 0
        }
        const width = CircuitJsonUnits.length(board?.width, 0)
        const height = CircuitJsonUnits.length(board?.height, 0)
        const minX = CircuitJsonManufacturingBuilder.#round(
            center.x - width / 2
        )
        const minY = CircuitJsonManufacturingBuilder.#round(
            center.y - height / 2
        )
        const maxX = CircuitJsonManufacturingBuilder.#round(
            center.x + width / 2
        )
        const maxY = CircuitJsonManufacturingBuilder.#round(
            center.y + height / 2
        )

        return [
            '  (structure',
            '    (boundary (rect ' + [minX, minY, maxX, maxY].join(' ') + '))',
            ...CircuitJsonManufacturingBuilder.#layers(board).map(
                (layer) => '    (layer ' + layer + ' signal)'
            ),
            '  )'
        ]
    }

    /**
     * Builds component placement lines.
     * @param {{ elementsByType?: Map<string, object[]>, sourceComponentById?: Map<string, object> }} index Element index.
     * @returns {string[]}
     */
    static #placementLines(index) {
        return [
            '  (placement',
            ...CircuitJsonManufacturingBuilder.#pickAndPlaceRows(index).map(
                (row) =>
                    '    (component ' +
                    CircuitJsonManufacturingBuilder.#token(row.designator) +
                    ' (place ' +
                    [
                        row.x,
                        row.y,
                        row.side || row.layer || 'top',
                        row.rotation
                    ].join(' ') +
                    '))'
            ),
            '  )'
        ]
    }

    /**
     * Builds network lines for nets, pads, vias, and wires.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @returns {string[]}
     */
    static #networkLines(index) {
        return [
            '  (network',
            ...CircuitJsonManufacturingBuilder.#netNames(index).flatMap(
                (netName) => [
                    '    (net ' +
                        CircuitJsonManufacturingBuilder.#token(netName),
                    ...CircuitJsonManufacturingBuilder.#pinLines(
                        index,
                        netName
                    ),
                    ...CircuitJsonManufacturingBuilder.#wireLines(
                        index,
                        netName
                    ),
                    '    )'
                ]
            ),
            '  )'
        ]
    }

    /**
     * Builds pad pin lines for one net.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @param {string} netName Net name.
     * @returns {string[]}
     */
    static #pinLines(index, netName) {
        return CircuitJsonManufacturingBuilder.#all(index, 'pcb_smtpad')
            .filter(
                (pad) =>
                    CircuitJsonManufacturingBuilder.#netName(pad) === netName
            )
            .map((pad) => {
                const point = CircuitJsonUnits.optionalPoint(
                    pad.center || pad
                ) || {
                    x: 0,
                    y: 0
                }
                return (
                    '      (pin ' +
                    CircuitJsonManufacturingBuilder.#token(
                        pad.pcb_smtpad_id || ''
                    ) +
                    ' ' +
                    [
                        CircuitJsonManufacturingBuilder.#round(point.x),
                        CircuitJsonManufacturingBuilder.#round(point.y)
                    ].join(' ') +
                    ')'
                )
            })
    }

    /**
     * Builds routed wire lines for one net.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @param {string} netName Net name.
     * @returns {string[]}
     */
    static #wireLines(index, netName) {
        return CircuitJsonManufacturingBuilder.#all(index, 'pcb_trace')
            .filter(
                (trace) =>
                    CircuitJsonManufacturingBuilder.#netName(trace) === netName
            )
            .flatMap((trace) =>
                CircuitJsonManufacturingBuilder.#traceWireLines(trace)
            )
    }

    /**
     * Builds routed wire lines for one trace.
     * @param {object} trace Trace element.
     * @returns {string[]}
     */
    static #traceWireLines(trace) {
        const route = Array.isArray(trace.route) ? trace.route : []
        const lines = []
        let previous = null
        for (const entry of route) {
            const current = CircuitJsonUnits.optionalPoint(
                entry.center || entry
            )
            if (!current) continue
            if (previous) {
                const layer = CircuitJsonManufacturingBuilder.#layer(
                    entry.layer || previous.layer || trace.layer
                )
                const width = CircuitJsonUnits.length(
                    entry.width ?? previous.width ?? trace.width,
                    0
                )
                lines.push(
                    '      (wire ' +
                        [
                            layer || 'top',
                            CircuitJsonManufacturingBuilder.#round(previous.x),
                            CircuitJsonManufacturingBuilder.#round(previous.y),
                            CircuitJsonManufacturingBuilder.#round(current.x),
                            CircuitJsonManufacturingBuilder.#round(current.y),
                            CircuitJsonManufacturingBuilder.#round(width)
                        ].join(' ') +
                        ')'
                )
            }
            previous = { ...entry, x: current.x, y: current.y }
        }
        return lines
    }

    /**
     * Builds sorted net names.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @returns {string[]}
     */
    static #netNames(index) {
        const names = new Set()
        for (const net of CircuitJsonManufacturingBuilder.#all(
            index,
            'source_net'
        )) {
            const name = String(net.name || net.source_net_id || '').trim()
            if (name) names.add(name)
        }
        for (const type of ['pcb_smtpad', 'pcb_trace', 'pcb_via']) {
            for (const element of CircuitJsonManufacturingBuilder.#all(
                index,
                type
            )) {
                const name = CircuitJsonManufacturingBuilder.#netName(element)
                if (name) names.add(name)
            }
        }
        return [...names].sort((left, right) => left.localeCompare(right))
    }

    /**
     * Resolves layer names from board metadata.
     * @param {object | undefined} board Board element.
     * @returns {string[]}
     */
    static #layers(board) {
        const count = Math.max(1, Math.round(Number(board?.num_layers || 2)))
        if (count === 1) return ['top']
        return [
            'top',
            ...Array.from(
                { length: Math.max(count - 2, 0) },
                (_entry, index) => 'inner' + (index + 1)
            ),
            'bottom'
        ]
    }

    /**
     * Resolves rows by type.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @param {string} type Element type.
     * @returns {object[]}
     */
    static #all(index, type) {
        return index.elementsByType?.get(type) || []
    }

    /**
     * Resolves a component designator.
     * @param {object} component PCB component.
     * @param {object} source Source component.
     * @returns {string}
     */
    static #designator(component, source) {
        return String(
            source.name ||
                source.reference ||
                source.designator ||
                component.name ||
                component.pcb_component_id ||
                ''
        ).trim()
    }

    /**
     * Resolves a source value field.
     * @param {object} source Source component.
     * @returns {string}
     */
    static #value(source) {
        return String(
            source.value ||
                source.resistance ||
                source.capacitance ||
                source.inductance ||
                ''
        )
    }

    /**
     * Resolves a normalized net name.
     * @param {object} element Element row.
     * @returns {string}
     */
    static #netName(element) {
        return String(
            element?.netName ??
                element?.net ??
                element?.net_name ??
                element?.source_net_name ??
                ''
        ).trim()
    }

    /**
     * Resolves a layer string.
     * @param {unknown} value Layer candidate.
     * @returns {string}
     */
    static #layer(value) {
        const raw =
            typeof value === 'object' && value !== null ? value.name : value
        const text = String(raw ?? '').trim()
        const lowered = text.toLowerCase()
        if (['front', 'f.cu', '1'].includes(lowered)) return 'top'
        if (['back', 'b.cu', '32'].includes(lowered)) return 'bottom'
        return text || 'top'
    }

    /**
     * Resolves an assembly side.
     * @param {string} layer Layer name.
     * @returns {'top' | 'bottom' | ''}
     */
    static #side(layer) {
        const text = String(layer || '').toLowerCase()
        if (/\b(bottom|back)\b|\bb[._-]/u.test(text)) return 'bottom'
        if (/\b(top|front)\b|\bf[._-]/u.test(text)) return 'top'
        return ''
    }

    /**
     * Builds a DSN-safe token.
     * @param {unknown} value Raw value.
     * @returns {string}
     */
    static #token(value) {
        return String(value || 'unnamed').replace(/[^A-Za-z0-9_.:-]+/gu, '_')
    }

    /**
     * Rounds a numeric value for deterministic output.
     * @param {number} value Number.
     * @returns {number}
     */
    static #round(value) {
        const number = Number(value)
        if (!Number.isFinite(number)) return 0
        return Number(number.toFixed(6))
    }
}

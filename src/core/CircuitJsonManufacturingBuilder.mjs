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
     * @returns {{ pickAndPlaceRows: object[], routingDsn: string, routingGuides: object[], fabricationNotes: object[] }}
     */
    static build(circuitJson, index = CircuitJsonIndexer.index(circuitJson)) {
        return {
            pickAndPlaceRows:
                CircuitJsonManufacturingBuilder.#pickAndPlaceRows(index),
            routingDsn: CircuitJsonManufacturingBuilder.#routingDsn(index),
            routingGuides:
                CircuitJsonManufacturingBuilder.#routingGuides(index),
            fabricationNotes:
                CircuitJsonManufacturingBuilder.#fabricationNotes(index)
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
        const sourceNetNames =
            CircuitJsonManufacturingBuilder.#sourceNetNames(index)
        return [
            '  (network',
            ...CircuitJsonManufacturingBuilder.#netNames(index).flatMap(
                (netName) => [
                    '    (net ' +
                        CircuitJsonManufacturingBuilder.#token(netName),
                    ...CircuitJsonManufacturingBuilder.#pinLines(
                        index,
                        netName,
                        sourceNetNames
                    ),
                    ...CircuitJsonManufacturingBuilder.#drillLines(
                        index,
                        netName,
                        sourceNetNames
                    ),
                    ...CircuitJsonManufacturingBuilder.#wireLines(
                        index,
                        netName,
                        sourceNetNames
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
     * @param {Map<string, string>} sourceNetNames Source net lookup.
     * @returns {string[]}
     */
    static #pinLines(index, netName, sourceNetNames) {
        return CircuitJsonManufacturingBuilder.#all(index, 'pcb_smtpad')
            .filter(
                (pad) =>
                    CircuitJsonManufacturingBuilder.#netName(
                        pad,
                        sourceNetNames
                    ) === netName
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
     * Builds drill feature lines for one net.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @param {string} netName Net name.
     * @param {Map<string, string>} sourceNetNames Source net lookup.
     * @returns {string[]}
     */
    static #drillLines(index, netName, sourceNetNames) {
        return [
            ...CircuitJsonManufacturingBuilder.#all(index, 'pcb_via')
                .filter(
                    (via) =>
                        CircuitJsonManufacturingBuilder.#netName(
                            via,
                            sourceNetNames
                        ) === netName
                )
                .map((via) =>
                    CircuitJsonManufacturingBuilder.#drillLine(via, 'via')
                ),
            ...CircuitJsonManufacturingBuilder.#all(index, 'pcb_plated_hole')
                .filter(
                    (hole) =>
                        CircuitJsonManufacturingBuilder.#netName(
                            hole,
                            sourceNetNames
                        ) === netName
                )
                .map((hole) =>
                    CircuitJsonManufacturingBuilder.#drillLine(
                        hole,
                        'plated_hole'
                    )
                )
        ].filter(Boolean)
    }

    /**
     * Builds one drill feature line.
     * @param {object} element Drill-bearing element.
     * @param {'via' | 'plated_hole'} kind Drill line kind.
     * @returns {string}
     */
    static #drillLine(element, kind) {
        const point = CircuitJsonUnits.optionalPoint(element.center || element)
        const layers = CircuitJsonManufacturingBuilder.#elementLayers(element)
        return (
            '      (' +
            kind +
            ' ' +
            [
                CircuitJsonManufacturingBuilder.#token(
                    element.pcb_via_id ||
                        element.pcb_plated_hole_id ||
                        element.pcb_hole_id ||
                        ''
                ),
                CircuitJsonManufacturingBuilder.#round(point?.x),
                CircuitJsonManufacturingBuilder.#round(point?.y),
                CircuitJsonManufacturingBuilder.#round(
                    CircuitJsonManufacturingBuilder.#holeDiameter(element)
                ),
                CircuitJsonManufacturingBuilder.#round(
                    CircuitJsonManufacturingBuilder.#outerDiameter(element)
                ),
                ...layers
            ].join(' ') +
            ')'
        )
    }

    /**
     * Builds routed wire lines for one net.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @param {string} netName Net name.
     * @param {Map<string, string>} sourceNetNames Source net lookup.
     * @returns {string[]}
     */
    static #wireLines(index, netName, sourceNetNames) {
        return CircuitJsonManufacturingBuilder.#all(index, 'pcb_trace')
            .filter(
                (trace) =>
                    CircuitJsonManufacturingBuilder.#netName(
                        trace,
                        sourceNetNames
                    ) === netName
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
        const sourceNetNames =
            CircuitJsonManufacturingBuilder.#sourceNetNames(index)
        for (const name of sourceNetNames.values()) {
            if (name) names.add(name)
        }
        for (const type of [
            'pcb_smtpad',
            'pcb_trace',
            'pcb_via',
            'pcb_plated_hole',
            'pcb_trace_hint',
            'pcb_breakout_point'
        ]) {
            for (const element of CircuitJsonManufacturingBuilder.#all(
                index,
                type
            )) {
                const name = CircuitJsonManufacturingBuilder.#netName(
                    element,
                    sourceNetNames
                )
                if (name) names.add(name)
            }
        }
        return [...names].sort((left, right) => left.localeCompare(right))
    }

    /**
     * Builds route guide metadata from hints and breakout points.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @returns {object[]}
     */
    static #routingGuides(index) {
        const sourceNetNames =
            CircuitJsonManufacturingBuilder.#sourceNetNames(index)
        return [
            ...CircuitJsonManufacturingBuilder.#all(index, 'pcb_trace_hint')
                .map((hint) =>
                    CircuitJsonManufacturingBuilder.#traceHintGuide(
                        hint,
                        sourceNetNames
                    )
                )
                .filter(Boolean),
            ...CircuitJsonManufacturingBuilder.#all(index, 'pcb_breakout_point')
                .map((point) =>
                    CircuitJsonManufacturingBuilder.#breakoutGuide(
                        point,
                        sourceNetNames
                    )
                )
                .filter(Boolean)
        ]
    }

    /**
     * Builds one trace hint guide.
     * @param {object} hint Trace hint element.
     * @param {Map<string, string>} sourceNetNames Source net lookup.
     * @returns {object | null}
     */
    static #traceHintGuide(hint, sourceNetNames) {
        const route = (Array.isArray(hint.route) ? hint.route : [])
            .map((point) =>
                CircuitJsonManufacturingBuilder.#routeGuidePoint(point)
            )
            .filter(Boolean)
        if (!route.length) return null
        return {
            type: 'trace_hint',
            id: String(hint.pcb_trace_hint_id || ''),
            pcbComponentId: String(hint.pcb_component_id || ''),
            pcbPortId: String(hint.pcb_port_id || ''),
            sourceNetId: String(hint.source_net_id || ''),
            netName: CircuitJsonManufacturingBuilder.#netName(
                hint,
                sourceNetNames
            ),
            subcircuitId: String(hint.subcircuit_id || ''),
            route
        }
    }

    /**
     * Builds one breakout guide.
     * @param {object} breakout Breakout point element.
     * @param {Map<string, string>} sourceNetNames Source net lookup.
     * @returns {object | null}
     */
    static #breakoutGuide(breakout, sourceNetNames) {
        const point = CircuitJsonUnits.optionalPoint(
            breakout.center || breakout
        )
        if (!point) return null
        return {
            type: 'breakout_point',
            id: String(breakout.pcb_breakout_point_id || ''),
            pcbGroupId: String(breakout.pcb_group_id || ''),
            sourceTraceId: String(breakout.source_trace_id || ''),
            sourcePortId: String(breakout.source_port_id || ''),
            sourceNetId: String(breakout.source_net_id || ''),
            netName: CircuitJsonManufacturingBuilder.#netName(
                breakout,
                sourceNetNames
            ),
            subcircuitId: String(breakout.subcircuit_id || ''),
            point: {
                x: CircuitJsonManufacturingBuilder.#round(point.x),
                y: CircuitJsonManufacturingBuilder.#round(point.y)
            }
        }
    }

    /**
     * Builds a normalized route guide point.
     * @param {object} value Point row.
     * @returns {{ x: number, y: number, layer: string } | null}
     */
    static #routeGuidePoint(value) {
        const point = CircuitJsonUnits.optionalPoint(value?.center || value)
        if (!point) return null
        return {
            x: CircuitJsonManufacturingBuilder.#round(point.x),
            y: CircuitJsonManufacturingBuilder.#round(point.y),
            layer: CircuitJsonManufacturingBuilder.#layer(value?.layer)
        }
    }

    /**
     * Builds fabrication note metadata.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @returns {object[]}
     */
    static #fabricationNotes(index) {
        return [
            ...CircuitJsonManufacturingBuilder.#all(
                index,
                'pcb_fabrication_note_text'
            ).map((note) =>
                CircuitJsonManufacturingBuilder.#fabricationTextNote(note)
            ),
            ...CircuitJsonManufacturingBuilder.#all(
                index,
                'pcb_fabrication_note_path'
            ).map((note) =>
                CircuitJsonManufacturingBuilder.#fabricationPathNote(note)
            ),
            ...CircuitJsonManufacturingBuilder.#all(
                index,
                'pcb_fabrication_note_rect'
            ).map((note) =>
                CircuitJsonManufacturingBuilder.#fabricationRectNote(note)
            ),
            ...CircuitJsonManufacturingBuilder.#all(
                index,
                'pcb_fabrication_note_dimension'
            ).map((note) =>
                CircuitJsonManufacturingBuilder.#fabricationDimensionNote(note)
            )
        ].filter(Boolean)
    }

    /**
     * Builds one fabrication text note row.
     * @param {object} note Fabrication text element.
     * @returns {object | null}
     */
    static #fabricationTextNote(note) {
        const anchor = CircuitJsonUnits.optionalPoint(
            note.anchor_position || note.center || note
        ) || { x: 0, y: 0 }
        return {
            ...CircuitJsonManufacturingBuilder.#fabricationBaseNote(
                note,
                'text'
            ),
            text: String(note.text || ''),
            anchor: {
                x: CircuitJsonManufacturingBuilder.#round(anchor.x),
                y: CircuitJsonManufacturingBuilder.#round(anchor.y)
            },
            rotation: CircuitJsonUnits.angle(note.ccw_rotation, 0),
            fontSize: CircuitJsonUnits.length(note.font_size, 1),
            color: String(note.color || '')
        }
    }

    /**
     * Builds one fabrication path note row.
     * @param {object} note Fabrication path element.
     * @returns {object | null}
     */
    static #fabricationPathNote(note) {
        const route = (Array.isArray(note.route) ? note.route : [])
            .map((point) => CircuitJsonUnits.optionalPoint(point))
            .filter(Boolean)
            .map((point) => ({
                x: CircuitJsonManufacturingBuilder.#round(point.x),
                y: CircuitJsonManufacturingBuilder.#round(point.y)
            }))
        if (!route.length) return null
        return {
            ...CircuitJsonManufacturingBuilder.#fabricationBaseNote(
                note,
                'path'
            ),
            route,
            strokeWidth: CircuitJsonUnits.length(note.stroke_width, 0),
            color: String(note.color || '')
        }
    }

    /**
     * Builds one fabrication rectangle note row.
     * @param {object} note Fabrication rectangle element.
     * @returns {object | null}
     */
    static #fabricationRectNote(note) {
        const center = CircuitJsonUnits.optionalPoint(note.center || note)
        if (!center) return null
        return {
            ...CircuitJsonManufacturingBuilder.#fabricationBaseNote(
                note,
                'rect'
            ),
            center: {
                x: CircuitJsonManufacturingBuilder.#round(center.x),
                y: CircuitJsonManufacturingBuilder.#round(center.y)
            },
            width: CircuitJsonUnits.length(note.width, 0),
            height: CircuitJsonUnits.length(note.height, 0),
            strokeWidth: CircuitJsonUnits.length(note.stroke_width, 0.1),
            cornerRadius: CircuitJsonUnits.length(note.corner_radius, 0),
            isFilled: note.is_filled === true,
            hasStroke: note.has_stroke !== false,
            isStrokeDashed: note.is_stroke_dashed === true,
            color: String(note.color || '')
        }
    }

    /**
     * Builds one fabrication dimension note row.
     * @param {object} note Fabrication dimension element.
     * @returns {object | null}
     */
    static #fabricationDimensionNote(note) {
        const from = CircuitJsonUnits.optionalPoint(note.from)
        const to = CircuitJsonUnits.optionalPoint(note.to)
        if (!from || !to) return null
        return {
            ...CircuitJsonManufacturingBuilder.#fabricationBaseNote(
                note,
                'dimension'
            ),
            from: {
                x: CircuitJsonManufacturingBuilder.#round(from.x),
                y: CircuitJsonManufacturingBuilder.#round(from.y)
            },
            to: {
                x: CircuitJsonManufacturingBuilder.#round(to.x),
                y: CircuitJsonManufacturingBuilder.#round(to.y)
            },
            text: String(note.text || ''),
            offset: CircuitJsonUnits.length(note.offset, 0),
            offsetDistance: CircuitJsonUnits.length(note.offset_distance, 0),
            offsetDirection: CircuitJsonManufacturingBuilder.#offsetDirection(
                note.offset_direction
            ),
            rotation: CircuitJsonUnits.angle(
                note.text_ccw_rotation ?? note.ccw_rotation,
                0
            ),
            fontSize: CircuitJsonUnits.length(note.font_size, 1),
            arrowSize: CircuitJsonUnits.length(note.arrow_size, 1),
            color: String(note.color || '')
        }
    }

    /**
     * Builds common fabrication note metadata.
     * @param {object} note Fabrication note element.
     * @param {string} type Note type.
     * @returns {object}
     */
    static #fabricationBaseNote(note, type) {
        return {
            type,
            elementType: String(note.type || ''),
            id: CircuitJsonIndexer.getElementId(note),
            pcbComponentId: String(note.pcb_component_id || ''),
            pcbGroupId: String(note.pcb_group_id || ''),
            subcircuitId: String(note.subcircuit_id || ''),
            layer: CircuitJsonManufacturingBuilder.#layer(note.layer)
        }
    }

    /**
     * Normalizes an offset direction row.
     * @param {object | null | undefined} direction Direction row.
     * @returns {{ x: number, y: number } | null}
     */
    static #offsetDirection(direction) {
        const x = Number(direction?.x)
        const y = Number(direction?.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        return {
            x: CircuitJsonManufacturingBuilder.#round(x),
            y: CircuitJsonManufacturingBuilder.#round(y)
        }
    }

    /**
     * Builds source net id to display name lookup.
     * @param {{ elementsByType?: Map<string, object[]> }} index Element index.
     * @returns {Map<string, string>}
     */
    static #sourceNetNames(index) {
        return new Map(
            CircuitJsonManufacturingBuilder.#all(index, 'source_net').map(
                (net) => {
                    const id = String(net.source_net_id || '').trim()
                    const name = String(net.name || id).trim()
                    return [id, name]
                }
            )
        )
    }

    /**
     * Resolves layer names from a drill-bearing element.
     * @param {object} element Element row.
     * @returns {string[]}
     */
    static #elementLayers(element) {
        const values = Array.isArray(element.layers)
            ? element.layers
            : [element.from_layer, element.to_layer, element.layer]
        const layers = values
            .map((value) => CircuitJsonManufacturingBuilder.#layer(value))
            .filter(Boolean)
        return CircuitJsonManufacturingBuilder.#uniqueStrings(
            layers.length ? layers : ['top', 'bottom']
        )
    }

    /**
     * Resolves drill hole diameter.
     * @param {object} element Element row.
     * @returns {number}
     */
    static #holeDiameter(element) {
        return CircuitJsonManufacturingBuilder.#maxLength([
            element.hole_diameter,
            element.hole_width,
            element.hole_height
        ])
    }

    /**
     * Resolves drill outer diameter.
     * @param {object} element Element row.
     * @returns {number}
     */
    static #outerDiameter(element) {
        return CircuitJsonManufacturingBuilder.#maxLength([
            element.outer_diameter,
            element.outer_width,
            element.outer_height,
            element.rect_pad_width,
            element.rect_pad_height
        ])
    }

    /**
     * Returns the largest valid length in a list.
     * @param {unknown[]} values Candidate values.
     * @returns {number}
     */
    static #maxLength(values) {
        const lengths = values
            .map((value) => CircuitJsonUnits.optionalLength(value))
            .filter((value) => value !== null)
        return lengths.length ? Math.max(...lengths) : 0
    }

    /**
     * Returns unique strings in input order.
     * @param {string[]} values Candidate strings.
     * @returns {string[]}
     */
    static #uniqueStrings(values) {
        return [
            ...new Set(values.map((value) => String(value || '').trim()))
        ].filter(Boolean)
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
     * @param {Map<string, string>} [sourceNetNames] Source net lookup.
     * @returns {string}
     */
    static #netName(element, sourceNetNames = new Map()) {
        const sourceNetId = String(element?.source_net_id || '').trim()
        return String(
            element?.netName ??
                element?.net ??
                element?.net_name ??
                element?.source_net_name ??
                sourceNetNames.get(sourceNetId) ??
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

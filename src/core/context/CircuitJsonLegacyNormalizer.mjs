import { CircuitJsonUnits } from '../CircuitJsonUnits.mjs'
import { CircuitJsonSchematicTableNormalizer } from './CircuitJsonSchematicTableNormalizer.mjs'

const VISIBLE_LAYERS = new Set([
    'top',
    'bottom',
    'inner1',
    'inner2',
    'inner3',
    'inner4',
    'inner5',
    'inner6'
])
const EMPTY_LIST = Object.freeze([])
const UPSTREAM_SUPPLIERS = new Set([
    'jlcpcb',
    'macrofab',
    'pcbway',
    'digikey',
    'mouser',
    'lcsc'
])
const SIDE_LAYER_TYPES = new Set([
    'pcb_copper_text',
    'pcb_fabrication_note_dimension',
    'pcb_fabrication_note_path',
    'pcb_fabrication_note_rect',
    'pcb_fabrication_note_text',
    'pcb_note_dimension',
    'pcb_note_line',
    'pcb_note_path',
    'pcb_note_rect',
    'pcb_note_text',
    'pcb_silkscreen_circle',
    'pcb_silkscreen_graphic',
    'pcb_silkscreen_line',
    'pcb_silkscreen_oval',
    'pcb_silkscreen_path',
    'pcb_silkscreen_pill',
    'pcb_silkscreen_rect',
    'pcb_silkscreen_text'
])
const COMPONENT_ARTWORK_TYPES = new Set([
    'pcb_copper_text',
    'pcb_fabrication_note_dimension',
    'pcb_fabrication_note_path',
    'pcb_fabrication_note_rect',
    'pcb_fabrication_note_text',
    'pcb_silkscreen_circle',
    'pcb_silkscreen_graphic',
    'pcb_silkscreen_line',
    'pcb_silkscreen_oval',
    'pcb_silkscreen_path',
    'pcb_silkscreen_pill',
    'pcb_silkscreen_rect',
    'pcb_silkscreen_text'
])
const COURTYARD_TYPES = new Set([
    'pcb_courtyard_circle',
    'pcb_courtyard_outline',
    'pcb_courtyard_pill',
    'pcb_courtyard_polygon',
    'pcb_courtyard_rect'
])
const PCB_ROUTE_PATH_TYPES = new Set([
    'pcb_fabrication_note_path',
    'pcb_note_path',
    'pcb_silkscreen_path'
])

/**
 * Projects explicitly supported pre-union shapes onto valid CircuitJSON.
 */
export class CircuitJsonLegacyNormalizer {
    /**
     * Normalizes a dense safe model while preserving already canonical rows.
     * @param {unknown} model CircuitJSON model.
     * @param {{ owned?: boolean }} [options] Ownership options.
     * @returns {unknown} Original model or a standards-shaped replacement.
     */
    static normalize(model, options = {}) {
        if (options.owned === true) {
            if (!Array.isArray(model)) return model
            let hasSchematicTable = false
            for (let index = 0; index < model.length; index += 1) {
                const fields = model[index]
                const type = fields?.type
                if (
                    !fields ||
                    typeof fields !== 'object' ||
                    typeof type !== 'string'
                ) {
                    continue
                }
                if (type === 'schematic_table') hasSchematicTable = true
                CircuitJsonLegacyNormalizer.#fields(fields, type)
            }
            if (hasSchematicTable) {
                CircuitJsonSchematicTableNormalizer.normalize(model, true)
            }
            return model
        }
        const descriptors = CircuitJsonLegacyNormalizer.#array(model)
        if (!descriptors) return model
        const length = descriptors.length.value
        const rows = options.owned === true ? model : new Array(length)
        let changed = false
        for (let index = 0; index < length; index += 1) {
            const original = descriptors[String(index)].value
            const normalized = CircuitJsonLegacyNormalizer.#element(
                original,
                options.owned === true
            )
            rows[index] = normalized
            if (normalized !== original) changed = true
        }
        if (CircuitJsonSchematicTableNormalizer.normalize(rows, false)) {
            changed = true
        }
        return changed || options.owned === true ? rows : model
    }

    /** @param {unknown} element Element candidate. @param {boolean} owned Owned input. @returns {unknown} */
    static #element(element, owned) {
        const descriptors = CircuitJsonLegacyNormalizer.#record(element)
        const type = descriptors?.type?.value
        if (!descriptors || typeof type !== 'string') return element
        const fields = Object.fromEntries(
            Object.entries(descriptors).map(([key, descriptor]) => [
                key,
                descriptor.value
            ])
        )
        CircuitJsonLegacyNormalizer.#fields(fields, type)
        const keys = Object.keys(fields)
        const changed =
            keys.length !== Object.keys(descriptors).length ||
            keys.some(
                (key) =>
                    !descriptors[key] || fields[key] !== descriptors[key].value
            )
        if (!changed) return element
        if (owned) {
            for (const key of Object.keys(element)) delete element[key]
            Object.assign(element, fields)
            return element
        }
        return fields
    }

    /** @param {Record<string, any>} fields Element fields. @param {string} type Type. @returns {void} */
    static #fields(fields, type) {
        CircuitJsonLegacyNormalizer.#common(fields, type)
        if (type.startsWith('pcb_')) {
            CircuitJsonLegacyNormalizer.#pcb(fields, type)
        } else if (type.startsWith('schematic_')) {
            CircuitJsonLegacyNormalizer.#schematic(fields, type)
        }
    }

    /** @param {Record<string, any>} fields Element fields. @param {string} type Type. @returns {void} */
    static #common(fields, type) {
        if (type === 'source_component') {
            fields.ftype ??=
                CircuitJsonLegacyNormalizer.#sourceComponentFtype(fields)
            CircuitJsonLegacyNormalizer.#supplierNumbers(fields)
        }
        if (
            type === 'source_net' &&
            fields.member_source_group_ids === undefined
        ) {
            fields.member_source_group_ids = EMPTY_LIST
        }
        if (type === 'source_trace') {
            fields.connected_source_port_ids ??= EMPTY_LIST
            fields.connected_source_net_ids ??= EMPTY_LIST
        }
        if (type === 'source_port') fields.name ??= ''
        if (type === 'source_component_pins_underspecified_warning') {
            fields.source_port_ids ??=
                fields.source_port_id === undefined
                    ? EMPTY_LIST
                    : [fields.source_port_id]
        }
        if (type === 'cad_component') {
            fields.pcb_component_id ??= ''
            fields.source_component_id ??= ''
            fields.position ??= { x: 0, y: 0, z: 0 }
        }
    }

    /** @param {Record<string, any>} fields Element fields. @param {string} type Type. @returns {void} */
    static #pcb(fields, type) {
        CircuitJsonLegacyNormalizer.#courtyard(fields, type)
        const normalizedType = fields.type
        CircuitJsonLegacyNormalizer.#padClearanceDiagnostic(
            fields,
            normalizedType
        )
        if (normalizedType === 'pcb_board' && !Array.isArray(fields.outline)) {
            if (Array.isArray(fields.outline?.points)) {
                fields.outline = fields.outline.points
            }
        }
        if (normalizedType === 'pcb_component') {
            fields.rotation ??= 0
            fields.width ??= 0
            fields.height ??= 0
        }
        if (normalizedType === 'pcb_group') {
            fields.pcb_component_ids ??= EMPTY_LIST
        }
        if (normalizedType === 'pcb_smtpad') {
            CircuitJsonLegacyNormalizer.#padLengths(fields)
            if (fields.shape === 'rounded_rect') {
                fields.legacy_shape = fields.shape
                fields.shape = 'rect'
            }
            if (fields.shape === 'circle' && fields.radius === undefined) {
                fields.radius =
                    fields.diameter !== undefined
                        ? Number(fields.diameter) / 2
                        : Math.min(
                              Number(fields.width),
                              Number(fields.height)
                          ) / 2
            }
            if (
                ['pill', 'rotated_pill'].includes(fields.shape) &&
                fields.radius === undefined
            ) {
                fields.radius =
                    Math.min(Number(fields.width), Number(fields.height)) / 2
            }
        }
        if (normalizedType === 'pcb_plated_hole') {
            fields.layers ??= fields.layer ? [fields.layer] : ['top', 'bottom']
            if (fields.shape === 'circular_hole_with_rect_pad') {
                fields.hole_shape ??= 'circle'
                fields.pad_shape ??= 'rect'
            }
        }
        if (normalizedType === 'pcb_via') {
            fields.layers = CircuitJsonLegacyNormalizer.#layers(fields.layers, [
                fields.from_layer ?? 'top',
                fields.to_layer ?? 'bottom'
            ])
            if (fields.from_layer !== undefined) {
                fields.from_layer = CircuitJsonLegacyNormalizer.#side(
                    fields.from_layer
                )
            }
            if (fields.to_layer !== undefined) {
                fields.to_layer = CircuitJsonLegacyNormalizer.#side(
                    fields.to_layer
                )
            }
        }
        if (normalizedType === 'pcb_hole') {
            if (fields.hole_shape === 'round') fields.hole_shape = 'circle'
            if (fields.hole_shape === 'circle_or_square') {
                fields.hole_shape = 'circle'
            }
            if (['circle', 'square'].includes(fields.hole_shape)) {
                fields.hole_diameter ??=
                    fields.diameter ?? fields.width ?? fields.height ?? 0
            } else {
                fields.hole_width ??= fields.width ?? fields.diameter ?? 0
                fields.hole_height ??= fields.height ?? fields.diameter ?? 0
            }
        }
        if (normalizedType === 'pcb_keepout') {
            fields.shape ??= fields.radius !== undefined ? 'circle' : 'rect'
            fields.layers ??= fields.layer ? [fields.layer] : ['top']
            if (fields.shape === 'polygon' && Array.isArray(fields.points)) {
                const bounds = CircuitJsonLegacyNormalizer.#pointBounds(
                    fields.points
                )
                if (bounds) {
                    fields.legacy_shape = 'polygon'
                    fields.shape = 'rect'
                    fields.center = {
                        x: (bounds.minX + bounds.maxX) / 2,
                        y: (bounds.minY + bounds.maxY) / 2
                    }
                    fields.width = bounds.maxX - bounds.minX
                    fields.height = bounds.maxY - bounds.minY
                }
            }
        }
        if (normalizedType === 'pcb_cutout') {
            fields.shape ??= Array.isArray(fields.points)
                ? 'polygon'
                : Array.isArray(fields.route)
                  ? 'path'
                  : fields.radius !== undefined
                    ? 'circle'
                    : 'rect'
            if (fields.shape === 'path') {
                fields.slot_width ??= fields.width ?? 0
            }
        }
        if (normalizedType === 'pcb_port') {
            fields.layers ??= fields.layer ? [fields.layer] : ['top']
        }
        if (normalizedType === 'pcb_copper_pour' && fields.shape === 'brep') {
            CircuitJsonLegacyNormalizer.#brep(fields)
        }
        if (normalizedType === 'pcb_copper_pour') {
            fields.layer = CircuitJsonLegacyNormalizer.#side(fields.layer)
        }
        if (normalizedType === 'pcb_solder_paste') {
            fields.x ??= fields.center?.x
            fields.y ??= fields.center?.y
            fields.shape ??= fields.radius !== undefined ? 'circle' : 'rect'
            if (fields.shape === 'pill') {
                fields.radius ??=
                    Math.min(Number(fields.width), Number(fields.height)) / 2
            }
        }
        if (normalizedType === 'pcb_breakout_point') {
            fields.pcb_group_id ??= ''
            fields.x ??= fields.center?.x ?? 0
            fields.y ??= fields.center?.y ?? 0
        }
        if (normalizedType === 'pcb_thermal_spoke') {
            fields.pcb_ground_plane_id ??= ''
            fields.shape ??= 'spokes'
            fields.spoke_count ??= 4
            fields.spoke_thickness ??= fields.width ?? 0
            fields.spoke_inner_diameter ??= 0
            fields.spoke_outer_diameter ??= 0
        }
        if (normalizedType === 'pcb_trace_error') {
            fields.error_type = 'pcb_trace_error'
            fields.pcb_trace_id ??= ''
            fields.source_trace_id ??= ''
            fields.pcb_component_ids ??=
                fields.pcb_component_id === undefined
                    ? []
                    : [fields.pcb_component_id]
            fields.pcb_port_ids ??= []
        }
        if (normalizedType === 'pcb_trace') {
            fields.route = CircuitJsonLegacyNormalizer.#traceRoute(fields.route)
        }
        if (
            normalizedType === 'pcb_silkscreen_circle' &&
            fields.center === undefined &&
            (fields.x !== undefined || fields.y !== undefined)
        ) {
            fields.center = { x: fields.x ?? 0, y: fields.y ?? 0 }
        }
        if (normalizedType === 'pcb_silkscreen_oval') {
            if (fields.radius_x === undefined && fields.width !== undefined) {
                fields.radius_x = Number(fields.width) / 2
            }
            if (fields.radius_y === undefined && fields.height !== undefined) {
                fields.radius_y = Number(fields.height) / 2
            }
        }
        if (normalizedType === 'pcb_courtyard_outline') {
            fields.outline ??=
                fields.points ?? fields.route ?? fields.path ?? []
            fields.stroke_width ??= fields.width
            delete fields.points
            delete fields.route
            delete fields.path
            delete fields.width
        }
        if (COURTYARD_TYPES.has(normalizedType)) {
            fields.pcb_component_id ??= ''
            fields.layer = CircuitJsonLegacyNormalizer.#side(fields.layer)
        }
        if (COMPONENT_ARTWORK_TYPES.has(normalizedType)) {
            fields.pcb_component_id ??= ''
        }
        if (SIDE_LAYER_TYPES.has(normalizedType)) {
            fields.layer = CircuitJsonLegacyNormalizer.#side(fields.layer)
        }
        if (PCB_ROUTE_PATH_TYPES.has(normalizedType)) {
            fields.route ??= fields.points ?? fields.path ?? []
            fields.stroke_width ??= fields.width ?? 0
            delete fields.points
            delete fields.path
            delete fields.width
        }
        if (normalizedType === 'pcb_fabrication_note_dimension') {
            fields.from ??= fields.start
            fields.to ??= fields.end
        }
    }

    /**
     * Projects legacy string pad dimensions onto upstream numeric pad fields.
     * @param {Record<string, any>} fields Pad fields.
     * @returns {void}
     */
    static #padLengths(fields) {
        for (const key of [
            'width',
            'height',
            'diameter',
            'radius',
            'corner_radius',
            'rect_border_radius',
            'soldermask_margin',
            'soldermask_margin_top',
            'soldermask_margin_right',
            'soldermask_margin_bottom',
            'soldermask_margin_left'
        ]) {
            if (typeof fields[key] !== 'string') continue
            const value = CircuitJsonUnits.optionalLength(fields[key])
            if (value !== null) fields[key] = value
        }
    }

    /**
     * Projects historical SMT-pad diagnostic relations onto upstream pad ids.
     * @param {Record<string, any>} fields Diagnostic fields.
     * @param {string} type Diagnostic type.
     * @returns {void}
     */
    static #padClearanceDiagnostic(fields, type) {
        if (type === 'pcb_pad_pad_clearance_error') {
            fields.pcb_pad_ids ??=
                fields.pcb_smtpad_ids ??
                [fields.pcb_smtpad_id, fields.pcb_pad_id].filter(
                    (value) => typeof value === 'string' && value
                )
            fields.error_type = type
            delete fields.pcb_smtpad_ids
            delete fields.pcb_smtpad_id
            delete fields.pcb_pad_id
            return
        }
        if (type === 'pcb_pad_trace_clearance_error') {
            fields.pcb_pad_id ??= fields.pcb_smtpad_id
            fields.error_type = type
            delete fields.pcb_smtpad_id
            return
        }
        if (type === 'pcb_via_clearance_error') {
            fields.pcb_error_id ??= fields.pcb_via_clearance_error_id
            fields.error_type = type
            delete fields.pcb_via_clearance_error_id
            return
        }
        if (type === 'pcb_via_trace_clearance_error') {
            fields.error_type = type
        }
    }

    /** @param {Record<string, any>} fields Element fields. @param {string} type Type. @returns {void} */
    static #courtyard(fields, type) {
        if (
            ![
                'pcb_courtyard',
                'pcb_courtyard_line',
                'pcb_courtyard_path'
            ].includes(type)
        ) {
            return
        }
        if (type === 'pcb_courtyard') {
            fields.type = 'pcb_courtyard_rect'
            fields.pcb_courtyard_rect_id = fields.pcb_courtyard_id
            delete fields.pcb_courtyard_id
        } else {
            fields.type = 'pcb_courtyard_outline'
            fields.legacy_shape =
                type === 'pcb_courtyard_path' ? 'path' : 'line'
            fields.pcb_courtyard_outline_id =
                fields.pcb_courtyard_line_id ?? fields.pcb_courtyard_path_id
            fields.stroke_width ??= fields.width
            fields.outline =
                type === 'pcb_courtyard_line'
                    ? [
                          fields.start ?? { x: fields.x1, y: fields.y1 },
                          fields.end ?? { x: fields.x2, y: fields.y2 }
                      ]
                    : (fields.route ?? fields.points ?? fields.path ?? [])
            delete fields.pcb_courtyard_line_id
            delete fields.pcb_courtyard_path_id
            delete fields.start
            delete fields.end
            delete fields.x1
            delete fields.y1
            delete fields.x2
            delete fields.y2
            delete fields.route
            delete fields.points
            delete fields.path
            delete fields.width
        }
        fields.pcb_component_id ??= ''
        fields.layer = CircuitJsonLegacyNormalizer.#side(fields.layer)
    }

    /** @param {Record<string, any>} fields Element fields. @param {string} type Type. @returns {void} */
    static #schematic(fields, type) {
        if (type === 'schematic_trace') {
            fields.junctions ??= []
            fields.edges ??= []
            if (
                fields.start &&
                fields.end &&
                !fields.edges.some((edge) => edge?.from && edge?.to)
            ) {
                fields.edges = [{ from: fields.start, to: fields.end }]
            }
        }
        if (type === 'schematic_arc') {
            fields.center ??= { x: 0, y: 0 }
            fields.radius ??= 0
            if (
                fields.direction === undefined &&
                (fields.start_angle !== undefined ||
                    fields.end_angle !== undefined)
            ) {
                fields.direction = 'clockwise'
            }
            fields.start_angle_degrees ??= fields.start_angle ?? 0
            fields.end_angle_degrees ??= fields.end_angle ?? 0
        }
        if (type === 'schematic_layout_error') {
            fields.message ??= ''
            fields.schematic_group_id ??= ''
            fields.source_group_id ??= ''
        }
        if (type === 'schematic_group') {
            fields.source_group_id ??= ''
            fields.width ??= 0
            fields.height ??= 0
            fields.center ??= { x: 0, y: 0 }
            fields.schematic_component_ids ??= []
        }
        if (type === 'schematic_debug_object') {
            const shapeWasOmitted = fields.shape === undefined
            fields.shape ??= fields.start && fields.end ? 'line' : 'rect'
            if (shapeWasOmitted) fields.legacy_shape_omitted = true
            fields.label ??= fields.message
            if (fields.shape === 'rect') {
                fields.center ??= { x: fields.x ?? 0, y: fields.y ?? 0 }
                fields.size ??= {
                    width: fields.width ?? 0,
                    height: fields.height ?? 0
                }
            }
        }
    }

    /**
     * Resolves one legacy layer reference without invoking caller coercion or
     * accessors. Numeric Gerber layer ids use the conventional outer-layer
     * aliases 1 (top) and 32 (bottom).
     * @param {unknown} value Layer value.
     * @returns {string} Canonical visible side.
     */
    static #side(value) {
        const descriptors = CircuitJsonLegacyNormalizer.#record(value)
        if (descriptors) {
            const name = descriptors.name
            return name && Object.hasOwn(name, 'value')
                ? CircuitJsonLegacyNormalizer.#side(name.value)
                : 'top'
        }
        if (value !== null && typeof value === 'object') return 'top'
        if (value === 1) return 'top'
        if (value === 32) return 'bottom'
        const text = String(value ?? '')
            .trim()
            .toLowerCase()
        if (VISIBLE_LAYERS.has(text)) return text
        if (text === '1') return 'top'
        if (text === '32') return 'bottom'
        return /bottom|back|^b[._-]/u.test(text) ? 'bottom' : 'top'
    }

    /**
     * Normalizes one dense layer-reference list with a stable fallback.
     * @param {unknown} layers Layer list candidate.
     * @param {unknown[]} fallback Missing or invalid layer list fallback.
     * @returns {string[]} Canonical layer references.
     */
    static #layers(layers, fallback) {
        const descriptors = CircuitJsonLegacyNormalizer.#array(layers)
        const values = descriptors
            ? Array.from(
                  { length: descriptors.length.value },
                  (_entry, index) => descriptors[String(index)].value
              )
            : fallback
        return values.map((value) => CircuitJsonLegacyNormalizer.#side(value))
    }

    /** @param {Record<string, any>} fields Source component. @returns {string} */
    static #sourceComponentFtype(fields) {
        const reference = String(
            fields.name ?? fields.reference ?? fields.designator ?? ''
        ).trim()
        const text = [
            reference,
            fields.footprint,
            fields.package,
            fields.package_name,
            fields.value,
            fields.description
        ]
            .map((value) => String(value ?? '').toLowerCase())
            .join(' ')
        if (text.includes('led')) return 'simple_led'
        if (/^tp[0-9A-Z_-]*/iu.test(reference) || text.includes('test point')) {
            return 'simple_test_point'
        }
        if (/^d[0-9A-Z_-]*/iu.test(reference)) return 'simple_diode'
        if (/^r[0-9A-Z_-]*/iu.test(reference) || fields.resistance) {
            return 'simple_resistor'
        }
        if (/^c[0-9A-Z_-]*/iu.test(reference) || fields.capacitance) {
            return 'simple_capacitor'
        }
        return 'simple_chip'
    }

    /** @param {Record<string, any>} fields Source component. @returns {void} */
    static #supplierNumbers(fields) {
        const descriptors = CircuitJsonLegacyNormalizer.#record(
            fields.supplier_part_numbers
        )
        if (!descriptors) return
        const canonical = {}
        const legacy = {}
        for (const [supplier, descriptor] of Object.entries(descriptors)) {
            if (UPSTREAM_SUPPLIERS.has(supplier)) {
                canonical[supplier] = descriptor.value
            } else {
                legacy[supplier] = descriptor.value
            }
        }
        if (Object.keys(legacy).length === 0) return
        fields.supplier_part_numbers = canonical
        fields.legacy_supplier_part_numbers = legacy
    }

    /** @param {unknown} route Legacy trace route. @returns {unknown} */
    static #traceRoute(route) {
        const descriptors = CircuitJsonLegacyNormalizer.#array(route)
        if (!descriptors) return route
        const normalized = new Array(descriptors.length.value)
        for (let index = 0; index < normalized.length; index += 1) {
            const element = descriptors[String(index)].value
            const elementDescriptors =
                CircuitJsonLegacyNormalizer.#record(element)
            if (!elementDescriptors) {
                normalized[index] = element
                continue
            }
            const fields = Object.fromEntries(
                Object.entries(elementDescriptors).map(([key, descriptor]) => [
                    key,
                    descriptor.value
                ])
            )
            if (
                !fields.route_type &&
                (fields.via_diameter !== undefined ||
                    fields.from_layer !== undefined ||
                    fields.to_layer !== undefined)
            ) {
                fields.route_type = 'via'
            } else if (
                !fields.route_type &&
                fields.x !== undefined &&
                fields.y !== undefined
            ) {
                fields.route_type = 'wire'
            }
            if (fields.route_type === 'wire') {
                fields.layer = CircuitJsonLegacyNormalizer.#side(fields.layer)
            }
            if (fields.route_type === 'via') {
                fields.from_layer = CircuitJsonLegacyNormalizer.#side(
                    fields.from_layer ?? 'top'
                )
                fields.to_layer = CircuitJsonLegacyNormalizer.#side(
                    fields.to_layer ?? 'bottom'
                )
                fields.outer_diameter ??= fields.via_diameter
                if (
                    fields.hole_diameter === undefined &&
                    fields.outer_diameter !== undefined
                ) {
                    fields.hole_diameter = Number(fields.outer_diameter) / 2
                }
            }
            normalized[index] = fields
        }
        return normalized
    }

    /** @param {Record<string, any>} fields B-Rep pour fields. @returns {void} */
    static #brep(fields) {
        const candidates = Array.isArray(fields.brep_shapes)
            ? fields.brep_shapes
            : Array.isArray(fields.brepShapes)
              ? fields.brepShapes
              : [fields.brep_shape ?? fields.brepShape]
        const normalized = candidates
            .map((shape) => CircuitJsonLegacyNormalizer.#brepShape(shape))
            .filter(Boolean)
        if (normalized.length > 0) fields.brep_shape = normalized[0]
    }

    /** @param {unknown} shape B-Rep shape. @returns {object | null} */
    static #brepShape(shape) {
        const descriptors = CircuitJsonLegacyNormalizer.#record(shape)
        if (!descriptors) return null
        const outer =
            descriptors.outer_ring?.value ??
            descriptors.outerRing?.value ??
            descriptors.outer?.value ??
            descriptors.ring?.value
        const outerRing = CircuitJsonLegacyNormalizer.#brepRing(outer)
        if (!outerRing) return null
        const inner =
            descriptors.inner_rings?.value ??
            descriptors.innerRings?.value ??
            descriptors.holes?.value ??
            []
        const innerDescriptors = CircuitJsonLegacyNormalizer.#array(inner)
        const innerRings = []
        if (innerDescriptors) {
            for (
                let index = 0;
                index < innerDescriptors.length.value;
                index += 1
            ) {
                const ring = CircuitJsonLegacyNormalizer.#brepRing(
                    innerDescriptors[String(index)].value
                )
                if (ring) innerRings.push(ring)
            }
        }
        return { outer_ring: outerRing, inner_rings: innerRings }
    }

    /** @param {unknown} ring B-Rep ring. @returns {object | null} */
    static #brepRing(ring) {
        const arrayDescriptors = CircuitJsonLegacyNormalizer.#array(ring)
        if (arrayDescriptors) {
            return {
                vertices: Array.from(
                    { length: arrayDescriptors.length.value },
                    (_entry, index) => arrayDescriptors[String(index)].value
                )
            }
        }
        const descriptors = CircuitJsonLegacyNormalizer.#record(ring)
        if (!descriptors) return null
        const vertices =
            descriptors.vertices?.value ??
            descriptors.cwVertices?.value ??
            descriptors.ccwVertices?.value ??
            descriptors.points?.value
        return CircuitJsonLegacyNormalizer.#array(vertices)
            ? { vertices }
            : null
    }

    /** @param {unknown} points Point array. @returns {{ minX: number, minY: number, maxX: number, maxY: number } | null} */
    static #pointBounds(points) {
        const descriptors = CircuitJsonLegacyNormalizer.#array(points)
        if (!descriptors) return null
        const bounds = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        }
        for (let index = 0; index < descriptors.length.value; index += 1) {
            const point = CircuitJsonLegacyNormalizer.#record(
                descriptors[String(index)].value
            )
            const x = point?.x?.value
            const y = point?.y?.value
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue
            bounds.minX = Math.min(bounds.minX, x)
            bounds.minY = Math.min(bounds.minY, y)
            bounds.maxX = Math.max(bounds.maxX, x)
            bounds.maxY = Math.max(bounds.maxY, y)
        }
        return Number.isFinite(bounds.minX) ? bounds : null
    }

    /** @param {unknown} value Array candidate. @returns {Record<string, PropertyDescriptor> | null} */
    static #array(value) {
        if (!Array.isArray(value)) return null
        try {
            const descriptors = Object.getOwnPropertyDescriptors(value)
            const length = descriptors.length?.value
            if (
                Object.getPrototypeOf(value) !== Array.prototype ||
                !Number.isSafeInteger(length) ||
                length < 0
            ) {
                return null
            }
            for (let index = 0; index < length; index += 1) {
                const descriptor = descriptors[String(index)]
                if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                    return null
                }
            }
            return descriptors
        } catch {
            return null
        }
    }

    /** @param {unknown} value Record candidate. @returns {Record<string, PropertyDescriptor> | null} */
    static #record(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null
        }
        try {
            const prototype = Object.getPrototypeOf(value)
            const descriptors = Object.getOwnPropertyDescriptors(value)
            if (prototype !== Object.prototype && prototype !== null)
                return null
            if (
                Object.values(descriptors).some(
                    (descriptor) => !Object.hasOwn(descriptor, 'value')
                )
            ) {
                return null
            }
            return descriptors
        } catch {
            return null
        }
    }
}

Object.freeze(CircuitJsonLegacyNormalizer.prototype)
Object.freeze(CircuitJsonLegacyNormalizer)

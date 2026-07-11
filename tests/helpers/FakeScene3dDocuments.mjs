import { DocumentResult } from '../../src/core/contracts/DocumentResult.mjs'

/**
 * Creates a representative, repo-owned CircuitJSON assembly model.
 * @returns {object[]} CircuitJSON elements.
 */
export function createAssemblyModel() {
    return [
        {
            type: 'pcb_board',
            pcb_board_id: 'board_1',
            center: { x: 0, y: 0 },
            width: 20,
            height: 10,
            num_layers: 4
        },
        {
            type: 'source_component',
            source_component_id: 'source_u1',
            name: 'U1',
            ftype: 'simple_chip'
        },
        {
            type: 'pcb_component',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            center: { x: 2, y: 1 },
            width: 3,
            height: 2,
            rotation: 90,
            layer: 'top'
        },
        {
            type: 'pcb_smtpad',
            pcb_smtpad_id: 'pad_1',
            pcb_component_id: 'pcb_u1',
            shape: 'rect',
            x: 1.5,
            y: 1,
            width: 1,
            height: 0.5,
            layer: 'top',
            net: 'SIG'
        },
        {
            type: 'pcb_trace',
            pcb_trace_id: 'trace_1',
            net: 'SIG',
            route: [
                {
                    route_type: 'wire',
                    x: 1.5,
                    y: 1,
                    width: 0.2,
                    layer: 'top'
                },
                {
                    route_type: 'wire',
                    x: 5,
                    y: 1,
                    width: 0.2,
                    layer: 'top'
                }
            ]
        },
        {
            type: 'pcb_via',
            pcb_via_id: 'via_1',
            x: 5,
            y: 1,
            outer_diameter: 0.8,
            hole_diameter: 0.35,
            layers: ['top', 'bottom'],
            net: 'SIG'
        },
        {
            type: 'pcb_copper_pour',
            pcb_copper_pour_id: 'zone_1',
            shape: 'polygon',
            points: [
                { x: -4, y: -3 },
                { x: 4, y: -3 },
                { x: 4, y: 3 },
                { x: -4, y: 3 }
            ],
            layer: 'bottom',
            net: 'GND'
        },
        {
            type: 'pcb_silkscreen_text',
            pcb_silkscreen_text_id: 'text_1',
            pcb_component_id: 'pcb_u1',
            text: 'U1',
            x: 2,
            y: 2.5,
            font_size: 1,
            layer: 'top'
        },
        {
            type: 'pcb_hole',
            pcb_hole_id: 'hole_1',
            hole_shape: 'circle',
            x: -7,
            y: 0,
            hole_diameter: 2,
            layer: 'board'
        },
        {
            type: 'pcb_cutout',
            pcb_cutout_id: 'cutout_1',
            shape: 'rect',
            center: { x: 7, y: 0 },
            width: 2,
            height: 1,
            layer: 'board'
        }
    ]
}

/**
 * Adds one canonical CAD placement to the assembly model.
 * @param {object[]} model CircuitJSON model.
 * @param {boolean} [withModelReference] Whether to include an asset reference.
 * @returns {object[]} Model with CAD placement.
 */
export function withCadPlacement(model, withModelReference = true) {
    return [
        ...model,
        {
            type: 'cad_component',
            cad_component_id: 'cad_u1',
            pcb_component_id: 'pcb_u1',
            source_component_id: 'source_u1',
            position: { x: 2, y: 1, z: 1.6 },
            rotation: { x: 0, y: 0, z: 90 },
            size: { x: 3, y: 2, z: 1.2 },
            layer: 'top',
            ...(withModelReference
                ? { model_step_url: 'models/body.step' }
                : {}),
            model_unit_to_mm_scale_factor: 1,
            model_board_normal_direction: 'z+',
            model_origin_position: { x: 0, y: 0, z: 0 },
            model_origin_alignment: 'center',
            model_object_fit: 'contain_within_bounds',
            anchor_alignment: 'center'
        }
    ]
}

/**
 * Creates a source-native envelope around the canonical model.
 * @param {'none' | 'metadata' | 'full'} assetMode Asset inclusion mode.
 * @param {{ withModelReference?: boolean, assetCount?: number }} [options] Fixture controls.
 * @returns {object} Canonical document envelope.
 */
export function createNativeDocument(assetMode, options = {}) {
    const withModelReference = options.withModelReference !== false
    const assetCount = options.assetCount || 1
    const assets = Array.from({ length: assetCount }, (_, index) => {
        const primary = index === 0
        const name = primary ? 'models/body.step' : `models/body-${index}.step`
        return {
            id: primary ? 'asset-body' : `asset-body-${index}`,
            kind: 'model3d',
            name,
            mediaType: 'model/step',
            byteLength: 3,
            data:
                assetMode === 'full' ? new Uint8Array([index + 1, 2, 3]) : null,
            source: { entryName: name }
        }
    })
    return DocumentResult.createValidated({
        fileName: 'assembly.PcbDoc',
        format: 'altium',
        model: withCadPlacement(createAssemblyModel(), withModelReference),
        extensions: {
            altium: {
                $meta: {
                    completeness: 'canonical',
                    included: ['scene3d'],
                    omitted: []
                },
                scene3d: { placementSource: 'native-records' }
            }
        },
        assets: assetMode === 'none' ? [] : assets
    })
}

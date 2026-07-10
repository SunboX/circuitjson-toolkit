const CAPABILITIES = [
    [
        'bom.build',
        'shared',
        'BomTableRenderer',
        'Build BOM rows from standard source-component elements.'
    ],
    [
        'export.selected-part',
        'native',
        'circuitjson-toolkit/extensions',
        'Export a selected part through the retained CircuitJSON extension adapter.'
    ],
    [
        'interaction.pcb',
        'shared',
        'PcbInteractionIndex',
        'Build deterministic PCB hit-test and selection records.'
    ],
    [
        'manufacturing.export',
        'shared',
        'ManufacturingService',
        'Inspect and export standard manufacturing data.'
    ],
    [
        'metadata.normalize',
        'shared',
        'DocumentResult',
        'Normalize shared source and extension metadata.'
    ],
    [
        'parse.document',
        'shared',
        'Parser',
        'Parse one CircuitJSON document into the canonical envelope.'
    ],
    [
        'query.document',
        'shared',
        'QueryService',
        'Query standard CircuitJSON elements and relationships.'
    ],
    [
        'render.pcb',
        'shared',
        'PcbSvgRenderer',
        'Render PCB views from standard CircuitJSON.'
    ],
    [
        'render.schematic',
        'shared',
        'SchematicSvgRenderer',
        'Render schematic views from standard CircuitJSON.'
    ],
    [
        'simulation.spice',
        'shared',
        'SimulationService',
        'Build and execute injected SPICE simulations.'
    ],
    [
        'units.convert',
        'shared',
        'CircuitJsonUnits',
        'Convert CircuitJSON units deterministically.'
    ],
    [
        'validation.document',
        'shared',
        'DocumentResult',
        'Validate and prepare CircuitJSON document envelopes.'
    ]
].map(([id, status, entrypoint, summary]) => {
    const [category, operation] = id.split('.')
    return Object.freeze({
        id,
        category,
        operation,
        status,
        entrypoint,
        summary,
        reason: summary,
        tested: true,
        documented: true
    })
})

/**
 * Reports operation-level capabilities exposed by the canonical toolkit API.
 */
export class ToolkitCapabilities {
    /**
     * Returns fresh clone-safe capability records in stable id order.
     * @returns {Record<string, any>[]} Capability inventory.
     */
    static inventory() {
        return CAPABILITIES.map((capability) => ({ ...capability }))
    }
}

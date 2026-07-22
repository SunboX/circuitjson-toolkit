const CANONICAL_CLASS_NAMES = Object.freeze([
    'Parser',
    'ProjectLoader',
    'CircuitJsonDocumentContext',
    'PcbSvgRenderer',
    'SchematicSvgRenderer',
    'BomTableRenderer',
    'PcbInteractionIndex',
    'QueryService',
    'ManufacturingService',
    'SimulationService',
    'PcbScene3dBuilder',
    'PcbScene3dPreparator',
    'SelfAdjustingComputation',
    'ToolkitCapabilities',
    'ToolkitError'
])

/**
 * Supplies small source-independent and source-format contract fixtures.
 */
export class ToolkitContractFixtures {
    /** @returns {string[]} Exact canonical root class names. */
    static get canonicalClassNames() {
        return [...CANONICAL_CLASS_NAMES]
    }

    /** @returns {object[]} Minimal valid CircuitJSON document. */
    static circuitJsonDocument() {
        return []
    }

    /** @returns {Record<string, any>} CircuitJSON contract fixture. */
    static circuitJson() {
        return ToolkitContractFixtures.#fixture(
            'circuitjson',
            'contract.json',
            JSON.stringify(ToolkitContractFixtures.circuitJsonDocument())
        )
    }

    /** @returns {Record<string, any>} Gerber contract fixture. */
    static gerber() {
        const source = [
            'G04 ECAD toolkit contract fixture*',
            '%FSLAX24Y24*%',
            '%MOMM*%',
            '%ADD10C,1.000*%',
            'D10*',
            'X000000Y000000D03*',
            'M02*'
        ].join('\n')
        return ToolkitContractFixtures.#fixture(
            'gerber',
            'contract.gbr',
            source
        )
    }

    /** @returns {Record<string, any>} Altium text-project fixture. */
    static altium() {
        const source = [
            '[Design]',
            'Version=1.0',
            'CurrentVariant=',
            '',
            '[Document1]',
            'DocumentPath=contract.PcbDoc',
            'DocumentUniqueId=CONTRACT'
        ].join('\r\n')
        return ToolkitContractFixtures.#fixture(
            'altium',
            'contract.PrjPcb',
            source
        )
    }

    /** @returns {Record<string, any>} KiCad PCB contract fixture. */
    static kicad() {
        const source = [
            '(kicad_pcb',
            '  (version 20240108)',
            '  (generator pcbnew)',
            '  (general (thickness 1.6))',
            '  (paper "A4")',
            '  (layers',
            '    (0 "F.Cu" signal)',
            '    (31 "B.Cu" signal)',
            '    (44 "Edge.Cuts" user)',
            '  )',
            '  (setup (pad_to_mask_clearance 0))',
            ')'
        ].join('\n')
        return ToolkitContractFixtures.#fixture(
            'kicad',
            'contract.kicad_pcb',
            source
        )
    }

    /**
     * Builds one complete generic fixture record.
     * @param {string} format Source format.
     * @param {string} fileName Source file name.
     * @param {string} data Source data.
     * @returns {Record<string, any>} Contract fixture.
     */
    static #fixture(format, fileName, data) {
        return {
            schema: 'ecad-toolkit.contract-fixture.v1',
            format,
            parserInput: { fileName, data },
            unsupportedInput: {
                fileName: `unsupported-${format}.txt`,
                data: 'not an ECAD document'
            },
            projectEntries: [{ name: fileName, data }],
            renderOptions: {
                pcb: { side: 'top', fidelity: 'canonical' },
                pcbBottom: { side: 'bottom', fidelity: 'canonical' },
                schematic: { fidelity: 'canonical' }
            }
        }
    }
}

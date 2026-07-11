import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CircuitJsonBomBuilder,
    CircuitJsonManufacturingBuilder,
    CircuitJsonSupportMatrixBuilder
} from '../src/extensions.mjs'
import {
    CircuitJsonPcbClearanceDiagnostics,
    CircuitJsonPcbCopperGeometry,
    CircuitJsonPcbHolePrimitiveModel,
    CircuitJsonPcbNetMetadata,
    CircuitJsonPcbPadPrimitiveModel,
    CircuitJsonPcbPrimitiveArtwork,
    CircuitJsonPcbPrimitiveAttributeRenderer,
    CircuitJsonPcbPrimitiveBuilder,
    CircuitJsonPcbPrimitiveGeometry,
    CircuitJsonPcbPrimitiveGroups,
    CircuitJsonPcbPrimitiveIndex,
    CircuitJsonPcbPrimitiveOverlays,
    CircuitJsonPcbTraceLengthModel,
    CircuitJsonPcbViaSvgRenderer,
    CircuitJsonSchematicSvgArcPath,
    CircuitJsonSchematicSvgPortMetadata,
    CircuitJsonSchematicSvgPrimitiveAttributes,
    CircuitJsonSchematicTableSvgRenderer,
    PcbBoundsSelectionModel,
    PcbCandidateSelectionModel,
    SelectedPartCircuitJsonExportAdapter
} from '../src/extensions.mjs'

test('legacy extension contracts remain importable callables', () => {
    const publicContracts = [
        CircuitJsonBomBuilder,
        CircuitJsonManufacturingBuilder,
        CircuitJsonPcbClearanceDiagnostics,
        CircuitJsonPcbCopperGeometry,
        CircuitJsonPcbHolePrimitiveModel,
        CircuitJsonPcbNetMetadata,
        CircuitJsonPcbPadPrimitiveModel,
        CircuitJsonPcbPrimitiveArtwork,
        CircuitJsonPcbPrimitiveAttributeRenderer,
        CircuitJsonPcbPrimitiveBuilder,
        CircuitJsonPcbPrimitiveGeometry,
        CircuitJsonPcbPrimitiveGroups,
        CircuitJsonPcbPrimitiveIndex,
        CircuitJsonPcbPrimitiveOverlays,
        CircuitJsonPcbTraceLengthModel,
        CircuitJsonPcbViaSvgRenderer,
        CircuitJsonSchematicSvgArcPath,
        CircuitJsonSchematicSvgPortMetadata,
        CircuitJsonSchematicSvgPrimitiveAttributes,
        CircuitJsonSchematicTableSvgRenderer,
        CircuitJsonSupportMatrixBuilder,
        PcbBoundsSelectionModel,
        PcbCandidateSelectionModel,
        SelectedPartCircuitJsonExportAdapter
    ]

    assert.ok(
        publicContracts.every((contract) => typeof contract === 'function')
    )
})

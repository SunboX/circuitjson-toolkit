<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# ECAD Forge Integration and Release Design

## Goal

Migrate `ecadforge_app` to the converged library contract, verify all four
formats end to end, and perform the requested coordinated minor releases in
dependency order.

## Toolkit Registry

Replace format-specific service branching with an app-owned registry. Each
entry supplies the same interfaces:

```js
{
    Parser,
    ProjectLoader,
    CircuitJsonDocumentContext,
    PcbSvgRenderer,
    SchematicSvgRenderer,
    BomTableRenderer,
    PcbInteractionIndex,
    QueryService,
    ManufacturingService,
    SimulationService,
    PcbScene3dBuilder,
    PcbScene3dPreparator,
    ToolkitCapabilities
}
```

`EcadFormatRegistry` still detects the source format. It selects a toolkit
adapter rather than triggering separate method/return-shape branches.

## App State and Services

Session state stores `DocumentResult` objects. Shared views use
`document.model`; source-specific views use `document.extensions[format]`.
Request/session owners create and retain `CircuitJsonDocumentContext` objects
for repeated rendering, query, measurement, selection, diagnostics, and
manufacturing operations.

Migrate:

- `EcadParserService` to common parser/project results;
- `EcadRendererService` to common renderer signatures and sides;
- `EcadScene3dService` to common scene builder/preparator contracts;
- loaded-design query and WebMCP consumers to shared `QueryService`;
- manufacturing, selected-part, diagnostics, measurement, and layer consumers
  to document contexts;
- parser workers to the versioned shared protocol.

Remove app-side compatibility normalization only after a library test proves
the owning package handles the general behavior. Preserve app orchestration,
analytics, UI state, and source selection.

## Integration Verification

- Update app tests for the envelope/context contract.
- Parse and render repo-owned CircuitJSON, Gerber, Altium, and KiCad samples.
- Verify schematic, PCB, BOM, layer controls, queries, manufacturing exports,
  diagnostics, measurements, selected-part export, workers, and 3D scenes when
  the toolkit capability inventory marks the operation available. For
  inapplicable Gerber component/net/BOM behavior, verify the unavailable status
  and exact `ERR_CAPABILITY_UNAVAILABLE` failure instead of expecting empty
  output.
- Run browser sanity checks and capture screenshots for visible changes.
- After dependency and app-version updates, run
  `npm run sync:structured-data` and commit generated `src/*.html`. Then run
  `npm test`, `npm run check:circuitjson-schema`,
  `npm run check:structured-data`, `npm run build:static`,
  `npm run check:format`, and `git diff --check`.
- Repeat the release gates from a clean `npm ci` installation and verify
  `npm ls circuitjson-toolkit` resolves one compatible core instance across the
  app and `pcb-scene3d-viewer`.
- Keep generated structured-data HTML synchronized with the app version.

## Documentation

Update ECAD Forge README, architecture, testing, troubleshooting, and affected
specifications. Document the toolkit registry, document envelope, prepared
context lifecycle, extension access, worker protocol, and migration from the
old format-specific services.

## Versions and Release Order

This workstream owns coordinated release orchestration. Each library phase
hands it a verified tarball candidate; it does not republish from a different
commit. Before any registry publication, install the packed core into all
source toolkits and `pcb-scene3d-viewer`, install all four packed toolkit
candidates together into ECAD Forge, and pass every downstream/full release
gate.

Dependency DAG:

1. Publish and verify `circuitjson-toolkit@1.1.0`.
2. Publish and verify `gerber-toolkit@0.2.0`,
   `altium-toolkit@1.2.0`, and `kicad-toolkit@1.1.0` independently in any order.
3. Release `ecadforge_app@1.10.0` only after all four npm records are verified.

Each source toolkit pins exact `circuitjson-toolkit@1.1.0`. ECAD Forge pins all
four deliberately incompatible toolkit releases exactly, commits its lockfile,
and rejects a clean installation that resolves an older or duplicate core.
`pcb-scene3d-viewer@1.1.50` remains compatible through the tested 1.1.x aliases
specified by the core phase; changing/publishing the viewer is outside this
five-release scope.

Each GitHub/npm release note contains a `Breaking API convergence` section,
old-to-new examples, retained native extension features, verification results,
and performance findings. Verify npm `gitHead`, local commit, tag, GitHub
release target, and registry version after every publish.

After pushing ECAD Forge `main`, identify the workflow for the pushed commit and
watch `Deploy to FTP (main)` with exit status. A tag or GitHub release is not a
successful deployment. Report completion only when the workflow conclusion is
`success`.

## Acceptance Criteria

- ECAD Forge uses the common contract for all four formats.
- No required feature relies on removed hybrid array properties.
- App-owned format workarounds removed by this migration have equivalent
  library-owned tests.
- All library and app verification gates pass.
- Browser screenshots for every visibly affected format are captured and linked
  from the release evidence.
- All requested versions, tags, GitHub releases, npm records, and deployment
  state agree.
- The final FTP deployment succeeds.

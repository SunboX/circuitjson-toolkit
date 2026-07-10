<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Gerber Toolkit Convergence Design

## Goal

Migrate `gerber-toolkit` to the shared API and CircuitJSON result contract while
preserving lossless Gerber/Excellon CAM behavior and improving large-package
performance.

## Native Decode and Projection

The native parser produces a lossless ordered CAM extension containing source
files, layers, attributes, aperture state, dark/clear operations, Excellon
tools, drill routes, diagnostics, and source bounds. A dedicated adapter
projects representable geometry into standard CircuitJSON:

- board outline and cutouts;
- traces and arcs;
- flashes as pads or drilled features when structurally justified;
- Excellon holes, plated holes, vias, and slots;
- dark copper regions and supported artwork;
- layer and source provenance through extension references.

The adapter never invents components, nets, BOM rows, or assembly models.
Source-faithful composite/separated rendering continues to consume the Gerber
extension where CircuitJSON cannot reproduce ordered polarity semantics.

## Public Contract

Implement the common `Parser`, `ProjectLoader`, renderers, query,
manufacturing, simulation, scene3d, capabilities, extensions, worker, and style
entrypoints. `PcbSvgRenderer` replaces the format-prefixed canonical renderer
name. Interaction exposes the common create, hit-test, and pick behavior.

Gerber-native coordinate, role, aperture, and CAM inspection utilities remain
under `gerber-toolkit/extensions`.

`ProjectLoader` accepts `{ name, data }`, supports direct files and archives,
and returns the common project envelope. Malformed archives produce typed
errors rather than escaping unnormalized `fflate` errors.

## Performance

- Avoid decompressing every archive member merely to classify input.
- Replace full command-array tokenization with an incremental command reader
  where it preserves macro/block behavior.
- Remove JSON stringify/parse cloning from step-repeat and primitive expansion.
- Build shared spatial indexes for drill, mask-opening, region, and hit-test
  candidate lookup.
- Reuse layer classification, bounds, and CircuitJSON projection within one
  document context.
- Make async parsing perform real worker work with progress and cancellation.
- Preserve exact CAM ordering and polarity; acceleration is broad phase only.

The required 20-percent primary improvements are large synthetic archive
classification/parse/projection and repeated large mask/drill hit testing.

## Testing

- Test-first adapter coverage for synthetic lines, arcs, flashes, regions,
  attributes, drills, and slots.
- Differential tests for all existing SVG and 3D fixtures.
- Common API/error/worker/capability contract tests.
- Malformed ZIP, colliding layer id, arc-bound, and separated-mode consistency
  regressions.
- Large synthetic archive, step-repeat, mask, drill, and hit-test benchmarks.
- Complete Gerber suite plus relevant ECAD Forge integration tests.

## Documentation and Release Candidate

Update README, API, model-format, testing, scope, capabilities, and migration
documentation. Explicitly document which data is standard CircuitJSON and which
remains in the Gerber extension.

Prepare `gerber-toolkit@0.2.0` against exact `circuitjson-toolkit@1.1.0`.
Release notes map old parser/renderer calls to the canonical API, describe the
lossless CAM extension, measured speed changes, and dependency/license impact.
Run `npm test`, `npm run check:format`, `npm run benchmark`, `git diff --check`,
lockfile/dependency checks, packed-subpath import smoke tests, and
`npm pack --dry-run`. The coordinated release phase publishes only after the
complete candidate matrix passes.

## Acceptance Criteria

- Gerber parse results use the common envelope with a valid CircuitJSON model.
- Existing CAM rendering and 3D behavior remains exact.
- No semantic component/net data is fabricated.
- Archive, parse, render, interaction, and worker behavior meet the shared
  contract.
- Full tests and benchmark gates pass.

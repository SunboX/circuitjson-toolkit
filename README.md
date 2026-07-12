<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# CircuitJSON Toolkit

CircuitJSON Toolkit is the dependency-free common runtime for the ECAD toolkit
family. It provides the same parser, project, rendering, interaction, query,
manufacturing, simulation, 3D scene, capability, error, and worker contracts
used by `gerber-toolkit`, `altium-toolkit`, and `kicad-toolkit`.

CircuitJSON is the shared immutable model. Source-format packages keep their
native decoders and fidelity data in explicit extension namespaces while
common services operate on `DocumentResult.model` or a reused
`CircuitJsonDocumentContext`.

The package is browser- and Node-compatible, local-first, and has no runtime
dependencies. It does not import Three.js, the DOM, filesystem APIs, or network
clients.

## Breaking API convergence

Version 1.1.0 intentionally changes names, parameters, return shapes, and
package subpaths to match the Gerber, Altium, and KiCad toolkits. The root is an
exact 17-class surface: 14 common classes plus three deprecated viewer
compatibility classes. Previous CircuitJSON-specific utilities were not
deleted: 37 source-neutral compatibility exports moved to
`circuitjson-toolkit/extensions`.

See the [migration guide](docs/migration.md) and its generated
[root](docs/migration/root.md), [parser](docs/migration/parser.md),
[renderer](docs/migration/renderers.md), and
[behavior](docs/migration/behaviors.md) appendices for all 1,207 preserved
1.0.17 features. The
[1.1.0 release notes](docs/release-notes-v1.1.0.md) provide the concise change
summary.

Version 1.1.1 makes queued worker-request ownership synchronous. Parser and
project requests waiting behind active work can no longer observe later
caller-buffer mutation; explicit transfers detach exact buffers immediately
after admission. See the
[1.1.1 release notes](docs/release-notes-v1.1.1.md).

Version 1.1.2 makes schematic SVG paint deterministic. Open primitives always
emit `fill="none"`, filled primitives retain authored paint or use the shared
theme fallback, and generic component and symbol bodies explicitly use the
ECAD Forge schematic palette. See the
[1.1.2 release notes](docs/release-notes-v1.1.2.md).

Before 1.1.0:

```js
import { CircuitJsonParser } from 'circuitjson-toolkit'

const model = CircuitJsonParser.parseText(text, {
    fileName: 'board.json'
})
```

After 1.1.0:

```js
import { Parser } from 'circuitjson-toolkit'

const document = Parser.parse({
    fileName: 'board.json',
    data: text
})
const model = document.model
```

## Features

- Exact `Parser` and `ProjectLoader` contracts with typed envelopes and errors
- Immutable CircuitJSON validation proofs and request-scoped reusable indexes
- Copy-on-write normalization of supported legacy CircuitJSON aliases through
  `CircuitJsonDocument.normalizeModel()`
- Deterministic PCB, schematic, and BOM renderers
- Explicit schematic SVG stroke/fill paint that does not depend on browser
  defaults
- Asset-backed `schematic_image` rows and hierarchical
  `schematic_sheet_symbol` rows with shared bounds and SVG behavior
- Reusable exact PCB interaction and spatial indexes
- Query, manufacturing, and injected simulation services
- Data-only, millimeter-based, right-handed Z-up PCB 3D scenes
- Descriptor-safe `ToolkitAsset` measurement and preparation with zero-copy
  metadata mode, one-copy full mode, and shared ECAD model/image media-type
  inference
- Explicit asynchronous scene-asset preparation without implicit I/O
- Strict `ecad-toolkit.worker.v1` parsing/project protocol with progress,
  cancellation, and controlled buffer transfer
- One-pass ownership for selected source extensions, with a separate 128 MiB /
  2,000,000-item bound and exact direct/worker result parity
- Machine-readable capability inventory and packed downstream conformance
  harness
- Explicit `/extensions` surface retaining every previous specialized API
- Local-only behavior and no runtime package dependencies

## Install

```bash
npm install circuitjson-toolkit
```

Node.js 20 or newer is required.

## Parse and reuse a context

```js
import {
    CircuitJsonDocumentContext,
    Parser,
    PcbInteractionIndex,
    PcbSvgRenderer,
    QueryService
} from 'circuitjson-toolkit'

const document = Parser.parse({
    fileName: 'board.json',
    data: fileText
})

const context = CircuitJsonDocumentContext.prepare(document, {
    indexes: ['elements', 'relations', 'connectivity', 'spatial']
})

const svg = PcbSvgRenderer.render(context, { side: 'top' })
const hits = PcbInteractionIndex.create(context).hitTest({ x: 10, y: 5 })
const components = QueryService.create(context).query({
    select: 'components'
})

console.log(document.model, svg, hits, components.items)
```

`Parser.parse()` returns the exact clone-safe `ecad-toolkit.document.v1`
envelope:

```js
{
    schema: 'ecad-toolkit.document.v1',
    id: 'document-...',
    modelSchema: { name: 'circuit-json', version: '0.0.446' },
    model: [],
    source: { format: 'circuitjson', fileName: 'board.json', fileType: 'circuitjson' },
    extensions: {},
    assets: [],
    diagnostics: [],
    statistics: {}
}
```

## Project and asynchronous parsing

```js
import { Parser, ProjectLoader } from 'circuitjson-toolkit'

const project = ProjectLoader.load(
    [
        {
            name: 'board.json',
            data: boardText,
            assets: [{ name: 'body.step', data: bodyBytes }]
        },
        { name: 'schematic.json', data: schematicText }
    ],
    { decodeAssets: 'metadata' }
)

const controller = new AbortController()
const document = await Parser.parseAsync(
    { fileName: 'board.json', data: boardBytes },
    {
        worker: 'auto',
        transferInput: false,
        signal: controller.signal,
        onProgress: ({ stage, detail }) => console.log(stage, detail)
    }
)

console.log(project.documents, document.model)
```

Attached asset bytes count toward both `maxEntryBytes` and `maxTotalBytes` in
direct and worker project loading, even when `decodeAssets: 'none'` omits them
from the result.

Direct and worker calls return equivalent serialized results. Caller input is
never detached unless `transferInput: true` is explicit. `worker: 'auto'`
falls back to direct execution only when worker construction is unavailable;
explicit worker and runtime failures remain visible.

Selected source-native extensions are captured once into an immutable owned
snapshot. Their separate 128 MiB payload and 2,000,000-item ceilings permit
realistic renderer/model graphs without weakening the worker protocol's 250 MB
total-result ceiling; an over-limit extension fails visibly instead of being
silently truncated. Binary extension values remain byte-backed and return
defensive copies instead of expanding into JavaScript number arrays.
When extensions are disabled, native documents and projects return the exact
empty map `{}`. Bounded ZIP consumers can preflight local/central filenames and
CRC32/size metadata with
`ZipArchiveInspector.inspect()` and validate inflated bytes with
`verifyExtractedBytes()`. Compression limits use member payload sizes, so ZIP
comments or other container padding cannot dilute the measured expansion ratio.

The shared PCB hole primitive preserves circular, pill/oval, rectangular, and
square legal variants. Square holes normalize to equal-width rectangular
apertures instead of circular fallbacks.

`retainSource: 'reference'` is available for direct parser calls that need the
exact caller input identity. It adds a non-enumerable `sourceReference`, does
not freeze the caller object, and is omitted from serialized results. Explicit
worker execution rejects this identity-only mode; automatic execution stays
direct.

## Render, inspect, export, simulate, and build scenes

```js
import {
    BomTableRenderer,
    ManufacturingService,
    PcbScene3dBuilder,
    PcbScene3dPreparator,
    SchematicSvgRenderer,
    SimulationService
} from 'circuitjson-toolkit'

const schematicSvg = SchematicSvgRenderer.render(document)
const bomHtml = BomTableRenderer.render(document)
const manufacturing = ManufacturingService.inspect(document)
const simulation = SimulationService.build(document)
const canonicalScene = PcbScene3dBuilder.build(document)

const preparedScene = await PcbScene3dPreparator.prepare(document, {
    fidelity: 'native',
    resolveAsset: async (request, { signal }) =>
        await hostAssetStore.resolve(request, { signal })
})
```

3D results use the `ecad-toolkit.scene3d.v1` data contract. Runtime rendering
belongs to packages such as
[`pcb-scene3d-viewer`](https://www.npmjs.com/package/pcb-scene3d-viewer).

## Retained extension APIs

Previous specialized exports remain available explicitly:

```js
import {
    CircuitJsonParser,
    CircuitJsonPcbSvgRenderer,
    SpiceSimulationService
} from 'circuitjson-toolkit/extensions'
```

New integrations should use canonical classes. `/extensions` exists for
deliberate migrations, not as a second common API. Its exact 37 exports are
source-neutral and can be shared or derived by all four toolkits.

The temporary root compatibility class also exposes
`CircuitJsonDocument.normalizeModel(model, { owned })`. It projects supported
pre-union table, PCB path, pad-clearance, courtyard, and artwork aliases onto
the pinned CircuitJSON union. The default copy-on-write mode returns the exact
input when it is already canonical; `{ owned: true }` is reserved for
toolkit-owned mutable projections and may update them in place. Renderers and
viewers can therefore share the same normalization boundary instead of keeping
application adapters.

The compatibility renderer also provides
`CircuitJsonPcbSvgRenderer.renderSides(model, sides)` so callers migrating
multi-side output can prepare legacy primitives once.

`CircuitJsonPcbHolePrimitiveModel` is the shared geometry boundary for drilled
PCB elements. Polygon-plated pads derive rotation-local width and height from
`pad_outline`, while pill drill width, height, diameter, and rotation remain
available to viewers and manufacturing consumers without source adapters.

Direct asynchronous parsing and project loading own exact binary view windows
and selected assets before the first progress callback. Worker-received inputs
reuse their structured-clone ownership marker, avoiding a redundant receiver
copy while keeping sync, direct async, and worker results mutation-isolated.

## Package entrypoints

- `circuitjson-toolkit`
- `circuitjson-toolkit/parser`
- `circuitjson-toolkit/project`
- `circuitjson-toolkit/renderers`
- `circuitjson-toolkit/interaction`
- `circuitjson-toolkit/query`
- `circuitjson-toolkit/manufacturing`
- `circuitjson-toolkit/simulation`
- `circuitjson-toolkit/scene3d`
- `circuitjson-toolkit/capabilities`
- `circuitjson-toolkit/extensions`
- `circuitjson-toolkit/testing`
- `circuitjson-toolkit/workers/parser.worker.mjs`
- `circuitjson-toolkit/styles/renderers.css`

## Documentation

- [API reference](docs/api.md)
- [Capability inventory](docs/capabilities.md)
- [Migration from 1.0.17](docs/migration.md)
- [Model and envelope format](docs/model-format.md)
- [Testing and downstream conformance](docs/testing.md)
- [1.1.0 release notes](docs/release-notes-v1.1.0.md)
- [1.1.1 release notes](docs/release-notes-v1.1.1.md)
- [1.1.2 release notes](docs/release-notes-v1.1.2.md)
- [Library scope](spec/library-scope.md)

## Package scope

This package owns common, data-only operations derived from CircuitJSON. Native
Gerber, Altium, and KiCad decoding remains in the source toolkit. Native-only
facts remain in `document.extensions[format]`; common services do not duplicate
or rename native renderer graphs.

The package does not own Three.js runtime rendering, browser UI controls,
implicit filesystem access, implicit network access, or source-format-specific
decoders.

## Test

```bash
npm test
npm run check:format
npm run sync:schema -- --check
npm run check:features -- --strict
npm run benchmark -- --compare benchmarks/baseline-v1.0.17.json
npm run check:packed-entrypoints
npm run check:browser-dependencies
```

Tests use small synthetic CircuitJSON and source-format fixtures only. Do not
add customer, vendor, or source project documents.

## License

This project is available under two licensing options.

### 1. Open-source software license

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).

You may use, modify, and distribute this project under the AGPL. If you
distribute modified versions, run modified versions as a network service, or
create larger works based on this project, they must comply with the AGPL,
including source-code availability requirements.

The full AGPL license text is included in
[LICENSES/AGPL-3.0-or-later.txt](LICENSES/AGPL-3.0-or-later.txt). The root
[LICENSE](LICENSE) file summarizes the package's public software license.

### 2. Commercial/proprietary license

For use in closed-source, proprietary, or otherwise AGPL-incompatible products,
a separate paid commercial license is required.

Commercial licensing contact: https://github.com/SunboX

See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md). That file is a licensing
notice, not a commercial license grant.

### Downstream toolkit dependency

Gerber Toolkit, Altium Toolkit, and KiCad Toolkit use this package as their
shared runtime. Their package or commercial terms do not replace this
package's AGPL or separately granted commercial terms. A closed-source product
using a source toolkit must also have an AGPL-compatible use or a separate
commercial license for CircuitJSON Toolkit.

### Documentation and notices

Documentation and non-code text are licensed under Creative Commons
Attribution-ShareAlike 4.0 (`CC-BY-SA-4.0`) unless otherwise marked.

The full CC-BY-SA license text is included in
[LICENSES/CC-BY-SA-4.0.txt](LICENSES/CC-BY-SA-4.0.txt).

Copyright (C) 2026 André Fiedler.

Copyright, license, attribution, and source-origin notices must be preserved as
required by the AGPL, CC-BY-SA-4.0, and the notice files in this repository.
See [LICENSE](LICENSE), [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md), and
[NOTICE.md](NOTICE.md).

Package-manager dependencies retain their own license terms and notices.

<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# CircuitJSON Toolkit

CircuitJSON Toolkit is an ESM JavaScript library for parsing, validating,
indexing, and inspecting serialized CircuitJSON element arrays.

The package was extracted from [ECAD Forge](https://ecadforge.app/), where it
is used as the shared CircuitJSON runtime utility layer between ECAD parsers,
viewer adapters, and browser-based import flows. Its parser-style API,
metadata conventions, and local-first behavior are designed to line up with
packages such as `altium-toolkit` and `kicad-toolkit`, while remaining
independent of any source ECAD format.

This package is intentionally separate from
[`pcb-scene3d-viewer`](https://www.npmjs.com/package/pcb-scene3d-viewer).
`circuitjson-toolkit` owns CircuitJSON parsing, validation, indexing, and unit
helpers. `pcb-scene3d-viewer` owns Three.js runtime rendering and consumes this
package as a normal npm dependency.

## Features

- Parse standalone CircuitJSON `.json` text from strings, `ArrayBuffer`, or
  `Uint8Array` input
- Validate serialized CircuitJSON element arrays with a small, stable document
  API
- Attach parser-style metadata such as `fileName`, `fileType`, `kind`, and
  `sourceFormat`, matching the conventions used by the ECAD toolkit packages
- Build lookup indexes by element type and stable CircuitJSON identifiers
- Resolve source component and PCB component maps for viewer, QA, export, or
  reporting integrations
- Reject unknown element types and invalid core element fields before consumers
  render or query the model
- Convert CircuitJSON millimeter dimensions and points into mils for render
  adapters that use PCB imperial units internally
- Run dependency-free SPICE transient examples or normalize injected simulator
  results into complete CircuitJSON simulation experiment element sets
- Provide root and parser-focused ESM entrypoints
- Run in browser and Node ESM environments
- Run entirely with local input data; no network calls are made by the parser
- Stay dependency-free at runtime

## Install

The package is published on npm as
[`circuitjson-toolkit`](https://www.npmjs.com/package/circuitjson-toolkit).

```bash
npm install circuitjson-toolkit
```

## Usage

Parse a standalone CircuitJSON file or string:

```js
import {
    CircuitJsonDocument,
    CircuitJsonIndexer,
    CircuitJsonParser
} from 'circuitjson-toolkit'

const circuitJson = CircuitJsonParser.parseText(fileText)
CircuitJsonDocument.assertModel(circuitJson)

const index = CircuitJsonIndexer.index(circuitJson)
console.log(index.elementsByType.get('pcb_board'))
```

The parser also accepts bytes, mirroring the parser style used by the source
ECAD toolkits:

```js
import { CircuitJsonParser } from 'circuitjson-toolkit'

const documentModel = CircuitJsonParser.parseBytes(arrayBuffer, {
    fileName: file.name
})
```

Parser-focused imports are available through the `parser` subpath:

```js
import { CircuitJsonParser } from 'circuitjson-toolkit/parser'
```

Build an index for renderer or reporting integrations:

```js
import { CircuitJsonIndexer } from 'circuitjson-toolkit'

const index = CircuitJsonIndexer.index(documentModel)
const board = index.elementsByType.get('pcb_board')?.[0]
const components = index.elementsByType.get('pcb_component') || []
const source = index.sourceComponentById.get('source_component_1')
```

Convert CircuitJSON millimeter coordinates for renderer adapters:

```js
import { CircuitJsonUnits } from 'circuitjson-toolkit'

const centerMil = CircuitJsonUnits.pointMmToMil(board.center)
const widthMil = CircuitJsonUnits.mmToMil(board.width)
```

Run a local SPICE transient example and receive CircuitJSON experiment output:

```js
import { SpiceSimulationService } from 'circuitjson-toolkit'

const result = await SpiceSimulationService.simulate(`
Vmain out 0 DC 3.3
.PRINT TRAN V(out)
.tran 1ms 2ms
.END
`)

console.log(result.simulationCircuitJson)
console.log(result.graphSummary)
```

Pass CircuitJSON to the 3D renderer as a separate step:

```js
import { CircuitJsonParser } from 'circuitjson-toolkit'
import { PcbScene3dController } from 'pcb-scene3d-viewer'

const circuitJson = CircuitJsonParser.parseText(fileText, {
    fileName: 'board.circuitjson'
})

const controller = new PcbScene3dController(viewportNode, circuitJson)
```

`circuitjson-toolkit` does not render, fetch, or load external model assets.
That behavior belongs in host applications or renderer packages.

## Documentation

- [API](docs/api.md)
- [Model Format](docs/model-format.md)
- [Testing](docs/testing.md)
- [Scope](spec/library-scope.md)

## Package Scope

This package owns reusable CircuitJSON utility behavior only:

- parser-style document ingestion for serialized CircuitJSON;
- validation and diagnostics for element-array inputs;
- indexing and lookup maps for common CircuitJSON IDs;
- small unit conversion helpers for downstream renderer adapters.
- local SPICE transient graph helpers that return CircuitJSON elements.

It does not include native Altium or KiCad parsing, schematic/PCB SVG
rendering, Three.js rendering, browser UI controls, network fetching, or
format-specific scene-description builders.

## Test

```bash
npm test
```

The test suite uses small fake CircuitJSON samples only. Do not add customer,
vendor, or source project documents to this repository.

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

<!--
SPDX-FileCopyrightText: 2026 André Fiedler
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Attribution and notices

Original project by André Fiedler / SunboX.

Original source repository: https://github.com/SunboX/circuitjson-toolkit

This toolkit was extracted from ECAD Forge:
https://github.com/SunboX/ecadforge_app

Copyright (C) 2026 André Fiedler.

When redistributing this project, modified versions, binaries, packaged
applications, or larger works based on this project, preserve the following as
required by the applicable license:

- copyright notices;
- license notices;
- SPDX license identifiers;
- source-origin notices;
- this attribution/notice file, where applicable.

For applications with an "About", "Licenses", or "Legal Notices" screen,
include a reasonable reference to this project and its original author there.

Package-manager dependencies retain their own licenses.

## Canonical ECAD toolkit convergence

Version 1.1.0 defines the common parser, project, renderer, interaction, query,
manufacturing, simulation, data-only 3D scene, capability, error, and worker
contracts used by CircuitJSON Toolkit, Gerber Toolkit, Altium Toolkit, and
KiCad Toolkit.

Source-format packages retain their own native decoders, fidelity engines,
assets, reports, and license terms. Shared behavior generalized here operates
on standards-only CircuitJSON and does not copy source-format parser models or
renderer graphs. `docs/provenance.md` records consulted behavior and adapted
ownership boundaries.

The `circuit-json` schema package is used only for development-time schema
verification. It is not a runtime dependency or bundled production edge.

## Query behavior references

The shared CircuitJSON query contract was independently implemented after
reviewing the byte-identical netlist-query behavior in these projects:

- Altium Toolkit (`https://github.com/SunboX/altium-toolkit`), source commit
  `e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b`;
- KiCad Toolkit (`https://github.com/SunboX/kicad-toolkit`), source commit
  `02e38fe0b961a09d2ff25462b9b00207326743d2`.

Those consulted files are Copyright (C) 2026 André Fiedler and licensed
`GPL-3.0-or-later`. CircuitJSON Toolkit does not copy their source text or
package-native model logic; `docs/provenance.md` records the per-module
behavior-only reuse decisions.

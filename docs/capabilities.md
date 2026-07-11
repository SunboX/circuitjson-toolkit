# Capability inventory

`ToolkitCapabilities.inventory()` is the machine-readable operation inventory
shared by CircuitJSON, Gerber, Altium, and KiCad toolkits. Every row has the
same fields:

```js
{
    id: 'scene3d.prepare',
    category: 'scene3d',
    operation: 'prepare',
    status: 'shared',
    entrypoint: 'PcbScene3dPreparator',
    summary: '...',
    reason: '...',
    tested: true,
    documented: true
}
```

`status` is one of `native`, `shared`, `derived`, or `unavailable`. An
unavailable operation must throw `ToolkitError` with
`ERR_CAPABILITY_UNAVAILABLE`; an empty or invented result is not a substitute.

## Common behavior families

The canonical contract requires these operation ids across all four toolkits:

- `bom.build`
- `interaction.pcb`
- `manufacturing.export`
- `parse.document`
- `project.load`
- `query.document`
- `render.pcb`
- `render.schematic`
- `scene3d.build`
- `scene3d.prepare`
- `simulation.spice`
- `validation.document`
- `worker.load-project`
- `worker.parse`

The CircuitJSON package additionally inventories retained shared and extension
operations:

- `export.selected-part`
- `metadata.normalize`
- `units.convert`

Source-format packages may add native capability ids for features that cannot
be represented by CircuitJSON. Their availability maps still state whether the
same behavior is native, shared, derived, or unavailable in every toolkit.

## Host gating

Hosts should gate controls by capability id and status, not by package name:

```js
const capabilities = new Map(
    ToolkitCapabilities.inventory().map((row) => [row.id, row])
)

if (capabilities.get('scene3d.prepare')?.status !== 'unavailable') {
    await PcbScene3dPreparator.prepare(document, options)
}
```

This keeps ECAD Forge and other consumers independent of source-specific class
names while preserving explicit access to native extensions.

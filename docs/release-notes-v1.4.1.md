# circuitjson-toolkit 1.4.1

This patch release adds a shared self-adjusting-computation runtime for
persistent toolkit and application state. It implements dynamic dependency
tracing and ordered change propagation without coupling the common package to
DOM, Three.js, or source-format parser state.

## Self-adjusting computation

- `SelfAdjustingComputation` is available from the package root and is shared
  by identity through the Gerber, Altium, KiCad, and PCB Scene3D packages.
- Named synchronous computations record the data and control-flow paths they
  observe. Explicit changed roots start propagation from reverse reader lists.
- Potentially affected computations compare their previous observations and
  reuse successful results when values, presence, key structure, and selected
  atomic identities remain unchanged.
- Re-execution replaces the previous trace and its abandoned reader edges.
  `forget()` and `clear()` reclaim trace storage explicitly.
- Tracked snapshots reject mutation and asynchronous trace escape. Callers can
  choose an atomic boundary for immutable documents and native objects.

## Verification

The unit suite covers nested and structural reads, control-flow replacement,
stale reader removal, atomic document identity, failed and asynchronous
computations, write rejection, explicit trace reclamation, and equality with a
fresh runtime after each propagated change.

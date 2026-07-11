# circuitjson-toolkit 1.1.1

## Synchronous queued-request ownership

This patch makes the common worker client own every accepted parser and
project request when it enters the queue behind active work.

- Default `transferInput: false` requests clone their exact binary graph into
  a private queue snapshot immediately. Later caller mutation cannot change a
  queued parser input, project entry, or attached asset.
- `transferInput: true` detaches exact transferable caller buffers immediately
  after queue admission. Partial views, resizable buffers, and shared buffers
  keep their isolated-copy behavior without detaching unrelated caller bytes.
- Shared backing-buffer aliases remain shared in the owned request, and queued
  snapshots transfer to the worker without another binary copy when posted.
- Disposed, pre-cancelled, over-limit, and initial worker-construction failures
  reject before ownership. Automatic direct fallback therefore retains valid
  binary input.
- Parser and project queues use the same bounded, accessor-safe traversal and
  retain existing cancellation, error, and response behavior.

Public names, parameters, package subpaths, document envelopes, and project
envelopes are unchanged from 1.1.0. Gerber, Altium, KiCad, viewers, and ECAD
Forge receive the corrected behavior through the shared `ParserWorkerClient`.

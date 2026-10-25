# Pinned DeepCW engine resources

These unmodified resources are from e04/deepcw-engine at
`8e264d243bbd4467bd19f3f28292219405b47e0e`, distributed under the adjacent
AGPL-3.0-only LICENSE. They are distinct from the web-deep-cw-decoder project
and its hosted assets, which are not included or used.

The manifest records each original resource hash. The native build verifies all
three before generating the feature contract. Updating the model requires a new
manifest, native feature/output parity and streaming/quality qualification.

Corresponding source for this combination is the OM0RX-xLog repository including
`native/cw-worker`, this directory, build scripts and the upstream source at
https://github.com/e04/deepcw-engine/tree/8e264d243bbd4467bd19f3f28292219405b47e0e.
Release artifacts must include these notices, the model metadata and manifest,
the runtime's own notices and corresponding-source access instructions. This is
an inventory of the published inference source, not a claim that an unpublished
training pipeline or training corpus is available.

Model execution is native. Python is used only during development/build to check
hashes and generate a C++ header; it is not required by the installed worker.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Preserved baseline: native SwiftUI/AppKit macOS application. The authorized successor is one shared React/Tauri interface, a reused Swift domain worker with SQLite, embedded xCat/xCluster services, and bundled Hamlib radio/rotor helpers. Mac-first acceptance precedes Windows/Linux release; those platforms are not claimed supported until their exact packages pass.

## Users

Radio amateurs who need a fast, keyboard-first local logger during live operation, especially operators already using Wavelog and the OM0RX macOS station suite.

## Product Purpose

OM0RX-xLog is the local logging centre for the OM0RX station ecosystem. It records QSOs reliably without requiring a browser or RUMlog, enriches contacts, controls a remote station through embedded xCat or local hardware through bundled Hamlib, and synchronises changes both ways with Wavelog. Neither standalone xCat nor xCluster is a required successor-app dependency. It must remain useful as a standalone logger when network services are unavailable.

## Positioning

One native logbook joins local-first operation, the existing OM0RX radio and cluster applications, lossless ADIF storage, and Wavelog reconciliation without putting safety-critical radio control and remote sync in one process.

## Operating Context

- Used on macOS during live amateur-radio operation, often with a radio, amplifier, tuner and rotator active.
- Integrates with OM0RX-xCat, OM0RX-xCluster and OM0RX-xBridge rather than replacing their stable responsibilities immediately.
- Wavelog remains the online award, statistics and third-party-service hub.
- Callsign lookup may use QRZ.com when the operator configures eligible credentials.
- Reference data must update safely and retain the last known good copy when a download fails.

## Capabilities and Constraints

- Local SQLite logbook is authoritative for the desktop workflow and preserves unknown ADIF fields.
- Create, edit, search, import and export QSOs; show previous contacts and band/mode state.
- Two-way Wavelog API v2 synchronisation with an outbox, stable local identifiers, remote identifiers, conflict visibility and recoverable failures.
- Logging fields follow the useful Wavelog groups: QSO, Station, General, Notes and QSL.
- Callsign enrichment must not overwrite fields the operator has edited.
- Secrets belong in macOS Keychain, never preferences, source, screenshots or logs.
- One embedded station session owns each configured device. UI, cluster selection and optional compatibility clients share that authority. Remote station policy stays on the Windows agent; local Hamlib radio and rotor require no Windows agent. Standalone xCat loopback remains only a transitional compatibility adapter, not the primary architecture.
- Club Log CTY, LoTW activity and Wavelog catalog updates are atomic and validated before activation.
- Cluster activation references are promoted into standard ADIF fields when a valid identifier is present; xLog never invents a reference from a programme badge alone.
- The operator desk keeps logging, propagation and cluster context simultaneously visible, with resizable undocked maps for multi-screen stations.
- External-account, RF, signing, notarisation and deployment claims require direct evidence.

## Brand Commitments

- Product name: OM0RX-xLog.
- Owner and maker: Oliver Bross OM0RX.
- It belongs visually to OM0RX-xCat, OM0RX-xCluster and OM0RX-xBridge: dark navy working surfaces, cyan/teal operational states, amber attention states and restrained semantic colour.
- The icon must be recognisably a logbook and distinct from the xCat radio-control icon.

## Evidence on Hand

- Existing native suite repositories under `/Users/oliver/Documents/Projects/OM0RX-xCat`, `/Users/oliver/Documents/Projects/OM0RX-xCluster` and `/Users/oliver/Documents/Projects/OM0RX-xBridge`.
- Existing Wavelog API v2, ADIF, Keychain and reconciliation code in OM0RX-xBridge.
- Existing station-control and cluster palette and interaction patterns in OM0RX-xCluster and OM0RX-xCat.
- The authenticated Wavelog logging form was inspected read-only; no account data or credentials are copied into this repository.

## Product Principles

1. The contact is safe locally before any network operation begins.
2. The operator can log a normal QSO from the keyboard without leaving the primary screen.
3. Integrations expose their real state and recover without blocking local logging.
4. Preserve source data; enrich carefully and never silently discard ADIF fields.
5. Dense information is welcome when hierarchy, colour and interaction remain predictable.

## Accessibility & Inclusion

All core logging actions require keyboard equivalents, visible focus, descriptive labels and colour-independent status text. Layouts must remain usable at smaller macOS window sizes and with increased text sizing.

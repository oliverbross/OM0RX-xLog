# Windows qualification handoff: Flex discovery transport only

This is a bounded supporting task for W16 / NL-07. The Mac integration owner
continues the existing two-span/32-track skimmer; do not start another decoder,
CW project, radio registry or Windows application port. This handoff does not
qualify IQ, RF mapping, decoding, throughput, quality or installation.

## Operator's selected topology

- Flex 8400 radio: **192.168.0.199**; native TCP control is reachable from Mac.
- Selected Station: **OM0RX-WIN10**. Released resource: existing panadapter
  **40000000**, **DAX IQ 1**, VFO A. Do not change its tuning or ownership.
- Windows 10 station PC / intended relay host: **192.168.0.117**. Verify that
  this is the actual local machine before doing anything beyond inspection.
- SmartSDR remains running. The operator stopped Windows DAX; the panadapter's
  DAX IQ assignment remains **1**. Slice DAX audio is unrelated to native IQ.
- Radio-LAN router: TP-Link **EC120-F5 v1**, firmware 3.16.0 / Build 200311
  Rel.38251n. Existing OpenVPN is routed; its inspected UI has no bridge/relay
  control. Do not change router, VPN, WAN exposure or firewall settings.
- Mac OpenVPN Connect 3.8.1 is connected over UDP 1194. Both client and router
  verified its current private address as **10.8.0.10**. Earlier **10.8.0.6 is
  obsolete**. Confirm the current destination with the operator at run time;
  abort if it changes. Never forward to an arbitrary public destination.
- The Mac's native admission and a separately bound raw UDP socket receive no
  manufacturer discovery on **UDP destination 4992**. The latest native attempt
  stops before stream creation and collects zero IQ. Ping/TCP success is not
  discovery or IQ evidence.

## Required result

Deliver fresh, genuine Flex manufacturer discovery from the radio's LAN to
**10.8.0.10:4992**, preserving the **actual radio source IPv4 address and original
UDP source port**. Preserve the entire manufacturer's UDP payload byte-for-byte.
Only destination routing and required IP/UDP checksums may change. Capture and
forward live packets; never replay a saved discovery packet, generate an identity,
alter model/serial/IP fields, masquerade another host as the radio, or weaken the
Mac's discovery/peer checks. A source-preserving relay copies an actual observed
radio packet; a fabricated packet is unacceptable.

This is transport forwarding, with no station-side IQ processing. Do **not**
forward IQ/audio, TCP control, multicast generally, or unrelated LAN traffic.
Native IQ will later be acquired directly by the existing Mac owner, which must
independently verify sender, stream, ownership, rate and fresh samples.

## Work and permission boundaries

1. Work in a new private Windows folder. Do not modify a production xLog checkout,
   app, logs, drafts, settings, recordings, backups, radio profiles or credentials.
   Do not commit/push/merge xLog changes; return the helper source and receipts to
   the Mac integration owner for review. Keep unique work recoverable.
2. Bounded read-only inventory: verify Windows version, local PC identity/IP,
   adapter/default route, SmartSDR version/process and existing approved packet
   capture facilities. Do not dump credentials, VPN private keys or unrelated logs.
3. First observe **at most 30 seconds** of discovery on the local LAN. Confirm
   packets really come from 192.168.0.199 to UDP 4992. Validate the actual Flex
   VITA discovery header/class and bounded metadata against official FlexLib
   contracts. Record actual model/serial and packet source; do not infer identity
   from the PC name or a slice label. Preserve bounded evidence privately.
4. Ordinary Windows UDP forwarding changes the sender, and Windows raw UDP has
   source-address restrictions. Do not silently substitute either as a solution.
   Investigate an existing approved packet-forwarding facility first. A possible
   implementation is an auditable, narrowly filtered WinDivert sniff-and-copy
   helper; verify its current official API, signature and licensing first.
5. Before installing/loading a **new privileged capture/injection driver**, show
   the operator the concrete official source/version, hashes, validated signer,
   exact filter, run duration, effect and cleanup. Obtain explicit approval for
   that driver operation. Do not disable Secure Boot, antivirus, driver signature
   checks or firewalls. Do not use unsigned/test-signing mode, an unrecognized
   download, a broad bridge or a general-purpose traffic tunnel.
6. Prepare and locally test packet validation/checksum/destination logic with
   synthetic fixtures **offline**, never injected into the network. Preserve the
   actual radio packet's payload and source fields. Reject IPv6, fragments,
   malformed/truncated/oversized packets, other sources and other packet classes.
   No fallback that fabricates, repairs or re-labels identity evidence.
7. Any live relay must copy/sniff rather than divert original packets away from
   SmartSDR or other consumers. Restrict capture to inbound radio discovery from
   192.168.0.199, UDP destination 4992; restrict output to the confirmed Mac VPN
   address/port. Exclude reinjected/outbound traffic and self-loops. Use bounded
   buffers, counters and rate (maximum 10 forwarded packets/second); drop excess
   visibly, with no backlog or stale-packet replay.
8. Live runs require a hard **five-minute maximum**, explicit operator start,
   visible Stop and automatic expiration. No service, startup entry, scheduled
   task, persistent route or unattended restart. Coordinate a run window with the
   Mac owner; report its actual start and expiry UTC. The Mac owner will run one
   bounded native discovery/admission check. Sending locally is not delivery
   proof; wait for the Mac receipt before claiming success.
9. Stop closes only this helper's handles/process. Do not stop SmartSDR, CAT,
   DAX services generally, other VPN clients or a shared capture driver. Preserve
   any pre-existing driver/service. Document any newly loaded driver and verified
   cleanup; do not uninstall a shared driver merely to obtain a clean report.
10. If no supported approved mechanism works, return the exact failing dependency
    or error once. Do not retry indefinitely or relax identity checks.

## Absolute station limits

No PTT, CW/voice/audio send, physical TX test, power/amplifier/antenna/rotor change,
retune, new panadapter, DAX/IQ assignment/rate change, IQ stream creation/removal,
QSO/import/reset/restore/rescore, provider upload or public spot. Do not borrow
another user's stream or interrupt their station session. Radio stream acquisition
belongs to the existing Mac owner after fresh handoff/admission.

## Return receipt

Return a compact result with local evidence paths/hashes:

- Verified PC/IP, Windows and SmartSDR versions; mechanism and exact source/build,
  driver/DLL hashes and signature results, approval and cleanup outcome if used.
- Radio model/serial from **actual received discovery**, source address/port,
  destination, packet length/class, input/output payload hashes and equality.
- Observed, forwarded, rejected, dropped and loop-suppressed counts; queue/rate
  bounds; start/expiry/stop UTC and actual elapsed duration. Unknown stays unknown.
- SmartSDR/CAT preservation check; no radio commands or IQ stream actions.
- Mac's actual corresponding reception/admission receipt, if available. Distinguish
  successful local forwarding from verified Mac delivery. Do not claim a CW pass.

Primary references: [official FlexLib 4.3.16](https://www.flexradio.com/software/smartsdr-v4-x-api-flexlib/)
(review Discovery.cs / VitaDiscovery.cs; original ZIP SHA-256
`60978db51dac6ea781899dd80832ad4e7876ce96ed72532b57106376fc26463f`),
[Microsoft raw socket restrictions](https://learn.microsoft.com/en-us/windows/win32/winsock/tcp-ip-raw-sockets-2),
[official WinDivert](https://reqrypt.org/windivert.html) and
[its API documentation](https://reqrypt.org/windivert-doc.html).

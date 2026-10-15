#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
report_path="${1:-$repo_root/dist/disposable-ftp-live-acceptance.json}"
temporary_parent="${TMPDIR:-/tmp}"
acceptance_root="$(mktemp -d "$temporary_parent/xlog-ftp-live.XXXXXX")"
ftp_pid=""
ftps_pid=""
refusal_pid=""
lost_ack_pid=""
timeout_pid=""
oversized_pids=()
slow_pids=()

cleanup() {
  # Bash 3.2 treats empty arrays as unset under nounset, including in EXIT traps.
  for pid in ${slow_pids[@]+"${slow_pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  for pid in ${oversized_pids[@]+"${oversized_pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  if [[ -n "$ftp_pid" ]]; then kill "$ftp_pid" 2>/dev/null || true; fi
  if [[ -n "$ftps_pid" ]]; then kill "$ftps_pid" 2>/dev/null || true; fi
  if [[ -n "$refusal_pid" ]]; then kill "$refusal_pid" 2>/dev/null || true; fi
  if [[ -n "$lost_ack_pid" ]]; then kill "$lost_ack_pid" 2>/dev/null || true; fi
  if [[ -n "$timeout_pid" ]]; then kill "$timeout_pid" 2>/dev/null || true; fi
  if [[ -n "$ftp_pid" ]]; then wait "$ftp_pid" 2>/dev/null || true; fi
  if [[ -n "$ftps_pid" ]]; then wait "$ftps_pid" 2>/dev/null || true; fi
  if [[ -n "$refusal_pid" ]]; then wait "$refusal_pid" 2>/dev/null || true; fi
  if [[ -n "$lost_ack_pid" ]]; then wait "$lost_ack_pid" 2>/dev/null || true; fi
  if [[ -n "$timeout_pid" ]]; then wait "$timeout_pid" 2>/dev/null || true; fi
  for pid in ${oversized_pids[@]+"${oversized_pids[@]}"}; do wait "$pid" 2>/dev/null || true; done
  for pid in ${slow_pids[@]+"${slow_pids[@]}"}; do wait "$pid" 2>/dev/null || true; done
  case "$acceptance_root" in
    "$temporary_parent"/xlog-ftp-live.*) rm -rf -- "$acceptance_root" ;;
    *) echo "Refusing to remove unexpected path: $acceptance_root" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

mkdir -p "$acceptance_root/ftp-root/backups/logs"
mkdir -p "$acceptance_root/ftps-root/backups/logs"
mkdir -p "$acceptance_root/refusal-root/backups/logs"
mkdir -p "$acceptance_root/lost-ack-root/backups/logs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost,IP:127.0.0.1 \
  -keyout "$acceptance_root/server.key" \
  -out "$acceptance_root/server.crt" >/dev/null 2>&1

username="xlog-acceptance"
password="synthetic-only"
PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
  --root "$acceptance_root/ftp-root" \
  --ready-file "$acceptance_root/ftp-ready.json" \
  --mode ftp --username "$username" --password "$password" &
ftp_pid=$!
PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
  --root "$acceptance_root/ftps-root" \
  --ready-file "$acceptance_root/ftps-ready.json" \
  --mode ftps --cert "$acceptance_root/server.crt" \
  --key "$acceptance_root/server.key" \
  --username "$username" --password "$password" &
ftps_pid=$!
PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
  --root "$acceptance_root/refusal-root" \
  --ready-file "$acceptance_root/refusal-ready.json" \
  --mode ftp --mkdir-refuse --username "$username" --password "$password" &
refusal_pid=$!
PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
  --root "$acceptance_root/lost-ack-root" \
  --ready-file "$acceptance_root/lost-ack-ready.json" \
  --mode ftp --drop-after-store --username "$username" --password "$password" &
lost_ack_pid=$!

for mode in advertised streamed after-verification; do
  mkdir -p "$acceptance_root/oversized-$mode-root/backups/logs"
  PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
    --root "$acceptance_root/oversized-$mode-root" \
    --ready-file "$acceptance_root/oversized-$mode-ready.json" \
    --mode ftp --oversized-download "$mode" --username "$username" --password "$password" &
  oversized_pids+=("$!")
done

mkdir -p "$acceptance_root/timeout-root/backups/logs"
PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
  --root "$acceptance_root/timeout-root" \
  --ready-file "$acceptance_root/timeout-ready.json" \
  --mode ftp --withhold-greeting --username "$username" --password "$password" &
timeout_pid=$!

for mode in stall deadline; do
  mkdir -p "$acceptance_root/$mode-root/backups/logs"
  PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
    --root "$acceptance_root/$mode-root" \
    --ready-file "$acceptance_root/$mode-ready.json" \
    --slow-download "$mode" --username "$username" --password "$password" &
  slow_pids+=("$!")
done

for _ in {1..100}; do
  [[ -f "$acceptance_root/ftp-ready.json" && -f "$acceptance_root/ftps-ready.json" \
     && -f "$acceptance_root/refusal-ready.json" \
     && -f "$acceptance_root/lost-ack-ready.json" \
     && -f "$acceptance_root/timeout-ready.json" \
     && -f "$acceptance_root/stall-ready.json" && -f "$acceptance_root/deadline-ready.json" \
     && -f "$acceptance_root/oversized-advertised-ready.json" \
     && -f "$acceptance_root/oversized-streamed-ready.json" \
     && -f "$acceptance_root/oversized-after-verification-ready.json" ]] && break
  sleep 0.05
done
[[ -f "$acceptance_root/ftp-ready.json" && -f "$acceptance_root/ftps-ready.json" \
   && -f "$acceptance_root/refusal-ready.json" \
   && -f "$acceptance_root/lost-ack-ready.json" \
   && -f "$acceptance_root/timeout-ready.json" \
   && -f "$acceptance_root/stall-ready.json" && -f "$acceptance_root/deadline-ready.json" \
   && -f "$acceptance_root/oversized-advertised-ready.json" \
   && -f "$acceptance_root/oversized-streamed-ready.json" \
   && -f "$acceptance_root/oversized-after-verification-ready.json" ]]

ftp_endpoint="$(jq -r .endpoint "$acceptance_root/ftp-ready.json")"
ftps_endpoint="$(jq -r .endpoint "$acceptance_root/ftps-ready.json")"
refusal_endpoint="$(jq -r .endpoint "$acceptance_root/refusal-ready.json")"
lost_ack_endpoint="$(jq -r .endpoint "$acceptance_root/lost-ack-ready.json")"
XLOG_FTP_LIVE_ENDPOINT="$ftp_endpoint" \
XLOG_FTPS_UNTRUSTED_ENDPOINT="$ftps_endpoint" \
XLOG_FTP_REFUSAL_ENDPOINT="$refusal_endpoint" \
XLOG_FTP_LOST_ACK_ENDPOINT="$lost_ack_endpoint" \
XLOG_FTP_TIMEOUT_ENDPOINT="$(jq -r .endpoint "$acceptance_root/timeout-ready.json")" \
XLOG_FTP_STALL_ENDPOINT="$(jq -r .endpoint "$acceptance_root/stall-ready.json")" \
XLOG_FTP_DEADLINE_ENDPOINT="$(jq -r .endpoint "$acceptance_root/deadline-ready.json")" \
XLOG_FTP_TIMING_DIRECTORY="$acceptance_root" \
XLOG_FTP_OVERSIZED_ADVERTISED_ENDPOINT="$(jq -r .endpoint "$acceptance_root/oversized-advertised-ready.json")" \
XLOG_FTP_OVERSIZED_STREAMED_ENDPOINT="$(jq -r .endpoint "$acceptance_root/oversized-streamed-ready.json")" \
XLOG_FTP_OVERSIZED_RESTORE_ENDPOINT="$(jq -r .endpoint "$acceptance_root/oversized-after-verification-ready.json")" \
XLOG_FTP_LIVE_USERNAME="$username" \
XLOG_FTP_LIVE_PASSWORD="$password" \
  swift test --package-path "$repo_root" -Xswiftc -warnings-as-errors --filter FTPBackupLiveServerTests

plain_count="$(find "$acceptance_root/ftp-root" -type f | wc -l | tr -d ' ')"
untrusted_ftps_count="$(find "$acceptance_root/ftps-root" -type f | wc -l | tr -d ' ')"
refusal_count="$(find "$acceptance_root/refusal-root" -type f | wc -l | tr -d ' ')"
lost_ack_count="$(find "$acceptance_root/lost-ack-root" -type f | wc -l | tr -d ' ')"
[[ "$plain_count" == "1" ]]
[[ "$untrusted_ftps_count" == "0" ]]
[[ "$refusal_count" == "0" ]]
[[ "$lost_ack_count" == "1" ]]
timeout_count="$(find "$acceptance_root/timeout-root" -type f | wc -l | tr -d ' ')"
[[ "$timeout_count" == "0" ]]
for mode in stall deadline; do
  slow_count="$(find "$acceptance_root/$mode-root" -type f | wc -l | tr -d ' ')"
  [[ "$slow_count" == "1" ]]
  slow_file="$(find "$acceptance_root/$mode-root" -type f -print -quit)"
  [[ "$(wc -c < "$slow_file" | tr -d ' ')" == "8192" ]]
done
for mode in advertised streamed after-verification; do
  oversized_count="$(find "$acceptance_root/oversized-$mode-root" -type f | wc -l | tr -d ' ')"
  [[ "$oversized_count" == "1" ]]
done
plain_file="$(find "$acceptance_root/ftp-root" -type f -print -quit)"
plain_sha256="$(shasum -a 256 "$plain_file" | awk '{print $1}')"
expected_sha256="$(printf 'OM0RX-xLog synthetic disposable FTP acceptance\n' | shasum -a 256 | awk '{print $1}')"
[[ "$plain_sha256" == "$expected_sha256" ]]

mkdir -p "$(dirname "$report_path")"
source_commit="$(git -C "$repo_root" rev-parse HEAD)"
tracked_source_dirty=false
if [[ -n "$(git -C "$repo_root" status --short --untracked-files=no)" ]]; then
  tracked_source_dirty=true
fi
jq -n \
  --arg source_commit "$source_commit" \
  --arg plain_sha256 "$plain_sha256" \
  --argjson tracked_source_dirty "$tracked_source_dirty" \
  --slurpfile stall "$acceptance_root/stall.json" \
  --slurpfile deadline "$acceptance_root/deadline.json" \
  '{schema: 1, status: "passed", source_commit: $source_commit,
    tracked_source_dirty: $tracked_source_dirty, scope: "disposable-local-transport",
    synthetic_data_only: true, external_network: false, station_io: false,
    production_limits: {connect_timeout_seconds: 15, total_timeout_seconds: 120,
      low_speed_bytes_per_second: 1, low_speed_seconds: 30},
    ftp: {upload: true, independent_download: true, restore_download: true,
      replay_refused: true, reservation_refusal_wrote_no_object: true,
      lost_acknowledgement_wrote_one_object_without_replay: true,
      oversized_advertised_download_rejected: true,
      oversized_streamed_download_rejected: true,
      oversized_download_produced_no_verified_object: true,
      restore_rejected_growth_after_verification: true,
      control_handshake_timeout_bounded: true,
      timeout_wrote_no_object_and_replay_refused: true,
       stalled_download_rejected_without_verified_object: true,
       sustained_slow_download_total_deadline_enforced: true,
       timed_out_download_replay_refused: true,
       timed_out_download_remote_object_count_per_case: 1,
       stalled_download_elapsed_seconds: $stall[0].elapsed_seconds,
       total_deadline_elapsed_seconds: $deadline[0].elapsed_seconds,
      object_count: 1, sha256: $plain_sha256},
    ftps: {untrusted_certificate_rejected: true, object_count: 0,
      trusted_certificate_success: false,
      remaining_gate: "trusted certificate without modifying operator trust store"}}' \
  > "$report_path"
echo "Disposable FTP acceptance passed: $report_path"

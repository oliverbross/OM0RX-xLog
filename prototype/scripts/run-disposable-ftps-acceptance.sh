#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
report_path="${1:-$repo_root/dist/disposable-ftps-live-acceptance.json}"
temporary_parent="${TMPDIR:-/tmp}"
acceptance_root="$(mktemp -d "$temporary_parent/xlog-ftps-live.XXXXXX")"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  case "$acceptance_root" in
    "$temporary_parent"/xlog-ftps-live.*) rm -rf -- "$acceptance_root" ;;
    *) echo "Refusing to remove unexpected path: $acceptance_root" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

mkdir -p "$acceptance_root/server-root/backups/logs"
for name in server wrong-ca; do
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -subj "/CN=$name.localhost" -addext subjectAltName=DNS:localhost \
    -keyout "$acceptance_root/$name.key" -out "$acceptance_root/$name.crt" >/dev/null 2>&1
done
PYTHONDONTWRITEBYTECODE=1 python3 "$repo_root/prototype/scripts/disposable_ftp_server.py" \
  --root "$acceptance_root/server-root" --ready-file "$acceptance_root/ready.json" \
  --mode ftps --cert "$acceptance_root/server.crt" --key "$acceptance_root/server.key" \
  --username xlog-acceptance --password synthetic-only &
server_pid=$!
for _ in {1..100}; do
  [[ -f "$acceptance_root/ready.json" ]] && break
  sleep 0.05
done
[[ -f "$acceptance_root/ready.json" ]]
XLOG_FTPS_TRUSTED_ENDPOINT="$(jq -r .endpoint "$acceptance_root/ready.json")" \
XLOG_FTPS_UNTRUSTED_ENDPOINT="$(jq -r .endpoint "$acceptance_root/ready.json")" \
XLOG_FTPS_CA_PATH="$acceptance_root/server.crt" \
XLOG_FTPS_WRONG_CA_PATH="$acceptance_root/wrong-ca.crt" \
XLOG_FTP_LIVE_USERNAME=xlog-acceptance XLOG_FTP_LIVE_PASSWORD=synthetic-only \
  swift test --package-path "$repo_root" -Xswiftc -warnings-as-errors -Xcc -Wall -Xcc -Wextra -Xcc -Werror \
    --filter 'FTPBackupLiveServerTests/(trustedImplicitFTPS|rejectedConfiguredTrust|untrustedImplicitFTPS)'

object_count="$(find "$acceptance_root/server-root" -type f | wc -l | tr -d ' ')"
reservation_count="$(find "$acceptance_root/server-root/backups/logs" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$object_count" == "1" && "$reservation_count" == "1" ]]
object="$(find "$acceptance_root/server-root" -type f -print -quit)"
sha256="$(shasum -a 256 "$object" | awk '{print $1}')"
expected="$(printf 'OM0RX-xLog synthetic trusted implicit FTPS acceptance\n' | shasum -a 256 | awk '{print $1}')"
[[ "$sha256" == "$expected" ]]
ca_sha256="$(shasum -a 256 "$acceptance_root/server.crt" | awk '{print $1}')"
source_commit="$(git -C "$repo_root" rev-parse HEAD)"
tracked_source_dirty=false
if [[ -n "$(git -C "$repo_root" status --short --untracked-files=no)" ]]; then tracked_source_dirty=true; fi
mkdir -p "$(dirname "$report_path")"
jq -n --arg source_commit "$source_commit" --arg sha256 "$sha256" --arg ca_sha256 "$ca_sha256" \
  --argjson tracked_source_dirty "$tracked_source_dirty" \
  '{schema: 1, status: "passed", source_commit: $source_commit, tracked_source_dirty: $tracked_source_dirty,
    scope: "disposable-local-transport", synthetic_data_only: true, external_network: false, station_io: false,
    trust_store_modified: false, trust_configuration: "native-memory-CURLOPT_CAINFO_BLOB",
    ftps: {trusted_certificate_success: true, upload: true, independent_download: true, restore_download: true,
      replay_refused: true, untrusted_certificate_rejected: true, wrong_ca_rejected: true,
      wrong_hostname_rejected: true, rejected_attempts_created_no_reservation: true,
      peer_verification_required: true, hostname_verification_required: true,
      object_count: 1, sha256: $sha256, ca_pem_sha256: $ca_sha256, ca_revision: 1}}' > "$report_path"
echo "Disposable implicit FTPS acceptance passed: $report_path"

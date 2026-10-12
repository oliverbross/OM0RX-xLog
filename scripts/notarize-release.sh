#!/bin/zsh
set -euo pipefail

repo_dir="${0:A:h:h}"
profile="${NOTARY_PROFILE:-OM0RX-notary}"
app_dir="$repo_dir/dist/OM0RX-xLog.app"
temporary_dir="$(mktemp -d /private/tmp/om0rx-xlog-notary.XXXXXX)"
trap 'rm -rf "$temporary_dir"' EXIT

"$repo_dir/scripts/package-app.sh"

version="$(plutil -extract CFBundleShortVersionString raw "$app_dir/Contents/Info.plist")"
archive="$repo_dir/dist/OM0RX-xLog-$version-macOS.zip"
response="$temporary_dir/notary-response.plist"
log_file="$temporary_dir/notary-log.json"

codesign --verify --deep --strict --verbose=2 "$app_dir"
rm -f "$archive"
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$archive"

xcrun notarytool submit "$archive" \
    --keychain-profile "$profile" \
    --wait \
    --timeout 2h \
    --output-format plist > "$response"

status="$(plutil -extract status raw "$response")"
submission_id="$(plutil -extract id raw "$response")"
print "Notary submission: $submission_id ($status)"

if [[ "$status" != "Accepted" ]]; then
    xcrun notarytool log "$submission_id" \
        --keychain-profile "$profile" \
        "$log_file"
    sed -n '1,240p' "$log_file" >&2
    exit 1
fi

xcrun stapler staple -v "$app_dir"
xcrun stapler validate -v "$app_dir"

# A ZIP cannot itself carry a stapled ticket, so rebuild it around the
# ticket-bearing application bundle after Apple accepts the submission.
rm -f "$archive"
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$archive"

codesign --verify --deep --strict --verbose=2 "$app_dir"
spctl -a -vvv -t exec "$app_dir"
shasum -a 256 "$archive"
print "$archive"

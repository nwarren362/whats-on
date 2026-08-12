#!/bin/zsh
set -euo pipefail

readonly KEYCHAIN_SERVICE="jasmin-whats-on-research-drafts"
readonly KEYCHAIN_ACCOUNT="capture-token"
readonly ENDPOINT="https://jrluybdxwzyyrinfrbly.supabase.co/functions/v1/research-drafts"

if (( $# != 1 )); then
  print -u2 "Usage: $0 /path/to/approved-drafts.json"
  exit 64
fi

readonly PAYLOAD_FILE="$1"
if [[ ! -f "$PAYLOAD_FILE" ]]; then
  print -u2 "Payload file not found: $PAYLOAD_FILE"
  exit 66
fi

if ! /usr/bin/ruby -rjson -e 'JSON.parse(File.read(ARGV.fetch(0)))' "$PAYLOAD_FILE" >/dev/null 2>&1; then
  print -u2 "Payload is not valid JSON: $PAYLOAD_FILE"
  exit 65
fi

if ! CAPTURE_TOKEN=$(/usr/bin/security find-generic-password \
  -s "$KEYCHAIN_SERVICE" \
  -a "$KEYCHAIN_ACCOUNT" \
  -w 2>/dev/null); then
  print -u2 "Private code not found in macOS Keychain."
  print -u2 "Add it once using the setup command in README.md."
  exit 77
fi
readonly CAPTURE_TOKEN

/usr/bin/curl --silent --show-error --fail-with-body \
  --request POST \
  "$ENDPOINT" \
  --header "X-Capture-Token: $CAPTURE_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary "@$PAYLOAD_FILE"
print

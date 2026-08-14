#!/bin/zsh
set -euo pipefail

readonly KEYCHAIN_SERVICE="jasmin-whats-on-research-drafts"
readonly KEYCHAIN_ACCOUNT="capture-token"
readonly ENDPOINT="https://jrluybdxwzyyrinfrbly.supabase.co/functions/v1/manage-events/api/sources"

usage() {
  print -u2 "Usage:"
  print -u2 "  $0 list"
  print -u2 "  $0 add /path/to/source.json"
  print -u2 "  $0 update SOURCE_ID /path/to/source.json"
  exit 64
}

if ! CAPTURE_TOKEN=$(/usr/bin/security find-generic-password \
  -s "$KEYCHAIN_SERVICE" \
  -a "$KEYCHAIN_ACCOUNT" \
  -w 2>/dev/null); then
  print -u2 "Private code not found in macOS Keychain."
  print -u2 "Add it once using the setup command in README.md."
  exit 77
fi
readonly CAPTURE_TOKEN

readonly ACTION="${1:-}"
case "$ACTION" in
  list)
    (( $# == 1 )) || usage
    /usr/bin/curl --silent --show-error --fail-with-body \
      "$ENDPOINT" \
      --header "X-Capture-Token: $CAPTURE_TOKEN" \
      | /usr/bin/ruby -rjson -e 'puts JSON.pretty_generate(JSON.parse(STDIN.read))'
    ;;
  add)
    (( $# == 2 )) || usage
    readonly PAYLOAD_FILE="$2"
    [[ -f "$PAYLOAD_FILE" ]] || { print -u2 "Payload file not found: $PAYLOAD_FILE"; exit 66; }
    /usr/bin/ruby -rjson -e 'JSON.parse(File.read(ARGV.fetch(0)))' "$PAYLOAD_FILE" >/dev/null 2>&1 \
      || { print -u2 "Payload is not valid JSON: $PAYLOAD_FILE"; exit 65; }
    /usr/bin/curl --silent --show-error --fail-with-body \
      --request POST "$ENDPOINT" \
      --header "X-Capture-Token: $CAPTURE_TOKEN" \
      --header "Content-Type: application/json" \
      --data-binary "@$PAYLOAD_FILE"
    print
    ;;
  update)
    (( $# == 3 )) || usage
    readonly SOURCE_ID="$2"
    readonly PAYLOAD_FILE="$3"
    /usr/bin/ruby -e 'exit(ARGV.fetch(0).match?(/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/i) ? 0 : 1)' "$SOURCE_ID" \
      || { print -u2 "Invalid source id: $SOURCE_ID"; exit 65; }
    [[ -f "$PAYLOAD_FILE" ]] || { print -u2 "Payload file not found: $PAYLOAD_FILE"; exit 66; }
    /usr/bin/ruby -rjson -e 'JSON.parse(File.read(ARGV.fetch(0)))' "$PAYLOAD_FILE" >/dev/null 2>&1 \
      || { print -u2 "Payload is not valid JSON: $PAYLOAD_FILE"; exit 65; }
    /usr/bin/curl --silent --show-error --fail-with-body \
      --request PATCH "$ENDPOINT/$SOURCE_ID" \
      --header "X-Capture-Token: $CAPTURE_TOKEN" \
      --header "Content-Type: application/json" \
      --data-binary "@$PAYLOAD_FILE"
    print
    ;;
  *) usage ;;
esac

#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
lodgify_dir="$repo_dir/lodgify"

{
  printf '%s\n' '<script type="text/javascript">'
  sed '/^[[:space:]]*<script/d; /^[[:space:]]*<\/script>[[:space:]]*$/d' "$lodgify_dir/whats-on.js"
  sed '/^[[:space:]]*<script/d; /^[[:space:]]*<\/script>[[:space:]]*$/d' "$lodgify_dir/admin.js"
  printf '%s\n' '</script>'
} > "$lodgify_dir/lodgify-custom-javascript.html"

{
  printf '%s\n' '/* PUBLIC WHAT\047S ON PAGE */'
  sed '/^[[:space:]]*<style/d; /^[[:space:]]*<\/style>[[:space:]]*$/d' "$lodgify_dir/whats-on.css"
  printf '\n%s\n' '/* PRIVATE AGENDA MANAGEMENT PAGE */'
  sed '/^[[:space:]]*<style/d; /^[[:space:]]*<\/style>[[:space:]]*$/d' "$lodgify_dir/admin.css"
} > "$lodgify_dir/lodgify-custom-css.css"

printf '%s\n' 'Built the combined Lodgify JavaScript and CSS files.'

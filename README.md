# Jasmin Cottage What's On

A curated feed of local events, captured from an iPhone Share Sheet, reviewed in a private editor, and published on the Jasmin Cottage Lodgify website.

## Current capabilities

- Capture links from the iPhone Share Sheet into a private draft queue.
- Prefill drafts from standard page metadata and structured event data when available.
- Review, edit, publish, archive, and categorise events in a private mobile-friendly editor.
- Represent a weekly series as one event with a final occurrence date.
- Prioritise the next 28 days while keeping later events in an expandable section.
- Enlarge event posters in an accessible desktop/mobile lightbox.
- Hide inaccessible or expired external images without showing a broken placeholder.
- Accept an approved research shortlist through a protected batch endpoint that can create drafts only.
- Import approved research from Codex using a local helper and a private code held in macOS Keychain.

## Backlog

- Test and refine the desktop bookmarklet against Facebook and other common event sources.
- Add small editor conveniences such as quick publishing, automatic expiry suggestions, image previews, and validation prompts.
- Optionally distribute approved posts to a future Jasmin Cottage Facebook Page.

## Approved research imports

The `research-drafts` Edge Function accepts approved event suggestions and always creates them as drafts. It cannot publish events.

Store the private capture code once in macOS Keychain. Run this command in Terminal, paste the code when prompted, and press Return:

```bash
security add-generic-password \
  -U \
  -s "jasmin-whats-on-research-drafts" \
  -a "capture-token" \
  -w
```

Approved research is written temporarily to `research/approved-drafts.json`. JSON files in that folder are ignored by Git so event payloads are not committed accidentally.

Import an approved file with:

```bash
./scripts/import-research-drafts.sh research/approved-drafts.json
```

The helper reads the private code from Keychain at runtime. The code is never stored in the repository, payload file, shell history, or command output.

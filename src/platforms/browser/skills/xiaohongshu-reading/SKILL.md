---
name: xiaohongshu-reading
description: Read a supplied Xiaohongshu image/text note and its image carousel.
---

# Read a Xiaohongshu note

1. Open the supplied note with its existing access parameters. Wait and inspect a fresh snapshot while its container loads. A `sourceError` preserves the platform's source rejection, including `300031` when the note is currently unavailable. Return that observed failure after bounded recovery; it leaves the source stage incomplete.
2. Once the note loads, take a fresh snapshot and select the note's own content container. Capture its title, body, and ordered image carousel. A `source_scope` response requires a fresh snapshot and a reference inside that note.
3. When `read_xiaohongshu` is available, it can retrieve the same successfully observed note through the installed enhancement. Its result includes a capture identity. Browser capture remains available when enhancement retrieval fails.
4. Return actual text and image coverage. A page showing only a cover or introduction has partial coverage.

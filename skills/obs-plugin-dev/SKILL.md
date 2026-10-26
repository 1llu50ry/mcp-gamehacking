---
name: obs-plugin-dev
description: "OBS Studio plugin development -- obs-studio API, source filters, service, encoder, screen-capture integration for stream-safe cheats."
metadata:
  type: tool-reference
  source: curated
  topics: [obs, streaming, plugin, api, capture]
---
# OBS Studio Plugin Development

OBS is open source, C/C++. Plugins compile against obs-studio headers and ship as a `.dll` / `.so`.

## Plugin types
- **source**: generate a video / audio source (ex. ESP overlay as an OBS source).
- **filter**: modify an existing source.
- **output**: write to a format (stream/file).
- **encoder**: hw/sw encoder plug-in.
- **service**: streaming endpoint config.

## Stream-safe cheat use
- Draw ESP into a separate OBS source visible on-screen (OBS-side) but absent from the capture OBS sends to the stream.
- Overlay via DisplayCapture + explicit scene reorder.

## Related
[[anti-screenshot]], the `cheat-developer` agent.

# Audio package — **DEPRECATED** (disconnected from live pipeline)

**As of four-axis EI change:** `audio_distance` was removed from Expansion Intelligence.
Live materialize / OCSE / depth use **territory · scene · era · language** only.

This directory (`embedder`, Deezer preview, embedding cache, ANN, resolve-signature)
is **not** part of the live distance path. Kept for historical reference and
optional offline experiments only.

Do not wire new product features through these modules assuming they feed EI.

## Why deprecated

Audio was the weakest axis: neutral defaults for most candidates, false
"close" leaps, and a major driver of `distanceVarianceCollapsed`. Replaced
by an honest four-axis metadata model.

## Confidence tags (current product meaning)

| Tag | Meaning |
|-----|---------|
| `high_confidence` | All four metadata axes well-populated |
| `partial_confidence` | Some axes thin / defaulted |
| `low_confidence` | Mostly missing metadata |

Legacy audio-era strings still normalize: `real_audio`→high, `tag_inferred`→partial,
`cold_start_default`→low.

## Optional offline use

```bash
ORCA_START_EMBEDDING_SIDECAR=1 npm run dev   # not required for materialize
```

# SeaSubs

Seanime plugin for external English Forced / Signs & Songs subtitles. Adds only subtitle tracks through VideoCore; preserves your current video provider, quality and audio.

## v0.7.0 faster search and episode following

- Tries the original AnimeTosho source first, checking the most likely dub/remembered release before expanding the search. Returns the first readable signs track without waiting for Animeya, a slow alternate host, or unrelated downloads. Falls back to wider release checks, AnimeTosho.xyz and then current-provider/Animeya content when needed.
- Uses eight-second feed/detail timeouts, a five-minute feed cache and a bounded in-memory cache of selected decoded tracks (six episodes / eight million characters). Revisiting a cached episode needs no subtitle downloads. Signed subtitle URLs/content are not saved to persistent storage.
- Choosing a verified signs track enables **Automatic Signs & Songs** for that anime and sub/dub mode. The enabled setting and release hint persist across extension reloads/restarts. On the next episode, SeaSubs searches for that episode's own track and adds it automatically; it never reuses the previous episode's subtitles for a new episode.
- Repeated player events are coalesced; stale results are discarded during rapid skips, and the newest episode is queued while an older search finishes.
- Use **Pause automatic subtitles** in the tray to turn following off for the current anime. Unverified plain English captions never enable automatic following and are never automatically selected. If no verified track or derivable ASS is available, SeaSubs leaves playback alone and reports the missing match.

After upgrading, select a signs track once to enable following for the anime, or use the tray's Enable automatic subtitles button. Provider, video quality and audio are preserved.

## v0.6.1 runtime fix

- Moves the subtitle helpers and bundled XZ decoder inside the registered UI callback. Seanime serializes this callback into a separate JavaScript VM, so helpers outside it are unavailable there.
- Normalizes native Goja string wrappers and supports `uri`, `sourceUrl`, and `format` alongside legacy `src`/`type`. Skips tracks without URL/content rather than sending invalid fetch arguments.
- Tests now evaluate the serialized callback in a fresh VM, reproducing Seanime's UI registration behavior.

## v0.6.0 content and source changes

- Reads current provider tracks, then English dub and softsub content from Animeya, rather than requiring forced labels.
- Logs cue counts, covered seconds and final timestamps without logging subtitle text or signed URLs.
- Marks a dub VTT as **likely** Signs & Songs only when it is a small, time-aligned subset of a substantial full-subtitle reference, spread across the episode. This is inference, not a guarantee.
- Offers plain dub captions as **unverified preview** when their purpose cannot be established. They may contain dialogue; they do not stop the AnimeTosho fallback.
- Derives VTT only from explicit signs/song classes or musical-note markers. Uppercase dialogue or positioning alone is insufficient evidence.
- Fixes AnimeTosho's attachment-ID download route, English matching, numeric forced flags and standalone “English Signs” names. Reads XZ attachments locally using a bounded CRC32/LZMA2 decoder.
- Loads readable ASS signs tracks directly or offers styled-event extraction from full ASS/SSA. Excludes comments from generated tracks.
- Checks direct AnimeTosho files before offering them. Reports unreadable files distinctly; a failed host does not discard the other host's results.
- Rejects stale selections/downloads after an episode change and prevents overlapping searches.

## Setup

Add `https://raw.githubusercontent.com/DefnoJae/SeaSubs/main/Manifest.json` in Seanime Extensions. Play an episode, then use **Find external subtitles** in the SeaSubs tray. OpenSubtitles API key is optional. Approve the updated subtitle CDN/attachment permissions when Seanime requests them.

## Investigation: Girlfriend, Girlfriend S2 E4 dub

The October 7 log resolves Animeya episode `11959` for AniList `154692`, episode 4. Live Vidnest responses reproduced plain `English` on dub and multiple languages on softsub. The dub English URL matches the current Anikoto provider's URL in the log. Both VTT downloads were blocked by Cloudflare in the development environment, so whether the dub VTT is signs-only remains **unverified**.

The original AnimeTosho API does expose a working alternate source: release `586376` (Yameii English dub), file `1119742`, attachment `1863226`, AniDB episode `271605`. The API names it **English Signs** and supplies an ID without a URL. The downloaded XZ contains **20 actual Dialogue events** with sign styles/on-screen text. The bundled decoder matches Python `lzma` decompression byte for byte. This is a signs-only track; it does not guarantee OP/ED lyrics. Timing still needs checking in the current player because releases can differ.

## Limits and validation

Observed Vidnest subtitle CDN domains are explicitly allowed; rotations can require a manifest update. XZ support intentionally accepts CRC32/LZMA2 only: maximum 512 KiB compressed input, 2 MiB output, 8 MiB dictionary, 16 blocks. Unsupported/corrupt streams fail visibly. ASS custom fonts are not downloaded, so rendering may substitute fonts.

Tested with live API/attachment data, fifteen regression/replay checks and mocked VideoCore injection, including search request counts, next-episode following, saved preferences, pause, cached revisits and rapid skips. The real attachment also decoded byte for byte inside Seanime's exact Goja version after callback serialization into a fresh UI VM; native `*string` subtitle URIs and empty tracks were tested there too. The user confirmed v0.6.1 renders successfully; v0.7.0's automatic episode following remains to be checked in the user's player.

## Development

Edit `source.ts` and `scripts/xz.js`; `code.ts` is the generated self-contained payload. Run `npm ci`, `npm run build`, and `npm test`. Type checking uses Seanime's current `plugin.d.ts`, `core.d.ts`, `app.d.ts`, and `system.d.ts` as external declarations. Decoder licenses are in `THIRD_PARTY_NOTICES.md`. No third-party subtitle content is stored in this repository.

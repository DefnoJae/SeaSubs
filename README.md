# SeaSubs

Seanime plugin for external English Forced / Signs & Songs subtitles. Adds only subtitle tracks through VideoCore; preserves your current video provider, quality and audio.

## v0.12.0 redesigned native panel

- Compact anime card, SeaSubs logo and wave header, a prominent gradient search action with native loading feedback, and a small link to retained alternatives.
- Timing is grouped into one card with an editable seconds pill, slider, ±100ms controls and Reset. Changes save automatically per anime and sub/dub mode; the exact input also accepts milliseconds and retains the ±120-second limit. Invalid values show an inline hint. Positive values move subtitles later.
- Per-sign adjustment and automatic following are compact cards. Automatic following uses Seanime's native switch and displays a subtle glow when enabled. Existing subtitle sources, generation, timing comparison, per-sign edits, caching, keyboard shortcut, alternative picker and playback preservation remain in place.
- Uses native tray layouts, images, buttons, inputs and switch with scoped CSS. Seanime has no slider primitive: a DOM observer adapts only the timing input to a range while retaining the native field/change bridge. Inline vector icons use the native image component; no embedded web page or browser scripts.
- Regression checks cover autosave, exact/slider synchronization, switch persistence, slider bounds and existing subtitle flows. The local browser preview could not be opened, so final appearance still needs confirmation in Seanime.

## v0.11.0 load first, choose alternatives separately

- **Find external subtitles** searches and loads the first ranked readable signs track directly, without opening a selection dialog. Repeated Find uses the remembered selection when available. Loading and success feedback remain visible.
- **Choose another subtitle** opens saved alternatives. Wider search keeps its results selectable. Selecting a result dismisses the picker immediately while the loading spinner covers its download; a failed download reports an error without replacing the current track.
- Unverified captions still require explicit selection, with a message that the search is complete. No matching track means no automatic caption selection. Existing next-episode following and anime delay controls continue to apply.
- Regression checks cover direct loading without opening a picker, retained alternatives, explicit unverified selection, wider searches and immediate picker dismissal during pending downloads.

## v0.10.1 download reuse and failed-track handling

- Shares simultaneous subtitle reads and reuses successful downloads for five minutes, bounded to twelve cached files / eight million characters. Briefly caches failures for fifteen seconds; wider search retries failed reads. Selection no longer repeats downloads already completed during inspection.
- Uses eight-second subtitle/API and six-second Vidnest fallback timeouts, rather than long repeated waits.
- Excludes unreadable provider results and refuses to inject a failed download URL into the player. Leaves the active track in place and reports the failure instead of claiming success.
- Strips the byte-order mark and detects actual ASS/VTT content before injection. Genuine ASS labeled SSA bypasses Seanime's conversion service. Logs the selected source, detected format and payload size to help diagnose renderer failures; this does not claim to resolve an unidentified Seanime renderer error.

## v0.10.0 manual timing and loading feedback

- The tray accepts an exact anime delay in seconds (`1.250`, `-0.250`) or milliseconds (`250ms`), with Apply, Later +100ms, Earlier −100ms and Reset buttons. Positive values show subtitles later. Saves the delay per anime and sub/dub mode, applies it to following episodes and restores it after reload. Limit: ±120 seconds.
- Applies delays from the unshifted SeaSubs content every time, preserving ASS styles/drawings and VTT settings. ASS/SSA uses its native centisecond precision; VTT/SRT timing supports milliseconds. Changes affect only readable SeaSubs tracks, not the original video/audio or Seanime's own delay setting.
- For mixed timing, pause near an affected sign and choose **Adjust one subtitle's timing**. Pick the sign, then move it earlier/later by 0.5 or 1 second; other signs stay unchanged. These individual edits remain in the bounded episode cache for this session and combine with the saved anime delay. They are not saved across reloads. Moving a sign before zero is rejected.
- Shows Seanime's circular spinner beside the find button during searches and selected-track downloads, disables the button while busy, and clears loading on completion/failure.
- Tested saved delays, anime/dub isolation, reset, repeated application, format preservation, individual corrections, stale editors and loading cleanup alongside existing subtitle regressions.

## v0.9.0 provider timing comparison

- Compares readable ASS/SSA and VTT candidate cues with the current provider's original English captions. Prioritizes compared matches among available results and labels timing as matching, adjusted, or unverified.
- Adjusts only individual matching cues, preserving other timestamps, ASS styles/positioning and VTT cue settings. Requires at least three distinct text matches spanning sixty seconds; ignores repeated/short text, drawing commands, differences over five seconds and large duration differences. Does not apply a guessed global delay or extrapolate across different cuts.
- Resolves Seanime's local subtitle proxy URLs to the public target, retaining only Origin, Referer and User-Agent headers under existing network permissions. Provider comparison downloads have a five-second timeout and are cached for the playback session. **Search other subtitle sources** retries the reference.
- Checks selected/generated tracks before injection and discards results if the episode changes. Failed downloads or insufficient matches keep original timing. Provider captions can themselves be mistimed: matching them is not proof of visual synchronization, and SRT-only sources remain unverified.
- Timing checks are covered by mixed early/correct cues, ASS/VTT preservation, ambiguous evidence, proxy headers, blocked references and playback-change regression tests.

## v0.8.0 episode matching and reusable results

- Filters season-batch subtitle attachments by the requested episode, including decimal special episodes. The Tsukigakirei Episode 1 replay checks the poster sign at 5:47 against the actual Episode 1 ASS.
- Keeps search alternatives available after choosing a track, with **Search other subtitle sources** for wider discovery. Selected-track caching is used for automatic playback, rather than replacing manual results.
- Tries derivation from the correct English ASS early, prefers releases advertising subtitle tracks over known MP4/hardsub releases, and removes the ASS byte-order mark.
- Allows the observed `*.broforgotsave.online` Animeya subtitle CDN. Adds regression coverage for the user's real season batch and repeated selections.

## v0.7.4 icon framing

- Uses a padded square PNG of the supplied logo so the marketplace's cropped, rounded frame shows the complete artwork.

## v0.7.2 updated logo

- Replaces the marketplace and tray icon with the supplied Glossy Chat Wave logo.

## v0.7.1 logo and result cursor

- Adds the supplied SeaSubs logo to the extension marketplace metadata and tray button.
- Shows the pointer cursor across SeaSubs subtitle result rows, including newly opened and filtered results.

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

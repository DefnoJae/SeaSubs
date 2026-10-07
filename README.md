# SeaSubs

SeaSubs is a Seanime plugin for finding **external English Forced / Signs & Songs subtitles** when the video/provider you are watching does not include a suitable track.

## v0.1.0

- Detects the currently playing anime title and episode from Seanime playback.
- Searches OpenSubtitles for English subtitle candidates.
- Ranks `foreign_parts_only`, `forced`, and `Signs & Songs` candidates first.
- De-prioritizes SDH/CC-style results when looking for dub companion subtitles.
- Presents results in a Seanime command palette.
- Requests the selected subtitle from OpenSubtitles and loads it with MPV's `sub-add`.
- Shortcut: **Ctrl/Cmd + Shift + S**.

## Setup

Install `Manifest.json` in Seanime and configure your OpenSubtitles.com API key, username and password in the extension settings.

## Current limitation

Direct subtitle injection in v0.1 targets Seanime's MPV-connected playback path. Search/result matching is already separated from loading so a VideoCore/built-in-player loader can be added when a supported subtitle-injection hook is available.

## Roadmap

- Native VideoCore/built-in player injection.
- Better release matching (WEB-DL/BluRay/provider/runtime).
- Subtitle delay controls.
- Remember successful release matches per anime.
- Additional subtitle sources.

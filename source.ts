declare const SeaSubsXZ: { decode(bytes: ArrayLike<number>): string }

type OSResult = {
    id: string
    attributes: {
        language?: string
        release?: string
        hearing_impaired?: boolean
        foreign_parts_only?: boolean
        ratings?: number
        download_count?: number
        files?: Array<{ file_id: number, file_name?: string }>
    }
}

type VttCue = { start: number, end: number, text: string, block: string }

function init() {
    $ui.register((ctx) => {
        // Parse cue blocks, not lines: identifiers/settings/multiline text are significant.
        function parseVtt(input: string): VttCue[] {
            if (!/^\uFEFF?WEBVTT(?:\s|$)/.test(input)) return []
            const cues: VttCue[] = []
            const stamp = (s: string) => s.split(":").reduce((n, p) => n * 60 + Number(p), 0)
            for (const block of input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
                if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue
                const lines = block.split("\n")
                const i = lines.findIndex(l => l.includes("-->"))
                if (i < 0) continue
                const m = lines[i].match(/^((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})(?:\s.*)?$/)
                if (!m) continue
                const start = stamp(m[1]), end = stamp(m[2])
                const text = lines.slice(i + 1).join("\n").trim()
                if (end > start && text && end - start <= 180) cues.push({ start, end, text, block })
            }
            return cues
        }

        function cueText(text: string): string {
            return text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
                .replace(/\s+/g, " ").trim().toLowerCase()
        }

        function cueStats(cues: VttCue[]): { count: number, seconds: number, span: number } {
            const sorted = cues.slice().sort((a, b) => a.start - b.start)
            let seconds = 0, end = 0
            for (const c of sorted) { seconds += Math.max(0, c.end - Math.max(end, c.start)); end = Math.max(end, c.end) }
            return { count: cues.length, seconds: Math.round(seconds), span: Math.round(end) }
        }

        function inferDubCompanion(dub: VttCue[], full: VttCue[]): boolean {
            const d = cueStats(dub), f = cueStats(full)
            // Sparsity alone also describes truncated dialogue. Require a substantial full
            // reference and matching text/timestamps spread across the episode.
            if (d.count < 3 || f.count < 100 || d.count / f.count > 0.3 || d.seconds / f.seconds > 0.3) return false
            const matched = dub.filter(c => full.some(s => cueText(c.text) === cueText(s.text)
                && Math.abs(c.start - s.start) <= 1.5 && Math.abs(c.end - s.end) <= 2))
            return matched.length / dub.length >= 0.85
                && Math.max(...dub.map(c => c.end)) - Math.min(...dub.map(c => c.start)) >= f.span * 0.5
        }

        function deriveVtt(input: string): { content: string, count: number } {
            // VTT has usually lost ASS styles. Only retain explicit semantic classes or
            // musical-note markers; uppercase dialogue and top positioning are not proof.
            const cues = parseVtt(input).filter(c => /<c\.(?:[^>]*\.)?(?:signs?|songs?|lyrics?|karaoke)(?:[.>])/i.test(c.text)
                || /[♪♫]/.test(cueText(c.text)))
            const metadata = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)
                .filter(b => /^(STYLE|REGION)(?:\s|$)/.test(b))
            return { content: ["WEBVTT", ...metadata, ...cues.map(c => c.block)].join("\n\n") + "\n", count: cues.length }
        }

        const API_KEY = "{{apiKey}}"
        const PREFER_FORCED = String("{{preferForced}}") !== "false"
        const API = "https://api.opensubtitles.com/api/v1"
        const UA = "SeaSubs v0.7.4"

        let title = ""
        let episode = 0
        let token = ""
        let baseUrl = API
        let results: OSResult[] = []
        let mediaId = 0
        let dubbed = false
        let searching = false
        let unreadable = 0
        let pendingAuto = false
        let autoAttemptedKey = ""
        let autoCancel: (() => void) | undefined
        let autoScheduledKey = ""
        const cachedTracks: Record<string, AnimeToshoResult> = {}
        const cacheOrder: string[] = []
        const feedCache: Record<string, { time: number, rows: any[] }> = {}
        const seriesKey = () => String(mediaId) + "|" + String(dubbed)
        const episodeKey = () => seriesKey() + "|" + episode
        type FollowPreference = { enabled: boolean, releaseHint: string }
        const preferences: Record<string, FollowPreference> = {}
        const playbackKey = () => String(ctx.videoCore.getCurrentPlaybackInfo()?.id || "") + "|" + seriesKey() + "|" + episode

        function followPreference(): FollowPreference {
            const key = seriesKey()
            if (!preferences[key]) {
                try { preferences[key] = $storage.get<FollowPreference>("follow-" + key) || { enabled: false, releaseHint: "" } }
                catch (_) { preferences[key] = { enabled: false, releaseHint: "" } }
            }
            return preferences[key]
        }

        function savePreference(preference: FollowPreference): void {
            preferences[seriesKey()] = preference
            try { $storage.set("follow-" + seriesKey(), preference) }
            catch (err) { console.log("SeaSubs preference save failed", String(err)) }
            tray.update()
        }

        function cacheTrack(item: AnimeToshoResult): void {
            if (!item.content || item.content.length > 2000000) return
            const key = episodeKey()
            cachedTracks[key] = { ...item, playback: undefined }
            const at = cacheOrder.indexOf(key)
            if (at >= 0) cacheOrder.splice(at, 1)
            cacheOrder.push(key)
            let size = () => cacheOrder.reduce((n, k) => n + (cachedTracks[k]?.content?.length || 0), 0)
            while (cacheOrder.length > 6 || size() > 8000000) delete cachedTracks[cacheOrder.shift()!]
        }

        function rememberChoice(item: AnimeToshoResult): void {
            // Unverified plain captions must never silently become automatic dialogue.
            if (item.score < 500) return
            cacheTrack(item)
            const releaseHint = item.label.match(/\[([^\]]+)\]/)?.[1] || ""
            savePreference({ enabled: true, releaseHint })
            autoAttemptedKey = playbackKey()
        }

        function scheduleAuto(): void {
            syncFromVideoCore()
            const key = playbackKey()
            if (!mediaId || !episode || !followPreference().enabled || autoAttemptedKey === key) return
            if (autoCancel && autoScheduledKey === key) return
            if (autoCancel) autoCancel()
            autoScheduledKey = key
            autoCancel = ctx.setTimeout(() => {
                autoCancel = undefined
                autoScheduledKey = ""
                syncFromVideoCore()
                if (key !== playbackKey() || !followPreference().enabled) return
                if (searching) { pendingAuto = true; return }
                autoAttemptedKey = key
                void search(true)
            }, 500)
        }

        const tray = ctx.newTray({ withContent: true, iconUrl: "https://raw.githubusercontent.com/DefnoJae/SeaSubs/main/marketplace-icon.png" })
        const palette = ctx.newCommandPalette({
            placeholder: "SeaSubs — search Forced / Signs & Songs",
            keyboardShortcut: "mod+shift+s",
        })

        function headers(auth: boolean): Record<string, string> {
            const h: Record<string, string> = {
                "Api-Key": API_KEY,
                "User-Agent": UA,
                "Accept": "application/json",
            }
            if (auth && token) h["Authorization"] = "Bearer " + token
            return h
        }


        function score(item: OSResult): number {
            const a = item.attributes || {}
            const text = ((a.release || "") + " " + (a.files?.[0]?.file_name || "")).toLowerCase()
            let s = Number(a.ratings || 0) * 10
            if (a.foreign_parts_only) s += 1000
            if (/signs?[ ._-]*(and|&)?[ ._-]*songs?|forced|songs?[ ._-]*(and|&)?[ ._-]*signs?/.test(text)) s += 700
            if (/sdh|hearing[ ._-]*impaired|closed[ ._-]*captions?|\bcc\b/.test(text)) s -= 150
            s += Math.min(Number(a.download_count || 0) / 1000, 50)
            return s
        }

        function labelFor(item: OSResult): string {
            const a = item.attributes || {}
            const file = a.files?.[0]?.file_name || a.release || "English subtitle"
            const lower = ((a.release || "") + " " + file).toLowerCase()
            const forced = !!a.foreign_parts_only || /forced|signs?[ ._-]*(and|&)?[ ._-]*songs?/.test(lower)
            return (forced ? "★ " : "") + file
        }

        type AnimeToshoResult = {
            label: string
            url: string
            type: string
            language: string
            score: number
            mode: "direct" | "derive"
            fallbackUrl?: string
            content?: string
            playback?: string
            sourceMode?: string
            automatic?: boolean
        }

        function animeToshoScore(name: string, release: string): number {
            const text = (name + " " + release).toLowerCase()
            let s = 0
            if (/\bsigns?\b|\bsongs?\b|\bforced\b|foreign.?parts/.test(name.toLowerCase())) s += 1000
            if (/\beng(?:lish)?\b/.test(text)) s += 200
            if (/sdh|hearing[ ._-]*impaired|closed[ ._-]*captions?|\bcc\b/.test(text)) s -= 200
            return s
        }

        function collectSubtitleAttachments(torrent: any): any[] {
            const out: any[] = []
            const seen: Record<string, boolean> = {}
            const add = (items: any[]) => {
                for (const attach of (items || [])) {
                    if (attach?.type !== "subtitle") continue
                    const key = String(attach.id || "") + "|" + String(attach.url || "")
                    if (seen[key]) continue
                    seen[key] = true
                    out.push(attach)
                }
            }
            add(torrent?.attachments || [])
            for (const file of (torrent?.files || [])) add(file?.attachments || [])
            return out
        }

        async function searchAnimeToshoHost(host: string, eid: number, expanded = false): Promise<AnimeToshoResult[]> {
            const key = playbackKey()
            const feedUrl = host.indexOf(".xyz") >= 0
                ? "https://feed.animetosho.xyz/feed/json?eid=" + eid
                : "https://feed.animetosho.org/json?eid=" + eid
            const detailBase = host.indexOf(".xyz") >= 0
                ? "https://feed.animetosho.xyz/json?show=torrent&id="
                : "https://feed.animetosho.org/json?show=torrent&id="
            let entries: any[]
            const cachedFeed = feedCache[feedUrl]
            if (cachedFeed && Date.now() - cachedFeed.time < 300000) entries = cachedFeed.rows
            else {
                const feed = await ctx.fetch(feedUrl, { timeout: 8 })
                if (!feed.ok) return []
                entries = feed.json() as any[]
                if (Array.isArray(entries)) {
                    feedCache[feedUrl] = { time: Date.now(), rows: entries }
                    if (Object.keys(feedCache).length > 12) delete feedCache[Object.keys(feedCache)[0]]
                }
            }
            if (key !== playbackKey()) return []
            const candidates = (Array.isArray(entries) ? entries : [])
                .filter((e: any) => !e.status || e.status === "complete")
                .sort((a: any, b: any) => {
                    const hint = followPreference().releaseHint
                    const rank = (e: any) => (hint && String(e.title || "").includes("[" + hint + "]") ? 10 : 0)
                        + (dubbed && /dub|dual|multi.?audio/i.test(String(e.title || "")) ? 3 : 0)
                    return rank(b) - rank(a)
                })
                .slice(0, 12)
            const details = await Promise.all((expanded ? candidates.slice(1) : candidates.slice(0, 1)).map(async (entry: any) => {
                try {
                    const r = await ctx.fetch(detailBase + entry.id, { timeout: 8 })
                    if (!r.ok) return null
                    return { torrent: r.json() as any, entry }
                } catch (_) { return null }
            }))
            const out: AnimeToshoResult[] = []
            for (const item of details) {
                if (!item) continue
                const torrent = item.torrent
                const release = String(torrent?.title || torrent?.torrent_name || item.entry?.title || "")
                for (const attach of collectSubtitleAttachments(torrent)) {
                    const info = attach?.info || {}
                    const lang = String(info.lang || info.language_code || info.language || "").toLowerCase()
                    const name = String(info.name || info.title || info.language || "")
                    const forced = info.forced === true || info.forced === 1
                    const isEnglish = /^(eng|en|english)$/.test(lang) || /english|\beng\b/i.test(lang + " " + name)
                    if (!isEnglish) continue
                    const rawType = String(info.codec || info.format || "ass").toLowerCase()
                    const type = rawType.indexOf("ssa") >= 0 ? "ssa" : rawType.indexOf("srt") >= 0 ? "srt" : rawType.indexOf("vtt") >= 0 ? "vtt" : "ass"
                    const directScore = animeToshoScore(name, release) + (forced ? 1200 : 0)
                    const attachmentId = Number(attach.id || 0)
                    const originalUrl = String(attach.url || (host === "animetosho.org" && attachmentId > 0
                        ? "https://animetosho.org/storage/attach/" + ("00000000" + attachmentId.toString(16)).slice(-8) + "/subtitle." + type + ".xz" : ""))
                    const readable = /\.(?:ass|ssa|srt|vtt|xz)(?:[?#]|$)/i.test(originalUrl)

                    // The original API supplies attachment IDs, not URLs. Download its
                    // ID-based XZ attachment and decode locally rather than using a converter.
                    if (directScore >= 500 && readable) {
                        out.push({
                            label: (forced ? "★ Forced — " : "★ ") + (name || "English Signs & Songs") + " — " + release,
                            url: originalUrl, type, language: "en", score: directScore, mode: "direct",
                        })
                    } else if ((type === "ass" || type === "ssa") && readable) {
                        // ASS preserves styles needed for useful signs/song extraction.
                        out.push({
                            label: "Generate Signs & Songs — " + (name || "English ASS") + " — " + release,
                            url: originalUrl, type, language: "en", score: 100, mode: "derive",
                        })
                    }
                }
            }
            return out
        }

        async function searchAnimeTosho(): Promise<AnimeToshoResult[]> {
            if (!mediaId || !episode) return []
            try {
                const key = playbackKey(), requestedMedia = mediaId, requestedEpisode = episode
                const metadata = await ctx.anime.getAnimeMetadata("anilist", requestedMedia)
                if (key !== playbackKey()) return []
                const epMeta = metadata?.episodes?.[String(requestedEpisode)]
                const eid = Number(epMeta?.anidbId || 0)
                if (!eid) return []
                const sources: AnimeToshoResult[][] = []
                // A fast working source should not wait for a slow alternate host.
                for (const host of ["animetosho.org", "animetosho.xyz"]) {
                    for (const expanded of [false, true]) {
                        if (key !== playbackKey()) return []
                        try {
                            const list = await searchAnimeToshoHost(host, eid, expanded)
                            sources.push(list)
                            const direct = list.filter(i => i.mode === "direct").sort((a, b) => b.score - a.score)
                            for (const item of direct) {
                                const content = await readCandidate(item)
                                if (key !== playbackKey()) return []
                                if (content) {
                                    console.log("SeaSubs fast Signs match", { source: item.label, events: (content.match(/^Dialogue\s*:/gm) || []).length })
                                    return [{ ...item, content }]
                                }
                            }
                        } catch (err) { console.log("SeaSubs AnimeTosho host failed", host, String(err)) }
                    }
                }
                const seen: Record<string, boolean> = {}
                const out: AnimeToshoResult[] = []
                for (const list of sources) {
                    for (const item of list) {
                        const key = item.url + "|" + item.label
                        if (seen[key]) continue
                        seen[key] = true
                        out.push(item)
                    }
                }
                out.sort((a, b) => {
                    if (a.mode !== b.mode) return a.mode === "direct" ? -1 : 1
                    return b.score - a.score
                })
                return out
            } catch (err) {
                console.log("SeaSubs AnimeTosho search failed", err)
                return []
            }
        }

        function injectExternal(src: string, label: string, language: string, type: string): void {
            ctx.videoCore.addExternalSubtitleTrack({ src, label: "SeaSubs — " + label, language, type: type as "ass" | "ssa" | "vtt" | "srt", default: true })
            ctx.videoCore.showMessage("SeaSubs loaded: " + label, 2500)
            ctx.toast.success("SeaSubs: external subtitle added to the player.")
            palette.close()
        }

        async function readCandidate(item: AnimeToshoResult): Promise<string> {
            if (item.content) return item.content
            if (typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) {
                console.log("SeaSubs subtitle skipped", { source: item.label, reason: "No readable subtitle URL/content" })
                return ""
            }
            try {
                const r = await ctx.fetch(item.url, { timeout: 15,
                    headers: { "Referer": "https://vidnest.fun/", "User-Agent": "Mozilla/5.0" } })
                if (!r.ok) throw new Error("HTTP " + r.status)
                const text = /\.xz(?:[?#]|$)/i.test(item.url) ? SeaSubsXZ.decode((r as any).body) : r.text()
                const isSrt = item.type === "srt" && /^\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/m.test(text)
                if (text.length > 2000000 || (!parseVtt(text).length && !/\[Events\]/i.test(text) && !isSrt)) throw new Error("Not readable subtitle content")
                return text
            } catch (err) {
                unreadable++
                console.log("SeaSubs subtitle unreadable", { source: item.label, error: String(err) })
                return ""
            }
        }

        async function inspectCandidates(items: AnimeToshoResult[]): Promise<AnimeToshoResult[]> {
            const inspected = await Promise.all(items.slice(0, 16).map(async item => ({ ...item, content: await readCandidate(item) })))
            const references = inspected.filter(i => i.sourceMode === "sub" && parseVtt(i.content || "").length >= 100)
            const out: AnimeToshoResult[] = []
            for (const item of inspected) {
                const cues = parseVtt(item.content || "")
                if (cues.length) console.log("SeaSubs subtitle content", { source: item.label, ...cueStats(cues) })
                if (item.score >= 3000) { out.push(item); continue }
                if (dubbed && item.sourceMode === "dub") {
                    const inferred = references.some(r => inferDubCompanion(cues, parseVtt(r.content || "")))
                    out.push({ ...item, score: inferred ? 2500 : 10,
                        label: item.label + (inferred ? " — likely Signs & Songs (content compared)" : " — preview dub captions (unverified)") })
                }
                if (!item.content) continue
                if (cues.length) {
                    const derived = deriveVtt(item.content)
                    if (derived.count) out.push({ ...item, content: derived.content, type: "vtt", score: 2000,
                        label: "Generated explicit signs/song cues — " + item.label + " (" + derived.count + " cues)" })
                } else if (item.type === "ass" || item.type === "ssa") {
                    const derived = deriveSignsSongsAss(item.content)
                    if (derived.count) out.push({ ...item, content: derived.content, score: 2000,
                        label: "Generated Signs & Songs — " + item.label + " (" + derived.count + " events)" })
                }
            }
            return out.sort((a, b) => b.score - a.score)
        }

        async function currentCandidates(): Promise<AnimeToshoResult[]> {
            const tracks = ctx.videoCore.getCurrentPlaybackInfo()?.subtitleTracks || []
            const items: AnimeToshoResult[] = []
            for (const t of tracks) {
                if (/^SeaSubs/.test(t.label || "")) continue
                if (!/^(en|eng|english)(?:[-_]|$)/i.test(t.language || "") && !/english|\beng\b/i.test(t.label || "")) continue
                // Native Goja structs may expose *string wrappers rather than JS
                // primitives. Modern playback uses uri/sourceUrl/format fields.
                const raw = t as any
                const value = (v: any) => v == null ? "" : String(v)
                const url = value(raw.src) || value(raw.uri) || value(raw.sourceUrl)
                const content = value(raw.content)
                if (!url && !content) {
                    console.log("SeaSubs current track skipped", { label: value(raw.label), reason: "No URL/content exposed" })
                    continue
                }
                items.push({ url, content, type: value(raw.type) || value(raw.format) || "vtt", language: "en", mode: "direct",
                    label: "Current provider — " + (t.label || "English"), sourceMode: dubbed ? "dub" : "sub",
                    score: /forced|signs?|songs?/i.test(t.label || "") ? 3000 : 0 })
            }
            return await inspectCandidates(items)
        }

        async function loadCandidate(item: AnimeToshoResult): Promise<void> {
            syncFromVideoCore()
            if (item.playback !== playbackKey()) { ctx.toast.warning("SeaSubs: episode changed; search again."); return }
            if (item.automatic && !followPreference().enabled) return
            if (item.mode === "derive") { void deriveAndInject(item); return }
            if (/\.xz(?:[?#]|$)/i.test(item.url) && !item.content) {
                item.content = await readCandidate(item)
                syncFromVideoCore()
                if (item.playback !== playbackKey()) return
                if (item.automatic && !followPreference().enabled) return
                if (!item.content) { ctx.toast.error("SeaSubs: compressed subtitle could not be read; see log."); return }
            }
            if (item.content) {
                ctx.videoCore.addExternalSubtitleTrack({ content: item.content, label: "SeaSubs — " + item.label,
                    language: item.language, type: item.type as "vtt" | "ass" | "ssa" | "srt", default: true })
                ctx.toast.success("SeaSubs: subtitle track added.")
                palette.close()
            } else injectExternal(item.url, item.label, item.language, item.type)
            rememberChoice(item)
        }

        function showCandidates(items: AnimeToshoResult[], key: string, automatic = false): void {
            if (key !== playbackKey()) return
            if (automatic) {
                const safe = items.find(i => i.score >= 500 && i.mode === "direct" && !!i.content)
                if (safe) { void loadCandidate({ ...safe, playback: key, automatic: true }).catch(err => console.log("SeaSubs auto load failed", String(err))); return }
                const derive = items.find(i => i.mode === "derive")
                if (derive && followPreference().enabled) { void deriveAndInject({ ...derive, playback: key, automatic: true }).catch(err => console.log("SeaSubs auto derive failed", String(err))); return }
                ctx.toast.warning("SeaSubs: no verified signs track for this episode; use Find external subtitles to choose a fallback.")
                return
            }
            palette.setItems(items.slice(0, 25).map((item, i) => ({ label: item.label, value: String(i),
                heading: i === 0 ? "Subtitle tracks — unverified captions may contain dialogue" : undefined,
                onSelect: () => { void loadCandidate({ ...item, playback: key }).catch(err => { console.log("SeaSubs load failed", String(err)); ctx.toast.error("SeaSubs: subtitle load failed.") }) } })))
            palette.open()
        }

        function splitAssFields(payload: string, count: number): string[] {
            const out: string[] = []
            let start = 0
            for (let i = 0; i < count - 1; i++) {
                const p = payload.indexOf(",", start)
                if (p < 0) {
                    out.push(payload.slice(start))
                    while (out.length < count) out.push("")
                    return out
                }
                out.push(payload.slice(start, p))
                start = p + 1
            }
            out.push(payload.slice(start))
            return out
        }

        function stripAssTags(text: string): string {
            return text
                .replace(/\{[^}]*\}/g, "")
                .replace(/\\N|\\n/g, " ")
                .replace(/\\h/g, " ")
                .trim()
        }

        function looksLikeSignsOrSongs(style: string, name: string, effect: string, text: string): boolean {
            const meta = (style + " " + name + " " + effect).toLowerCase()
            if (/signs?|songs?|lyrics?|karaoke|opening|ending|\bop\b|\bed\b|insert|typeset|screen|title|note/.test(meta)) return true
            if (/\\k(?:f|o)?\d+/i.test(text)) return true

            // Some releases use a generic style for on-screen text but position/typeset it heavily.
            const plain = stripAssTags(text)
            const positioned = /\\(?:pos|move)\s*\(/i.test(text)
            const typeset = /\\(?:fn|fs|bord|shad|frx|fry|frz|fax|fay|c&H|1c&H|3c&H)/i.test(text)
            if (positioned && typeset && plain.length > 0 && plain.length <= 100) return true
            return false
        }

        function deriveSignsSongsAss(input: string): { content: string, count: number } {
            const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
            const lines = normalized.split("\n")
            let inEvents = false
            let eventFormat: string[] = []
            let kept = 0
            const output: string[] = []

            for (const line of lines) {
                const trimmed = line.trim()
                if (/^\[Events\]$/i.test(trimmed)) {
                    inEvents = true
                    output.push(line)
                    continue
                }
                if (/^\[[^\]]+\]$/.test(trimmed) && !/^\[Events\]$/i.test(trimmed)) {
                    inEvents = false
                    output.push(line)
                    continue
                }
                if (!inEvents) {
                    output.push(line)
                    continue
                }
                if (/^Format\s*:/i.test(trimmed)) {
                    eventFormat = trimmed.slice(trimmed.indexOf(":") + 1).split(",").map(x => x.trim().toLowerCase())
                    output.push(line)
                    continue
                }
                if (/^Comment\s*:/i.test(trimmed)) continue
                if (!/^Dialogue\s*:/i.test(trimmed)) {
                    output.push(line)
                    continue
                }

                const colon = line.indexOf(":")
                const kind = line.slice(0, colon + 1)
                const payload = line.slice(colon + 1)
                const format = eventFormat.length ? eventFormat : ["layer","start","end","style","name","marginl","marginr","marginv","effect","text"]
                const fields = splitAssFields(payload, format.length)
                const get = (key: string) => {
                    const i = format.indexOf(key)
                    return i >= 0 ? String(fields[i] || "") : ""
                }
                if (looksLikeSignsOrSongs(get("style"), get("name"), get("effect"), get("text"))) {
                    output.push(kind + fields.join(","))
                    kept++
                }
            }
            return { content: output.join("\r\n"), count: kept }
        }

        async function fetchSubtitleText(item: AnimeToshoResult): Promise<string> {
            const text = await readCandidate(item)
            return /\[Script Info\]/i.test(text) && /\[Events\]/i.test(text) ? text : ""
        }

        async function deriveAndInject(item: AnimeToshoResult): Promise<void> {
            ctx.toast.info("SeaSubs: generating a Signs & Songs track…")
            const full = await fetchSubtitleText(item)
            syncFromVideoCore()
            if (item.playback && item.playback !== playbackKey()) { ctx.toast.warning("SeaSubs: episode changed; search again."); return }
            if (item.automatic && !followPreference().enabled) return
            if (!full) {
                ctx.toast.error("SeaSubs: couldn't read this ASS/SSA subtitle as text.")
                return
            }
            const derived = deriveSignsSongsAss(full)
            if (!derived.count) {
                ctx.toast.warning("SeaSubs: this full subtitle had no recognizable Signs / Songs events.")
                return
            }
            ctx.videoCore.addExternalSubtitleTrack({
                content: derived.content,
                label: "SeaSubs — Generated Signs & Songs (" + derived.count + " events)",
                language: "en",
                type: item.type === "ssa" ? "ssa" : "ass",
                default: true,
            })
            ctx.videoCore.showMessage("SeaSubs generated Signs & Songs", 2500)
            ctx.toast.success("SeaSubs: generated " + derived.count + " Signs / Songs events.")
            palette.close()
            rememberChoice({ ...item, mode: "direct", content: derived.content, score: 2000,
                label: "Generated Signs & Songs — " + item.label })
        }

        async function animeyaRpc(method: string, input: any): Promise<any> {
            const url = "https://animeya.cc/api/trpc/" + method + "?input=" + encodeURIComponent(JSON.stringify({ json: input }))
            const r = await ctx.fetch(url, {
                headers: { "Referer": "https://animeya.cc/", "User-Agent": "Mozilla/5.0" },
                timeout: 20,
            })
            if (!r.ok) {
                let detail = ""
                try { detail = String(r.text() || "").slice(0, 300) } catch (_) {}
                throw new Error("Animeya HTTP " + r.status + (detail ? ": " + detail : ""))
            }
            const body = r.json() as any
            if (body?.error) throw new Error(body.error?.json?.message || body.error?.message || "Animeya API error")
            return body?.result?.data?.json
        }

        function animeyaDecodeCipher(body: any): any {
            if (!body?.encrypted) return body
            if (typeof body.data !== "string") throw new Error("Animeya encrypted response changed")
            const alphabet = "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/="
            const bytes: number[] = []
            for (let i = 0; i < body.data.length; i += 4) {
                const a = alphabet.indexOf(body.data[i]), b = alphabet.indexOf(body.data[i + 1])
                const cc = alphabet.indexOf(body.data[i + 2]), d = alphabet.indexOf(body.data[i + 3])
                if (a < 0 || b < 0 || cc < 0 || d < 0) throw new Error("Invalid Animeya encoding")
                bytes.push((a << 2) | (b >> 4))
                if (cc !== 64) bytes.push(((b & 15) << 4) | (cc >> 2))
                if (d !== 64) bytes.push(((cc & 3) << 6) | d)
            }
            const text = decodeURIComponent(bytes.map(b => "%" + ("0" + b.toString(16)).slice(-2)).join(""))
            return JSON.parse(text)
        }

        function absoluteUrl(url: string, base: string): string {
            if (!url) return ""
            if (/^https?:\/\//i.test(url)) return url
            if (url.startsWith("//")) return "https:" + url
            const origin = base.match(/^https?:\/\/[^/]+/i)?.[0] || ""
            if (url.startsWith("/")) return origin + url
            return base.slice(0, base.lastIndexOf("/") + 1) + url
        }

        async function searchAnimeyaForced(): Promise<AnimeToshoResult[]> {
            if (!mediaId || !episode) return []
            try {
                const search = await animeyaRpc("media.getMediasWithPaginationAndFilters", {
                    page: 1,
                    pageSize: 50,
                    skipInitialData: true,
                    filters: { search: title, type: "ANIME" },
                    // Keep this in sync with the working Animeya provider.
                    // The API rejects unsupported projection keys such as "sub"/"dub".
                    keys: ["id", "idAnilist", "slug", "title", "coverImage", "description", "episodes", "format", "seasonYear", "status"],
                })
                const media = (search?.medias || []).find((x: any) => Number(x?.idAnilist) === mediaId)
                if (!media?.slug) return []

                let episodeId = 0
                for (let page = 1; page <= 5 && !episodeId; page++) {
                    const eps = await animeyaRpc("episode.getAllEpisodesByMediaSlugWithPagination", {
                        slug: media.slug, page, pageSize: 100,
                    })
                    for (const ep of (eps?.eps || [])) {
                        if (Number(ep?.episodeNumber) === episode) {
                            episodeId = Number(ep.id)
                            break
                        }
                    }
                    if (page * 100 >= Number(eps?.epsCount || 0)) break
                }
                if (!episodeId) return []

                const full = await animeyaRpc("episode.getEpisodeFullById", episodeId)
                // SeaSubs only needs the subtitle track, not Animeya's video.
                // When the current Seanime stream is dubbed we must still inspect Animeya's
                // softsub players, because Signs & Songs tracks often live there rather than
                // on the dub player itself.
                const players = (full?.players || [])
                    .filter((p: any) => p?.langue === "ENG" && p?.subType !== "HARD")
                    .sort((a: any, b: any) => {
                        const rank = (p: any) => {
                            const ai = /\bAI\b|auto.?translated|machine/i.test(String(p?.name || "") + " " + String(p?.subType || ""))
                            if (ai) return 9
                            if (dubbed && p?.subType === "NONE") return 0
                            if (p?.subType === "SOFT") return 1
                            if (!dubbed && p?.subType !== "NONE") return 2
                            return 3
                        }
                        return rank(a) - rank(b)
                    })

                const found: AnimeToshoResult[] = []
                const seen: Record<string, boolean> = {}
                for (const player of players.slice(0, 10)) {
                    const match = String(player?.url || "").match(/^https:\/\/vidnest\.fun\/(anime|animepahe)\/(\d+)\/(\d+)\/(sub|dub)(?:[/?#]|$)/i)
                    if (!match) continue
                    for (const backend of ["anitaku", "aniwave", "megaplay"]) {
                        try {
                            const route = backend === "anitaku" ? "hianime/anime/" : backend === "aniwave" ? "aniwave_hls/" : "animehub/"
                            const suffix = backend === "anitaku" ? "/hd-2" : ""
                            const api = "https://new.vidnest.fun/" + route + match[2] + "/" + match[3] + "/" + match[4] + suffix
                            const rr = await ctx.fetch(api, {
                                headers: { "Referer": String(player.url), "User-Agent": "Mozilla/5.0" },
                                timeout: 20,
                            })
                            if (!rr.ok) continue
                            const data = animeyaDecodeCipher(rr.json() as any)
                            const tracks = ([] as any[]).concat(data?.subtitles || [], data?.tracks || [])
                            for (const source of (data?.sources || data?.multiSrc || [])) {
                                tracks.push(...(source?.subtitles || []), ...(source?.tracks || []))
                            }
                            if (tracks.length) {
                                console.log("SeaSubs Animeya tracks", {
                                    backend,
                                    player: String(player?.name || ""),
                                    subType: String(player?.subType || ""),
                                    mode: match[4],
                                    labels: tracks.map((t: any) => String(t?.label || t?.language || t?.lang || t?.name || t?.title || "unlabelled")),
                                })
                            }
                            for (const track of tracks) {
                                if (track?.kind && !["captions", "subtitles"].includes(track.kind)) continue
                                const label = String(track?.label || track?.language || track?.lang || track?.name || track?.title || "")
                                const forcedFlag = track?.forced === true || track?.forced === 1 || String(track?.forced || "").toLowerCase() === "true"
                                const forced = forcedFlag || /forced|signs?|songs?|foreign.?parts/i.test(label)
                                const english = /english|\beng\b|^en(?:[-_]|$)/i.test(label) || !label
                                if (!english) continue
                                const url = absoluteUrl(String(track?.url || track?.file || ""), String(player.url))
                                if (!url || !/^https:\/\//i.test(url)) continue
                                const key = url + "|" + match[4]
                                if (seen[key]) continue
                                seen[key] = true
                                const type = /\.ass(?:[?#]|$)/i.test(url) ? "ass" : /\.ssa(?:[?#]|$)/i.test(url) ? "ssa" : /\.srt(?:[?#]|$)/i.test(url) ? "srt" : "vtt"
                                found.push({
                                    label: (forced ? "★ " : "") + "Animeya " + match[4] + " — " + (label || "English"),
                                    url, type, language: "en", score: forced ? 3000 : 0, mode: "direct", sourceMode: match[4],
                                })
                            }
                        } catch (err) { console.log("SeaSubs Vidnest failed", backend, String(err)) }
                    }
                }
                return await inspectCandidates(found)
            } catch (err) {
                console.log("SeaSubs Animeya fallback failed", err)
                return []
            }
        }

        async function search(automatic = false): Promise<void> {
            if (searching) return
            searching = true
            unreadable = 0
            try { await runSearch(automatic) }
            catch (err) { console.log("SeaSubs search failed", String(err)); ctx.toast.error("SeaSubs: search failed; see log.") }
            finally {
                searching = false
                if (pendingAuto) { pendingAuto = false; scheduleAuto() }
            }
        }

        async function runSearch(automatic = false): Promise<void> {
            syncFromVideoCore()
            if (!title || !episode) {
                ctx.toast.warning("SeaSubs: start an episode first so I know what to search for.")
                return
            }
            ctx.toast.info("SeaSubs: searching Signs & Songs for " + title + " E" + episode + "…")
            const key = playbackKey()
            if (automatic && !followPreference().enabled) return
            const cached = cachedTracks[episodeKey()]
            if (cached) {
                showCandidates([cached], key, automatic)
                return
            }

            const animeTosho = await searchAnimeTosho()
            syncFromVideoCore()
            if (key !== playbackKey()) return
            if (animeTosho.some(i => i.content && i.mode === "direct")) {
                showCandidates(animeTosho, key, automatic)
                return
            }
            const sources = await Promise.all([currentCandidates(), searchAnimeyaForced()])
            syncFromVideoCore()
            if (key !== playbackKey()) return
            const candidates = sources[0].concat(sources[1]).sort((a, b) => b.score - a.score)
            if (candidates.some(i => i.score >= 2000)) {
                showCandidates(candidates, key, automatic)
                return
            }
            if (animeTosho.length) {
                const direct = animeTosho.filter(x => x.mode === "direct")
                const derived = animeTosho.filter(x => x.mode === "derive")
                const loaded: AnimeToshoResult[] = await Promise.all(direct.slice(0, 4).map(async item => ({ ...item, content: await readCandidate(item) })))
                syncFromVideoCore()
                if (key !== playbackKey()) return
                const verified = loaded.filter(i => !!i.content)
                for (const item of verified) console.log("SeaSubs AnimeTosho content", { source: item.label,
                    events: (item.content?.match(/^Dialogue\s*:/gm) || []).length, ...cueStats(parseVtt(item.content || "")) })
                const choices = verified.concat(derived.slice(0, 8))
                if (!choices.length && !candidates.length) {
                    ctx.toast.warning("SeaSubs: matching subtitles were found but could not be read; see log.")
                    return
                }
                showCandidates(choices.concat(candidates), key, automatic)
                return
            }
            if (candidates.length) {
                ctx.toast.warning("SeaSubs: no verified Signs & Songs; dub captions are available to preview." + (unreadable ? " Some subtitle files could not be inspected (see log)." : ""))
                showCandidates(candidates, key, automatic)
                return
            }
            if (!API_KEY || automatic) {
                ctx.toast.warning("SeaSubs: no verified Signs & Songs found." + (unreadable ? " Some subtitle files could not be inspected (see log)." : ""))
                return
            }
            ctx.toast.info("SeaSubs: trying OpenSubtitles fallback…")
            const q = encodeURIComponent(title)
            const url = API + "/subtitles?languages=en&query=" + q + "&episode_number=" + episode + "&order_by=download_count&order_direction=desc"
            const r = await ctx.fetch(url, { headers: headers(false) })
            syncFromVideoCore()
            if (key !== playbackKey()) return
            if (!r.ok) {
                ctx.toast.error("SeaSubs: search failed (" + r.status + ").")
                return
            }
            const data = r.json() as any
            results = (data.data || []) as OSResult[]
            results.sort((a, b) => score(b) - score(a))
            if (PREFER_FORCED) {
                const preferred = results.filter(x => score(x) >= 600)
                if (preferred.length) results = preferred.concat(results.filter(x => score(x) < 600))
            }
            if (!results.length) {
                ctx.toast.warning("SeaSubs: no English subtitles found for this episode.")
                return
            }
            palette.setItems(results.slice(0, 25).map((item, index) => ({
                label: labelFor(item),
                value: String(index),
                heading: index === 0 ? "Best matches" : undefined,
                onSelect: () => { if (key === playbackKey()) void loadSubtitle(item, key) },
            })))
            palette.open()
        }

        async function loadSubtitle(item: OSResult, key: string): Promise<void> {
            const fileId = item.attributes?.files?.[0]?.file_id
            if (!fileId) {
                ctx.toast.error("SeaSubs: this result has no downloadable subtitle file.")
                return
            }
            const r = await ctx.fetch(baseUrl + "/download", {
                method: "POST",
                headers: { ...headers(false), "Content-Type": "application/json" },
                body: JSON.stringify({ file_id: fileId }),
            })
            if (!r.ok) {
                ctx.toast.error("SeaSubs: subtitle download failed (" + r.status + ").")
                return
            }
            const data = r.json() as any
            syncFromVideoCore()
            if (key !== playbackKey()) return
            const link = data.link as string
            if (!link) {
                ctx.toast.error("SeaSubs: OpenSubtitles did not return a download link.")
                return
            }
            const label = "SeaSubs — " + labelFor(item)
            const type = /\.ass(?:\?|$)/i.test(link) ? "ass" : /\.ssa(?:\?|$)/i.test(link) ? "ssa" : /\.vtt(?:\?|$)/i.test(link) ? "vtt" : "srt"

            // Seanime v3.x VideoCore supports external subtitle injection for the
            // built-in/torrent/online player. This makes the new track appear in
            // the player's normal subtitle selector.
            const playerType = ctx.videoCore.getCurrentPlayerType()
            if (playerType) {
                ctx.videoCore.addExternalSubtitleTrack({
                    src: link,
                    label,
                    language: "en",
                    type,
                    default: true,
                })
                ctx.videoCore.showMessage("SeaSubs loaded: " + labelFor(item), 2500)
                ctx.toast.success("SeaSubs: external subtitle added to the player.")
                palette.close()
                return
            }

            // Fallback for classic MPV-connected playback.
            const conn = ctx.mpv.getConnection()
            if (conn && !conn.isClosed()) {
                conn.call("sub-add", link, "select", label, "eng")
                ctx.toast.success("SeaSubs: external subtitle loaded.")
                palette.close()
                return
            }

            ctx.toast.warning("SeaSubs found the subtitle, but no compatible active player was detected.")
        }

        function syncFromVideoCore(): void {
            const info = ctx.videoCore.getCurrentPlaybackInfo()
            const media = ctx.videoCore.getCurrentMedia()
            mediaId = 0
            title = ""
            episode = 0
            dubbed = Boolean(info?.onlinestreamParams?.dubbed)
            if (media?.id) mediaId = Number(media.id)
            if (media?.title?.userPreferred) title = media.title.userPreferred
            else if (media?.title?.english) title = media.title.english
            else if (media?.title?.romaji) title = media.title.romaji

            if (info?.onlinestreamParams?.episodeNumber) {
                episode = Number(info.onlinestreamParams.episodeNumber)
            } else if (info?.episode?.episodeNumber) {
                episode = Number(info.episode.episodeNumber)
            } else {
                const playlist = ctx.videoCore.getPlaybackState()?.playbackInfo?.episode
                if (playlist?.episodeNumber) episode = Number(playlist.episodeNumber)
            }
            tray.update()
        }

        ctx.videoCore.addEventListener("video-loaded", () => scheduleAuto())
        ctx.videoCore.addEventListener("video-playback-state", () => scheduleAuto())
        ctx.videoCore.addEventListener("video-playlist", (event) => {
            const ep = event?.playlist?.currentEpisode?.episodeNumber
            if (ep) episode = Number(ep)
            syncFromVideoCore()
            scheduleAuto()
        })

        ctx.playback.registerEventListener((event) => {
            if (event?.state?.mediaTitle) title = event.state.mediaTitle
            if (event?.state?.episodeNumber) episode = event.state.episodeNumber
            tray.update()
        })

        ctx.dom.onReady(() => {
            scheduleAuto()
            // The palette is portaled and its rows are recreated when results change.
            // Scope the observer to our input so other Seanime palettes keep their styles.
            ctx.dom.observe('[cmdk-root]:has(input[placeholder="SeaSubs — search Forced / Signs & Songs"]) [cmdk-item]', rows => {
                for (const row of rows) {
                    // Styling triggers another DOM observation; avoid a feedback loop.
                    if (!/(?:^|;)\s*cursor:\s*pointer\s*(?:;|$)/.test(row.attributes.style || "")) row.setStyle("cursor", "pointer")
                }
            })
        })
        ctx.screen.onNavigate(() => syncFromVideoCore())
        ctx.screen.loadCurrent()

        ctx.registerEventHandler("seasubs-search", () => { void search() })
        ctx.registerEventHandler("seasubs-follow", () => {
            syncFromVideoCore()
            if (!mediaId || !episode) return
            const preference = followPreference()
            savePreference({ ...preference, enabled: !preference.enabled })
            autoAttemptedKey = ""
            if (preference.enabled && autoCancel) { autoCancel(); autoCancel = undefined; autoScheduledKey = "" }
            if (!preference.enabled) scheduleAuto()
        })

        tray.render(() => tray.stack([
            tray.text("SeaSubs"),
            tray.text("External Forced / Signs & Songs subtitle fallback."),
            tray.text(title && episode ? title + " — Episode " + episode : "Start an episode, then search."),
            tray.button("Find external subtitles", { onClick: "seasubs-search", intent: "primary" }),
            tray.text(followPreference().enabled ? "Automatic Signs & Songs is on for this anime." : "Choose a signs track to continue automatically on the next episode."),
            tray.button(followPreference().enabled ? "Pause automatic subtitles" : "Enable automatic subtitles", { onClick: "seasubs-follow" }),
            tray.text("Shortcut: Ctrl/Cmd + Shift + S"),
        ]))
    })
}

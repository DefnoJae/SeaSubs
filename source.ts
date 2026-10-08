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

        type TimingCue = { start: number, end: number, text: string, line: number, fields?: string[], startIndex?: number, endIndex?: number }
        function timingCues(content: string, includeDrawings = false): TimingCue[] {
            const vtt = parseVtt(content)
            if (vtt.length) return vtt.map((c, i) => ({ ...c, line: i }))
            const out: TimingCue[] = []
            let events = false, format: string[] = []
            content.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((line, index) => {
                if (/^\[/.test(line)) { events = /^\[Events\]/i.test(line); return }
                if (!events) return
                if (/^Format:/i.test(line)) { format = line.slice(line.indexOf(":") + 1).split(",").map(s => s.trim().toLowerCase()); return }
                if (!/^Dialogue:/i.test(line) || !format.length) return
                const fields = splitAssFields(line.slice(line.indexOf(":") + 1), format.length)
                const startIndex = format.indexOf("start"), endIndex = format.indexOf("end"), textIndex = format.indexOf("text")
                if (startIndex < 0 || endIndex < 0 || textIndex < 0) return
                const stamp = (s: string) => s.trim().split(":").reduce((n, v) => n * 60 + Number(v), 0)
                const start = stamp(fields[startIndex]), end = stamp(fields[endIndex])
                if (Number.isFinite(start) && end > start && (includeDrawings || !/\\p[1-9]/.test(fields[textIndex]))) out.push({ start, end, text: stripAssTags(fields[textIndex]), line: index, fields, startIndex, endIndex })
            })
            return out
        }

        function compareTiming(content: string, reference: string): { content: string, matched: number, adjusted: number } {
            const cues = timingCues(content), refs = timingCues(reference)
            const normalize = (s: string) => cueText(stripAssTags(s)).replace(/[^a-z0-9\u0080-\uffff]+/g, " ").trim()
            const index: Record<string, TimingCue[]> = Object.create(null)
            for (const cue of refs) {
                const text = normalize(cue.text)
                if (text.length < 8) continue // Short repeated titles are ambiguous.
                const matches = index[text] || (index[text] = [])
                if (!matches.some(c => Math.abs(c.start - cue.start) < 0.05 && Math.abs(c.end - cue.end) < 0.05)) matches.push(cue)
            }
            const matches = cues.map(c => ({ cue: c, refs: index[normalize(c.text)] || [] }))
                .filter(m => m.refs.length === 1 && Math.abs(m.cue.start - m.refs[0].start) <= 5
                    && Math.abs(m.cue.end - m.refs[0].end) <= 5
                    && Math.abs((m.cue.end - m.cue.start) - (m.refs[0].end - m.refs[0].start)) <= 2)
            // A lone sign cannot establish alignment; require matches across the episode.
            const distinct: Record<string, boolean> = {}
            for (const m of matches) distinct[normalize(m.cue.text)] = true
            if (Object.keys(distinct).length < 3 || Math.max(...matches.map(m => m.cue.start)) - Math.min(...matches.map(m => m.cue.start)) < 60) return { content, matched: 0, adjusted: 0 }
            const replacements: Record<number, TimingCue> = {}
            for (const m of matches) if (Math.abs(m.cue.start - m.refs[0].start) > 0.1 || Math.abs(m.cue.end - m.refs[0].end) > 0.1) replacements[m.cue.line] = m.refs[0]
            const adjusted = Object.keys(replacements).length
            if (!adjusted) return { content, matched: matches.length, adjusted: 0 }
            const stamp = (s: number, ass: boolean) => {
                const units = ass ? 100 : 1000, ticks = Math.round(s * units)
                const sec = Math.floor(ticks / units), h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60
                return (ass ? String(h) : ("0" + h).slice(-2)) + ":" + ("0" + m).slice(-2) + ":" + ("0" + sec % 60).slice(-2) + "." + (String(ticks % units).padStart(ass ? 2 : 3, "0"))
            }
            if (parseVtt(content).length) {
                const parsed = parseVtt(content)
                let cueIndex = 0
                const blocks = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(block => {
                    if (!parsed.some(c => c.block === block)) return block
                    const ref = replacements[cueIndex++]
                    return ref ? block.replace(/((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})/, stamp(ref.start, false) + " --> " + stamp(ref.end, false)) : block
                })
                return { content: blocks.join("\n\n"), matched: matches.length, adjusted }
            }
            const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/)
            for (const cue of cues) {
                const ref = replacements[cue.line]
                if (!ref || !cue.fields) continue
                const fields = cue.fields.slice()
                fields[cue.startIndex!] = stamp(ref.start, true); fields[cue.endIndex!] = stamp(ref.end, true)
                lines[cue.line] = "Dialogue:" + fields.join(",")
            }
            return { content: lines.join("\r\n"), matched: matches.length, adjusted }
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
        const UA = "SeaSubs v0.13.0"

        let title = ""
        let episode = 0
        let token = ""
        let baseUrl = API
        let results: OSResult[] = []
        let mediaId = 0
        let dubbed = false
        let searching = false
        let searchStatus = ""
        let statusPlayback = ""
        let loadingTracks = 0
        let unreadable = 0
        let pendingAuto = false
        let autoAttemptedKey = ""
        let autoCancel: (() => void) | undefined
        let autoScheduledKey = ""
        const cachedTracks: Record<string, AnimeToshoResult> = {}
        let activeSubtitle: AnimeToshoResult | undefined
        let originalSelection: { key:string, subtitle:number, caption:number } | undefined
        let selectionRequest: { key:string, subtitle?:number, caption?:number, finish:()=>void } | undefined
        async function captureOriginalSelection(key: string): Promise<void> {
            if (originalSelection?.key === key) return
            await new Promise<void>(resolve => {
                const finish = () => {
                    if (selectionRequest?.key !== key) return
                    const request = selectionRequest
                    selectionRequest = undefined
                    if (key === playbackKey()) originalSelection = { key, subtitle:request.subtitle ?? -1, caption:request.caption ?? -1 }
                    resolve()
                }
                selectionRequest = { key,finish }
                ctx.setTimeout(finish,1200)
                ctx.videoCore.sendGetSubtitleTrack()
                ctx.videoCore.sendGetMediaCaptionTrack()
            })
        }
        function restoreOriginalSubtitles(): void {
            syncFromVideoCore()
            if (searching || loadingTracks) return
            const key = playbackKey(), previous = originalSelection
            if (previous?.key !== key || activeSubtitle?.playback !== key) return
            savePreference({ ...followPreference(), enabled:false })
            if (autoCancel) { autoCancel(); autoCancel = undefined }
            autoScheduledKey = ""
            autoAttemptedKey = ""
            pendingAuto = false
            ctx.videoCore.setSubtitleTrack(previous.subtitle)
            ctx.videoCore.setMediaCaptionTrack(previous.caption)
            activeSubtitle = undefined
            delete cachedTracks[episodeKey()]
            originalSelection = undefined
            searchStatus = "Original subtitle selection restored · automatic loading paused."
            tray.update()
            ctx.toast.success("SeaSubs: restored original subtitles and paused automatic loading.")
        }
        const animeDelays: Record<string, number> = {}
        const delayField = ctx.fieldRef("0.000")
        const sliderField = ctx.fieldRef("0.000")
        const followField = ctx.fieldRef(false)
        let delayFieldAnime = ""
        function animeDelay(): number {
            const key = seriesKey()
            if (animeDelays[key] === undefined) {
                let saved = 0
                try { saved = Number($storage.get<number>("timing-delay-" + key) || 0) } catch (_) { }
                animeDelays[key] = Number.isFinite(saved) && Math.abs(saved) <= 120000 ? Math.round(saved) : 0
            }
            return animeDelays[key]
        }
        function parseDelay(value: string): number | undefined {
            const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(ms|s|seconds?|milliseconds?)?$/i)
            if (!match) return undefined
            const milliseconds = Math.round(Number(match[1]) * (/^(ms|milliseconds?)$/i.test(match[2] || "") ? 1 : 1000))
            return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 120000 ? milliseconds : undefined
        }
        function offsetTrack(content: string, milliseconds: number): string {
            if (!milliseconds) return content
            const delta = milliseconds / 1000
            const stamp = (s: number, ass: boolean) => {
                const units = ass ? 100 : 1000, ticks = Math.max(0,Math.round(s * units)), whole = Math.floor(ticks / units)
                return (ass ? String(Math.floor(whole / 3600)) : String(Math.floor(whole / 3600)).padStart(2,"0")) + ":" + String(Math.floor(whole / 60) % 60).padStart(2,"0") + ":" + String(whole % 60).padStart(2,"0") + "." + String(ticks % units).padStart(ass ? 2 : 3,"0")
            }
            const vtt = parseVtt(content)
            if (vtt.length) {
                const replacements: Record<string,string> = Object.create(null)
                for (const cue of vtt) replacements[cue.block] = cue.end + delta <= 0 ? "" : cue.block.replace(/((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})/,stamp(cue.start + delta,false)+" --> "+stamp(cue.end + delta,false))
                return content.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").split(/\n\s*\n/).map(b => replacements[b] === undefined ? b : replacements[b]).filter(Boolean).join("\n\n")
            }
            const cues = timingCues(content,true), lines = content.replace(/^\uFEFF/,"").split(/\r?\n/)
            for (const cue of cues) {
                if (cue.end + delta <= 0) { lines[cue.line] = ""; continue }
                const fields = cue.fields!.slice()
                fields[cue.startIndex!] = stamp(cue.start + delta,true); fields[cue.endIndex!] = stamp(cue.end + delta,true)
                lines[cue.line] = "Dialogue:" + fields.join(",")
            }
            if (cues.length) return lines.join("\r\n")
            // Plain SRT keeps its numbering/text; adjust only timing lines.
            const seconds = (s: string) => s.replace(",",".").split(":").reduce((n,p) => n*60+Number(p),0)
            return content.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").split(/\n\s*\n/).map(block => {
                const match = block.match(/^(\d{2,}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2},\d{3})(.*)$/m)
                if (!match) return block
                if (seconds(match[2]) + delta <= 0) return ""
                return block.replace(match[0],stamp(seconds(match[1])+delta,false).replace(".",",")+" --> "+stamp(seconds(match[2])+delta,false).replace(".",",")+match[3])
            }).filter(Boolean).join("\n\n")
        }
        function emitSubtitle(item: AnimeToshoResult): void {
            const delay = animeDelay()
            const content = offsetTrack(item.content!,delay).replace(/^\uFEFF/,"")
            // Metadata sometimes says SSA/VTT for an actual ASS file. Sending the
            // real format avoids routing ASS through Seanime's conversion service.
            const type = /^WEBVTT(?:\s|$)/.test(content) ? "vtt"
                : /^\[V4\+ Styles\]\s*$/mi.test(content) && /^\[Events\]\s*$/mi.test(content) ? "ass" : item.type
            console.log("SeaSubs subtitle injection", { source:item.label,declaredType:item.type,type,characters:content.length,delayMs:delay })
            ctx.videoCore.addExternalSubtitleTrack({ content,
                label: "SeaSubs — " + item.label + (delay ? " (delay " + (delay > 0 ? "+" : "") + (delay/1000).toFixed(3) + "s)" : ""),
                language: item.language, type: type as "vtt" | "ass" | "ssa" | "srt", default: true })
        }
        function applyAnimeDelay(milliseconds: number, quiet = false): void {
            syncFromVideoCore()
            if (!mediaId || !episode) { ctx.toast.warning("SeaSubs: start an episode first."); return }
            animeDelays[seriesKey()] = milliseconds
            try { $storage.set("timing-delay-" + seriesKey(),milliseconds) } catch (err) { console.log("SeaSubs delay save failed",String(err)) }
            delayField.setValue((milliseconds/1000).toFixed(3))
            sliderField.setValue((milliseconds/1000).toFixed(3))
            if (activeSubtitle?.content && activeSubtitle.playback === playbackKey()) emitSubtitle(activeSubtitle)
            tray.update()
            if (!quiet) ctx.toast.success("SeaSubs: saved delay for this anime: " + (milliseconds/1000).toFixed(3) + "s.")
        }
        const resultLists: Record<string, AnimeToshoResult[]> = {}
        const cacheOrder: string[] = []
        const feedCache: Record<string, { time: number, rows: any[] }> = {}
        const subtitleReads: Record<string, { time: number, size: number, promise: Promise<string> }> = Object.create(null)
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
            followField.setValue(preference.enabled)
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

        const tray = ctx.newTray({ withContent: true, width: "32rem", iconUrl: "https://raw.githubusercontent.com/DefnoJae/SeaSubs/main/marketplace-icon.png" })
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
            timingMatched?: number
            timingKey?: string
            fetchHeaders?: Record<string, string>
            fetchTimeout?: number
            manualTiming?: boolean
        }

        let timingReferenceKey = "", timingReference: Promise<string> | undefined
        function unwrapProviderUrl(url: string): { url: string, headers: Record<string, string> } {
            const headers: Record<string, string> = {}
            if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/api\/v1\/proxy\?/i.test(url)) return { url, headers }
            const params: Record<string, string> = {}
            for (const part of url.slice(url.indexOf("?") + 1).split("&")) {
                const at = part.indexOf("=")
                if (at < 0) continue
                try { params[part.slice(0, at)] = decodeURIComponent(part.slice(at + 1).replace(/\+/g, " ")) } catch (_) { }
            }
            // Fetch the public subtitle target under the existing domain permissions.
            if (!/^https:\/\//i.test(params.url || "")) return { url, headers }
            try {
                const supplied = JSON.parse(params.headers || "{}")
                for (const name of Object.keys(supplied)) if (/^(origin|referer|user-agent)$/i.test(name) && typeof supplied[name] === "string") headers[name] = supplied[name]
            } catch (_) { }
            return { url: params.url, headers }
        }

        async function providerTimingReference(): Promise<string> {
            const tracks = ctx.videoCore.getCurrentPlaybackInfo()?.subtitleTracks || []
            const english = tracks.filter(t => !/^SeaSubs/.test(String(t.label || ""))
                && (/^(en|eng|english)(?:[-_]|$)/i.test(String(t.language || "")) || /english|\beng\b/i.test(String(t.label || ""))))
            const key = playbackKey() + "|" + english.map(t => String((t as any).uri || (t as any).src || (t as any).sourceUrl || (t as any).content || "")).join("|")
            if (key === timingReferenceKey && timingReference) return await timingReference
            timingReferenceKey = key
            timingReference = (async () => {
                for (const track of english.slice(0, 2)) {
                    const raw = track as any
                    const target = unwrapProviderUrl(String(raw.uri || raw.src || raw.sourceUrl || ""))
                    const content = await readCandidate({ label: "Provider timing reference", url: target.url,
                        fetchHeaders: target.headers, fetchTimeout: 5, content: raw.content == null ? "" : String(raw.content), type: String(raw.format || raw.type || "vtt"), language: "en", score: 0, mode: "direct" })
                    if (timingCues(content).length >= 3) return content
                }
                return ""
            })()
            return await timingReference
        }

        async function prepareTiming(item: AnimeToshoResult): Promise<AnimeToshoResult> {
            if (item.manualTiming) return item
            if (!item.content || item.mode === "derive") return item
            const key = playbackKey()
            if (item.timingKey === key) return item
            const reference = await providerTimingReference()
            if (key !== playbackKey()) return item
            const result = reference ? compareTiming(item.content, reference) : { content: item.content, matched: 0, adjusted: 0 }
            console.log("SeaSubs timing comparison", { source: item.label, matched: result.matched, adjusted: result.adjusted, referenceAvailable: !!reference })
            return { ...item, content: result.content, timingKey: key, timingMatched: result.matched,
                label: item.label.replace(/ — timing (?:matches provider|adjusted to provider|unverified)$/, "")
                    + (result.matched ? result.adjusted ? " — timing adjusted to provider" : " — timing matches provider" : " — timing unverified") }
        }

        async function rankTiming(items: AnimeToshoResult[]): Promise<AnimeToshoResult[]> {
            const out: AnimeToshoResult[] = []
            for (const item of items) out.push(await prepareTiming(item))
            return out.sort((a, b) => (b.timingMatched || 0) - (a.timingMatched || 0) || b.score - a.score)
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
            const files = torrent?.files || []
            // Batch file order is arbitrary. Never take another episode's subtitles.
            if (files.length <= 1) add(torrent?.attachments || [])
            for (const file of files) {
                const filename = String(file.filename || file.name || "").split(/[\\/]/).pop() || ""
                const match = filename.match(/(?:\s-\s|\bEpisode\s+|\bE)(\d{1,3}(?:\.\d+)?)(?:v\d+)?(?=[\s[._-]|$)/i)
                if (match && Number(match[1]) !== episode) continue
                if (files.length > 1 && !match) continue
                add(file?.attachments || [])
            }
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
                        + (/multiple.?subtitles?/i.test(String(e.title || "")) ? 2 : 0)
                        - (/\.mp4\b/i.test(String(e.title || "")) || (/\[RH\]/.test(String(e.title || "")) && /dubbed/i.test(String(e.title || ""))) ? 5 : 0)
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

        async function searchAnimeTosho(wider = false): Promise<AnimeToshoResult[]> {
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
                            for (const item of (wider ? [] : direct)) {
                                const content = await readCandidate(item)
                                if (key !== playbackKey()) return []
                                if (content) {
                                    console.log("SeaSubs fast Signs match", { source: item.label, events: (content.match(/^Dialogue\s*:/gm) || []).length })
                                    return [{ ...item, content }]
                                }
                            }
                            if (!wider) for (const item of list.filter(i => i.mode === "derive").slice(0, 2)) {
                                const full = await readCandidate(item)
                                if (key !== playbackKey()) return []
                                if (!full) continue
                                const derived = deriveSignsSongsAss(full)
                                if (derived.count) return [{ ...item, mode: "direct", content: derived.content, score: 2000,
                                    label: item.label.replace(/^Generate Signs & Songs/, "Generated Signs & Songs") + " (" + derived.count + " events)" }]
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
            activeSubtitle = undefined
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
            const cacheKey = item.url + "|" + item.type + "|" + JSON.stringify(item.fetchHeaders || {})
            const existing = subtitleReads[cacheKey]
            if (existing && Date.now() - existing.time < (existing.size ? 300000 : 15000)) return await existing.promise
            const entry = { time: Date.now(), size: 0, promise: Promise.resolve("") }
            subtitleReads[cacheKey] = entry
            entry.promise = fetchCandidate(item).then(content => {
                entry.time = Date.now()
                entry.size = content.length
                const keys = Object.keys(subtitleReads)
                let size = keys.reduce((n,key) => n + subtitleReads[key].size,0)
                while (keys.length > 12 || size > 8000000) {
                    const oldest = keys.shift()!
                    size -= subtitleReads[oldest].size
                    delete subtitleReads[oldest]
                }
                return content
            })
            return await entry.promise
        }
        async function fetchCandidate(item: AnimeToshoResult): Promise<string> {
            try {
                const r = await ctx.fetch(item.url, { timeout: item.fetchTimeout || 8,
                    headers: { "Referer": "https://vidnest.fun/", "User-Agent": "Mozilla/5.0", ...item.fetchHeaders } })
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
                if (!item.content) continue
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
                const target = unwrapProviderUrl(value(raw.src) || value(raw.uri) || value(raw.sourceUrl))
                const url = target.url
                const content = value(raw.content)
                if (!url && !content) {
                    console.log("SeaSubs current track skipped", { label: value(raw.label), reason: "No URL/content exposed" })
                    continue
                }
                items.push({ url, content, fetchHeaders: target.headers, type: value(raw.type) || value(raw.format) || "vtt", language: "en", mode: "direct",
                    label: "Current provider — " + (t.label || "English"), sourceMode: dubbed ? "dub" : "sub",
                    score: /forced|signs?|songs?/i.test(t.label || "") ? 3000 : 0 })
            }
            return await inspectCandidates(items)
        }

        async function loadCandidate(item: AnimeToshoResult): Promise<void> {
            loadingTracks++
            searchStatus = "Downloading and preparing subtitle…"
            tray.update()
            try { await loadCandidateImpl(item) }
            finally { loadingTracks--; tray.update() }
        }
        async function loadCandidateImpl(item: AnimeToshoResult): Promise<void> {
            syncFromVideoCore()
            if (item.playback !== playbackKey()) { ctx.toast.warning("SeaSubs: episode changed; search again."); return }
            if (item.automatic && !followPreference().enabled) return
            if (item.mode === "derive") { await deriveAndInject(item); return }
            if (!item.content) {
                item.content = await readCandidate(item)
                syncFromVideoCore()
                if (item.playback !== playbackKey()) return
                if (item.automatic && !followPreference().enabled) return
                if (!item.content) { searchStatus = "Could not read this track. Choose another subtitle."; ctx.toast.error("SeaSubs: this subtitle could not be downloaded or read. Choose another source; details are in the log."); return }
            }
            if (item.content) {
                item = await prepareTiming(item)
                syncFromVideoCore()
                if (item.playback !== playbackKey() || (item.automatic && !followPreference().enabled)) return
                await captureOriginalSelection(item.playback)
                if (item.playback !== playbackKey() || (item.automatic && !followPreference().enabled)) return
                emitSubtitle(item)
                activeSubtitle = { ...item }
                const cues = item.type === "srt" ? (item.content.match(/\d{2}:\d{2}:\d{2},\d{3}\s+-->/g) || []).length : timingCues(item.content).length
                searchStatus = "Sent to player · " + cues + " cues" + (item.timingMatched ? " · timing compared" : " · timing unverified")
                // Toasts can sit behind Seanime's open tray. Dismiss only after
                // an explicit selection has been injected, never during auto-follow.
                if (!item.automatic) tray.close()
                ctx.toast.success("SeaSubs: subtitle track added.")
                palette.close()
            }
            rememberChoice(item)
        }

        function shiftSign(content: string, selected: TimingCue, seconds: number): { content: string, changed: number } {
            const cues = timingCues(content)
            const matches = cues.filter(c => cueText(c.text) === cueText(selected.text)
                && Math.abs(c.start - selected.start) < 0.05 && Math.abs(c.end - selected.end) < 0.05)
            if (!matches.length || selected.start + seconds < 0) return { content, changed: 0 }
            const stamp = (s: number, ass: boolean) => {
                const units = ass ? 100 : 1000, ticks = Math.round(s * units), whole = Math.floor(ticks / units)
                return (ass ? String(Math.floor(whole / 3600)) : String(Math.floor(whole / 3600)).padStart(2,"0")) + ":"
                    + String(Math.floor(whole / 60) % 60).padStart(2,"0") + ":" + String(whole % 60).padStart(2,"0") + "." + String(ticks % units).padStart(ass ? 2 : 3,"0")
            }
            const vtt = parseVtt(content)
            if (vtt.length) {
                const indexes = matches.map(c => c.line)
                const replacements: Record<string, string> = Object.create(null)
                for (const i of indexes) replacements[vtt[i].block] = vtt[i].block.replace(/((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})/,
                    stamp(vtt[i].start + seconds,false) + " --> " + stamp(vtt[i].end + seconds,false))
                return { content: content.replace(/^\uFEFF/, "").replace(/\r\n?/g,"\n").split(/\n\s*\n/).map(b => replacements[b] || b).join("\n\n"), changed: matches.length }
            }
            const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/)
            for (const cue of matches) {
                const fields = cue.fields!.slice()
                fields[cue.startIndex!] = stamp(cue.start + seconds,true)
                fields[cue.endIndex!] = stamp(cue.end + seconds,true)
                lines[cue.line] = "Dialogue:" + fields.join(",")
            }
            return { content: lines.join("\r\n"), changed: matches.length }
        }

        function openSignTiming(): void {
            syncFromVideoCore()
            const item = activeSubtitle, key = playbackKey()
            if (!item?.content || item.playback !== key) { ctx.toast.warning("SeaSubs: load a SeaSubs track for this episode first."); return }
            const time = ctx.videoCore.getPlaybackStatus()?.currentTime
            if (time == null || !Number.isFinite(Number(time))) { ctx.toast.warning("SeaSubs: player position is unavailable. Pause the video and try again."); return }
            const seen: Record<string, boolean> = Object.create(null)
            const baselineTime = Number(time) - animeDelay()/1000
            const nearby = timingCues(item.content).filter(c => c.start <= baselineTime + 8 && c.end >= baselineTime - 8)
                .filter(c => { const id = c.start + "|" + c.end + "|" + cueText(c.text); if (seen[id]) return false; seen[id] = true; return true })
                .sort((a,b) => Math.abs(a.start - Number(time)) - Math.abs(b.start - Number(time))).slice(0,20)
            if (!nearby.length) { ctx.toast.warning("SeaSubs: no editable subtitle near this position. Pause near the early sign and try again."); return }
            palette.setItems(nearby.map((cue,index) => ({ label: cue.text.replace(/\s+/g," ").slice(0,140) + " — " + (cue.start+animeDelay()/1000).toFixed(2) + "s",
                value: "sign-" + index, heading: index === 0 ? "Choose the sign to adjust" : undefined,
                onSelect: () => {
                    if (key !== playbackKey() || activeSubtitle !== item) return
                    palette.setItems([-1,-0.5,0.5,1].map(seconds => ({ label: (seconds > 0 ? "Show later by " : "Show earlier by ") + Math.abs(seconds) + " seconds",
                        value: String(seconds), onSelect: () => {
                            syncFromVideoCore()
                            if (key !== playbackKey() || activeSubtitle !== item) { ctx.toast.warning("SeaSubs: track or episode changed; choose the sign again."); return }
                            const shifted = shiftSign(item.content!,cue,seconds)
                            if (!shifted.changed) { ctx.toast.warning("SeaSubs: that adjustment would start before the video."); return }
                            const edited = { ...item, content: shifted.content, manualTiming: true,
                                label: item.label.replace(/ — timing (?:matches provider|adjusted to provider|unverified|edited)$/, "") + " — timing edited" }
                            emitSubtitle(edited)
                            activeSubtitle = edited
                            cacheTrack(edited)
                            const list = resultLists[episodeKey()]
                            const sourceLabel = (label: string) => label.replace(/ — timing (?:matches provider|adjusted to provider|unverified|edited)$/, "")
                                .replace(/ \(\d+ events\)$/, "").replace(/^Generate Signs & Songs/, "Generated Signs & Songs")
                            if (list) resultLists[episodeKey()] = list.map(i => i.url === item.url && sourceLabel(i.label) === sourceLabel(item.label) ? edited : i)
                            console.log("SeaSubs sign timing edited", { start:cue.start,end:cue.end,seconds,events:shifted.changed })
                            ctx.toast.success("SeaSubs: moved only the selected sign. Pause and repeat to adjust further.")
                            palette.close()
                        } })))
                } })))
            palette.open()
        }

        function cacheResults(items: AnimeToshoResult[]): void {
                resultLists[episodeKey()] = items.slice(0, 25)
                if (Object.keys(resultLists).length > 6) delete resultLists[Object.keys(resultLists)[0]]
                const keys = Object.keys(resultLists)
                let size = keys.reduce((n, k) => n + resultLists[k].reduce((m, i) => m + (i.content?.length || 0), 0), 0)
                for (const older of keys) {
                    if (size <= 8000000) break
                    size -= resultLists[older].reduce((n, i) => n + (i.content?.length || 0), 0)
                    delete resultLists[older]
                }
        }
        async function presentSearchResults(items: AnimeToshoResult[], key: string, automatic = false, wider = false): Promise<void> {
            if (key !== playbackKey()) return
            if (!automatic) cacheResults(items)
            if (!wider) {
                const remembered = cachedTracks[episodeKey()]
                const safe = (!automatic && remembered?.content ? remembered : undefined)
                    || items.find(i => i.score >= 500 && i.mode === "direct" && !!i.content)
                if (safe) { palette.close(); await loadCandidate({ ...safe, playback:key, automatic }); return }
                if (automatic) {
                    const derive = items.find(i => i.mode === "derive")
                    if (derive && followPreference().enabled) { await loadCandidate({...derive,playback:key,automatic:true}); return }
                }
            }
            if (!automatic) ctx.toast.info("SeaSubs: choose a result to load it; the search is complete.")
            showCandidates(items,key,automatic)
        }
        function chooseAnotherSubtitle(): void {
            syncFromVideoCore()
            const items = resultLists[episodeKey()]
            if (!items?.length) { void search(false,true); return }
            ctx.toast.info("SeaSubs: choose an alternative subtitle track.")
            showCandidates(items,playbackKey())
        }
        function showCandidates(items: AnimeToshoResult[], key: string, automatic = false): void {
            if (key !== playbackKey()) return
            if (!automatic) cacheResults(items)
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
                onSelect: () => { if (key !== playbackKey()) return; palette.close(); void loadCandidate({ ...item, playback: key }).catch(err => { console.log("SeaSubs load failed", String(err)); ctx.toast.error("SeaSubs: subtitle load failed.") }) } })).concat([{
                    label: "Search other subtitle sources", value: "search-more", heading: "More options",
                    onSelect: () => { if (key === playbackKey()) void search(false, true) },
                }]))
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
            const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
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
            await loadCandidate({ ...item, playback: item.playback || playbackKey(), mode: "direct", content: derived.content, score: 2000,
                label: item.label.replace(/^Generate Signs & Songs/, "Generated Signs & Songs") + " (" + derived.count + " events)" })
        }

        async function animeyaRpc(method: string, input: any): Promise<any> {
            const url = "https://animeya.cc/api/trpc/" + method + "?input=" + encodeURIComponent(JSON.stringify({ json: input }))
            const r = await ctx.fetch(url, {
                headers: { "Referer": "https://animeya.cc/", "User-Agent": "Mozilla/5.0" },
                timeout: 8,
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
                                timeout: 6,
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

        async function search(automatic = false, wider = false): Promise<void> {
            if (searching) return
            if (wider) timingReference = undefined
            if (wider) for (const key of Object.keys(subtitleReads)) if (!subtitleReads[key].size) delete subtitleReads[key]
            searching = true
            searchStatus = "Searching subtitle sources…"
            tray.update()
            unreadable = 0
            try { await runSearch(automatic, wider) }
            catch (err) { searchStatus = "Search failed. Try again or choose another source."; console.log("SeaSubs search failed", String(err)); ctx.toast.error("SeaSubs: search failed; see log.") }
            finally {
                searching = false
                if (searchStatus === "Searching subtitle sources…") searchStatus = "Search complete. Choose a result if available."
                tray.update()
                if (pendingAuto) { pendingAuto = false; scheduleAuto() }
            }
        }

        async function runSearch(automatic = false, wider = false): Promise<void> {
            syncFromVideoCore()
            if (!title || !episode) {
                ctx.toast.warning("SeaSubs: start an episode first so I know what to search for.")
                return
            }
            ctx.toast.info("SeaSubs: searching Signs & Songs for " + title + " E" + episode + "…")
            const key = playbackKey()
            if (automatic && !followPreference().enabled) return
            const cached = cachedTracks[episodeKey()]
            const previous = resultLists[episodeKey()]
            if (!automatic && !wider && previous) { await presentSearchResults(previous,key); return }
            if (automatic && cached) {
                await presentSearchResults([cached], key, automatic)
                return
            }

            const animeTosho = await searchAnimeTosho(wider)
            syncFromVideoCore()
            if (key !== playbackKey()) return
            if (animeTosho.some(i => i.content && i.mode === "direct")) {
                await presentSearchResults(await rankTiming(animeTosho), key, automatic, wider)
                return
            }
            const sources = await Promise.all([currentCandidates(), searchAnimeyaForced()])
            syncFromVideoCore()
            if (key !== playbackKey()) return
            const candidates = sources[0].concat(sources[1]).sort((a, b) => b.score - a.score)
            if (candidates.some(i => i.score >= 2000)) {
                await presentSearchResults(await rankTiming(candidates), key, automatic, wider)
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
                await presentSearchResults(await rankTiming(choices.concat(candidates)), key, automatic, wider)
                return
            }
            if (candidates.length) {
                ctx.toast.warning("SeaSubs: no verified Signs & Songs; dub captions are available to preview." + (unreadable ? " Some subtitle files could not be inspected (see log)." : ""))
                await presentSearchResults(candidates, key, automatic, wider)
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
                onSelect: () => { if (key === playbackKey()) { palette.close(); void loadSubtitle(item, key) } },
            })))
            palette.open()
        }

        async function loadSubtitle(item: OSResult, key: string): Promise<void> {
            loadingTracks++
            tray.update()
            try { await loadSubtitleImpl(item,key) }
            finally { loadingTracks--; tray.update() }
        }
        async function loadSubtitleImpl(item: OSResult, key: string): Promise<void> {
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
                await loadCandidate({url:link,label:labelFor(item),language:"en",type,score:0,mode:"direct",playback:key})
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
            if (media?.title?.userPreferred) title = String(media.title.userPreferred)
            else if (media?.title?.english) title = String(media.title.english)
            else if (media?.title?.romaji) title = String(media.title.romaji)

            if (info?.onlinestreamParams?.episodeNumber) {
                episode = Number(info.onlinestreamParams.episodeNumber)
            } else if (info?.episode?.episodeNumber) {
                episode = Number(info.episode.episodeNumber)
            } else {
                const playlist = ctx.videoCore.getPlaybackState()?.playbackInfo?.episode
                if (playlist?.episodeNumber) episode = Number(playlist.episodeNumber)
            }
            if (delayFieldAnime !== seriesKey()) {
                delayFieldAnime = seriesKey()
                delayField.setValue((animeDelay()/1000).toFixed(3))
                sliderField.setValue((animeDelay()/1000).toFixed(3))
                followField.setValue(followPreference().enabled)
            }
            if (statusPlayback !== playbackKey()) { statusPlayback = playbackKey(); searchStatus = "" }
            tray.update()
        }

        ctx.videoCore.addEventListener("video-loaded", () => scheduleAuto())
        ctx.videoCore.addEventListener("video-subtitle-track", event => {
            const request = selectionRequest
            if (!request || request.key !== playbackKey()) return
            if (event.playbackId && String(event.playbackId) !== String(ctx.videoCore.getCurrentPlaybackInfo()?.id || "")) return
            request.subtitle = Number(event.trackNumber)
            if (request.caption !== undefined) request.finish()
        })
        ctx.videoCore.addEventListener("video-media-caption-track", event => {
            const request = selectionRequest
            if (!request || request.key !== playbackKey()) return
            if (event.playbackId && String(event.playbackId) !== String(ctx.videoCore.getCurrentPlaybackInfo()?.id || "")) return
            request.caption = Number(event.trackIndex)
            if (request.subtitle !== undefined) request.finish()
        })
        ctx.videoCore.addEventListener("video-playback-state", () => scheduleAuto())
        ctx.videoCore.addEventListener("video-playlist", (event) => {
            const ep = event?.playlist?.currentEpisode?.episodeNumber
            if (ep) episode = Number(ep)
            syncFromVideoCore()
            scheduleAuto()
        })

        ctx.playback.registerEventListener((event) => {
            if (event?.state?.mediaTitle) title = String(event.state.mediaTitle)
            if (event?.state?.episodeNumber) episode = event.state.episodeNumber
            tray.update()
        })

        ctx.dom.onReady(() => {
            scheduleAuto()
            // Seanime has no slider primitive. Keep its native input, field-ref and
            // debounced change bridge; only adapt this scoped input's HTML type.
            ctx.dom.observe('.ss-slider input', inputs => {
                for (const input of inputs) {
                    const limit = Math.min(120,Math.max(5, Math.ceil(Math.abs(animeDelay()/1000) + 1)))
                    const attrs: Record<string,string> = { min: String(-limit), max: String(limit), step: "0.1", type: "range", "aria-label": "Subtitle delay in seconds" }
                    let adapted = false
                    for (const name of Object.keys(attrs)) {
                        if (input.attributes[name] !== attrs[name]) { input.setAttribute(name,attrs[name]); adapted = true }
                    }
                    // Expanding a range after an exact value update must restore
                    // the thumb, since browsers can clamp to the previous bounds.
                    if (adapted) input.setProperty("value",String(animeDelay()/1000))
                }
            })
            ctx.dom.observe('.ss-delay input', inputs => {
                for (const input of inputs) {
                    if (input.attributes["aria-label"] !== "Subtitle delay; seconds or milliseconds") input.setAttribute("aria-label","Subtitle delay; seconds or milliseconds")
                }
            })
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
        ctx.registerEventHandler("seasubs-choose", () => chooseAnotherSubtitle())
        ctx.registerEventHandler("seasubs-restore", () => restoreOriginalSubtitles())
        ctx.registerEventHandler("seasubs-sign-timing", () => openSignTiming())
        ctx.registerEventHandler("seasubs-delay-apply", () => {
            syncFromVideoCore()
            const value = parseDelay(String(delayField.current))
            if (value === undefined) { ctx.toast.warning("SeaSubs: enter seconds, such as 1.250 or -0.250, or milliseconds, such as 250ms (maximum ±120s)."); return }
            applyAnimeDelay(value)
        })
        ctx.registerEventHandler("seasubs-delay-plus", () => { syncFromVideoCore(); applyAnimeDelay(Math.min(120000,animeDelay()+100)) })
        ctx.registerEventHandler("seasubs-delay-minus", () => { syncFromVideoCore(); applyAnimeDelay(Math.max(-120000,animeDelay()-100)) })
        ctx.registerEventHandler("seasubs-delay-reset", () => applyAnimeDelay(0))
        // Native inputs already debounce their changes by 200ms. Compare against
        // saved state so programmatic synchronization cannot reinject in a loop.
        for (const field of [delayField, sliderField]) field.onValueChange(value => {
            const milliseconds = parseDelay(String(value))
            if (milliseconds !== undefined && milliseconds !== animeDelay()) applyAnimeDelay(milliseconds,true)
            else if (milliseconds === undefined) tray.update()
        })
        ctx.registerEventHandler("seasubs-follow", () => {
            syncFromVideoCore()
            if (!mediaId || !episode) return
            const preference = followPreference()
            savePreference({ ...preference, enabled: !preference.enabled })
            autoAttemptedKey = ""
            if (preference.enabled && autoCancel) { autoCancel(); autoCancel = undefined; autoScheduledKey = "" }
            if (!preference.enabled) scheduleAuto()
        })
        followField.onValueChange(enabled => {
            if (enabled !== followPreference().enabled) {
                syncFromVideoCore()
                if (!mediaId || !episode) return
                savePreference({ ...followPreference(), enabled })
                autoAttemptedKey = ""
                if (autoCancel) { autoCancel(); autoCancel = undefined; autoScheduledKey = "" }
                if (enabled) scheduleAuto()
            }
        })

        // Native images can display these small inline vector icons.
        function icon(name: string): string {
            const paths: Record<string,string> = {
                search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
                clock:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M12 2v3"/>',
                sign:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
                settings:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
                chevron:'<path d="m9 5 7 7-7 7"/>',
            }
            return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e8eaff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+paths[name]+'</svg>')
        }
        const panelCSS = `
            .ss-panel {padding:12px;display:flex;flex-direction:column;gap:9px;background:radial-gradient(ellipse at 100% 0%,#13203b55,transparent 40%),#080c14;color:#f4f5ff;border:1px solid #293551;border-radius:20px;box-shadow:0 16px 50px #0006;font-family:inherit}
            .ss-panel p {margin:0;width:auto;word-break:normal}
            .ss-header {display:flex;align-items:center;gap:12px;min-height:66px;position:relative;overflow:hidden;padding:2px 4px 7px}
            .ss-header::after {content:"";position:absolute;width:180px;height:100px;right:-40px;top:-50px;border-radius:48%;border:14px solid #5446ed28;box-shadow:0 0 0 13px #188bef18,0 0 0 28px #6444bd15;transform:rotate(-25deg);pointer-events:none}
            .ss-logo {width:56px;height:56px;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 4px 12px #4736ff33)}
            .ss-title {font-size:28px;font-weight:750;letter-spacing:-.8px;line-height:1.15;background:linear-gradient(110deg,#f8fbff,#a7cfff);background-clip:text;color:transparent}
            .ss-sub {font-size:11px;line-height:1.45;color:#a8b5d0;margin-top:4px!important}
            .ss-card {background:linear-gradient(135deg,#111827aa,#0c111b);border:1px solid #2a3559;border-radius:16px;padding:12px;box-shadow:inset 0 1px 0 #ffffff04}
            .ss-anime {display:flex;align-items:center;gap:12px;padding:9px 11px}
            .ss-cover {width:80px;height:49px;object-fit:cover;border-radius:10px;flex-shrink:0;background:#151c32}
            .ss-anime-copy {min-width:0;flex:1}
            .ss-anime-title {font-size:16px;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .ss-episode {font-size:12px;color:#b1bdd4;display:flex;align-items:center;gap:8px;margin-top:5px}
            .ss-format {font-size:10px;color:#bcafff;padding:2px 9px;background:#22243c;border:1px solid #383953;border-radius:20px;line-height:1.4}
            .ss-panel button {cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s;border:1px solid #37446b;border-radius:11px;background:linear-gradient(135deg,#202a42,#161c2e);color:#f5f5ff;font-weight:600}
            .ss-panel button:hover:not(:disabled) {border-color:#8270ea;background:#282845;box-shadow:0 0 15px #6441ff19}
            .ss-panel button:focus-visible,.ss-panel input:focus-visible {outline:2px solid #a394ff;outline-offset:3px}
            .ss-panel button:disabled {cursor:default;opacity:.55}
            .ss-panel .ss-find {width:100%;min-height:76px;justify-content:flex-start;position:relative;padding:13px 37px 32px 59px;border-radius:16px;border-color:#9b88ff;font-size:19px;line-height:1.25;background:radial-gradient(ellipse at 100% 0%,#b47aff80,transparent 52%),linear-gradient(115deg,#4930f4,#293eed 60%,#753eff);box-shadow:0 5px 22px #492aff25;white-space:normal;text-align:left}
            .ss-find::before {content:"";position:absolute;left:17px;top:24px;width:26px;height:26px;background:url("${icon("search")}") center/contain no-repeat}
            .ss-find::after {content:"Search for Forced / Signs & Songs subtitles";position:absolute;left:59px;bottom:13px;font-size:11px;font-weight:400;color:#d1d6ff}
            .ss-panel .ss-find:hover:not(:disabled) {filter:brightness(1.1);border-color:#c1afff}
            .ss-find.ss-busy::before {display:none}
            .ss-alternatives {align-self:flex-end;font-size:11px!important;min-height:25px!important;padding:3px 11px!important;margin-top:-4px;background:transparent!important;border-color:transparent!important;color:#b8b3df!important}
            .ss-timing-head {display:flex;align-items:center;gap:9px;margin-bottom:9px}
            .ss-icon {width:24px;height:24px;flex-shrink:0}
            .ss-heading {font-size:14px;font-weight:650;line-height:1.3}
            .ss-description {font-size:11px;color:#9daccc;line-height:1.4;margin-top:3px!important}
            .ss-grow {flex:1;min-width:0}
            .ss-delay {width:85px;flex-shrink:0;position:relative}
            .ss-delay input {width:100%;height:32px!important;background:#211738!important;border:1px solid #6949e9!important;border-radius:20px!important;padding:4px 19px 4px 7px!important;text-align:right;font-size:15px!important;color:#c5afff!important;font-variant-numeric:tabular-nums}
            .ss-delay::after {content:"s";position:absolute;right:9px;top:6px;color:#c5afff;font-size:15px;pointer-events:none}
            .ss-slider-row {display:flex;align-items:center;gap:12px}
            .ss-panel .ss-step {width:36px;height:34px;font-size:25px;padding:0;flex-shrink:0}
            .ss-slider {flex:1;min-width:0}
            .ss-slider input {width:100%;height:7px!important;padding:0!important;border:1px solid #4d4b84!important;border-radius:20px;appearance:none;background:linear-gradient(90deg,#1e2c42,#31214e)!important;cursor:pointer;accent-color:#9668ff}
            .ss-slider input::-webkit-slider-thumb {appearance:none;width:20px;height:20px;border-radius:50%;background:#f2eaff;border:3px solid #8c56ff;box-shadow:0 0 12px #8042ff70}
            .ss-slider input::-moz-range-thumb {width:15px;height:15px;border-radius:50%;background:#f2eaff;border:3px solid #8c56ff;box-shadow:0 0 12px #8042ff70}
            .ss-timing-actions {display:flex;gap:8px;margin-top:9px}
            .ss-timing-actions button {height:29px;font-size:11px;padding:4px 13px}
            .ss-panel .ss-reset {margin-left:auto}
            .ss-note {font-size:10px;line-height:1.4;color:#8898bb;margin-top:8px!important}
            .ss-invalid {color:#f4bca2}
            .ss-feature {display:flex;align-items:center;gap:11px;min-height:62px;padding:10px 12px}
            .ss-feature .ss-icon {width:27px;height:27px;padding:5px;box-sizing:content-box;background:#3f24af25;border-radius:50%;border:1px solid #5636b329}
            .ss-feature button {flex-shrink:0;height:33px;padding:5px 13px;font-size:11px}
            .ss-auto-on {background:radial-gradient(ellipse at 100% 100%,#512ba930,transparent 65%),#0c111b;border-color:#55418d;box-shadow:0 0 18px #693aff12}
            .ss-toggle {flex-shrink:0;width:42px!important;margin:0!important}
            .ss-toggle .UI-Switch__container {gap:0!important;justify-content:flex-end}
            .ss-toggle .UI-Switch__container > div {display:none}
            .ss-toggle label {font-size:0!important;width:0!important;margin:0!important}
            .ss-toggle button {width:40px!important;height:23px!important;border-radius:20px!important;background:#30364c!important;border-color:#444b68!important;padding:2px!important}
            .ss-toggle button[data-state="checked"],.ss-toggle button[aria-checked="true"] {background:#6538f5!important;border-color:#8867ff!important;box-shadow:0 0 14px #693aff44}
            .ss-toggle button span {width:17px!important;height:17px!important;background:#eeeaff;border-radius:50%;transform:translateX(0)!important}
            .ss-toggle button[data-state="checked"] span {transform:translateX(15px)!important}
            .ss-shortcut {font-size:10px;color:#697a9b;text-align:center}
            .ss-status {font-size:11px;color:#bbb5e9;line-height:1.4}
            .ss-source {font-size:10px;color:#91a1bf;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
            .ss-status:empty,.ss-source:empty {display:none}
            @media(max-width:440px) {.ss-panel{padding:9px}.ss-sub{font-size:10px}.ss-heading{font-size:12px}.ss-feature{gap:8px}.ss-find::after{font-size:10px}.ss-panel .ss-find{font-size:16px}.ss-logo{width:46px;height:46px}.ss-title{font-size:25px}.ss-feature button{padding:4px 9px}}
        `
        tray.render(() => {
            const media = ctx.videoCore.getCurrentMedia()
            // Goja exports Seanime metadata fields as native *string wrappers.
            // Component props require JS primitives, even when TS says string.
            const cover = String(media?.coverImage?.large || media?.coverImage?.medium || "")
            const busy = searching || loadingTracks > 0
            const ready = Boolean(mediaId && episode)
            return tray.stack([
                tray.css(panelCSS),
                tray.div([
                    tray.div([
                        tray.img({src:"https://raw.githubusercontent.com/DefnoJae/SeaSubs/main/icon.png",alt:"SeaSubs",className:"ss-logo"}),
                        tray.div([tray.text("SeaSubs",{className:"ss-title"}),tray.text("External Forced / Signs & Songs subtitle fallback.",{className:"ss-sub"})]),
                    ],{className:"ss-header"}),
                    tray.div([
                        tray.img({src:cover || "https://raw.githubusercontent.com/DefnoJae/SeaSubs/main/marketplace-icon.png",alt:cover ? title : "SeaSubs",className:"ss-cover"}),
                        tray.div([
                            tray.text(title || "Ready when you are",{className:"ss-anime-title"}),
                            tray.div([tray.text(episode ? "Episode " + episode : "Start an episode"),tray.text(String(media?.format || "TV").replace(/_/g," "),{className:"ss-format"})],{className:"ss-episode"}),
                        ],{className:"ss-anime-copy"}),
                    ],{className:"ss-card ss-anime"}),
                    tray.button(searching ? "Finding subtitles…" : loadingTracks ? "Loading subtitle…" : "Find external subtitles",{onClick:"seasubs-search",intent:"primary",loading:busy,disabled:busy,className:"ss-find"+(busy ? " ss-busy" : ""),style:{backgroundImage:'url("'+icon("chevron")+'"), radial-gradient(ellipse at 100% 0%,#b47aff80,transparent 52%),linear-gradient(115deg,#4930f4,#293eed 60%,#753eff)',backgroundPosition:"right 15px center,center,center",backgroundSize:"17px,auto,auto",backgroundRepeat:"no-repeat"}}),
                    tray.button("Choose another subtitle ›",{onClick:"seasubs-choose",disabled:busy,className:"ss-alternatives"}),
                    tray.text(searchStatus,{className:"ss-status"}),
                    tray.text(activeSubtitle?.playback === playbackKey() ? activeSubtitle.label : "",{className:"ss-source"}),
                    tray.button("Restore original subtitles",{onClick:"seasubs-restore",disabled:busy || activeSubtitle?.playback !== playbackKey(),className:"ss-alternatives"}),
                    tray.text(activeSubtitle?.playback === playbackKey() ? "Stops SeaSubs playback; added tracks remain in the player menu." : "",{className:"ss-source"}),
                    tray.div([
                        tray.div([
                            tray.img({src:icon("clock"),alt:"",className:"ss-icon"}),
                            tray.div([tray.text("Subtitle timing adjustment",{className:"ss-heading"}),tray.text("Positive delay shows subtitles later.",{className:"ss-description"})],{className:"ss-grow"}),
                            tray.input({fieldRef:delayField,placeholder:"0.000",className:"ss-delay",disabled:!ready}),
                        ],{className:"ss-timing-head"}),
                        tray.div([
                            tray.button("−",{onClick:"seasubs-delay-minus",className:"ss-step",disabled:!ready}),
                            tray.input({fieldRef:sliderField,className:"ss-slider",disabled:!ready}),
                            tray.button("+",{onClick:"seasubs-delay-plus",className:"ss-step",disabled:!ready}),
                        ],{className:"ss-slider-row"}),
                        tray.div([
                            tray.button("−100ms",{onClick:"seasubs-delay-minus",disabled:!ready}),
                            tray.button("+100ms",{onClick:"seasubs-delay-plus",disabled:!ready}),
                            tray.button("↶ Reset",{onClick:"seasubs-delay-reset",className:"ss-reset",disabled:!ready}),
                        ],{className:"ss-timing-actions"}),
                        tray.text(parseDelay(String(delayField.current)) === undefined ? "Enter seconds or ms, between −120s and +120s." : "Saved automatically for this anime and sub/dub mode, including next episodes.",{className:"ss-note"+(parseDelay(String(delayField.current)) === undefined ? " ss-invalid" : "")}),
                    ],{className:"ss-card ss-timing"}),
                    tray.div([
                        tray.img({src:icon("sign"),alt:"",className:"ss-icon"}),
                        tray.div([tray.text("Adjust one subtitle’s timing",{className:"ss-heading"}),tray.text("Pause near a sign; adjust only that sign.",{className:"ss-description"})],{className:"ss-grow"}),
                        tray.button("Adjust sign",{onClick:"seasubs-sign-timing",disabled:!ready || busy}),
                    ],{className:"ss-card ss-feature"}),
                    tray.div([
                        tray.img({src:icon("settings"),alt:"",className:"ss-icon"}),
                        tray.div([tray.text("Automatic Signs & Songs",{className:"ss-heading"}),tray.text("Continue on this anime’s next episodes.",{className:"ss-description"})],{className:"ss-grow"}),
                        tray.switch({label:"Automatic Signs & Songs",fieldRef:followField,disabled:!ready,className:"ss-toggle"}),
                    ],{className:"ss-card ss-feature"+(followPreference().enabled ? " ss-auto-on" : "")}),
                    tray.text("Ctrl/Cmd + Shift + S · Find subtitles",{className:"ss-shortcut"}),
                ],{className:"ss-panel"}),
            ],{gap:0})
        })
    })
}

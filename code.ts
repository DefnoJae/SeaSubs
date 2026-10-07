/// <reference path="./plugin.d.ts" />

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

function init() {
    $ui.register((ctx) => {
        const API_KEY = "{{apiKey}}"
        const PREFER_FORCED = "{{preferForced}}" !== "false"
        const API = "https://api.opensubtitles.com/api/v1"
        const UA = "SeaSubs v0.3.0"

        let title = ""
        let episode = 0
        let token = ""
        let baseUrl = API
        let results: OSResult[] = []
        let mediaId = 0

        const tray = ctx.newTray({ withContent: true })
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
        }

        function animeToshoScore(name: string, release: string): number {
            const text = (name + " " + release).toLowerCase()
            let s = 0
            if (/signs?[ ._\\/-]*(and|&)?[ ._\\/-]*songs?|forced|songs?[ ._\\/-]*(and|&)?[ ._\\/-]*signs?/.test(text)) s += 1000
            if (/\\beng(?:lish)?\\b/.test(text)) s += 200
            if (/sdh|hearing[ ._-]*impaired|closed[ ._-]*captions?|\\bcc\\b/.test(text)) s -= 200
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

        async function searchAnimeToshoHost(host: string, eid: number): Promise<AnimeToshoResult[]> {
            const feedUrl = host.indexOf(".xyz") >= 0
                ? "https://feed.animetosho.xyz/feed/json?eid=" + eid
                : "https://feed.animetosho.org/json?eid=" + eid
            const detailBase = host.indexOf(".xyz") >= 0
                ? "https://feed.animetosho.xyz/json?show=torrent&id="
                : "https://feed.animetosho.org/json?show=torrent&id="
            const feed = await ctx.fetch(feedUrl)
            if (!feed.ok) return []
            const entries = feed.json() as any[]
            const candidates = (Array.isArray(entries) ? entries : [])
                .filter((e: any) => !e.status || e.status === "complete")
                .slice(0, 12)
            const details = await Promise.all(candidates.map(async (entry: any) => {
                try {
                    const r = await ctx.fetch(detailBase + entry.id)
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
                    const forced = info.forced === true
                    const isEnglish = /^(eng|en|english)$/.test(lang) || /english|\\beng\\b/i.test(lang + " " + name)
                    const s = animeToshoScore(name, release) + (forced ? 1200 : 0)
                    if (!isEnglish || s < 500) continue
                    const rawType = String(info.codec || info.format || "ass").toLowerCase()
                    const type = rawType.indexOf("ssa") >= 0 ? "ssa" : rawType.indexOf("srt") >= 0 ? "srt" : rawType.indexOf("vtt") >= 0 ? "vtt" : "ass"
                    const url = String(attach.url || (attach.id ? "https://sub.wyzie.io/c/animetosho/id/" + attach.id + ".animetosho?format=" + encodeURIComponent(type) : ""))
                    if (!url) continue
                    out.push({
                        label: (forced ? "★ Forced — " : "★ ") + (name || "English Signs & Songs") + " — " + release,
                        url, type, language: "en", score: s,
                    })
                }
            }
            return out
        }

        async function searchAnimeTosho(): Promise<AnimeToshoResult[]> {
            if (!mediaId || !episode) return []
            try {
                const metadata = await ctx.anime.getAnimeMetadata("anilist", mediaId)
                const epMeta = metadata?.episodes?.[String(episode)]
                const eid = Number(epMeta?.anidbId || 0)
                if (!eid) return []
                const sources = await Promise.all([
                    searchAnimeToshoHost("animetosho.xyz", eid),
                    searchAnimeToshoHost("animetosho.org", eid),
                ])
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
                out.sort((a, b) => b.score - a.score)
                return out
            } catch (err) {
                console.log("SeaSubs AnimeTosho search failed", err)
                return []
            }
        }

        function injectExternal(src: string, label: string, language: string, type: string): void {
            ctx.videoCore.addExternalSubtitleTrack({ src, label: "SeaSubs — " + label, language, type, default: true })
            ctx.videoCore.showMessage("SeaSubs loaded: " + label, 2500)
            ctx.toast.success("SeaSubs: external subtitle added to the player.")
            palette.close()
        }

        async function search(): Promise<void> {
            syncFromVideoCore()
            if (!title || !episode) {
                ctx.toast.warning("SeaSubs: start an episode first so I know what to search for.")
                return
            }
            ctx.toast.info("SeaSubs: searching Signs & Songs for " + title + " E" + episode + "…")
            const animeTosho = await searchAnimeTosho()
            if (animeTosho.length) {
                palette.setItems(animeTosho.slice(0, 25).map((item, index) => ({
                    label: item.label,
                    value: "at-" + String(index),
                    heading: index === 0 ? "AnimeTosho — Forced / Signs & Songs" : undefined,
                    onSelect: () => injectExternal(item.url, item.label, item.language, item.type),
                })))
                palette.open()
                return
            }
            if (!API_KEY) {
                ctx.toast.warning("SeaSubs: no separate Forced / Signs & Songs attachment was found for this episode.")
                return
            }
            ctx.toast.info("SeaSubs: trying OpenSubtitles fallback…")
            const q = encodeURIComponent(title)
            const url = API + "/subtitles?languages=en&query=" + q + "&episode_number=" + episode + "&order_by=download_count&order_direction=desc"
            const r = await ctx.fetch(url, { headers: headers(false) })
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
                onSelect: () => { void loadSubtitle(item) },
            })))
            palette.open()
        }

        async function loadSubtitle(item: OSResult): Promise<void> {
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

        ctx.videoCore.addEventListener("video-loaded", () => syncFromVideoCore())
        ctx.videoCore.addEventListener("video-playback-state", () => syncFromVideoCore())
        ctx.videoCore.addEventListener("video-playlist", (event) => {
            const ep = event?.playlist?.currentEpisode?.episodeNumber
            if (ep) episode = Number(ep)
            syncFromVideoCore()
        })

        ctx.playback.registerEventListener((event) => {
            if (event?.state?.mediaTitle) title = event.state.mediaTitle
            if (event?.state?.episodeNumber) episode = event.state.episodeNumber
            tray.update()
        })

        ctx.dom.onReady(() => syncFromVideoCore())
        ctx.screen.onNavigate(() => syncFromVideoCore())
        ctx.screen.loadCurrent()

        ctx.registerEventHandler("seasubs-search", () => { void search() })

        tray.render(() => tray.stack([
            tray.text("SeaSubs"),
            tray.text("External Forced / Signs & Songs subtitle fallback."),
            tray.text(title && episode ? title + " — Episode " + episode : "Start an episode, then search."),
            tray.button("Find external subtitles", { onClick: "seasubs-search", intent: "primary" }),
            tray.text("Shortcut: Ctrl/Cmd + Shift + S"),
        ]))
    })
}

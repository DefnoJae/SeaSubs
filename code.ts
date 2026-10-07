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
        const USERNAME = "{{username}}"
        const PASSWORD = "{{password}}"
        const PREFER_FORCED = "{{preferForced}}" !== "false"
        const API = "https://api.opensubtitles.com/api/v1"
        const UA = "SeaSubs v0.1.0"

        let title = ""
        let episode = 0
        let token = ""
        let baseUrl = API
        let results: OSResult[] = []

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

        async function login(): Promise<boolean> {
            if (token) return true
            if (!API_KEY || !USERNAME || !PASSWORD) {
                ctx.toast.error("SeaSubs: configure your OpenSubtitles API key, username and password.")
                return false
            }
            const r = await ctx.fetch(API + "/login", {
                method: "POST",
                headers: { ...headers(false), "Content-Type": "application/json" },
                body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
            })
            if (!r.ok) {
                ctx.toast.error("SeaSubs: OpenSubtitles login failed (" + r.status + ").")
                return false
            }
            const data = r.json() as any
            token = data.token || ""
            if (data.base_url) {
                const host = String(data.base_url).replace(/^https?:\/\//, "").replace(/\/$/, "")
                baseUrl = "https://" + host + "/api/v1"
            }
            return !!token
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

        async function search(): Promise<void> {
            if (!title || !episode) {
                ctx.toast.warning("SeaSubs: start an episode first so I know what to search for.")
                return
            }
            if (!API_KEY) {
                ctx.toast.error("SeaSubs: OpenSubtitles API key is missing.")
                return
            }
            ctx.toast.info("SeaSubs: searching English subtitles for " + title + " E" + episode + "…")
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
            if (!(await login())) return
            const r = await ctx.fetch(baseUrl + "/download", {
                method: "POST",
                headers: { ...headers(true), "Content-Type": "application/json" },
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
            const conn = ctx.mpv.getConnection()
            if (!conn || conn.isClosed()) {
                ctx.toast.warning("SeaSubs found the subtitle, but direct loading currently requires Seanime's MPV-connected player.")
                return
            }
            conn.call("sub-add", link, "select", "SeaSubs — " + labelFor(item), "eng")
            ctx.toast.success("SeaSubs: external subtitle loaded.")
            palette.close()
        }

        ctx.playback.registerEventListener((event) => {
            if (event?.state?.mediaTitle) title = event.state.mediaTitle
            if (event?.state?.episodeNumber) episode = event.state.episodeNumber
        })

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

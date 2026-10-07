const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const encoded = '/Td6WFoAAAFpIt42AgAhARYAAAB0L+Wj4AC2AJRdAC2UyMtHifLr5yTJxebCHSxfVkqNWXIPxgJIapMQKExT/N3Z7OVSi3s9v9hZrhfZR9YvoXRXW5inxLdC+ikFjefmBr0yuTyJ6GwfQEeYVLP8/aeVoeJLDN8QisM3Py8muktdEzfW4bM74QkR9bT1HFpprg0e/eEJGzWOqINlLHz2asmlOA9X/PqQltzB3gXOB81ygAAA1B/VhAABrAG3AQAA7DCMET4wDYsCAAAAAAFZWg==';
function harness(fetch) {
    const injected = [], messages = [], palette = {items: [], setItems(v) { this.items = v }, open() {}, close() {} };
    let playback = { id: 'episode-a', subtitleTracks: [], onlinestreamParams: { episodeNumber: 4, dubbed: true } };
    const ctx = { fetch, newTray: () => ({update() {}, render() {}}), newCommandPalette: () => palette,
        toast: Object.fromEntries(['success','warning','error','info'].map(k => [k, x => messages.push(x)])),
        videoCore: { getCurrentPlaybackInfo: () => playback, getCurrentMedia: () => ({ id:154692, title:{english:'Girlfriend, Girlfriend Season 2'} }),
            getPlaybackState: () => ({playbackInfo:playback}), addExternalSubtitleTrack: t => injected.push(t), showMessage() {}, addEventListener() {} },
        playback:{ registerEventListener() {} }, dom:{ onReady() {} }, screen:{ onNavigate() {}, loadCurrent() {} },
        anime:{ getAnimeMetadata: async () => ({episodes:{4:{anidbId:271605}}}) }, registerEventHandler() {} };
    const sandbox = {console: {log() {}}, $ui:{register: cb => cb(ctx)}};
    vm.createContext(sandbox);
    let code = fs.readFileSync(path.join(root,'code.ts'),'utf8');
    code = code.replace('ctx.registerEventHandler("seasubs-search",',
        'globalThis.testHooks = {runSearch, searchAnimeToshoHost, deriveSignsSongsAss, inspectCandidates, syncFromVideoCore, showCandidates, playbackKey}; ctx.registerEventHandler("seasubs-search",');
    vm.runInContext(ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText, sandbox);
    sandbox.init(); sandbox.testHooks.syncFromVideoCore();
    return { sandbox, hooks:sandbox.testHooks, palette, injected, messages, change:() => {playback = {...playback,id:'episode-b'};} };
}
const response = text => ({ok:true,status:200,text:() => text,json:() => JSON.parse(text)});
const stamp = n => new Date(n * 1000).toISOString().slice(11,23);
const vtt = cues => 'WEBVTT\n\n' + cues.map((c,i) => `${i}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n');
test('decoder runs without Node/browser globals and verifies checksums', () => {
    const {sandbox} = harness();
    const bytes = Uint8Array.from(Buffer.from(encoded,'base64'));
    assert.match(sandbox.SeaSubsXZ.decode(bytes), /TEST SIGN/);
    const bad = bytes.slice(); bad[40] ^= 8;
    assert.throws(() => sandbox.SeaSubsXZ.decode(bad));
    assert.throws(() => sandbox.SeaSubsXZ.decode(bytes.slice(0,35)));
    assert.equal(sandbox.Buffer,undefined); assert.equal(sandbox.require,undefined);
});
test('VTT parser supports settings, identifiers and multiline text; ignores notes', () => {
    const {sandbox:s} = harness();
    const text = '\uFEFFWEBVTT\n\nNOTE ignore --> text\n\ncue-id\n00:01.000 --> 00:03.000 align:start\nline 1\nline 2\n\n00:04.000 --> 00:03.000\nbad';
    const cues = s.parseVtt(text);
    assert.equal(cues.length,1); assert.equal(cues[0].text,'line 1\nline 2');
    assert.equal(s.parseVtt('<html>Error</html>').length,0);
});
test('sparsity requires full reference, matching timing/text and episode spread', () => {
    const {sandbox:s} = harness();
    const full = Array.from({length:200},(_,i) => ({start:i*7,end:i*7+2,text:'text '+i}));
    const dub = [full[5],full[60],full[120],full[190]];
    assert.equal(s.inferDubCompanion(dub,full),true);
    assert.equal(s.inferDubCompanion(full,full),false);
    assert.equal(s.inferDubCompanion(full.slice(0,5),full),false);
    assert.equal(s.inferDubCompanion(dub.map(c => ({...c,start:c.start+20,end:c.end+20})),full),false);
    assert.equal(s.inferDubCompanion(dub,[]),false);
});
test('VTT derivation retains semantic/song cues without treating uppercase dialogue as signs', () => {
    const {sandbox:s} = harness();
    const input = vtt([{start:1,end:3,text:'STOP SHOUTING!'}, {start:4,end:6,text:'<c.sign>SHOP</c>'}, {start:7,end:9,text:'♪ Test lyric ♪'}]);
    const d = s.deriveVtt(input); assert.equal(d.count,2); assert.doesNotMatch(d.content,/SHOUTING/);
});
test('ASS derivation discards comments and dialogue, preserves commas in text', () => {
    const {hooks} = harness();
    const ass = '[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
        'Dialogue: 0,0:00:01.00,0:00:03.00,Signs,,0,0,0,,shop, title\n' +
        'Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,dialogue\n' +
        'Comment: 0,0:00:01.00,0:00:03.00,Signs,,0,0,0,,not rendered';
    const d = hooks.deriveSignsSongsAss(ass); assert.equal(d.count,1); assert.match(d.content,/shop, title/); assert.doesNotMatch(d.content,/not rendered|,,dialogue/);
});
test('real AnimeTosho metadata shape yields ID-based compressed English Signs candidate', async () => {
    const h = harness(async url => response(JSON.stringify(url.includes('show=torrent')
        ? {title:'Episode release',files:[{attachments:[{id:1863226,type:'subtitle',info:{codec:'ASS',lang:'eng',name:'English Signs',forced:0}}]}]}
        : [{id:586376,status:'complete'}])));
    const items = await h.hooks.searchAnimeToshoHost('animetosho.org',271605);
    assert.equal(items.length,1); assert.equal(items[0].mode,'direct');
    assert.equal(items[0].url,'https://animetosho.org/storage/attach/001c6e3a/subtitle.ass.xz');
});
test('compressed selection injects plaintext only, and stale selections are rejected', async () => {
    const h = harness(async () => ({ok:true,body:Uint8Array.from(Buffer.from(encoded,'base64'))}));
    const item = {label:'English Signs',url:'https://animetosho.org/storage/attach/001c6e3a/subtitle.ass.xz',type:'ass',language:'en',mode:'direct',score:1000};
    h.hooks.showCandidates([item],h.hooks.playbackKey());
    h.palette.items[0].onSelect();
    for(let i=0;i<5;i++) await new Promise(r => setImmediate(r));
    assert.equal(h.injected.length,1); assert.match(h.injected[0].content,/TEST SIGN/); assert.equal(h.injected[0].src,undefined);
    h.change(); h.palette.items[0].onSelect();
    await new Promise(r => setImmediate(r)); assert.equal(h.injected.length,1);
});
test('failed English fetch is a preview, never a verified forced track', async () => {
    const h = harness(async () => ({ok:false,status:403}));
    const results = await h.hooks.inspectCandidates([{label:'Animeya dub — English',url:'https://cdn/test.vtt',type:'vtt',sourceMode:'dub',score:0}]);
    assert.equal(results.length,1); assert.match(results[0].label,/unverified/); assert.ok(results[0].score < 2000);
});

test('live captured episode responses survive blocked VTT and inject the real 20-event Signs ASS',
    {skip: !process.env.SEASUBS_LIVE_FIXTURE_DIR}, async () => {
    const dir = process.env.SEASUBS_LIVE_FIXTURE_DIR;
    const jsonFile = name => response(fs.readFileSync(path.join(dir,name),'utf8'));
    const h = harness(async url => {
        if (url.includes('media.getMedias')) return response(JSON.stringify({result:{data:{json:{medias:[{idAnilist:154692,slug:'girlfriend-girlfriend-season-2'}]}}}}));
        if (url.includes('episode.getAllEpisodes')) return response(JSON.stringify({result:{data:{json:{eps:[{id:11959,episodeNumber:4}],epsCount:1}}}}));
        if (url.includes('episode.getEpisodeFull')) return response(JSON.stringify({result:{data:{json:{players:[
            {langue:'ENG',subType:'NONE',url:'https://vidnest.fun/anime/154692/4/dub'},
            {langue:'ENG',subType:'SOFT',url:'https://vidnest.fun/anime/154692/4/sub'}]}}}}));
        if (url.includes('/hianime/')) return jsonFile(url.includes('/dub/') ? 'dub.json' : 'sub.json');
        if (url.includes('/aniwave_hls/') || url.includes('/animehub/')) return {ok:false,status:404};
        if (url.includes('northernsummit.world') || url.includes('embermeadow.world')) return {ok:false,status:403};
        if (url.includes('feed.animetosho')) {
            const u = new URL(url), xyz = u.hostname.endsWith('.xyz');
            return jsonFile(u.searchParams.has('id') ? (xyz ? 'xyz-' : 'tosho-') + u.searchParams.get('id') + '.json'
                : xyz ? 'tosho-xyz.json' : 'tosho-feed.json');
        }
        if (url.includes('/001c6e3a/')) return {ok:true,body:Uint8Array.from(fs.readFileSync(path.join(dir,'signs.ass.xz')))};
        throw Error('Unexpected request '+url);
    });
    await h.hooks.runSearch();
    assert.ok(h.palette.items.length); assert.match(h.palette.items[0].label,/English Signs/);
    h.palette.items[0].onSelect();
    await new Promise(r => setImmediate(r));
    assert.equal(h.injected.length,1); assert.equal(h.injected[0].type,'ass');
    assert.equal((h.injected[0].content.match(/^Dialogue:/gm)||[]).length,20);
    assert.equal(h.injected[0].content,fs.readFileSync(path.join(dir,'signs-raw.ass'),'utf8'));
    const full = fs.readFileSync(path.join(dir,'full-raw.ass'),'utf8');
    const derived = h.hooks.deriveSignsSongsAss(full);
    assert.ok(derived.count > 0 && derived.count < 313);
    console.log('Live full ASS: 313 events; derived signs/song events:',derived.count);
});

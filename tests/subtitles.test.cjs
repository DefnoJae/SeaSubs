const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const encoded = '/Td6WFoAAAFpIt42AgAhARYAAAB0L+Wj4AC2AJRdAC2UyMtHifLr5yTJxebCHSxfVkqNWXIPxgJIapMQKExT/N3Z7OVSi3s9v9hZrhfZR9YvoXRXW5inxLdC+ikFjefmBr0yuTyJ6GwfQEeYVLP8/aeVoeJLDN8QisM3Py8muktdEzfW4bM74QkR9bT1HFpprg0e/eEJGzWOqINlLHz2asmlOA9X/PqQltzB3gXOB81ygAAA1B/VhAABrAG3AQAA7DCMET4wDYsCAAAAAAFZWg==';
function harness(fetch, storage = new Map()) {
    const injected = [], messages = [], palette = {items: [], setItems(v) { this.items = v }, open() {}, close() {} };
    let playback = { id: 'episode-a', subtitleTracks: [], onlinestreamParams: { episodeNumber: 4, dubbed: true } };
    let media = {id:154692,title:{english:'Girlfriend, Girlfriend Season 2'}};
    const listeners = new Map(), handlers = new Map(), timers = new Map(); let nextTimer = 0;
    const ctx = { fetch, newTray: () => ({update() {}, render() {}}), newCommandPalette: () => palette,
        toast: Object.fromEntries(['success','warning','error','info'].map(k => [k, x => messages.push(x)])),
        videoCore: { getCurrentPlaybackInfo: () => playback, getCurrentMedia: () => media,
            getPlaybackState: () => ({playbackInfo:playback}), addExternalSubtitleTrack: t => injected.push(t), showMessage() {}, addEventListener:(name,fn) => listeners.set(name,fn) },
        playback:{ registerEventListener() {} }, dom:{ onReady() {} }, screen:{ onNavigate() {}, loadCurrent() {} },
        anime:{ getAnimeMetadata: async () => ({episodes:{4:{anidbId:271605},5:{anidbId:271606},6:{anidbId:271607}}}) },
        setTimeout:(fn) => {const id = ++nextTimer; timers.set(id,fn); return () => timers.delete(id)},
        registerEventHandler:(name,fn) => handlers.set(name,fn) };
    let callback;
    const rootSandbox = { $ui:{register: cb => {callback = cb.toString()} } };
    vm.createContext(rootSandbox);
    let code = fs.readFileSync(path.join(root,'code.ts'),'utf8');
    code = code.replace('ctx.registerEventHandler("seasubs-search",',
        'globalThis.testHooks = {compareTiming, timingCues, unwrapProviderUrl, prepareTiming, rankTiming, loadCandidate, collectSubtitleAttachments, SeaSubsXZ, parseVtt, inferDubCompanion, deriveVtt, currentCandidates, runSearch, search, scheduleAuto, searchAnimeToshoHost, deriveSignsSongsAss, inspectCandidates, syncFromVideoCore, showCandidates, playbackKey}; ctx.registerEventHandler("seasubs-search",');
    vm.runInContext(ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText, rootSandbox);
    rootSandbox.init();
    // Seanime serializes the callback and evaluates it in a separate UI VM.
    const sandbox = {console:{log() {}}, __ctx:ctx, $storage:{get:key => storage.get(key),set:(key,value) => storage.set(key,JSON.parse(JSON.stringify(value)))}}; vm.createContext(sandbox);
    vm.runInContext('(' + callback + ').call(undefined, __ctx)', sandbox);
    sandbox.testHooks.syncFromVideoCore();
    return { sandbox, hooks:sandbox.testHooks, palette, injected, messages, storage,
        setTracks:tracks => {playback.subtitleTracks = tracks},
        change:(ep=4,mediaId=154692) => {playback = {...playback,id:'episode-'+ep,onlinestreamParams:{episodeNumber:ep,dubbed:true}}; media={...media,id:mediaId}},
        emit:name => listeners.get(name)?.({}), handle:name => handlers.get(name)?.(),
        flushTimers:() => {const fns=[...timers.values()]; timers.clear(); for(const fn of fns) fn()} };
}
const response = text => ({ok:true,status:200,text:() => text,json:() => JSON.parse(text)});
test('real Tsukigakirei batch maps Episode 1 to its own attachment and visible poster sign', () => {
    const h = harness(); h.change(1,98202); h.hooks.syncFromVideoCore();
    const batch = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/tsuki-batch.json')));
    const attachments = h.hooks.collectSubtitleAttachments(batch);
    assert.ok(attachments.some(a => a.id === 371919));
    assert.ok(!attachments.some(a => a.id === 374581)); // Episode 9 from the user's log
    const full = fs.readFileSync(path.join(__dirname,'fixtures/tsuki-poster.ass'),'utf8');
    const derived = h.hooks.deriveSignsSongsAss(full);
    assert.match(derived.content,/0:05:45\.80,0:05:50\.55,.*Members Souper Wanted/);
    assert.ok(!derived.content.startsWith('\uFEFF'));
    h.change(6,98202); h.hooks.syncFromVideoCore();
    const episode6 = h.hooks.collectSubtitleAttachments(batch);
    assert.ok(episode6.some(a => a.id === 371944));
    assert.ok(!episode6.some(a => a.id === 371977)); // Episode 6.5
});
test('selecting generated signs retains alternatives on reopening instead of showing only cached choice', async () => {
    const h = harness(async () => {throw new Error('Reopening must use results, not network')});
    const full = fs.readFileSync(path.join(__dirname,'fixtures/tsuki-poster.ass'),'utf8');
    const items = [{label:'Generate Signs & Songs — English — [Erai-raws]',url:'https://example/one.ass',content:full,type:'ass',language:'en',score:100,mode:'derive'},
        {label:'Alternative English Signs',url:'https://example/two.ass',content:full,type:'ass',language:'en',score:1000,mode:'direct'}];
    h.hooks.showCandidates(items,h.hooks.playbackKey());
    h.palette.items[0].onSelect();
    await new Promise(resolve => setImmediate(resolve));
    await h.hooks.runSearch();
    assert.equal(h.palette.items[0].label,items[0].label);
    assert.equal(h.palette.items[1].label,items[1].label);
    assert.equal(h.palette.items[2].label,'Search other subtitle sources');
    assert.equal(h.injected.length,1);
});
test('Episode 1 generated signs take three requests and bypass slow fallback sources', async () => {
    const calls = [];
    const batch = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/tsuki-batch.json')));
    const poster = fs.readFileSync(path.join(__dirname,'fixtures/tsuki-poster.ass'),'utf8');
    const h = harness(async url => {
        calls.push(url);
        if (url.endsWith('eid=271605')) return response(JSON.stringify([{id:214423,title:batch.title,status:'complete'}]));
        if (url.endsWith('show=torrent&id=214423')) return response(JSON.stringify(batch));
        throw new Error('Unexpected slow fallback '+url);
    });
    h.change(1,98202); h.hooks.syncFromVideoCore();
    h.sandbox.__ctx.anime.getAnimeMetadata = async () => ({episodes:{1:{anidbId:271605}}});
    // The small committed poster excerpt verifies rendering content without bundling a full subtitle.
    // Supply it through an uncompressed attachment for a portable request-path regression.
    batch.files.find(f => f.filename.includes(' - 01 ')).attachments.find(a => a.id === 371919).url = 'https://fixture.test/episode1.ass';
    const originalFetch = h.sandbox.__ctx.fetch;
    h.sandbox.__ctx.fetch = async url => url === 'https://fixture.test/episode1.ass' ? (calls.push(url),response(poster)) : originalFetch(url);
    await h.hooks.runSearch();
    assert.equal(calls.length,3);
    assert.match(h.palette.items[0].label,/Generated Signs & Songs/);
    h.palette.items[0].onSelect(); await new Promise(resolve => setImmediate(resolve));
    assert.match(h.injected[0].content,/Members Souper Wanted/);
});
const stamp = n => new Date(n * 1000).toISOString().slice(11,23);
const vtt = cues => 'WEBVTT\n\n' + cues.map((c,i) => `${i}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n');
const timingSample = () => [
    {start:10,end:12,text:'School entrance sign'}, {start:50,end:52,text:'Student council office'},
    {start:110,end:112,text:'Library opens tomorrow'}, {start:160,end:162,text:'Keep the hallway quiet'},
    {start:210,end:212,text:'Unmatched source translation'}];
const timingAss = cues => '[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nStyle: Signs,Arial,20\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' + cues.map(c => `Dialogue: 0,${stamp(c.start).replace(/^00:/,'0:').slice(0,-1)},${stamp(c.end).replace(/^00:/,'0:').slice(0,-1)},Signs,,0,0,0,,{\\pos(100,200)}${c.text}`).join('\n');
test('timing comparison fixes only matching early cues and preserves correct and unmatched ASS cues', () => {
    const h = harness(), cues = timingSample();
    const reference = cues.slice(0,4).map((c,i) => ({...c,start:c.start+(i===0||i===2?1:0),end:c.end+(i===0||i===2?1:0)}));
    const result = h.hooks.compareTiming(timingAss(cues),vtt(reference));
    assert.equal(result.matched,4); assert.equal(result.adjusted,2);
    const parsed = h.hooks.timingCues(result.content);
    assert.deepEqual(Array.from(parsed,c=>c.start),[11,50,111,160,210]);
    assert.deepEqual(Array.from(parsed,c=>c.end),[13,52,113,162,212]);
    assert.equal((result.content.match(/\\pos\(100,200\)/g)||[]).length,5);
    assert.match(result.content,/Style: Signs,Arial,20/);
});
test('VTT retiming preserves settings, identifiers, styles and unmatched cues', () => {
    const h=harness(), cues=timingSample();
    const content=vtt(cues).replace('WEBVTT','WEBVTT\n\nSTYLE\n::cue { color: cyan; }').replace('00:00:12.000','00:00:12.000 align:start');
    const reference=vtt(cues.slice(0,4).map((c,i)=>({...c,start:c.start+(i===0?1:0),end:c.end+(i===0?1:0)})));
    const result=h.hooks.compareTiming(content,reference);
    assert.equal(result.adjusted,1); assert.match(result.content,/0\n00:00:11.000 --> 00:00:13.000 align:start/);
    assert.match(result.content,/STYLE\n::cue \{ color: cyan; \}/);
    assert.match(result.content,/00:03:30.000 --> 00:03:32.000/);
});
test('timing comparison rejects sparse, repeated, distant and short-span evidence', () => {
    const h=harness(), cues=timingSample(), content=timingAss(cues);
    for(const refs of [cues.slice(0,2),cues.slice(0,4).flatMap(c=>[c,{...c,start:c.start+1,end:c.end+1}]),
        cues.slice(0,4).map(c=>({...c,start:c.start+20,end:c.end+20}))]) {
        const result=h.hooks.compareTiming(content,vtt(refs)); assert.equal(result.content,content); assert.equal(result.adjusted,0);
    }
    const short=cues.slice(0,3).map((c,i)=>({...c,start:i*5,end:i*5+2}));
    assert.equal(h.hooks.compareTiming(timingAss(short),vtt(short.map(c=>({...c,start:c.start+1,end:c.end+1})))).adjusted,0);
});
test('provider comparison unwraps public proxy target, keeps CDN headers, and prioritizes matching tracks', async () => {
    const calls=[], refs=vtt(timingSample().slice(0,4));
    const url='http://127.0.0.1:43211/api/v1/proxy?url='+encodeURIComponent('https://6a8y6.broforgotsave.online/eng.vtt')+'&headers='+encodeURIComponent(JSON.stringify({Origin:'https://megaplay.buzz',Referer:'https://megaplay.buzz/',Authorization:'private'}));
    const h=harness(async (u,opts)=>{calls.push({u,opts});return response(refs)});
    h.setTracks([{label:'English',language:'en',uri:{toString:()=>url},format:'vtt'}]);
    const matched={label:'English Signs',url:'',content:timingAss(timingSample()),type:'ass',language:'en',score:1000,mode:'direct'};
    const ranked=await h.hooks.rankTiming([{...matched,label:'Different translation',content:timingAss(timingSample().map(c=>({...c,text:'OTHER '+c.text})))},matched]);
    assert.match(ranked[0].label,/timing matches provider/); assert.match(ranked[1].label,/timing unverified/);
    assert.equal(calls.length,1); assert.equal(calls[0].u,'https://6a8y6.broforgotsave.online/eng.vtt');
    assert.equal(calls[0].opts.headers.Origin,'https://megaplay.buzz'); assert.equal(calls[0].opts.headers.Referer,'https://megaplay.buzz/');
    assert.equal(calls[0].opts.headers.Authorization,undefined); assert.equal(calls[0].opts.timeout,5);
});
test('blocked reference leaves content unchanged and labels timing unverified', async () => {
    const h=harness(async()=>({ok:false,status:403})), content=timingAss(timingSample());
    h.setTracks([{label:'English',language:'en',uri:'https://cdn.test/eng.vtt'}]);
    const result=await h.hooks.prepareTiming({label:'Signs',content,url:'',type:'ass',language:'en',score:1000,mode:'direct'});
    assert.equal(result.content,content); assert.equal(result.timingMatched,0); assert.match(result.label,/timing unverified/);
});
test('episode changes during timing fetch prevent stale subtitle injection', async () => {
    let release;const h=harness(()=>new Promise(resolve=>{release=resolve}));
    h.setTracks([{label:'English',language:'en',uri:'https://cdn.test/eng.vtt'}]);
    const pending=h.hooks.loadCandidate({label:'Signs',content:timingAss(timingSample()),url:'',type:'ass',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    h.change(5);release(response(vtt(timingSample().slice(0,4))));await pending;
    assert.equal(h.injected.length,0);
});
test('decoder runs without Node/browser globals and verifies checksums', () => {
    const {sandbox,hooks} = harness();
    const bytes = Uint8Array.from(Buffer.from(encoded,'base64'));
    assert.match(hooks.SeaSubsXZ.decode(bytes), /TEST SIGN/);
    const bad = bytes.slice(); bad[40] ^= 8;
    assert.throws(() => hooks.SeaSubsXZ.decode(bad));
    assert.throws(() => hooks.SeaSubsXZ.decode(bytes.slice(0,35)));
    assert.equal(sandbox.Buffer,undefined); assert.equal(sandbox.require,undefined);
});
test('VTT parser supports settings, identifiers and multiline text; ignores notes', () => {
    const {hooks:s} = harness();
    const text = '\uFEFFWEBVTT\n\nNOTE ignore --> text\n\ncue-id\n00:01.000 --> 00:03.000 align:start\nline 1\nline 2\n\n00:04.000 --> 00:03.000\nbad';
    const cues = s.parseVtt(text);
    assert.equal(cues.length,1); assert.equal(cues[0].text,'line 1\nline 2');
    assert.equal(s.parseVtt('<html>Error</html>').length,0);
});
test('sparsity requires full reference, matching timing/text and episode spread', () => {
    const {hooks:s} = harness();
    const full = Array.from({length:200},(_,i) => ({start:i*7,end:i*7+2,text:'text '+i}));
    const dub = [full[5],full[60],full[120],full[190]];
    assert.equal(s.inferDubCompanion(dub,full),true);
    assert.equal(s.inferDubCompanion(full,full),false);
    assert.equal(s.inferDubCompanion(full.slice(0,5),full),false);
    assert.equal(s.inferDubCompanion(dub.map(c => ({...c,start:c.start+20,end:c.end+20})),full),false);
    assert.equal(s.inferDubCompanion(dub,[]),false);
});
test('VTT derivation retains semantic/song cues without treating uppercase dialogue as signs', () => {
    const {hooks:s} = harness();
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

test('current URI wrappers become primitive URLs; empty tracks are skipped', async () => {
    const calls = [];
    const h = harness(async url => {
        assert.equal(typeof url,'string'); calls.push(url);
        return response(vtt([{start:1,end:3,text:'TEST'}]));
    });
    h.setTracks([{label:'English',language:'en',uri:{toString:() => 'https://cdn.test/signs.vtt'},format:'vtt'},
        {label:'English',language:'en'}]);
    const items = await h.hooks.currentCandidates();
    assert.deepEqual(calls,['https://cdn.test/signs.vtt']);
    assert.equal(items.length,1); assert.match(items[0].content,/TEST/);
});

const settle = async () => {for(let i=0;i<8;i++) await new Promise(r => setImmediate(r))};
function fastSource(calls, waitForEp5) {
    return async url => {
        calls.push(url);
        if (url.includes('feed.animetosho.org/json?eid=')) {
            const eid = Number(new URL(url).searchParams.get('eid'));
            if (eid === 271606 && waitForEp5) await waitForEp5;
            return response(JSON.stringify([{id:eid,title:'[Yameii] English Dub',status:'complete'}]));
        }
        if (url.includes('show=torrent')) return response(JSON.stringify({title:'[Yameii] English Dub',files:[{attachments:[{id:Number(new URL(url).searchParams.get('id')),type:'subtitle',info:{codec:'ASS',lang:'eng',name:'English Signs'}}]}]}));
        if (url.includes('/storage/attach/')) return {ok:true,body:Uint8Array.from(Buffer.from(encoded,'base64'))};
        throw Error('Fast match should not contact slower fallback '+url);
    };
}
function chooseInitial(h) {
    h.hooks.showCandidates([{label:'English Signs — [Yameii] E4',url:'',type:'ass',language:'en',mode:'direct',score:1000,content:'[Script Info]\n[Events]\nOLD EPISODE SIGN'}],h.hooks.playbackKey());
    h.palette.items[0].onSelect();
}
test('fast match uses one release and does not wait for Animeya or the alternate host', async () => {
    const calls=[],h=harness(fastSource(calls));
    await h.hooks.runSearch();
    assert.equal(calls.length,3); assert.match(h.palette.items[0].label,/English Signs/);
    assert.ok(calls.every(url => !url.includes('animeya') && !url.includes('.xyz')));
});
test('choosing Signs enables next-episode auto loading, deduplicates events and caches revisits', async () => {
    const calls=[],h=harness(fastSource(calls));
    chooseInitial(h); await settle();
    assert.equal(h.storage.get('follow-154692|true').enabled,true);
    h.change(5); h.emit('video-loaded'); h.emit('video-playback-state'); h.flushTimers(); await settle();
    assert.equal(h.injected.length,2); assert.match(h.injected[1].content,/TEST SIGN/);
    assert.ok(calls[0].includes('eid=271606'));
    h.emit('video-playback-state'); h.flushTimers(); await settle(); assert.equal(h.injected.length,2);
    const count=calls.length;
    h.change(4); h.emit('video-loaded'); h.flushTimers(); await settle();
    assert.equal(h.injected.length,3); assert.match(h.injected[2].content,/OLD EPISODE SIGN/); assert.equal(calls.length,count);
});
test('automatic preference survives UI reload, remains scoped to the anime and can be paused', async () => {
    const storage=new Map(),first=harness(fastSource([]),storage); chooseInitial(first); await settle();
    const calls=[],h=harness(fastSource(calls),storage);
    h.change(5); h.emit('video-loaded'); h.flushTimers(); await settle(); assert.equal(h.injected.length,1);
    h.handle('seasubs-follow'); h.change(6); h.emit('video-loaded'); h.flushTimers(); await settle(); assert.equal(h.injected.length,1);
    h.change(5,999999); h.emit('video-loaded'); h.flushTimers(); await settle(); assert.equal(h.injected.length,1);
});
test('rapid episode changes discard an in-flight result and load the newest episode', async () => {
    let release; const delayed=new Promise(r=>{release=r});
    const calls=[],h=harness(fastSource(calls,delayed)); chooseInitial(h); await settle();
    h.change(5); h.emit('video-loaded'); h.flushTimers(); await settle();
    h.change(6); h.emit('video-loaded'); h.flushTimers(); await settle(); release(); await settle();
    h.flushTimers(); await settle();
    assert.equal(h.injected.length,2); assert.ok(calls.some(url=>url.includes('eid=271607')));
    assert.ok(!calls.some(url=>url.includes('show=torrent&id=271606')));
});
test('unverified captions never enable automatic subtitle following', async () => {
    const h=harness();
    h.hooks.showCandidates([{label:'Unverified English dub',url:'',content:'WEBVTT\n\n00:01.000 --> 00:02.000\ndialogue',language:'en',type:'vtt',mode:'direct',score:10}],h.hooks.playbackKey());
    h.palette.items[0].onSelect(); await settle();
    assert.equal(h.storage.size,0);
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

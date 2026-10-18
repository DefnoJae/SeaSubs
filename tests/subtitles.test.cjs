const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const encoded = '/Td6WFoAAAFpIt42AgAhARYAAAB0L+Wj4AC2AJRdAC2UyMtHifLr5yTJxebCHSxfVkqNWXIPxgJIapMQKExT/N3Z7OVSi3s9v9hZrhfZR9YvoXRXW5inxLdC+ikFjefmBr0yuTyJ6GwfQEeYVLP8/aeVoeJLDN8QisM3Py8muktdEzfW4bM74QkR9bT1HFpprg0e/eEJGzWOqINlLHz2asmlOA9X/PqQltzB3gXOB81ygAAA1B/VhAABrAG3AQAA7DCMET4wDYsCAAAAAAFZWg==';
function harness(fetch, storage = new Map(), globals = {}) {
    const injected = [], messages = [], palette = {items: [], opens:0, visible:false, setItems(v) { this.items = v }, open() {this.opens++;this.visible=true}, close() {this.visible=false} };
    let playback = { id: 'episode-a', subtitleTracks: [], onlinestreamParams: { episodeNumber: 4, dubbed: true } };
    let media = {id:154692,title:{english:'Girlfriend, Girlfriend Season 2'}};
    const listeners = new Map(), handlers = new Map(), timers = new Map(); let nextTimer = 0;
    const observers=new Map();let domReady;
    const restored=[];let originalTrack=2,originalCaption=-1;
    const fields = []; let trayRender, position = 10;
    const layout=(items,props)=>({items,...props});
    const tray = {close() {palette.trayClosed=true},update() {}, render(fn) {trayRender=fn},flex:layout,stack:layout,div:layout,
        css:css=>({css}),img:props=>{assert.equal(typeof props.src,'string');if(props.alt!==undefined)assert.equal(typeof props.alt,'string');return {image:props}},switch:props=>({switch:props}),
        text:(text,props)=>({text,...props}),input:props=>({input:props}),button:(label,props)=>({label,...props})};
    const ctx = { fetch, newTray: () => tray, newCommandPalette: () => palette,
        fieldRef:value=>{let change;const ref={current:value,setValue(v){this.current=v},onValueChange(fn){change=fn},userChange(v){this.current=v;change?.(v)}};fields.push(ref);return ref},
        toast: Object.fromEntries(['success','warning','error','info'].map(k => [k, x => messages.push(x)])),
        videoCore: { getCurrentPlaybackInfo: () => playback, getCurrentMedia: () => media,
            sendGetSubtitleTrack:()=>listeners.get('video-subtitle-track')?.({playbackId:playback.id,trackNumber:originalTrack}),
            sendGetMediaCaptionTrack:()=>listeners.get('video-media-caption-track')?.({playbackId:playback.id,trackIndex:originalCaption}),
            setSubtitleTrack:n=>restored.push(['subtitle',n]),setMediaCaptionTrack:n=>restored.push(['caption',n]),
            getPlaybackStatus:()=>({currentTime:position}),getPlaybackState: () => ({playbackInfo:playback}), addExternalSubtitleTrack: t => injected.push(t), showMessage() {}, addEventListener:(name,fn) => listeners.set(name,fn) },
        playback:{ registerEventListener() {} }, dom:{ onReady(fn) {domReady=fn},observe:(selector,fn)=>observers.set(selector,fn) }, screen:{ onNavigate() {}, loadCurrent() {} },
        anime:{ getAnimeMetadata: async () => ({episodes:{4:{anidbId:271605},5:{anidbId:271606},6:{anidbId:271607}}}) },
        setTimeout:(fn,ms) => {const id = ++nextTimer; timers.set(id,{fn,ms}); return () => timers.delete(id)},
        registerEventHandler:(name,fn) => handlers.set(name,fn) };
    let callback;
    const rootSandbox = { $ui:{register: cb => {callback = cb.toString()} } };
    vm.createContext(rootSandbox);
    let code = fs.readFileSync(path.join(root,'code.ts'),'utf8');
    code = code.replace('ctx.registerEventHandler("seasubs-search",',
        'globalThis.testHooks = {searchAnimeTosho,searchNyaa,parseNyaaRss,sourceFetch,torrentSubtitles,inspectTorrentChoices,matchesRelease,inspectSignsRole,presentSearchResults,readCandidate,shiftSign,offsetTrack,parseDelay,animeDelay,applyAnimeDelay,openSignTiming,compareTiming, timingCues, unwrapProviderUrl, prepareTiming, rankTiming, loadCandidate, collectSubtitleAttachments, SeaSubsXZ, parseVtt, inferDubCompanion, deriveVtt, currentCandidates, runSearch, search, scheduleAuto, searchAnimeToshoHost, deriveSignsSongsAss, inspectCandidates, syncFromVideoCore, showCandidates, playbackKey}; ctx.registerEventHandler("seasubs-search",');
    vm.runInContext(ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText, rootSandbox);
    rootSandbox.init();
    // Seanime serializes the callback and evaluates it in a separate UI VM.
    const sandbox = {...globals,console:{log() {}}, __ctx:ctx, $storage:{get:key => storage.get(key),set:(key,value) => storage.set(key,JSON.parse(JSON.stringify(value)))}}; vm.createContext(sandbox);
    vm.runInContext('(' + callback + ').call(undefined, __ctx)', sandbox);
    sandbox.testHooks.syncFromVideoCore();
    return { sandbox, hooks:sandbox.testHooks, palette, injected, messages, storage,
        fields,renderTree:()=>trayRender(),renderTray:()=>{const nodes=[];function walk(n){if(!n)return;if(Array.isArray(n)){n.forEach(walk);return}nodes.push(n);n.items?.forEach(walk)}walk(trayRender());return nodes},setPosition:value=>{position=value},
        observers,runDomReady:()=>domReady(),
        restored,setOriginal:(track,caption=-1)=>{originalTrack=track;originalCaption=caption},
        setMedia:value=>{media=value},
        setTracks:tracks => {playback.subtitleTracks = tracks},
        change:(ep=4,mediaId=154692,dub=true) => {playback = {...playback,id:'episode-'+ep,onlinestreamParams:{episodeNumber:ep,dubbed:dub}}; media={...media,id:mediaId}},
        emit:name => listeners.get(name)?.({}), handle:name => handlers.get(name)?.(),
        flushTimers:(includeDeadlines=false) => {for(const [id,timer] of [...timers]) { if(!includeDeadlines && timer.ms>=6000) continue; timers.delete(id);timer.fn(); }} };
}
const response = text => ({ok:true,status:200,text:() => text,json:() => JSON.parse(text)});
test('explicit season and episode mismatches are excluded even from single-file top-level attachments', () => {
    const h=harness();
    assert.equal(h.hooks.matchesRelease('[Release]_S02E04.ass'),true);
    assert.equal(h.hooks.matchesRelease('[Release]_S01E04.ass'),false);
    assert.equal(h.hooks.matchesRelease('[Release]_S02E05.ass'),false);
    const attachment={id:1,type:'subtitle'};
    assert.equal(h.hooks.collectSubtitleAttachments({title:'Title S01E04',attachments:[attachment]}).length,0);
    assert.equal(h.hooks.collectSubtitleAttachments({files:[{filename:'Title S02E05.mkv'}],attachments:[attachment]}).length,0);
    const batch=h.hooks.collectSubtitleAttachments({title:'Title S02E01-E12',files:[{filename:'Title_S02E04.mkv',attachments:[attachment]},{filename:'Title_S02E05.mkv',attachments:[{...attachment,id:2}]}]});
    assert.equal(batch.length,1);assert.equal(batch[0].id,1);
    h.change(1,185262);h.setMedia({id:185262,title:{english:'HELL MODE'}});h.hooks.syncFromVideoCore();
    assert.equal(h.hooks.matchesRelease('[Judas] Hell Mode - S02E01 [1080p]'),false);
    assert.equal(h.hooks.matchesRelease('HELL.MODE.S01E01.REPACK'),true);
});
test('wider search reads usable alternatives before slow providers and reuses detail metadata', async () => {
    const calls=[],content=timingAss(timingSample());
    const h=harness(async url=>{
        calls.push(url);
        if(url.endsWith('eid=271605'))return response(JSON.stringify([{id:1,title:'Wrong S03E04'},{id:2,title:'Correct S02E04'}]));
        if(url.endsWith('show=torrent&id=2'))return response(JSON.stringify({title:'Correct S02E04',attachments:[{id:99,type:'subtitle',url:'https://fixture.test/signs.ass',info:{lang:'eng',name:'Signs',codec:'ass'}}]}));
        if(url==='https://fixture.test/signs.ass')return response(content);
        throw Error('Unexpected fallback request '+url);
    });
    await h.hooks.runSearch(false,true);
    assert.equal(calls.length,3);assert.equal(h.injected.length,0);assert.match(h.palette.items[0].label,/Correct S02E04/);
    await h.hooks.runSearch(false,true);assert.equal(calls.length,3);
});
test('SRT references can verify timing and edits retain comma timestamps and other cues', () => {
    const h=harness(),cues=timingSample();
    const srt=vtt(cues).replace('WEBVTT\n\n','').replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g,'$1,$2');
    assert.equal(h.hooks.timingCues(srt).length,5);
    const reference=srt.replace('00:00:10,000','00:00:11,000').replace('00:00:12,000','00:00:13,000');
    const compared=h.hooks.compareTiming(srt,reference);assert.equal(compared.adjusted,1);assert.match(compared.content,/00:00:11,000 --> 00:00:13,000/);
    const shifted=h.hooks.shiftSign(srt,h.hooks.timingCues(srt)[0],0.25);assert.equal(shifted.changed,1);assert.match(shifted.content,/00:00:10,250 --> 00:00:12,250/);
    assert.equal(h.hooks.timingCues(shifted.content)[1].start,50);
});
test('paused-position sign alignment includes saved delay and changes only the selected sign', async () => {
    const h=harness();await h.hooks.loadCandidate({label:'Signs',url:'',content:timingAss(timingSample()),type:'ass',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    h.hooks.applyAnimeDelay(1250);h.setPosition(14);h.handle('seasubs-sign-timing');h.palette.items[0].onSelect();
    h.palette.items.find(i=>i.value==='align').onSelect();
    assert.deepEqual(Array.from(h.hooks.timingCues(h.injected.at(-1).content),c=>c.start),[14,51.25,111.25,161.25,211.25]);
});
test('dense plain captions mislabeled Forced require explicit selection', () => {
    const h=harness(),content=timingAss(Array.from({length:100},(_,i)=>({start:i*5,end:i*5+2,text:'ordinary spoken dialogue '+i}))).replace(/Style: Signs/g,'Style: Default').replace(/,Signs,,/g,',Default,,').replace(/\{\\pos\(100,200\)\}/g,'');
    const result=h.hooks.inspectSignsRole({label:'★ Forced — English',type:'ass',score:1200,mode:'direct'},content);
    assert.equal(result.score,0);assert.match(result.label,/Unverified captions/);
});
test('restore returns to original tracks, pauses following and retains the baseline across repeated injections', async () => {
    const h=harness(),track={label:'Signs',url:'',content:'1\n00:01:00,000 --> 00:01:02,000\nSign',type:'srt',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()};
    h.setOriginal(3,1);await h.hooks.loadCandidate(track);
    h.setOriginal(100);await h.hooks.loadCandidate(track);
    h.handle('seasubs-restore');
    assert.deepEqual(h.restored,[['subtitle',3],['caption',1]]);
    assert.equal(h.storage.get('follow-154692|true').enabled,false);
    assert.equal(h.renderTray().find(n=>n.onClick==='seasubs-restore').disabled,true);
    h.flushTimers();assert.equal(h.injected.length,2);
    h.setOriginal(-1);await h.hooks.loadCandidate(track);h.handle('seasubs-restore');
    assert.deepEqual(h.restored.slice(-2),[['subtitle',-1],['caption',-1]]);
    h.change(5);h.hooks.syncFromVideoCore();h.handle('seasubs-restore');assert.equal(h.restored.length,4);
});
test('manual injection dismisses tray and shows cue/source status; automatic injection leaves tray open', async () => {
    const h=harness();
    const track={label:'Publisher Forced',url:'',content:'1\n00:08:15,904 --> 00:08:22,578\nSTARE',type:'srt',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()};
    await h.hooks.loadCandidate(track);
    assert.equal(h.palette.trayClosed,true);
    assert.match(h.renderTray().find(n=>n.className==='ss-status').text,/Sent to player · 1 cues/);
    assert.match(h.renderTray().find(n=>n.className==='ss-source').text,/Publisher Forced/);
    h.palette.trayClosed=false;
    await h.hooks.loadCandidate({...track,automatic:true});assert.equal(h.palette.trayClosed,false);
    h.change(5);h.hooks.syncFromVideoCore();assert.equal(h.renderTray().find(n=>n.className==='ss-status').text,'');
});
test('tray renders wrapped metadata strings and missing covers with primitive image props', () => {
    const h=harness();
    h.setMedia({id:154692,title:{english:new String('Wrapped anime title')},coverImage:{large:new String('https://example.test/cover.jpg')},format:new String('TV')});
    h.hooks.syncFromVideoCore();
    const nodes=h.renderTray();
    assert.equal(nodes.find(n=>n.image?.className==='ss-cover').image.src,'https://example.test/cover.jpg');
    assert.equal(nodes.find(n=>n.image?.className==='ss-cover').image.alt,'Wrapped anime title');
    assert.equal(nodes.find(n=>n.className==='ss-anime-title').text,'Wrapped anime title');
    h.setMedia(undefined);h.hooks.syncFromVideoCore();
    assert.match(h.renderTray().find(n=>n.image?.className==='ss-cover').image.src,/marketplace-icon.png$/);
});
test('slider adaptation is scoped, accessible, bounded and restores exact delays after expansion', () => {
    const h=harness();h.runDomReady();
    const writes=[],input={attributes:{},setAttribute(k,v){writes.push(k);this.attributes[k]=v},setProperty(k,v){this[k]=v}};
    const adapt=h.observers.get('.ss-slider input');adapt([input]);
    assert.equal(input.attributes.type,'range');assert.equal(input.attributes.min,'-5');assert.equal(input.attributes.max,'5');
    assert.equal(input.attributes.step,'0.1');assert.equal(input.attributes['aria-label'],'Subtitle delay in seconds');
    const before=writes.length;adapt([input]);assert.equal(writes.length,before);
    h.fields[0].userChange('120');adapt([input]);
    assert.equal(input.attributes.max,'120');assert.equal(input.value,'120');
    h.fields[0].userChange('-30.125');adapt([input]);assert.equal(input.attributes.min,'-32');assert.equal(input.value,'-30.125');
});
test('native timing inputs autosave exact and slider values without compounding or success spam', async () => {
    const h=harness();
    await h.hooks.loadCandidate({label:'Signs',url:'',content:timingAss(timingSample()),type:'ass',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    const before=h.messages.length;
    h.fields[0].userChange('1250ms');
    assert.equal(h.storage.get('timing-delay-154692|true'),1250);
    assert.equal(h.fields[1].current,'1.250');
    assert.equal(h.hooks.timingCues(h.injected.at(-1).content)[0].start,11.25);
    const injections=h.injected.length;
    h.fields[1].userChange('1.250');assert.equal(h.injected.length,injections);
    h.fields[1].userChange('-0.100');
    assert.equal(h.fields[0].current,'-0.100');
    assert.equal(h.hooks.timingCues(h.injected.at(-1).content)[0].start,9.9);
    h.fields[0].userChange('invalid');h.fields[0].userChange('121');
    assert.equal(h.storage.get('timing-delay-154692|true'),-100);
    assert.equal(h.messages.length,before);
    h.change(5);h.hooks.syncFromVideoCore();assert.equal(h.fields[1].current,'-0.100');
    h.change(5,10165);h.hooks.syncFromVideoCore();assert.equal(h.fields[1].current,'0.000');
});
test('native automation switch saves and restores anime-specific state and cancels pending following', () => {
    const h=harness();h.fields[2].userChange(true);
    assert.equal(h.storage.get('follow-154692|true').enabled,true);
    assert.equal(h.fields[2].current,true);
    h.fields[2].userChange(false);
    assert.equal(h.storage.get('follow-154692|true').enabled,false);
    assert.equal(h.fields[2].current,false);
    h.fields[2].userChange(true);
    h.change(1,10165);h.hooks.syncFromVideoCore();assert.equal(h.fields[2].current,false);
    h.change(4);h.hooks.syncFromVideoCore();assert.equal(h.fields[2].current,true);
    const reloaded=harness(undefined,h.storage);assert.equal(reloaded.fields[2].current,true);
});
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
    h.handle('seasubs-choose');
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
    assert.equal(h.injected.length,1);assert.equal(h.palette.opens,0);
    h.handle('seasubs-choose');
    assert.match(h.palette.items[0].label,/Generated Signs & Songs/);
    assert.match(h.injected[0].content,/Members Souper Wanted/);
});
const stamp = n => new Date(n * 1000).toISOString().slice(11,23);
const vtt = cues => 'WEBVTT\n\n' + cues.map((c,i) => `${i}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n');
const timingSample = () => [
    {start:10,end:12,text:'School entrance sign'}, {start:50,end:52,text:'Student council office'},
    {start:110,end:112,text:'Library opens tomorrow'}, {start:160,end:162,text:'Keep the hallway quiet'},
    {start:210,end:212,text:'Unmatched source translation'}];
const timingAss = cues => '[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nStyle: Signs,Arial,20\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' + cues.map(c => `Dialogue: 0,${stamp(c.start).replace(/^00:/,'0:').slice(0,-1)},${stamp(c.end).replace(/^00:/,'0:').slice(0,-1)},Signs,,0,0,0,,{\\pos(100,200)}${c.text}`).join('\n');
test('anime delay accepts seconds and milliseconds, persists by anime/dub, and never compounds', async () => {
    const h=harness(),content=timingAss(timingSample());
    assert.equal(h.hooks.parseDelay('1.250'),1250);assert.equal(h.hooks.parseDelay('-250ms'),-250);
    assert.equal(h.hooks.parseDelay('1ms'),1);assert.equal(h.hooks.parseDelay('junk'),undefined);assert.equal(h.hooks.parseDelay('121'),undefined);
    await h.hooks.loadCandidate({label:'Signs',url:'',content,type:'ass',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    h.fields[0].setValue('1.250');h.handle('seasubs-delay-apply');
    assert.equal(h.hooks.timingCues(h.injected.at(-1).content)[0].start,11.25);
    h.handle('seasubs-delay-apply');assert.equal(h.hooks.timingCues(h.injected.at(-1).content)[0].start,11.25);
    h.handle('seasubs-delay-plus');assert.equal(h.hooks.timingCues(h.injected.at(-1).content)[0].start,11.35);
    h.handle('seasubs-delay-minus');assert.equal(h.hooks.timingCues(h.injected.at(-1).content)[0].start,11.25);
    const reloaded=harness(undefined,h.storage);assert.equal(reloaded.hooks.animeDelay(),1250);assert.equal(reloaded.fields[0].current,'1.250');
    reloaded.change(5);reloaded.hooks.syncFromVideoCore();assert.equal(reloaded.hooks.animeDelay(),1250);
    reloaded.change(5,154692,false);reloaded.hooks.syncFromVideoCore();assert.equal(reloaded.hooks.animeDelay(),0);
    reloaded.change(1,10165);reloaded.hooks.syncFromVideoCore();assert.equal(reloaded.hooks.animeDelay(),0);
    h.handle('seasubs-delay-reset');assert.equal(h.hooks.timingCues(h.injected.at(-1).content)[0].start,10);
});
test('global offsets preserve drawing events and support VTT/SRT millisecond timing', () => {
    const h=harness(), ass=timingAss([{start:1,end:3,text:'{\\p1}m 0 0 l 10 10'}]);
    assert.match(h.hooks.offsetTrack(ass,250),/0:00:01.25,0:00:03.25/);assert.match(h.hooks.offsetTrack(ass,250),/\\p1/);
    assert.match(h.hooks.offsetTrack(vtt([{start:1,end:3,text:'Caption'}]),1),/00:00:01.001 --> 00:00:03.001/);
    assert.match(h.hooks.offsetTrack('1\n00:00:01,000 --> 00:00:03,000\nCaption',-250),/00:00:00,750 --> 00:00:02,750/);
    assert.ok(!h.hooks.offsetTrack(ass,-4000).includes('Dialogue:'));
});
test('per-sign editing moves only the chosen cue and combines with the anime offset', async () => {
    const h=harness(),content=timingAss(timingSample());
    await h.hooks.loadCandidate({label:'Signs',url:'https://example/signs.ass',content,type:'ass',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    h.hooks.applyAnimeDelay(1250);h.setPosition(11.5);h.handle('seasubs-sign-timing');
    assert.match(h.palette.items[0].label,/School entrance sign/);h.palette.items[0].onSelect();
    h.palette.items.find(i=>i.value==='0.5').onSelect();
    assert.deepEqual(Array.from(h.hooks.timingCues(h.injected.at(-1).content),c=>c.start),[11.75,51.25,111.25,161.25,211.25]);
    h.hooks.applyAnimeDelay(0);assert.deepEqual(Array.from(h.hooks.timingCues(h.injected.at(-1).content),c=>c.start),[10.5,50,110,160,210]);
    assert.equal(h.hooks.shiftSign(content,h.hooks.timingCues(content)[0],-11).changed,0);
});
test('stale sign editor cannot change another episode', async () => {
    const h=harness();await h.hooks.loadCandidate({label:'Signs',url:'',content:timingAss(timingSample()),type:'ass',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    h.handle('seasubs-sign-timing');h.palette.items[0].onSelect();const later=h.palette.items.find(i=>i.value==='1');
    h.change(5);later.onSelect();assert.equal(h.injected.length,1);
});
test('search spinner blocks duplicate requests and clears after failure', async () => {
    const h=harness(async()=>{throw Error('blocked')});let finish;
    h.sandbox.__ctx.anime.getAnimeMetadata=()=>new Promise(resolve=>{finish=resolve});
    const pending=h.hooks.search();
    let button=h.renderTray().find(i=>i.onClick==='seasubs-search');assert.equal(button.loading,true);assert.equal(button.disabled,true);
    await h.hooks.search();finish({episodes:{}});await pending;
    button=h.renderTray().find(i=>i.onClick==='seasubs-search');assert.equal(button.loading,false);assert.equal(button.disabled,false);
});
test('track download spinner clears when compressed subtitle download fails', async () => {
    const h=harness();let finish;h.sandbox.__ctx.fetch=()=>new Promise(resolve=>{finish=resolve});
    const pending=h.hooks.loadCandidate({label:'Signs',url:'https://cdn.test/subtitle.ass.xz',type:'ass',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    assert.equal(h.renderTray().find(i=>i.onClick==='seasubs-search').loading,true);
    finish({ok:false,status:403});await pending;
    assert.equal(h.renderTray().find(i=>i.onClick==='seasubs-search').loading,false);assert.equal(h.injected.length,0);
});
test('simultaneous inspections and later selection share one subtitle download', async () => {
    let finish,calls=0;const h=harness(()=>{calls++;return new Promise(resolve=>{finish=resolve})});
    const item={label:'Signs',url:'https://cdn.test/signs.ass',type:'ass',language:'en',score:1000,mode:'direct'};
    const first=h.hooks.readCandidate(item),second=h.hooks.readCandidate({...item});
    assert.equal(calls,1);finish(response(timingAss(timingSample())));
    assert.equal(await first,await second);
    await h.hooks.loadCandidate({...item,playback:h.hooks.playbackKey()});assert.equal(calls,1);assert.equal(h.injected.length,1);
});
test('failed downloads are briefly reused but never injected as player URLs', async () => {
    let calls=0;const h=harness(async()=>{calls++;return {ok:false,status:403}});
    const item={label:'Signs',url:'https://cdn.test/blocked.vtt',type:'vtt',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()};
    await h.hooks.loadCandidate(item);await h.hooks.loadCandidate({...item});assert.equal(calls,1);
    assert.equal(h.injected.length,0);assert.ok(h.messages.some(m=>/could not be downloaded/.test(m)));
});
test('actual ASS content overrides wrong SSA metadata and drops BOM before injection', async () => {
    const h=harness(),content='\uFEFF'+timingAss(timingSample());
    await h.hooks.loadCandidate({label:'Signs',url:'',content,type:'ssa',language:'en',score:1000,mode:'direct',playback:h.hooks.playbackKey()});
    assert.equal(h.injected[0].type,'ass');assert.ok(!h.injected[0].content.startsWith('\uFEFF'));
});
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

test('observed provider host is allowed exactly, without widening CDN permissions', () => {
    const domains=JSON.parse(fs.readFileSync(path.join(root,'Manifest.json'),'utf8')).plugin.permissions.allow.networkAccess.allowedDomains;
    assert.ok(domains.includes('mistcherry.starviolet.top'));
    assert.ok(domains.includes('creekpalm.cherrymossbrook.top'));
    assert.ok(!domains.includes('*.cherrymossbrook.top'));
    assert.ok(!domains.includes('*.starviolet.top'));
    assert.ok(!domains.includes('*'));
});

test('current provider accepts caption text on the observed JPEG path and excludes forbidden or image responses', async () => {
    const url='https://creekpalm.cherrymossbrook.top/a/reference.jpeg';
    for(const kind of ['text','image','forbidden']) {
        const calls=[],h=harness(async target=>{calls.push(target);return kind==='forbidden'?{ok:false,status:403}:response(kind==='image'?'\xff\xd8\xff\xe0JFIF':vtt(timingSample()))});
        h.setTracks([{label:'English (default)',language:'en',uri:url,format:'vtt'}]);
        const items=await h.hooks.currentCandidates();
        assert.deepEqual(calls,[url]);
        if(kind==='text')assert.ok(items.some(item=>item.content.includes('WEBVTT')));
        else assert.equal(items.length,0);
        assert.equal(h.injected.length,0);
    }
});

test('image-looking provider URL can contain subtitle text and proxy headers stay restricted', async () => {
    const calls=[],content=timingAss(timingSample()),remote='https://mistcherry.starviolet.top/a/reference.jpeg';
    const proxy='http://localhost:43211/api/v1/proxy?url='+encodeURIComponent(remote)+'&headers='+encodeURIComponent(JSON.stringify({Referer:'https://vidnest.fun/',Cookie:'secret'}));
    const h=harness(async (url,opts)=>{calls.push({url,opts});return response(vtt(timingSample()))});
    h.setTracks([{label:'English',language:'en',uri:proxy}]);
    const result=await h.hooks.prepareTiming({label:'Signs',content,url:'',type:'ass',language:'en',score:1000,mode:'direct'});
    assert.ok(result.timingMatched>=3);assert.equal(calls[0].url,remote);
    assert.equal(calls[0].opts.headers.Cookie,undefined);assert.equal(calls[0].opts.timeout,5);
});

test('provider references fall through blocked and real image responses to a later usable track', async () => {
    const calls=[],content=timingAss(timingSample());
    const h=harness(async url=>{calls.push(url);if(url.endsWith('/blocked'))throw Error('network access denied');
        return response(url.endsWith('/image')?'\xff\xd8\xff\xe0JFIF':vtt(timingSample()))});
    h.setTracks(['blocked','image','usable'].map(name=>({label:'English',language:'en',uri:'https://mistcherry.starviolet.top/'+name})));
    const result=await h.hooks.prepareTiming({label:'Signs',content,url:'',type:'ass',language:'en',score:1000,mode:'direct'});
    assert.equal(calls.length,3);assert.ok(result.timingMatched>=3);
});

test('reference attempts are unique, bounded, cached and keep timing when only images are available', async () => {
    const calls=[],content=timingAss(timingSample());
    const h=harness(async url=>{calls.push(url);return response('\xff\xd8\xff\xe0JFIF')});
    const tracks=Array.from({length:10},(_,i)=>({label:'English',language:'en',uri:'https://mistcherry.starviolet.top/'+i+'.jpeg'}));
    h.setTracks([tracks[0],...tracks]);
    const item={label:'Signs',content,url:'',type:'ass',language:'en',score:1000,mode:'direct'};
    const result=await h.hooks.prepareTiming(item);await h.hooks.prepareTiming(item);
    assert.equal(calls.length,6);assert.equal(new Set(calls).size,6);
    assert.equal(result.content,content);assert.equal(result.timingMatched,0);assert.match(result.label,/timing unverified/);
});

test('text references take priority over image-looking references and injected SeaSubs tracks', async () => {
    const calls=[],h=harness(async url=>{calls.push(url);return response(vtt(timingSample()))});
    h.setTracks([{label:'SeaSubs — English',language:'en',uri:'https://fixture.test/self.vtt'},
        {label:'English',language:'en',uri:'https://mistcherry.starviolet.top/image.jpeg'},
        {label:'English',language:'en',uri:'https://fixture.test/eng.vtt'}]);
    await h.hooks.prepareTiming({label:'Signs',content:timingAss(timingSample()),url:'',type:'ass',language:'en',score:1000,mode:'direct'});
    assert.deepEqual(calls,['https://fixture.test/eng.vtt']);
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

const xzFixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'xz-' + name));
function xzBlocks(bytes) {
    const footer = bytes.length - 12;
    const index = footer - (bytes.readUInt32LE(footer + 4) + 1) * 4;
    let pos = index + 1;
    const vli = () => { let n=0, shift=0, v; do { v=bytes[pos++]; n+=(v & 127)*2**shift; shift+=7; } while(v & 128); return n; };
    const count = vli(), blocks = []; let start=12;
    for(let i=0;i<count;i++) {
        const packed=vli(); vli();
        const end=start+Math.ceil(packed/4)*4;
        const checkSize={1:4,4:8,10:32}[bytes[7]];
        blocks.push({start,end,check:end-checkSize,checkSize,padding:Math.ceil(packed/4)*4-packed}); start=end;
    }
    return blocks;
}
for (const name of ['crc32','crc64','sha256']) {
    test(name + ' fixtures validate every block and every integrity-check byte in the isolated UI VM', () => {
        const {hooks,sandbox}=harness(), decode=hooks.SeaSubsXZ.decode;
        assert.equal(sandbox.crypto,undefined); assert.equal(sandbox.require,undefined);
        assert.equal(sandbox.Buffer,undefined);
        for(const suffix of ['', '-multi']) {
            const bytes=xzFixture(name+suffix+'.ass.xz');
            assert.equal(decode(bytes),xzFixture('subtitle.ass').toString('utf8'));
            for(const block of xzBlocks(bytes)) {
                for(let i=0;i<block.checkSize;i++) {
                    const bad=Buffer.from(bytes); bad[block.check+i]^=1;
                    assert.throws(()=>decode(bad),/XZ: data checksum/);
                }
                if(block.padding) {
                    const bad=Buffer.from(bytes); bad[block.check-1]=1;
                    assert.throws(()=>decode(bad),/XZ: block padding/);
                }
            }
            for(const position of [8, bytes.length-12, bytes.length-16, 12+((bytes[12]+1)*4)-4]) {
                const bad=Buffer.from(bytes); bad[position]^=1;
                assert.throws(()=>decode(bad),/XZ: .*checksum/);
            }
            assert.throws(()=>decode(bytes.subarray(0,bytes.length-1)),/XZ:/);
        }
    });
    test(name + ' large-dictionary subtitle fetch caches verified plaintext; corrupted checks never inject', async () => {
        const bytes=xzFixture(name+'-dict64.ass.xz'); let calls=0;
        const h=harness(async()=>{calls++; return {ok:true,body:Uint8Array.from(bytes)};});
        const item={label:'English Signs',url:'https://fixture.test/'+name+'.ass.xz',type:'ass',language:'en',mode:'direct',score:1000};
        const texts=await Promise.all([h.hooks.readCandidate(item),h.hooks.readCandidate({...item})]);
        assert.equal(texts[0],xzFixture('subtitle.ass').toString('utf8')); assert.equal(texts[1],texts[0]);
        assert.equal(await h.hooks.readCandidate({...item}),texts[0]); assert.equal(calls,1);
        await h.hooks.loadCandidate({...item,playback:h.hooks.playbackKey()}); assert.equal(h.injected.length,1); assert.equal(calls,1);
        const bad=Buffer.from(bytes); bad[xzBlocks(bytes)[0].check]^=1;
        let failures=0; const rejected=harness(async()=>{failures++;return {ok:true,body:Uint8Array.from(bad)};});
        assert.equal(await rejected.hooks.readCandidate(item),'');
        await rejected.hooks.loadCandidate({...item,playback:rejected.hooks.playbackKey()}); assert.equal(rejected.injected.length,0); assert.equal(failures,1);
    });
}
test('XZ retains input, output and block-count limits and rejects unknown or mismatched checks', () => {
    const decode=harness().hooks.SeaSubsXZ.decode;
    assert.throws(()=>decode(new Uint8Array(2*1024*1024+1)),/XZ: input size/);
    for(const [name,error] of [['output-limit','output limit'],['block-limit','block count']])
        assert.throws(()=>decode(xzFixture(name+'.xz')),new RegExp('XZ: '+error));
    for(const id of [0,2,3,5,15,0x84]) {
        const bad=Buffer.from(xzFixture('crc64.ass.xz'));bad[7]=id;
        assert.throws(()=>decode(bad),/XZ: unsupported stream flags\/check/);
    }
    const bad=Buffer.from(xzFixture('crc64.ass.xz'));bad[bad.length-3]=1;
    assert.throws(()=>decode(bad),/XZ: footer/);
});

function xzHeaderProperty(bytes, property, padding = false) {
    const changed=Buffer.from(bytes), end=12+(changed[12]+1)*4;
    changed[padding ? 17 : 16]=property;
    let crc=0xffffffff;
    for(const v of changed.subarray(12,end-4)) { crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    changed.writeUInt32LE((crc^0xffffffff)>>>0,end-4);
    return changed;
}
test('large valid XZ dictionaries decode with bounded allocations and preserve integrity checks', () => {
    const allocations=[];
    const boundedArray=new Proxy(Uint8Array,{construct(target,args){
        const size=typeof args[0]==='number'?args[0]:args[0]?.byteLength || args[0]?.length || 0;
        assert.ok(size<=2*1024*1024+64,'unexpected allocation: '+size);
        allocations.push(size);return Reflect.construct(target,args);
    }});
    const decode=harness(undefined,new Map(),{Uint8Array:boundedArray}).hooks.SeaSubsXZ.decode;
    const expected=xzFixture('subtitle.ass').toString('utf8');
    assert.equal(decode(xzFixture('dictionary-16m.xz')),expected);
    for(const name of ['crc32','crc64','sha256']) {
        for(const size of ['dict64','dictmax']) {
            const bytes=xzFixture(name+'-'+size+'.ass.xz');
            assert.equal(decode(bytes),expected);
            for(const block of xzBlocks(bytes)) for(let i=0;i<block.checkSize;i++) {
                const bad=Buffer.from(bytes);bad[block.check+i]^=1;
                assert.throws(()=>decode(bad),/XZ: data checksum/);
            }
        }
        // Exercise signed-shift edge cases in the dependency's dictionary parser.
        for(const property of [0,20,22,24,28,37,38,39,40])
            assert.equal(decode(xzHeaderProperty(xzFixture(name+'.ass.xz'),property)),expected);
    }
    assert.ok(allocations.includes(2*1024*1024));
    for(const property of [41,63,64,128,255])
        assert.throws(()=>decode(xzHeaderProperty(xzFixture('crc64.ass.xz'),property)),/XZ: invalid dictionary property/);
    assert.throws(()=>decode(xzHeaderProperty(xzFixture('crc64-dict64.ass.xz'),1,true)),/XZ: block header padding/);
    assert.throws(()=>decode(xzHeaderProperty(xzFixture('output-limit.xz'),28)),/XZ: output limit/);
});

test('captured Daemons Episode 5 large-dictionary attachments match liblzma and inject cached plaintext',
    {skip: !process.env.SEASUBS_LIVE_XZ_DIR}, async () => {
    const dir=process.env.SEASUBS_LIVE_XZ_DIR;
    for(let i=0;i<4;i++) {
        const bytes=fs.readFileSync(path.join(dir,'attachment-'+i+'.ass.xz'));
        const expected=fs.readFileSync(path.join(dir,'attachment-'+i+'.ass'),'utf8');
        let calls=0;const h=harness(async()=>{calls++;return {ok:true,body:Uint8Array.from(bytes)};});
        assert.equal(bytes[16],28);assert.equal(h.hooks.SeaSubsXZ.decode(bytes),expected);
        const item={label:'English Signs',url:'https://storage.animetosho.net/releases/test/track'+i+'.ass.xz',type:'ass',language:'en',mode:'direct',score:1000,playback:h.hooks.playbackKey()};
        assert.equal(await h.hooks.readCandidate(item),expected.replace(/^\uFEFF/,''));
        await h.hooks.loadCandidate(item);assert.equal(h.injected.length,1);assert.equal(calls,1);
    }
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
test('failed English fetch is excluded instead of offered as a broken player track', async () => {
    const h = harness(async () => ({ok:false,status:403}));
    const results = await h.hooks.inspectCandidates([{label:'Animeya dub — English',url:'https://cdn/test.vtt',type:'vtt',sourceMode:'dub',score:0}]);
    assert.equal(results.length,0);
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
        if (url.includes('feed.animetosho.xyz/feed/json?eid=')) {
            const eid = Number(new URL(url).searchParams.get('eid'));
            if (eid === 271606 && waitForEp5) await waitForEp5;
            return response(JSON.stringify([{id:eid,title:'[Yameii] English Dub',status:'complete'}]));
        }
        if (url.includes('show=torrent')) return response(JSON.stringify({title:'[Yameii] English Dub',files:[{attachments:[{id:Number(new URL(url).searchParams.get('id')),type:'subtitle',url:'https://fixture.test/storage/attach/signs.ass.xz',info:{codec:'ASS',lang:'eng',name:'English Signs'}}]}]}));
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
    assert.equal(calls.length,3); assert.equal(h.injected.length,1);assert.equal(h.palette.opens,0);
    h.handle('seasubs-choose');assert.match(h.palette.items[0].label,/English Signs/);
    assert.ok(calls.every(url => !url.includes('animeya') && !url.includes('feed.animetosho.org') && !url.includes('nyaa.si')));
});
test('unverified captions still require explicit selection after search completes', async () => {
    const h=harness(),item={label:'Preview English',url:'',content:vtt(timingSample()),type:'vtt',language:'en',score:10,mode:'direct'};
    await h.hooks.presentSearchResults([item],h.hooks.playbackKey());
    assert.equal(h.injected.length,0);assert.equal(h.palette.visible,true);assert.equal(h.storage.size,0);
    assert.ok(h.messages.some(m=>/search is complete/.test(m)));
});
test('wider search keeps verified alternatives selectable without silently changing tracks', async () => {
    const h=harness(),item={label:'English Signs',url:'',content:timingAss(timingSample()),type:'ass',language:'en',score:1000,mode:'direct'};
    await h.hooks.presentSearchResults([item],h.hooks.playbackKey(),false,true);
    assert.equal(h.injected.length,0);assert.equal(h.palette.visible,true);
});
test('selecting an alternative dismisses picker immediately while its download is pending', async () => {
    let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve}));
    h.hooks.showCandidates([{label:'Signs',url:'https://cdn.test/blocked.ass',type:'ass',language:'en',score:1000,mode:'direct'}],h.hooks.playbackKey());
    assert.equal(h.palette.visible,true);h.palette.items[0].onSelect();assert.equal(h.palette.visible,false);
    assert.equal(h.renderTray().find(i=>i.onClick==='seasubs-search').loading,true);
    finish({ok:false,status:403});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.injected.length,0);assert.equal(h.renderTray().find(i=>i.onClick==='seasubs-search').loading,false);
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
    assert.equal(h.injected.length,1);assert.equal(h.palette.opens,0);
    h.handle('seasubs-choose');
    assert.ok(h.palette.items.length); assert.match(h.palette.items[0].label,/English Signs/);
    await new Promise(r => setImmediate(r));
    assert.equal(h.injected.length,1); assert.equal(h.injected[0].type,'ass');
    assert.equal((h.injected[0].content.match(/^Dialogue:/gm)||[]).length,20);
    assert.equal(h.injected[0].content,fs.readFileSync(path.join(dir,'signs-raw.ass'),'utf8').replace(/^\uFEFF/,''));
    const full = fs.readFileSync(path.join(dir,'full-raw.ass'),'utf8');
    const derived = h.hooks.deriveSignsSongsAss(full);
    assert.ok(derived.count > 0 && derived.count < 313);
    console.log('Live full ASS: 313 events; derived signs/song events:',derived.count);
});

test('Nyaa RSS decodes entities and rejects malformed, duplicate, wrong-episode and foreign IDs',()=>{
 const h=harness(),hash='a'.repeat(40);
 const item=(name,id=123,domain='nyaa.si')=>'<item><title>'+name+'</title><guid isPermaLink="true">https://'+domain+'/view/'+id+'</guid><nyaa:infoHash>'+hash+'</nyaa:infoHash></item>';
 const rows=h.hooks.parseNyaaRss('<rss>'+item('Title &amp; Songs - 04')+item('Duplicate',123)+item('Wrong - 05',124)+item('Foreign',125,'fake.test')+'</rss>');
 assert.equal(rows.length,1);assert.equal(rows[0].title,'Title & Songs - 04');
 assert.equal(h.hooks.parseNyaaRss('<html>blocked</html>').length,0);
});
test('Nyaa batch lookup checks torrent identity and selects only the requested underscored episode',async()=>{
 const hash='b'.repeat(40),calls=[];
 const h=harness(async url=>{
 calls.push(url);
 if(url.includes('nyaa.si/?'))return response('<rss><item><title>Girlfriend, Girlfriend Season 2 [Dual Audio]</title><guid>https://nyaa.si/view/123</guid><nyaa:infoHash>'+hash+'</nyaa:infoHash></item></rss>');
 if(url.includes('nyaa_id=123'))return response(JSON.stringify({nyaa_id:123,info_hash:hash,title:'Girlfriend, Girlfriend Season 2',files:[{filename:'Title_-_04_.mkv',attachments:[{type:'subtitle',id:1,url:'https://fixture.test/sign.ass',info:{language_code:'eng',format:'ASS'}}]},{filename:'Title_-_05_.mkv',attachments:[{type:'subtitle',id:2,url:'https://fixture.test/wrong.ass',info:{language_code:'eng',format:'ASS'}}]}]}));
 if(url==='https://fixture.test/sign.ass')return response(timingAss(timingSample()));
 throw Error('Unexpected '+url);
 });
 const result=await h.hooks.searchNyaa();assert.equal(result.length,1);assert.match(result[0].label,/Nyaa.*Generated Signs/);assert.equal(result[0].mode,'direct');
 assert.equal(calls.length,3);assert.ok(!calls.some(url=>url.includes('wrong.ass')));
 await h.hooks.searchNyaa();assert.equal(calls.length,3);
});
test('unlabeled sparse ASS companion is inferred by full-track text and timing, not generic styles',async()=>{
 const h=harness();
 const cues=Array.from({length:120},(_,i)=>({start:i*10,end:i*10+2,text:'caption '+i}));
 const make=c=>timingAss(c).replace(/,Signs,/g,',Default,');
 const label='Nyaa — Generate Signs & Songs — English ASS — release';
 const items=await h.hooks.inspectTorrentChoices([{label,url:'full',content:make(cues),type:'ass',mode:'derive',score:100},{label,url:'signs',content:make(cues.filter((_,i)=>i%10===0)),type:'ass',mode:'derive',score:100}]);
 assert.equal(items.length,1);assert.equal(items[0].url,'signs');assert.match(items[0].label,/content compared/);assert.equal(items[0].score,2100);
 const truncated=await h.hooks.inspectTorrentChoices([{label,url:'full',content:make(cues),type:'ass',mode:'derive',score:100},{label,url:'partial',content:make(cues.slice(0,10)),type:'ass',mode:'derive',score:100}]);assert.equal(truncated.length,0);
});
test('source deadline ends a stuck fetch and ignores its late completion',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>{resolve=r}));const pending=h.hooks.sourceFetch('https://fixture.test/hung');
 await Promise.resolve();h.flushTimers(true);await assert.rejects(pending,/timed out/);resolve(response('[]'));await settle();
});
test('failed feed is tried once per search and skipped on a repeated search during backoff',async()=>{
 const calls=[],h=harness(async url=>{calls.push(url);throw Error('network unavailable')});
 await h.hooks.searchAnimeTosho();const feeds=calls.filter(url=>url.includes('feed.animetosho')&&url.includes('eid='));assert.equal(feeds.length,2);
 assert.equal(calls.filter(url=>url.includes('nyaa.si')).length,1);
 const count=calls.length;await h.hooks.searchAnimeTosho();assert.ok(!calls.slice(count).some(url=>url.includes('feed.animetosho')||url.includes('nyaa.si')));
});

test('Nyaa rejects a lookup with the wrong torrent hash before reading attachments',async()=>{
 const calls=[],h=harness(async url=>{calls.push(url);if(url.includes('nyaa.si/?'))return response('<rss><item><title>Girlfriend, Girlfriend Season 2</title><guid>https://nyaa.si/view/123</guid><nyaa:infoHash>'+ 'a'.repeat(40) +'</nyaa:infoHash></item></rss>');return response(JSON.stringify({nyaa_id:123,info_hash:'b'.repeat(40),files:[{filename:'Title_-_04_.mkv',attachments:[{type:'subtitle',url:'https://fixture.test/wrong.ass',info:{language_code:'eng',format:'ASS'}}]}]}));});
 assert.equal((await h.hooks.searchNyaa()).length,0);assert.equal(calls.length,2);assert.ok(!calls.some(url=>url.includes('wrong.ass')));
});
test('episode change during Nyaa lookup discards its attachments',async()=>{
 let finish;const hash='a'.repeat(40),calls=[],h=harness(async url=>{calls.push(url);if(url.includes('nyaa.si/?'))return response('<rss><item><title>Girlfriend, Girlfriend Season 2</title><guid>https://nyaa.si/view/123</guid><nyaa:infoHash>'+hash+'</nyaa:infoHash></item></rss>');return new Promise(resolve=>{finish=resolve});});
 const pending=h.hooks.searchNyaa();await settle();h.change(5);h.hooks.syncFromVideoCore();finish(response(JSON.stringify({nyaa_id:123,info_hash:hash,files:[]})));assert.equal((await pending).length,0);assert.equal(h.injected.length,0);
});

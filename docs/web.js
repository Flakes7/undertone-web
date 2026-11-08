import {DEFAULT_CLIENT_ID} from "./config.js";
import {SpotifyClient,playlistRows,spotifyImage} from "./spotify.js";
import {LyricsClient} from "./lyrics.js";

const $=id=>document.getElementById(id);
const redirectUri=new URL("./",location.href).href;
const client=new SpotifyClient({storage:sessionStorage,defaultClientId:DEFAULT_CLIENT_ID,redirectUri});
const lyrics=new LyricsClient({storage:localStorage});
const bus=new EventTarget();
let mini=false,revision=0,current=null,currentKey="",playback=null,pollTimer,reading=false,stopped=false;
let lyricTask=new AbortController(),browseTask=new AbortController(),volumeBeforeMute=50,writeVolume=null,volumeWriting=false;
const loaded=new Map();
const emit=(type,payload={})=>bus.dispatchEvent(new MessageEvent("message",{data:{type,payload}}));
const notice=text=>emit("notice",{text});
const status=text=>{$("webStatus").textContent=text;};
const account=()=>{
  emit("spotifyAccount",{connected:client.connected,connecting:false,clientId:client.clientId,redirectUri});
  $("webConnect").textContent=client.connected ? "Your library" : "Connect Spotify";
};
const windowState=()=>emit("window",{mini,miniPinned:false,maximized:!!document.fullscreenElement});
const problem=e=>e.name==="TimeoutError" ? "The connection took too long. Please try again." : e instanceof TypeError ? "Couldn’t connect. Check your internet connection and try again." : e.message;
function external(url) { window.open(url,"_blank","noopener,noreferrer"); }
function clearTrack() {
  current=null;currentKey="";playback=null;lyricTask.abort();
  emit("idle",{reason:"waiting"});emit("volume",{available:false,value:0,muted:false});
}
async function getLyrics() {
  if(!current)return;
  lyricTask.abort();lyricTask=new AbortController();
  const id=revision,song=current,signal=lyricTask.signal;
  emit("lyrics",{id,kind:"loading"});
  try { const result=await lyrics.find(song,signal);if(!signal.aborted && id===revision)emit("lyrics",{id,...result}); }
  catch(e) { if(e.name!=="AbortError")emit("lyrics",{id,kind:"offline"}); }
}
function volume(p) {
  const value=p?.device?.volume_percent;
  if(value>0)volumeBeforeMute=value;
  emit("volume",{available:!!p?.device?.supports_volume && !p.device.is_restricted && typeof value==="number",value:value??0,muted:value===0});
}
async function poll() {
  clearTimeout(pollTimer);
  if(reading || !client.connected || stopped)return;
  reading=true;
  try {
    const p=await client.api("/me/player");
    if(!client.connected)return;
    playback=p;
    if(!p?.item) { clearTrack();status("Play a song in Spotify. Your lyrics will appear here.");return; }
    const item=p.item, artists=(item.artists||[]).map(a=>a.name).join(", ");
    const key=[item.uri,item.name,item.album?.name].join("|");
    if(key!==currentKey) {
      currentKey=key;revision++;
      current={title:item.name,artist:artists || item.show?.name || "Spotify",album:item.album?.name||"",duration:(item.duration_ms||0)/1000};
      emit("track",{id:revision,...current});emit("art",{id:revision,image:spotifyImage(item.album || item)});
      if(item.type==="track")void getLyrics();else{lyricTask.abort();emit("lyrics",{id:revision,kind:"instrumental"});}
    }
    const disallowed=p.actions?.disallows || p.actions || {};
    emit("playback",{id:revision,position:(p.progress_ms||0)/1000,duration:current.duration,playing:p.is_playing,rate:1,timing:typeof p.progress_ms==="number",seek:!disallowed.seeking,toggle:!p.device?.is_restricted && !(p.is_playing?disallowed.pausing:disallowed.resuming),next:!disallowed.skipping_next,previous:!disallowed.skipping_prev});
    volume(p);
    status((p.is_playing?"Playing":"Paused")+" on "+(p.device?.name||"Spotify")+(p.device?.supports_volume===false?" · use device volume buttons":""));
  } catch(e) {
    if(e.name!=="AbortError") {
      status(problem(e));
      if(current)emit("playback",{id:revision,position:(playback?.progress_ms||0)/1000,duration:current.duration,playing:false,rate:1,timing:false,seek:false,toggle:false,next:false,previous:false});
      if(!client.connected){account();clearTrack();}
    }
  } finally {
    reading=false;
    if(client.connected && !stopped)pollTimer=setTimeout(poll,Math.max(document.hidden?15000:3000,client.blockedUntil-Date.now()));
  }
}
function schedulePoll() { clearTimeout(pollTimer);pollTimer=setTimeout(poll,350); }
function requireCurrent(data) { return current && data.id===revision; }
async function devices() {
  const result=await client.api("/me/player/devices");
  return (result?.devices||[]).filter(d=>d.id&&!d.is_restricted).map(d=>({id:d.id,name:d.name,type:d.type,active:d.is_active}));
}
async function setVolume(value) {
  if(!playback?.device?.supports_volume || playback.device.is_restricted)throw new Error("Use the volume buttons on your playback device.");
  writeVolume={value:Math.round(Math.max(0,Math.min(100,value))),device:playback.device.id};
  if(volumeWriting)return;
  volumeWriting=true;
  try {
    while(writeVolume) { const next=writeVolume;writeVolume=null;await client.api("/me/player/volume?"+new URLSearchParams({volume_percent:next.value,device_id:next.device}),{method:"PUT"}); }
  } finally {volumeWriting=false;schedulePoll();}
}
async function handle(data) {
  const {action,request}=data;
  try {
    switch(action) {
      case "ready":windowState();return;
      case "spotifyState":account();return;
      case "mini":mini=!!data.value;windowState();return;
      case "maximize":
        if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
        return;
      case "pin":case "miniPin":case "resize":return;
      case "spotify":external("https://open.spotify.com/");return;
      case "spotifyDashboard":external("https://developer.spotify.com/dashboard");return;
      case "spotifyConnect":location.assign(await client.authorize(data.clientId.trim()));return;
      case "spotifyDisconnect":
        client.disconnect();clearTimeout(pollTimer);browseTask.abort();lyricTask.abort();loaded.clear();account();clearTrack();status("Connect Spotify, or explore the silent preview.");return;
      case "spotifyCancel":client.storage.removeItem("undertone.oauth");account();return;
      case "spotifyDevices":emit("spotifyDevices",{items:await devices()});return;
      case "spotifyPlaylistOpen":
        if(/^[A-Za-z0-9]{22}$/.test(data.playlist))external("https://open.spotify.com/playlist/"+data.playlist);return;
      case "spotifyBrowse": {
        browseTask.abort();browseTask=new AbortController();const signal=browseTask.signal;
        const offset=Number(data.offset),playlist=data.playlist;
        if(!Number.isInteger(offset)||offset<0||offset>100000)throw new Error("Reload your library to continue.");
        if(playlist&&!/^[A-Za-z0-9]{22}$/.test(playlist))throw new Error("Choose a playlist from your library.");
        const page=await client.api((playlist?`/playlists/${playlist}/items`:"/me/playlists")+`?limit=50&offset=${offset}`,{signal});
        if(signal.aborted)return;
        let items;
        if(playlist) {
          items=playlistRows(page,offset);
          if(offset===0||!loaded.has(playlist))loaded.set(playlist,new Map());
          for(const row of items)loaded.get(playlist).set(row.index,row);
        } else items=(page.items||[]).filter(p=>p&&/^[A-Za-z0-9]{22}$/.test(p.id)).map(p=>({id:p.id,name:p.name,image:spotifyImage(p),owner:p.owner?.display_name||"",count:p.items?.total??p.tracks?.total??0}));
        emit("spotifyPage",{request,playlist:playlist||"",offset,items,next:page.next&&page.items?.length?offset+page.items.length:null});return;
      }
      case "spotifyPlay": {
        const row=loaded.get(data.playlist)?.get(data.index);
        if(!row?.playable)throw new Error("Reload the playlist and choose an available song.");
        const available=await devices();
        const target=available.find(d=>data.device?d.id===data.device:d.active);
        if(!target)throw new Error("Open Spotify and choose a device in the library’s “Play on” selector.");
        await client.api("/me/player/play?device_id="+encodeURIComponent(target.id),{method:"PUT",body:{context_uri:"spotify:playlist:"+data.playlist,offset:{position:row.index},position_ms:0}});
        emit("spotifyPlayed",{request,playlist:data.playlist,index:row.index,title:row.name});schedulePoll();return;
      }
      case "playPause":case "previous":case "next":case "seek": {
        if(!requireCurrent(data))return;
        const device=playback?.device?.id;
        if(!device)throw new Error("Open Spotify on a device first.");
        let command=action==="playPause"?(playback.is_playing?"pause":"play"):action;
        const query=new URLSearchParams({device_id:device});
        if(action==="seek")query.set("position_ms",String(Math.round(Math.max(0,Math.min(current.duration,Number(data.position)||0))*1000)));
        await client.api("/me/player/"+command+"?"+query,{method:["next","previous"].includes(action)?"POST":"PUT"});schedulePoll();return;
      }
      case "volume":await setVolume(Number(data.value));return;
      case "mute":await setVolume(data.value?0:volumeBeforeMute||50);return;
      case "retry":if(requireCurrent(data))void getLyrics();return;
      case "import":if(requireCurrent(data)){$("lrcFile").dataset.track=revision;$("lrcFile").click();}return;
    }
  } catch(e) {
    if(e.name==="AbortError")return;
    if(action.startsWith("spotify")){account();emit("spotifyError",{action,request,text:problem(e)});}else notice(problem(e));
  }
}
window.UndertoneBridge={postMessage:data=>void handle(data),addEventListener:(...args)=>bus.addEventListener(...args)};
await import("./timing.js");await import("./player.js");await import("./library.js");
$("redirectAddress").textContent=redirectUri;
$("webConnect").onclick=()=>{$("libraryToggle").click();};
$("lrcFile").onchange=async event=>{
  const file=event.target.files[0],id=Number(event.target.dataset.track);event.target.value="";
  if(!file||id!==revision||!current)return;
  if(file.size>1048576){notice("Choose an LRC file smaller than 1 MB.");return;}
  const text=await file.text();
  if(id!==revision)return;
  if(!LyricTiming.parse(text).some(r=>!r.rest)){notice("This file needs lyric timestamps, such as [00:12.50].");return;}
  lyricTask.abort();lyrics.store(current,{kind:"synced",text});emit("lyrics",{id,kind:"synced",text});
};
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void poll();});
document.addEventListener("fullscreenchange",windowState);
addEventListener("online",()=>void poll());
addEventListener("offline",()=>status("You’re offline. Cached lyrics are still available."));
addEventListener("pagehide",()=>{stopped=true;clearTimeout(pollTimer);lyricTask.abort();browseTask.abort();});
addEventListener("pageshow",()=>{stopped=false;if(client.connected)void poll();});
const params=new URLSearchParams(location.search);
// Remove the short-lived authorization code from history before any remote images load.
if(params.has("code")||params.has("error"))history.replaceState(null,"",redirectUri);
try { const connected=await client.callback(params);account();if(connected)notice("Spotify connected. Play a song in Spotify to follow along."); }
catch(e){account();$("libraryToggle").click();$("connectStatus").textContent=problem(e);status(problem(e));}
if(client.connected)void poll();else status("Connect Spotify, or explore the silent preview.");
if(!document.documentElement.requestFullscreen)$("maximize").hidden=true;
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
let installPrompt;
addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;$("installApp").hidden=false;});
$("installApp").onclick=async()=>{
  if(installPrompt){await installPrompt.prompt();installPrompt=null;$("installApp").hidden=true;}
  else notice("On iPhone: Safari → Share → Add to Home Screen. On Android: browser menu → Install app.");
};

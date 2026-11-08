const normalize = s => String(s || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const cleanTitle = s => s.replace(/\s*[-–(\[]\s*(feat\.?|featuring|\d{4} remaster|remaster(ed)?)[^\n]*$/i, "").trim();
const primary = s => s.split(/, |; | feat\.? | featuring | & /i)[0].trim();
export function bestMatch(entries,song) {
  return entries.filter(e => e.trackName && e.artistName && (normalize(cleanTitle(e.trackName))===normalize(cleanTitle(song.title)) || normalize(e.trackName)===normalize(cleanTitle(song.title)).repeat(2)))
    .filter(e => normalize(primary(e.artistName))===normalize(primary(song.artist)) || normalize(e.artistName)===normalize(song.artist))
    .filter(e => !song.duration || (e.duration>0 && Math.abs(e.duration-song.duration)<=5))
    .filter(e => e.instrumental || e.syncedLyrics || e.plainLyrics)
    .sort((a,b) => Number(!!(b.syncedLyrics||b.instrumental))-Number(!!(a.syncedLyrics||a.instrumental)) || Number(normalize(b.albumName)===normalize(song.album))-Number(normalize(a.albumName)===normalize(song.album)) || Math.abs(a.duration-song.duration)-Math.abs(b.duration-song.duration))[0];
}
export class LyricsClient {
  constructor({storage,fetchImpl=globalThis.fetch.bind(globalThis),now=Date.now}) { Object.assign(this,{storage,fetch:fetchImpl,now});this.blockedUntil=0; }
  key(song) { return "undertone.lyrics." + JSON.stringify([song.title,song.artist,song.album,Math.round(song.duration)]); }
  cached(song) { try { return JSON.parse(this.storage.getItem(this.key(song)) || "null"); } catch{return null;} }
  store(song,value) {
    try {
      const keys = Object.keys(this.storage).filter(k=>k.startsWith("undertone.lyrics."));
      if (keys.length>=80) this.storage.removeItem(keys[0]);
      this.storage.setItem(this.key(song),JSON.stringify(value));
    } catch { /* Storage limits never prevent listening. */ }
  }
  async read(path,signal) {
    const response = await this.fetch("https://lrclib.net/api/"+path,{signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(9000)]) : AbortSignal.timeout(9000)});
    if (response.status===404) return null;
    if (response.status===429) { this.blockedUntil=this.now()+60000;throw new Error("busy"); }
    if (!response.ok) throw new Error("offline");
    return response.json();
  }
  async find(song,signal) {
    const cached=this.cached(song); if(cached) return cached;
    if(this.blockedUntil>this.now()) return {kind:"busy"};
    try {
      const query=new URLSearchParams({track_name:song.title,artist_name:song.artist});
      let entry=null;
      try { entry=await this.read("get?"+new URLSearchParams({...Object.fromEntries(query),album_name:song.album,duration:String(Math.round(song.duration))}),signal); }
      catch(e) { if(signal?.aborted || e.message==="busy") throw e; }
      if(entry && !bestMatch([entry],song)) entry=null;
      if(!entry?.syncedLyrics && !entry?.instrumental) {
        try {
          let found=bestMatch(await this.read("search?"+query,signal)||[],song);
          if(!found && (primary(song.artist)!==song.artist || cleanTitle(song.title)!==song.title))
            found=bestMatch(await this.read("search?"+new URLSearchParams({track_name:cleanTitle(song.title),artist_name:primary(song.artist)}),signal)||[],song);
          entry=found || entry;
        } catch(e) {
          // A failed search for timed lyrics must not discard a valid plain result.
          if(signal?.aborted || !entry?.plainLyrics) throw e;
        }
      }
      const result=entry?.instrumental ? {kind:"instrumental"} : entry?.syncedLyrics ? {kind:"synced",text:entry.syncedLyrics} : entry?.plainLyrics ? {kind:"plain",text:entry.plainLyrics} : {kind:"missing"};
      if(signal?.aborted) throw new DOMException("Cancelled","AbortError");
      if(result.kind!=="missing") this.store(song,result);
      return result;
    } catch(e) { if(signal?.aborted) throw e;return {kind:e.message==="busy" ? "busy" : "offline"}; }
  }
}

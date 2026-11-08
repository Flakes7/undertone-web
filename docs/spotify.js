const SCOPES = "playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state";
export const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
export const challengeFor = async (verifier, cryptoImpl = globalThis.crypto) => base64url(await cryptoImpl.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
export class SpotifyError extends Error { constructor(message, status = 0) { super(message); this.status = status; } }
export class SpotifyClient {
  constructor({storage, fetchImpl = globalThis.fetch.bind(globalThis), cryptoImpl = globalThis.crypto, defaultClientId = "", redirectUri, now = Date.now}) {
    Object.assign(this,{storage,fetch:fetchImpl,crypto:cryptoImpl,defaultClientId,redirectUri,now});
    this.generation = 0; this.refreshing = null; this.blockedUntil = 0; this.tokens = null;
    try {
      this.clientId = storage.getItem("undertone.client") || defaultClientId;
      const saved = JSON.parse(storage.getItem("undertone.session") || "null");
      if (saved?.clientId === this.clientId && saved.refresh_token && saved.access_token) this.tokens = saved;
    } catch { this.clientId = defaultClientId; }
  }
  get connected() { return !!this.tokens; }
  save(tokens, generation) {
    if (generation !== this.generation) throw new DOMException("Connection changed", "AbortError");
    const next = {...tokens,clientId:this.clientId,expires:this.now() + Number(tokens.expires_in || 3600) * 1000};
    this.storage.setItem("undertone.session",JSON.stringify(next)); this.tokens = next;
  }
  disconnect() {
    this.generation++; this.tokens = null; this.refreshing = null;
    this.storage.removeItem("undertone.session"); this.storage.removeItem("undertone.oauth");
  }
  async authorize(clientId) {
    if (!/^[a-f0-9]{32}$/i.test(clientId)) throw new SpotifyError("Enter the Client ID from your Spotify Developer app.");
    if (!this.crypto?.subtle) throw new SpotifyError("Spotify sign-in needs a secure HTTPS address.");
    this.disconnect(); this.clientId = clientId;
    this.storage.setItem("undertone.client",clientId);
    const verifier = base64url(this.crypto.getRandomValues(new Uint8Array(48)));
    const state = base64url(this.crypto.getRandomValues(new Uint8Array(32)));
    this.storage.setItem("undertone.oauth",JSON.stringify({verifier,state,clientId,redirectUri:this.redirectUri,created:this.now()}));
    return "https://accounts.spotify.com/authorize?" + new URLSearchParams({client_id:clientId,response_type:"code",redirect_uri:this.redirectUri,scope:SCOPES,state,code_challenge_method:"S256",code_challenge:await challengeFor(verifier,this.crypto)});
  }
  async callback(params) {
    if (!params.has("code") && !params.has("error")) return false;
    const pending = JSON.parse(this.storage.getItem("undertone.oauth") || "null");
    this.storage.removeItem("undertone.oauth");
    if (!pending || !params.get("state") || params.get("state") !== pending.state || pending.redirectUri !== this.redirectUri || this.now() - pending.created > 600000)
      throw new SpotifyError("This sign-in expired or came from another tab. Connect Spotify again here.");
    if (params.has("error")) throw new SpotifyError("Spotify sign-in was cancelled. You can connect again whenever you’re ready.");
    this.clientId = pending.clientId;
    const generation = this.generation;
    const tokens = await this.exchange({grant_type:"authorization_code",client_id:this.clientId,code:params.get("code"),redirect_uri:this.redirectUri,code_verifier:pending.verifier});
    this.save(tokens,generation); return true;
  }
  async exchange(fields) {
    const response = await this.fetch("https://accounts.spotify.com/api/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(fields),signal:AbortSignal.timeout(15000)});
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) throw new SpotifyError("Spotify sign-in expired. Connect again and check the redirect address in Connection settings.",401);
      throw new SpotifyError("Spotify sign-in is temporarily unavailable. Try again shortly.",response.status);
    }
    return response.json();
  }
  async token() {
    if (!this.tokens) throw new SpotifyError("Connect Spotify to continue.",401);
    if (this.tokens.expires > this.now() + 60000) return this.tokens.access_token;
    if (!this.refreshing) {
      const generation = this.generation, refresh = this.tokens.refresh_token;
      const pending = this.exchange({grant_type:"refresh_token",refresh_token:refresh,client_id:this.clientId})
        .then(next => { this.save({...next,refresh_token:next.refresh_token || refresh},generation); return this.tokens.access_token; })
        .catch(error => { if (error.status === 401 && generation === this.generation) this.disconnect(); throw error; })
        .finally(() => { if (this.refreshing === pending) this.refreshing = null; });
      this.refreshing = pending;
    }
    return this.refreshing;
  }
  async api(path,{method = "GET",body,signal} = {}) {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid Spotify API path");
    if (this.blockedUntil > this.now()) throw new SpotifyError(`Spotify is busy. Try again in ${Math.ceil((this.blockedUntil-this.now())/1000)} seconds.`,429);
    const generation = this.generation;
    for (let attempt=0;attempt<2;attempt++) {
      const access = await this.token();
      const response = await this.fetch("https://api.spotify.com/v1"+path,{method,headers:{Authorization:"Bearer "+access,...(body ? {"Content-Type":"application/json"} : {})},body:body ? JSON.stringify(body) : undefined,signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)});
      if (generation !== this.generation) throw new DOMException("Connection changed","AbortError");
      if (response.status === 401 && attempt === 0) { if (this.tokens?.access_token === access) this.tokens.expires = 0; continue; }
      if (response.status === 401) { this.disconnect(); throw new SpotifyError("Your Spotify connection expired. Connect again.",401); }
      if (response.status === 429) {
        const wait = response.headers.get("Retry-After");
        this.blockedUntil = /^\d+$/.test(wait || "") ? this.now() + Number(wait)*1000 : Math.max(this.now()+30000,Date.parse(wait)||0);
        throw new SpotifyError(`Spotify is busy. Try again in ${Math.ceil((this.blockedUntil-this.now())/1000)} seconds.`,429);
      }
      if (response.status === 403) throw new SpotifyError(path.startsWith("/playlists/") ? "Spotify only shares songs from playlists you own or collaborate on. You can open this playlist in Spotify." : "Spotify denied access. Playback needs Premium; this Spotify account must also be allowed in the developer app.",403);
      if (response.status === 404) throw new SpotifyError(method !== "GET" ? "Open Spotify on a device, play a song there once, then try again." : "This playlist is no longer available.",404);
      if (!response.ok) throw new SpotifyError("Spotify couldn’t complete that request. Please try again.",response.status);
      return response.status === 204 ? null : response.json();
    }
  }
}
export function playlistRows(page, offset = 0) {
  return (page.items || []).map((entry,index) => {
    const item = entry?.item ?? entry?.track;
    const local = entry?.is_local || item?.is_local;
    const playable = item?.type === "track" && /^spotify:track:[A-Za-z0-9]{22}$/.test(item.uri || "") && !local && item.is_playable !== false && !item.restrictions?.reason;
    return {index:offset+index,name:item?.name || "Unavailable song",artist:(item?.artists || []).map(a=>a.name).join(", "),image:spotifyImage(item?.album),duration:item?.duration_ms || 0,playable,reason:local ? "Local file · open in Spotify" : !playable ? "Unavailable here" : ""};
  });
}
export function spotifyImage(item) {
  return (item?.images || []).find(i => { try {const u=new URL(i.url); return u.protocol==="https:" && (/\.(scdn\.co|spotifycdn\.com)$/i).test(u.hostname);} catch{return false;} })?.url || "";
}

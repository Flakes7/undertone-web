import {test} from "node:test";
import assert from "node:assert/strict";
import {SpotifyClient,challengeFor,playlistRows,spotifyImage} from "../docs/spotify.js";
const id="0123456789abcdef0123456789abcdef";
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...headers}});
function connected(fetchImpl){const store=storage();store.setItem("undertone.session",JSON.stringify({clientId:id,access_token:"old",refresh_token:"refresh",expires:Date.now()+3600000}));return new SpotifyClient({storage:store,defaultClientId:id,redirectUri:"https://example.org/undertone/",fetchImpl});}
test("PKCE matches RFC 7636 test vector",async()=>assert.equal(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
test("authorization binds state, redirect and verifier; state mismatch makes no token request",async()=>{
  let calls=0;const store=storage();const client=new SpotifyClient({storage:store,redirectUri:"https://example.org/undertone/",fetchImpl:async()=>{calls++;return reply({});}});
  const url=new URL(await client.authorize(id));assert.equal(url.searchParams.get("code_challenge_method"),"S256");assert.equal(url.searchParams.get("redirect_uri"),client.redirectUri);
  await assert.rejects(client.callback(new URLSearchParams({code:"code",state:"wrong"})),/another tab/);assert.equal(calls,0);assert.equal(client.connected,false);
});
test("callback stores session without a client secret",async()=>{
  const store=storage();let body;
  const client=new SpotifyClient({storage:store,redirectUri:"https://example.org/undertone/",fetchImpl:async(url,opts)=>{body=opts.body;return reply({access_token:"access",refresh_token:"refresh",expires_in:3600});}});
  const url=new URL(await client.authorize(id));await client.callback(new URLSearchParams({code:"code",state:url.searchParams.get("state")}));
  assert.equal(client.connected,true);assert.equal(body.has("client_secret"),false);assert.equal(store.getItem("undertone.oauth"),null);
  client.disconnect();assert.equal(store.getItem("undertone.session"),null);
});
test("401 refreshes once and retries with new token",async()=>{
  let calls=0;const client=connected(async(url,opts)=>{calls++;if(url.includes("/api/token"))return reply({access_token:"new",expires_in:3600});return opts.headers.Authorization==="Bearer old"?reply({},401):reply({items:[]});});
  assert.deepEqual(await client.api("/me/playlists"),{items:[]});assert.equal(calls,3);assert.equal(client.tokens.refresh_token,"refresh");
});
test("concurrent refresh is shared and disconnect prevents token resurrection",async()=>{
  let resolve,calls=0;const client=connected(async()=>{calls++;return new Promise(r=>resolve=r);});client.tokens.expires=0;
  const a=client.token(),b=client.token();client.disconnect();resolve(reply({access_token:"late",refresh_token:"late",expires_in:3600}));
  const results=await Promise.allSettled([a,b]);assert.equal(calls,1);assert(results.every(r=>r.status==="rejected"));assert.equal(client.connected,false);
});
test("rate limit respects Retry-After across repeated requests",async()=>{
  let calls=0;const client=connected(async()=>{calls++;return reply({},429,{"Retry-After":"30"});});
  await assert.rejects(client.api("/me/player"),/30 seconds/);await assert.rejects(client.api("/me/player"),/seconds/);assert.equal(calls,1);
});
test("playlist offsets preserve null, unavailable, local, duplicate and episode entries",()=>{
  const song={type:"track",uri:"spotify:track:1234567890123456789012",name:"Song",artists:[{name:"Artist"}],duration_ms:10000};
  const rows=playlistRows({items:[null,{item:song},{track:song},{is_local:true,item:song},{item:{type:"episode",name:"Episode"}}]},50);
  assert.deepEqual(rows.map(r=>r.index),[50,51,52,53,54]);assert.deepEqual(rows.map(r=>r.playable),[false,true,true,false,false]);
});
test("artwork accepts Spotify CDN domains and rejects external hosts",()=>{
  assert.equal(spotifyImage({images:[{url:"https://image-cdn-fa.spotifycdn.com/cover"}]}),"https://image-cdn-fa.spotifycdn.com/cover");
  assert.equal(spotifyImage({images:[{url:"https://evil.example/scdn.co"}]}),"");
});

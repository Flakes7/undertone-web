import {test} from "node:test";
import assert from "node:assert/strict";
import {bestMatch,LyricsClient} from "../docs/lyrics.js";
import "../docs/timing.js";
const song={title:"Carmen",artist:"Lana Del Rey",album:"Born To Die",duration:249};
test("catalog timing selects matching recording and rejects alternate artist/version",()=>{
 const base={trackName:"Carmen",artistName:"Lana Del Rey",albumName:"Born To Die",duration:249,syncedLyrics:"[00:00]Example"};
 assert.equal(bestMatch([{...base,trackName:"Carmen (Live)"},{...base,artistName:"Other"},{...base,duration:280},base],song),base);
});
test("missing exact lyrics fall back to search and become cached",async()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};let calls=0;
 const client=new LyricsClient({storage,fetchImpl:async url=>{calls++;return new Response(JSON.stringify(url.includes("/get?")?{}:[{trackName:song.title,artistName:song.artist,albumName:song.album,duration:249,syncedLyrics:"[00:00]Example"}]),{status:url.includes("/get?")?404:200});}});
 assert.equal((await client.find(song)).kind,"synced");assert.equal((await client.find(song)).kind,"synced");assert.equal(calls,2);
});
test("lyric timing handles offsets, backing vocals, and seeking backwards",()=>{
 const rows=LyricTiming.parse("[offset:500]\n[00:02]First line\n[00:05](Backing line)\n[00:10]Last line");
 assert.equal(rows[0].rest,true);assert.equal(rows[2].backing,true);assert.equal(LyricTiming.active(rows,11),3);assert.equal(LyricTiming.active(rows,3),1);
});

test("plain lyrics remain available when the timed-lyric search is offline",async()=>{
 const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const client=new LyricsClient({storage,fetchImpl:async url=>{
   if(url.includes("/search?"))throw new TypeError("Offline");
   return new Response(JSON.stringify({trackName:song.title,artistName:song.artist,duration:249,plainLyrics:"Original test line"}));
 }});
 assert.deepEqual(await client.find(song),{kind:"plain",text:"Original test line"});
});

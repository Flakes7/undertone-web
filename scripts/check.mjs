import {readFile,readdir,access} from "node:fs/promises";
import {spawnSync} from "node:child_process";
const root=new URL("../docs/",import.meta.url);
for(const name of await readdir(root))if(name.endsWith(".js")){
  const result=spawnSync(process.execPath,["--check",new URL(name,root).pathname.replace(/^\/([A-Za-z]:)/,"$1")],{encoding:"utf8"});
  if(result.status!==0)throw new Error(result.stderr);
}
const html=await readFile(new URL("index.html",root),"utf8");
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g))if(!match[1].includes(":")&&!match[1].includes("?"))await access(new URL(match[1],root));
const css=await readFile(new URL("lyric-fonts.css",root),"utf8");
for(const match of css.matchAll(/url\("([^"]+)"\)/g))await access(new URL(match[1],root));
if(!html.includes("viewport-fit=cover"))throw new Error("Missing mobile viewport");
console.log("JavaScript syntax, linked assets, bundled fonts and mobile viewport: PASS");

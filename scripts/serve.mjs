import http from "node:http";
import {readFile,stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(fileURLToPath(new URL("../docs/",import.meta.url)));
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ttf":"font/ttf",".woff2":"font/woff2",".webmanifest":"application/manifest+json",".txt":"text/plain; charset=utf-8"};
http.createServer(async(req,res)=>{
  try{
    let pathname=decodeURIComponent(new URL(req.url,"http://127.0.0.1").pathname);
    if(pathname.endsWith("/"))pathname+="index.html";
    const file=path.resolve(root,"."+pathname);
    if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
    if(!(await stat(file)).isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-cache","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
    res.end(await readFile(file));
  }catch{res.writeHead(404).end("Not found");}
}).listen(5173,"127.0.0.1",()=>console.log("Undertone preview: http://127.0.0.1:5173/"));

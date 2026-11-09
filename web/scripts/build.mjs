import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

execFileSync('python3', ['scripts/source-archive.py']);

await mkdir('dist/client', {recursive:true});
await cp('public', 'dist/client', {recursive:true});
const names = ['index.html', 'style.css', 'app.js', 'sw.js', 'config.js', 'icon.svg', 'manifest.webmanifest', 'about.html', 'source.zip'];
const types = {html:'text/html; charset=utf-8', css:'text/css; charset=utf-8', js:'text/javascript; charset=utf-8', svg:'image/svg+xml', webmanifest:'application/manifest+json', zip:'application/zip'};
const assets = {};
for (const name of names) {
  try { const data = await readFile(`public/${name}`); assets[`/${name}`] = {body:data.toString('base64'), type:types[name.split('.').pop()]}; }
  catch(error) { if (name !== 'source.zip') throw error; }
}
assets['/'] = assets['/index.html'];
const entry = `import worker from './src/worker.mjs';
const assets=${JSON.stringify(assets)};
export default {...worker,async fetch(request,env,ctx){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/'))return worker.fetch(request,env,ctx);
 const asset=assets[path]; if(!asset)return new Response('Not found',{status:404});
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.type,'Cache-Control':path==='/sw.js'?'no-cache':'public, max-age=120','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
}};`;
await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'site-entry.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js',minify:true});
try { await mkdir('dist/.openai',{recursive:true}); await cp('.openai/hosting.json','dist/.openai/hosting.json'); } catch(error) { if(error.code!=='ENOENT')throw error; }
console.log('Built GitHub Pages assets and the Site server.');

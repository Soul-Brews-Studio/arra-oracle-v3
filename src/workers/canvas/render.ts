import { findCanvasPlugin, listCanvasPlugins, type CanvasPluginDescriptor } from '../../canvas/plugins.ts';
import { CANVAS_ORIGIN, canvasPluginPath } from '../../canvas/urls.ts';

export type CanvasPlugin = CanvasPluginDescriptor;

const DEFAULT_PLUGIN = 'wave';
const STUDIO_HOME = 'https://studio.buildwithoracle.com/';

export function normalizePlugin(value: string | null): CanvasPlugin {
  return findCanvasPlugin(value ?? '') ?? findCanvasPlugin(DEFAULT_PLUGIN)!;
}

function titleFor(plugin: CanvasPlugin): string {
  return `Oracle ${plugin.label} Canvas`;
}

function pluginUrl(id: string): string {
  return canvasPluginPath(id);
}

function canonicalUrl(id: string): string {
  return `${CANVAS_ORIGIN}${pluginUrl(id)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function pluginLinks(current: string): string {
  return listCanvasPlugins().map((plugin) => {
    const currentAttr = plugin.id === current ? ' aria-current="page"' : '';
    return `<a href="${pluginUrl(plugin.id)}" data-plugin-link="${plugin.id}"${currentAttr}>${plugin.label}</a>`;
  }).join('');
}

function pluginOptions(current: string): string {
  return listCanvasPlugins().map((plugin) => {
    const selected = plugin.id === current ? ' selected' : '';
    return `<option value="${plugin.id}"${selected}>${plugin.label} · ${plugin.kind}</option>`;
  }).join('');
}

export function renderCanvasApp(plugin: CanvasPlugin, apiBase: string): string {
  const id = plugin.id;
  const title = titleFor(plugin);
  const canonical = canonicalUrl(id);
  const description = `${plugin.description} Runs as a dedicated Oracle canvas subdomain app.`;
  const plugins = listCanvasPlugins().map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    href: pluginUrl(item.id),
    apiPath: 'apiPath' in item ? item.apiPath : undefined,
  }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:type" content="website" />
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#020617;color:#e2e8f0}
body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#164e63 0,#020617 42%);overflow:hidden}
header{position:fixed;inset:1rem 1rem auto;z-index:2;display:grid;gap:.8rem;padding:1rem 1.25rem;border:1px solid rgb(255 255 255/.12);border-radius:1.25rem;background:rgb(2 6 23/.72);backdrop-filter:blur(18px)}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem}nav{display:flex;flex-wrap:wrap;gap:.4rem}a{color:#99f6e4;text-decoration:none;border:1px solid rgb(45 212 191/.25);border-radius:999px;padding:.3rem .55rem;font-size:.75rem}h1{margin:0;font-size:clamp(1.2rem,2.5vw,2rem)}
p{margin:.25rem 0 0;color:#94a3b8}.pill{border:1px solid rgb(45 212 191/.4);border-radius:999px;padding:.45rem .75rem;color:#99f6e4;font-weight:700}
.picker{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}.picker label{font-size:.75rem;color:#94a3b8}.picker select{border:1px solid rgb(45 212 191/.28);border-radius:.8rem;background:#020617;color:#e2e8f0;padding:.45rem .65rem}canvas{display:block;width:100vw;height:100vh}.error{position:fixed;left:1rem;right:1rem;bottom:1rem;color:#fecaca}
</style>
</head>
<body data-plugin="${escapeHtml(id)}" data-kind="${escapeHtml(plugin.kind)}" data-api-base="${escapeHtml(apiBase)}">
<header><div class="top"><div><h1 id="canvas-title">${escapeHtml(title)}</h1><p id="canvas-subtitle">canvas.buildwithoracle.com · plugin=${escapeHtml(id)} · ${escapeHtml(plugin.kind)}</p></div><span class="pill" id="status">loading API</span></div><div class="picker"><label for="plugin-picker">Hot-swap plugin</label><select id="plugin-picker" aria-label="Hot-swap canvas plugin">${pluginOptions(id)}</select><a href="${STUDIO_HOME}" data-studio-home aria-label="Open Oracle Studio home">Studio home</a></div><nav aria-label="Canvas plugins">${pluginLinks(id)}</nav></header>
<canvas id="oracle-canvas" aria-label="${escapeHtml(id)} canvas visualization"></canvas><p class="error" id="error"></p>
<script type="module">
let plugins=${JSON.stringify(plugins)};let plugin=${JSON.stringify(id)};let pluginData={documents:[]};const apiBase=${JSON.stringify(apiBase)};const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');
const CACHE_KEY='oracle.canvas.registry.v1';const DB_NAME='oracle-canvas-cache';
const status=document.getElementById('status');const error=document.getElementById('error');const picker=document.getElementById('plugin-picker');const title=document.getElementById('canvas-title');const subtitle=document.getElementById('canvas-subtitle');let t=0;
function saveLocal(value){try{localStorage.setItem(CACHE_KEY,JSON.stringify({ts:Date.now(),value}))}catch{}}
function readLocal(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'null')}catch{return null}}
function openDb(){return new Promise((resolve)=>{try{if(!('indexedDB'in globalThis))return resolve(null);const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>req.result.createObjectStore('kv');req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null)}catch{resolve(null)}})}
async function readIdb(){const db=await openDb();if(!db)return null;return new Promise((resolve)=>{const tx=db.transaction('kv','readonly');const req=tx.objectStore('kv').get(CACHE_KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>resolve(null)})}
async function saveIdb(value){const db=await openDb();if(!db)return;const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put({ts:Date.now(),value},CACHE_KEY)}
async function cacheRegistry(value){saveLocal(value);await saveIdb(value)}
function normalizeRegistry(value){const list=Array.isArray(value?.plugins)?value.plugins:null;return list?.map((item)=>({id:item.id,label:item.label,kind:item.kind,apiPath:item.apiPath,href:item.standalonePath||item.href||(item.id==='map'||item.id==='planets'?'/'+item.id:'/?plugin='+item.id)})).filter((item)=>item.id&&item.label&&item.kind)}
function useRegistry(value,label){const next=normalizeRegistry(value);if(!next?.length)return false;plugins=next;status.textContent=label;return true}
function useCachedRegistry(entry){return useRegistry(entry?.value,'registry cache ready')}
async function loadRegistry(){useCachedRegistry(readLocal());const cached=await readIdb();if(cached)useCachedRegistry(cached);try{const latest=await (await fetch('/api/plugins?kind=canvas')).json();useRegistry(latest,'registry updated');await cacheRegistry(latest)}catch{await cacheRegistry({plugins})}}
function dataCount(){return Array.isArray(pluginData?.documents)?pluginData.documents.length:0}
function setPluginData(value){pluginData=value||{documents:[]};document.body.dataset.dataCount=String(dataCount())}
async function loadPluginData(meta){setPluginData({documents:[]});if(!meta?.apiPath)return;try{const data=await (await fetch(meta.apiPath,{headers:{accept:'application/json'}})).json();setPluginData(data);status.textContent='data '+dataCount()}catch(e){error.textContent='plugin data unavailable: '+String(e)}}
function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}addEventListener('resize',resize);resize();
function setPlugin(next,replace=false){const meta=plugins.find((item)=>item.id===next);if(!meta)return;plugin=meta.id;document.body.dataset.plugin=plugin;document.body.dataset.kind=meta.kind;picker.value=plugin;title.textContent='Oracle '+meta.label+' Canvas';subtitle.textContent='canvas.buildwithoracle.com · plugin='+meta.id+' · '+meta.kind;document.querySelectorAll('[data-plugin-link]').forEach((a)=>a.toggleAttribute('aria-current',a.dataset.pluginLink===plugin));loadPluginData(meta);if(!replace)history.pushState({plugin},'',meta.href)}picker.addEventListener('change',()=>setPlugin(picker.value));addEventListener('popstate',()=>{const path=location.pathname.slice(1);const query=new URLSearchParams(location.search).get('plugin');setPlugin(query||path||'wave',true)});function dot(x,y,r,c){ctx.beginPath();ctx.fillStyle=c;ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()}
function star(i){dot((i*97+t*200)%innerWidth,(i*53)%innerHeight,1+(i%4),'#e0f2fe')}
function draw(){t+=.012;ctx.clearRect(0,0,innerWidth,innerHeight);ctx.fillStyle='#020617';ctx.fillRect(0,0,innerWidth,innerHeight);const n=Math.min(dataCount(),90);if(plugin==='cube'||plugin==='torus'){ctx.strokeStyle=plugin==='cube'?'#5eead4':'#c4b5fd';ctx.lineWidth=4;ctx.strokeRect(innerWidth/2-90,innerHeight/2-90,180,180);ctx.strokeRect(innerWidth/2-45+Math.sin(t)*40,innerHeight/2-45,90,90)}else if(plugin==='galaxy'){for(let i=0;i<120;i++)star(i)}else if(plugin==='solar'||plugin==='planets'){for(let i=0;i<(n||9);i++){const a=t+i*.72;dot(innerWidth/2+Math.cos(a)*(70+i*26),innerHeight/2+Math.sin(a)*(35+i*14),6+i*.7,i%2?'#67e8f9':'#c4b5fd')}}else if(plugin==='map'||plugin==='map3d'||plugin==='graph3d'){for(let i=0;i<(n||45);i++)dot((i*97)%innerWidth,(Math.sin(t+i)*120+innerHeight/2),3,'#2dd4bf');ctx.strokeStyle='#22d3ee66';ctx.strokeRect(innerWidth*.16,innerHeight*.24,innerWidth*.68,innerHeight*.52)}else{ctx.strokeStyle='#5eead4';ctx.lineWidth=3;ctx.beginPath();for(let x=0;x<innerWidth;x+=8){const y=innerHeight/2+Math.sin(x*.018+t*4)*90;ctx[x?'lineTo':'moveTo'](x,y)}ctx.stroke()}requestAnimationFrame(draw)}draw();
loadPluginData(plugins.find((item)=>item.id===plugin));
loadRegistry();
fetch('/api/health').then(r=>{status.textContent=r.ok?'API online':'API '+r.status}).catch(e=>{status.textContent='API offline';error.textContent=String(e)});
</script>
</body>
</html>`;
}

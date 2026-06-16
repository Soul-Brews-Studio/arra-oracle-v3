import { findCanvasPlugin, listCanvasPlugins, type CanvasPluginDescriptor } from '../../canvas/plugins.ts';

export type CanvasPlugin = CanvasPluginDescriptor;

const DEFAULT_PLUGIN = 'wave';

export function normalizePlugin(value: string | null): CanvasPlugin {
  return findCanvasPlugin(value ?? '') ?? findCanvasPlugin(DEFAULT_PLUGIN)!;
}

function titleFor(plugin: CanvasPlugin): string {
  return `Oracle ${plugin.label} Canvas`;
}

function pluginUrl(id: string): string {
  return id === 'map' || id === 'planets' ? `/${id}` : `/?plugin=${id}`;
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
  const plugins = listCanvasPlugins().map((item) => ({ id: item.id, label: item.label, kind: item.kind, href: pluginUrl(item.id) }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${titleFor(plugin)}</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#020617;color:#e2e8f0}
body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#164e63 0,#020617 42%);overflow:hidden}
header{position:fixed;inset:1rem 1rem auto;z-index:2;display:grid;gap:.8rem;padding:1rem 1.25rem;border:1px solid rgb(255 255 255/.12);border-radius:1.25rem;background:rgb(2 6 23/.72);backdrop-filter:blur(18px)}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem}nav{display:flex;flex-wrap:wrap;gap:.4rem}a{color:#99f6e4;text-decoration:none;border:1px solid rgb(45 212 191/.25);border-radius:999px;padding:.3rem .55rem;font-size:.75rem}h1{margin:0;font-size:clamp(1.2rem,2.5vw,2rem)}
p{margin:.25rem 0 0;color:#94a3b8}.pill{border:1px solid rgb(45 212 191/.4);border-radius:999px;padding:.45rem .75rem;color:#99f6e4;font-weight:700}
.picker{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}.picker label{font-size:.75rem;color:#94a3b8}.picker select{border:1px solid rgb(45 212 191/.28);border-radius:.8rem;background:#020617;color:#e2e8f0;padding:.45rem .65rem}canvas{display:block;width:100vw;height:100vh}.error{position:fixed;left:1rem;right:1rem;bottom:1rem;color:#fecaca}
</style>
</head>
<body data-plugin="${id}" data-kind="${plugin.kind}" data-api-base="${apiBase}">
<header><div class="top"><div><h1 id="canvas-title">${titleFor(plugin)}</h1><p id="canvas-subtitle">canvas.buildwithoracle.com · plugin=${id} · ${plugin.kind}</p></div><span class="pill" id="status">loading API</span></div><div class="picker"><label for="plugin-picker">Hot-swap plugin</label><select id="plugin-picker" aria-label="Hot-swap canvas plugin">${pluginOptions(id)}</select></div><nav aria-label="Canvas plugins">${pluginLinks(id)}</nav></header>
<canvas id="oracle-canvas" aria-label="${id} canvas visualization"></canvas><p class="error" id="error"></p>
<script type="module">
const plugins=${JSON.stringify(plugins)};let plugin=${JSON.stringify(id)};const apiBase=${JSON.stringify(apiBase)};const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');
const status=document.getElementById('status');const error=document.getElementById('error');const picker=document.getElementById('plugin-picker');const title=document.getElementById('canvas-title');const subtitle=document.getElementById('canvas-subtitle');let t=0;
function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}addEventListener('resize',resize);resize();
function setPlugin(next,replace=false){const meta=plugins.find((item)=>item.id===next);if(!meta)return;plugin=meta.id;document.body.dataset.plugin=plugin;document.body.dataset.kind=meta.kind;picker.value=plugin;title.textContent='Oracle '+meta.label+' Canvas';subtitle.textContent='canvas.buildwithoracle.com · plugin='+meta.id+' · '+meta.kind;document.querySelectorAll('[data-plugin-link]').forEach((a)=>a.toggleAttribute('aria-current',a.dataset.pluginLink===plugin));if(!replace)history.pushState({plugin},'',meta.href)}picker.addEventListener('change',()=>setPlugin(picker.value));addEventListener('popstate',()=>{const path=location.pathname.slice(1);const query=new URLSearchParams(location.search).get('plugin');setPlugin(query||path||'wave',true)});function dot(x,y,r,c){ctx.beginPath();ctx.fillStyle=c;ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()}
function star(i){dot((i*97+t*200)%innerWidth,(i*53)%innerHeight,1+(i%4),'#e0f2fe')}
function draw(){t+=.012;ctx.clearRect(0,0,innerWidth,innerHeight);ctx.fillStyle='#020617';ctx.fillRect(0,0,innerWidth,innerHeight);if(plugin==='cube'||plugin==='torus'){ctx.strokeStyle=plugin==='cube'?'#5eead4':'#c4b5fd';ctx.lineWidth=4;ctx.strokeRect(innerWidth/2-90,innerHeight/2-90,180,180);ctx.strokeRect(innerWidth/2-45+Math.sin(t)*40,innerHeight/2-45,90,90)}else if(plugin==='galaxy'){for(let i=0;i<120;i++)star(i)}else if(plugin==='solar'||plugin==='planets'){for(let i=0;i<9;i++){const a=t+i*.72;dot(innerWidth/2+Math.cos(a)*(70+i*26),innerHeight/2+Math.sin(a)*(35+i*14),6+i*.7,i%2?'#67e8f9':'#c4b5fd')}}else if(plugin==='map'||plugin==='map3d'||plugin==='graph3d'){for(let i=0;i<45;i++)dot((i*97)%innerWidth,(Math.sin(t+i)*120+innerHeight/2),3,'#2dd4bf');ctx.strokeStyle='#22d3ee66';ctx.strokeRect(innerWidth*.16,innerHeight*.24,innerWidth*.68,innerHeight*.52)}else{ctx.strokeStyle='#5eead4';ctx.lineWidth=3;ctx.beginPath();for(let x=0;x<innerWidth;x+=8){const y=innerHeight/2+Math.sin(x*.018+t*4)*90;ctx[x?'lineTo':'moveTo'](x,y)}ctx.stroke()}requestAnimationFrame(draw)}draw();
fetch('/api/health').then(r=>{status.textContent=r.ok?'API online':'API '+r.status}).catch(e=>{status.textContent='API offline';error.textContent=String(e)});
</script>
</body>
</html>`;
}

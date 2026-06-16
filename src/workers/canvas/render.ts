export type CanvasPlugin = 'wave' | 'map' | 'planets';

export const CANVAS_PLUGINS: readonly CanvasPlugin[] = ['wave', 'map', 'planets'];

export function normalizePlugin(value: string | null): CanvasPlugin {
  return CANVAS_PLUGINS.includes(value as CanvasPlugin) ? value as CanvasPlugin : 'wave';
}

function titleFor(plugin: CanvasPlugin): string {
  if (plugin === 'map') return 'Oracle Map Canvas';
  if (plugin === 'planets') return 'Oracle Planets Canvas';
  return 'Oracle Wave Canvas';
}

export function renderCanvasApp(plugin: CanvasPlugin, apiBase: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${titleFor(plugin)}</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#020617;color:#e2e8f0}
body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#164e63 0,#020617 42%);overflow:hidden}
header{position:fixed;inset:1rem 1rem auto;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;border:1px solid rgb(255 255 255/.12);border-radius:1.25rem;background:rgb(2 6 23/.72);backdrop-filter:blur(18px)}
h1{margin:0;font-size:clamp(1.2rem,2.5vw,2rem)}
p{margin:.25rem 0 0;color:#94a3b8}.pill{border:1px solid rgb(45 212 191/.4);border-radius:999px;padding:.45rem .75rem;color:#99f6e4;font-weight:700}
canvas{display:block;width:100vw;height:100vh}.error{position:fixed;left:1rem;right:1rem;bottom:1rem;color:#fecaca}
</style>
</head>
<body data-plugin="${plugin}" data-api-base="${apiBase}">
<header><div><h1>${titleFor(plugin)}</h1><p>canvas.buildwithoracle.com · plugin=${plugin}</p></div><span class="pill" id="status">loading API</span></header>
<canvas id="oracle-canvas" aria-label="${plugin} canvas visualization"></canvas><p class="error" id="error"></p>
<script type="module">
const plugin=${JSON.stringify(plugin)};const apiBase=${JSON.stringify(apiBase)};const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');
const status=document.getElementById('status');const error=document.getElementById('error');let t=0;
function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}addEventListener('resize',resize);resize();
function dot(x,y,r,c){ctx.beginPath();ctx.fillStyle=c;ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()}
function draw(){t+=.012;ctx.clearRect(0,0,innerWidth,innerHeight);ctx.fillStyle='#020617';ctx.fillRect(0,0,innerWidth,innerHeight);if(plugin==='planets'){for(let i=0;i<9;i++){const a=t+i*.72;dot(innerWidth/2+Math.cos(a)*(70+i*26),innerHeight/2+Math.sin(a)*(35+i*14),6+i*.7, i%2?'#67e8f9':'#c4b5fd')}}else if(plugin==='map'){for(let i=0;i<45;i++){dot((i*97)%innerWidth,(Math.sin(t+i)*120+innerHeight/2),3,'#2dd4bf')}ctx.strokeStyle='#22d3ee66';ctx.strokeRect(innerWidth*.16,innerHeight*.24,innerWidth*.68,innerHeight*.52)}else{ctx.strokeStyle='#5eead4';ctx.lineWidth=3;ctx.beginPath();for(let x=0;x<innerWidth;x+=8){const y=innerHeight/2+Math.sin(x*.018+t*4)*90;ctx[x?'lineTo':'moveTo'](x,y)}ctx.stroke()}requestAnimationFrame(draw)}draw();
fetch('/api/health').then(r=>{status.textContent=r.ok?'API online':'API '+r.status}).catch(e=>{status.textContent='API offline';error.textContent=String(e)});
</script>
</body>
</html>`;
}

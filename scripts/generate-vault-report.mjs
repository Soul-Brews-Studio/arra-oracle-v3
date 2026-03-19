#!/usr/bin/env node
/**
 * Oracle Vault Report Generator
 * Scans ghq repos + oracle-vault → generates HTML dashboard + JSON export
 * Usage: node scripts/generate-vault-report.mjs [--push]
 */

import { writeFileSync, readdirSync, existsSync, lstatSync, readlinkSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// ── Config ───────────────────────────────────────────────────────────────────

const GHQ_ROOT = execSync('ghq root', { encoding: 'utf-8' }).trim();
const VAULT = process.env.ORACLE_VAULT_PATH
  || execSync('ghq list -p', { encoding: 'utf-8' }).trim().split('\n').find(p => /\/oracle-vault$/.test(p) && !p.includes('-report'))
  || '';
const OUT_DIR = process.cwd();
q
if (!existsSync(VAULT)) {
  console.error('ERROR: oracle-vault not found');
  process.exit(1);
}

// ── Scan Data ────────────────────────────────────────────────────────────────

console.log('📊 Scanning ghq repos...');
const allRepos = execSync('ghq list -p', { encoding: 'utf-8' }).trim().split('\n');

const repos = { symlinked: [], realRepos: [], realWorktrees: [], noPsi: [] };
let totalMdInVault = 0;

for (const repo of allRepos) {
  const rel = repo.replace(GHQ_ROOT + '/', '');
  const psiPath = join(repo, 'ψ');

  if (lstatSync(psiPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    const target = readlinkSync(psiPath);
    const vaultRel = target.replace(VAULT + '/', '');
    const mdCount = countMd(target);
    repos.symlinked.push({ rel, target: vaultRel, mdCount });
  } else if (existsSync(psiPath) && statSync(psiPath).isDirectory()) {
    if (rel.includes('oracle-vault')) continue;
    const mdCount = countMd(psiPath);
    const size = dirSize(psiPath);
    const isWt = /\.wt[-/]/.test(rel);
    const parentRel = isWt ? rel.replace(/\.wt[-/]\d+$/, '') : null;
    const entry = { rel, mdCount, size, parentRel };
    if (isWt) repos.realWorktrees.push(entry);
    else repos.realRepos.push(entry);
  } else {
    repos.noPsi.push({ rel });
  }
}

// ── Vault Stats ──────────────────────────────────────────────────────────────

console.log('📂 Scanning vault...');
const vaultGithub = join(VAULT, 'github.com');
const vaultOrgs = existsSync(vaultGithub) ? readdirSync(vaultGithub).filter(f => statSync(join(vaultGithub, f)).isDirectory()) : [];

const vaultProjects = [];
for (const org of vaultOrgs) {
  const orgDir = join(vaultGithub, org);
  for (const project of readdirSync(orgDir).filter(f => statSync(join(orgDir, f)).isDirectory())) {
    const projDir = join(orgDir, project);
    const mdCount = countMd(projDir);
    const size = dirSize(projDir);
    vaultProjects.push({ org, project, path: `github.com/${org}/${project}`, mdCount, size });
    totalMdInVault += mdCount;
  }
}
vaultProjects.sort((a, b) => b.mdCount - a.mdCount);

const vaultSize = dirSize(vaultGithub);

// ── Compute Metrics ──────────────────────────────────────────────────────────

const totalRepos = allRepos.length;
const totalWithPsi = repos.symlinked.length + repos.realRepos.length + repos.realWorktrees.length;
const totalSymlinked = repos.symlinked.length;
const totalReal = repos.realRepos.length;
const totalWorktrees = repos.realWorktrees.length;
const totalNeedSync = totalReal + totalWorktrees;
const totalVaultProjects = vaultProjects.length;
const totalVaultOrgs = vaultOrgs.length;

// Top projects
const top20 = vaultProjects.slice(0, 20);

// Org distribution
const orgStats = {};
for (const p of vaultProjects) {
  if (!orgStats[p.org]) orgStats[p.org] = { org: p.org, projects: 0, mdCount: 0, size: 0 };
  orgStats[p.org].projects++;
  orgStats[p.org].mdCount += p.mdCount;
  orgStats[p.org].size += p.size;
}
const orgList = Object.values(orgStats).sort((a, b) => b.mdCount - a.mdCount);

// Overlap detection (multiple repos → same vault dest)
const destMap = {};
for (const r of repos.symlinked) {
  const dest = r.target;
  if (!destMap[dest]) destMap[dest] = [];
  destMap[dest].push(r.rel);
}
for (const r of [...repos.realRepos, ...repos.realWorktrees]) {
  const dest = (r.parentRel || r.rel).toLowerCase() + '/ψ';
  if (!destMap[dest]) destMap[dest] = [];
  destMap[dest].push(r.rel);
}
const overlaps = Object.entries(destMap).filter(([, sources]) => sources.length > 1).map(([dest, sources]) => ({ dest, sources, count: sources.length }));
overlaps.sort((a, b) => b.count - a.count);

// ── Generate ─────────────────────────────────────────────────────────────────

const now = new Date();
const generated = now.toISOString();
const generatedDisplay = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

console.log('🎨 Generating HTML...');
const html = generateHTML();
writeFileSync(join(OUT_DIR, 'vault-report.html'), html);
console.log('✅ vault-report.html generated');

const repoListHtml = generateRepoListHTML();
writeFileSync(join(OUT_DIR, 'vault-repos.html'), repoListHtml);
console.log('✅ vault-repos.html generated');

writeFileSync(join(OUT_DIR, 'vault-data.json'), JSON.stringify({
  generated, totalRepos, totalWithPsi, totalSymlinked, totalReal, totalWorktrees, totalNeedSync,
  totalMdInVault, totalVaultProjects, totalVaultOrgs, vaultSize,
  vaultProjects, orgList, overlaps,
  rsyncEligible: [...repos.realRepos, ...repos.realWorktrees],
  symlinked: repos.symlinked,
}, null, 2));
console.log('✅ vault-data.json generated');

if (process.argv.includes('--push')) {
  console.log('🚀 Pushing to GitHub...');
  execSync('git add vault-report.html vault-repos.html vault-data.json && git commit -m "vault report: ' + now.toISOString().split('T')[0] + '" && git push', { stdio: 'inherit' });
  console.log('✅ Pushed!');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function countMd(dir) {
  try {
    return parseInt(execSync(`find "${dir}" -name '*.md' 2>/dev/null | wc -l`, { encoding: 'utf-8' }).trim()) || 0;
  } catch { return 0; }
}

function dirSize(dir) {
  try {
    const out = execSync(`du -sk "${dir}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
    return parseInt(out.split('\t')[0]) * 1024 || 0;
  } catch { return 0; }
}

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function fmtSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
  return bytes + ' B';
}

function pct(part, whole) {
  return whole ? ((part / whole) * 100).toFixed(1) : '0';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function orgColor(org) {
  const colors = {
  };
  // Dynamic color assignment based on org name hash
  const colorPalette = [
    { bg: 'violet', hex: '#8b5cf6' },
    { bg: 'emerald', hex: '#10b981' },
    { bg: 'amber', hex: '#f59e0b' },
    { bg: 'blue', hex: '#3b82f6' },
    { bg: 'rose', hex: '#f43f5e' },
    { bg: 'teal', hex: '#14b8a6' },
    { bg: 'indigo', hex: '#6366f1' },
    { bg: 'orange', hex: '#f97316' },
  ];
  // Simple hash to assign consistent colors
  const hash = org.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colorPalette[hash % colorPalette.length] || { bg: 'gray', hex: '#6b7280' };
}

// ── HTML Generator ───────────────────────────────────────────────────────────

function generateHTML() {
  // Hero stats
  const heroStats = [
    { label: '.md Files', value: fmt(totalMdInVault), color: 'text-secondary' },
    { label: 'Projects', value: totalVaultProjects.toString(), color: 'text-emerald-400' },
    { label: 'Orgs', value: totalVaultOrgs.toString(), color: 'text-violet-400' },
    { label: 'Vault Size', value: fmtSize(vaultSize), color: 'text-amber-400' },
    { label: 'ghq Repos', value: totalRepos.toString(), color: 'text-rose-400' },
  ];

  const heroCards = heroStats.map(s => `
    <div class="glass stat-card rounded-xl p-3">
      <div class="text-[10px] text-gray-500 uppercase tracking-wider mb-1">${s.label}</div>
      <div class="text-xl font-bold font-mono ${s.color}">${s.value}</div>
    </div>`).join('\n');

  // Connection breakdown bars
  const breakdownBars = [
    { label: 'Symlinked → vault', count: totalSymlinked, color: 'emerald', pctVal: pct(totalSymlinked, totalWithPsi) },
    { label: 'Real ψ/ (repos)', count: totalReal, color: 'violet', pctVal: pct(totalReal, totalWithPsi) },
    { label: 'Real ψ/ (worktrees)', count: totalWorktrees, color: 'amber', pctVal: pct(totalWorktrees, totalWithPsi) },
  ];

  const breakdownRows = breakdownBars.map(b => `
    <div>
      <div class="flex justify-between items-center mb-1">
        <span class="text-xs text-gray-400">${b.label}</span>
        <span class="font-mono text-xs text-${b.color}-400">${b.count} <span class="text-gray-600">(${b.pctVal}%)</span></span>
      </div>
      <div class="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-${b.color}-600 to-${b.color}-400 rounded-full" style="width: ${b.pctVal}%"></div>
      </div>
    </div>`).join('\n');

  // Org distribution
  const orgRows = orgList.map(o => {
    const c = orgColor(o.org);
    const p = pct(o.mdCount, totalMdInVault);
    return `<div>
      <div class="flex justify-between items-center mb-1">
        <div class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-${c.bg}-500"></span>
          <span class="text-xs text-gray-300">${o.org}</span>
        </div>
        <span class="font-mono text-xs text-${c.bg}-400">${fmt(o.mdCount)} <span class="text-gray-600">(${o.projects})</span></span>
      </div>
      <div class="h-1 bg-surface-3 rounded-full overflow-hidden">
        <div class="h-full bg-${c.bg}-500 rounded-full" style="width: ${p}%"></div>
      </div>
    </div>`;
  }).join('\n');

  // Top projects horizontal bar chart
  const maxMd = Math.max(...top20.map(p => p.mdCount), 1);
  const projectBars = top20.map((p, i) => {
    const w = Math.max((p.mdCount / maxMd) * 100, 1);
    const c = orgColor(p.org);
    return `<div class="flex items-center gap-2 group">
      <span class="w-4 text-[10px] text-gray-600 text-right font-mono">${i + 1}</span>
      <span class="w-[180px] text-[11px] text-gray-400 truncate">${p.project}</span>
      <div class="flex-1 h-3 bg-surface-3 rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-${c.bg}-600 to-${c.bg}-400 rounded-full transition-all" style="width: ${w.toFixed(1)}%"></div>
      </div>
      <span class="w-12 text-[10px] font-mono text-gray-500 text-right">${fmt(p.mdCount)}</span>
    </div>`;
  }).join('\n');

  // Rsync eligible list
  const rsyncRows = [...repos.realRepos, ...repos.realWorktrees].sort((a, b) => b.mdCount - a.mdCount).map(r => {
    const isWt = !!r.parentRel;
    const tag = isWt
      ? `<span class="px-1 py-0.5 text-[9px] bg-amber-500/20 text-amber-400 rounded">wt</span>`
      : `<span class="px-1 py-0.5 text-[9px] bg-violet-500/20 text-violet-400 rounded">repo</span>`;
    const dest = isWt ? r.parentRel.toLowerCase() : r.rel.toLowerCase();
    return `<tr class="border-b border-white/5 hover:bg-white/[0.02]">
      <td class="py-1 px-2 text-xs text-gray-300 font-mono truncate max-w-[280px]">${escapeHtml(r.rel)}</td>
      <td class="py-1 px-2">${tag}</td>
      <td class="py-1 px-2 text-xs text-gray-400 font-mono text-right">${r.mdCount}</td>
      <td class="py-1 px-2 text-xs text-gray-500 font-mono text-right">${fmtSize(r.size)}</td>
      <td class="py-1 px-2 text-[10px] text-gray-600 font-mono truncate max-w-[200px]">${escapeHtml(dest)}</td>
    </tr>`;
  }).join('\n');

  // Overlap rows
  const overlapRows = overlaps.slice(0, 10).map(o => `
    <div class="p-2 bg-surface-3/50 rounded-lg">
      <div class="text-[10px] text-violet-400 font-mono mb-0.5">${escapeHtml(o.dest)}</div>
      <div class="text-[10px] text-gray-500 leading-tight">${o.sources.map(s => escapeHtml(s)).join(' · ')}</div>
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oracle Vault Report</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#1E40AF',
            secondary: '#3B82F6',
            accent: '#F59E0B',
            surface: '#0a0a0f',
            'surface-2': '#111118',
            'surface-3': '#1a1a24',
          },
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
    body { font-family: 'Inter', system-ui, sans-serif; background: #000; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    .oled-bg { background: radial-gradient(ellipse at top, #0d1117 0%, #000 50%); }
    .glass { background: rgba(17, 17, 24, 0.8); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
    .glass-highlight { background: linear-gradient(135deg, rgba(30, 64, 175, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%); border: 1px solid rgba(59, 130, 246, 0.2); }
    .glow-blue { box-shadow: 0 0 60px rgba(59, 130, 246, 0.15); }
    .glow-green { box-shadow: 0 0 60px rgba(16, 185, 129, 0.15); }
    .text-glow-blue { text-shadow: 0 0 20px rgba(59, 130, 246, 0.5); }
    .stat-card { transition: all 0.2s ease; }
    .stat-card:hover { transform: translateY(-2px); border-color: rgba(59, 130, 246, 0.3); }
    .bar { transition: height 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
    .tooltip { opacity: 0; transition: opacity 0.15s ease; pointer-events: none; }
    .bar-container:hover .tooltip { opacity: 1; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  </style>
</head>
<body class="oled-bg min-h-screen text-white antialiased">
  <div class="max-w-6xl mx-auto px-4 py-6">

    <!-- Header -->
    <header class="text-center mb-6">
      <h1 class="text-2xl font-semibold tracking-tight mb-1">Oracle Vault Report</h1>
      <p class="text-gray-500 text-xs font-mono">${totalVaultProjects} projects &middot; ${totalVaultOrgs} orgs &middot; ${generatedDisplay}</p>
      <div class="mt-2 flex gap-3 justify-center">
        <a href="vault-repos.html" class="text-xs text-gray-500 hover:text-gray-300">All Repos</a>
        <a href="vault-data.json" class="text-xs text-gray-500 hover:text-gray-300">JSON</a>
      </div>
    </header>

    <!-- Hero Stats -->
    <div class="grid grid-cols-5 gap-2 mb-4">
      ${heroCards}
    </div>

    <!-- Row: Breakdown + Orgs -->
    <div class="grid lg:grid-cols-2 gap-3 mb-4">
      <div class="glass rounded-xl p-4">
        <h2 class="text-sm font-semibold mb-3">Connection Breakdown <span class="text-[10px] text-gray-600 font-normal">(${totalWithPsi} with ψ/)</span></h2>
        <div class="space-y-3">
          ${breakdownRows}
        </div>
        <div class="mt-3 p-2.5 bg-surface-3/50 rounded-lg border border-white/5 flex items-center justify-between">
          <div>
            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Needs rsync</div>
            <div class="text-lg font-bold font-mono text-white">${totalNeedSync}</div>
          </div>
          <div class="text-right text-[10px] text-gray-600">
            <div>${totalReal} repos + ${totalWorktrees} wt</div>
          </div>
        </div>
      </div>
      <div class="glass rounded-xl p-4">
        <h2 class="text-sm font-semibold mb-3">Org Distribution</h2>
        <div class="space-y-2.5">
          ${orgRows}
        </div>
      </div>
    </div>

    <!-- Top 20 Projects -->
    <div class="glass rounded-xl p-4 mb-4">
      <h2 class="text-sm font-semibold mb-3">Top 20 Projects <span class="text-[10px] text-gray-600 font-normal">(.md files)</span></h2>
      <div class="space-y-1">
        ${projectBars}
      </div>
    </div>

    <!-- Rsync Eligible - full width, no scroll constraint -->
    <div class="glass rounded-xl p-4 mb-4">
      <h2 class="text-sm font-semibold mb-3">Rsync Eligible <span class="text-[10px] text-gray-600 font-normal">(${totalNeedSync})</span></h2>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="text-[10px] text-gray-500 uppercase tracking-wider border-b border-white/10">
            <tr>
              <th class="py-1 px-2">Repo</th>
              <th class="py-1 px-2">Type</th>
              <th class="py-1 px-2 text-right">.md</th>
              <th class="py-1 px-2 text-right">Size</th>
              <th class="py-1 px-2">Vault dest</th>
            </tr>
          </thead>
          <tbody>${rsyncRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Overlaps -->
    ${overlaps.length > 0 ? `
    <div class="glass rounded-xl p-4 mb-4">
      <h2 class="text-sm font-semibold mb-2">Shared Vault Destinations <span class="text-[10px] text-gray-600 font-normal">(${overlaps.length})</span></h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
        ${overlapRows}
      </div>
    </div>` : ''}

    <footer class="text-center text-gray-600 text-[10px] py-3 border-t border-white/5">
      <a href="https://github.com/Soul-Brews-Studio/oracle-v2" class="text-gray-500 hover:text-gray-300">oracle-v2</a> &middot; <span class="font-mono">${generated}</span>
    </footer>
  </div>
</body>
</html>`;
}

// ── Repo List HTML ───────────────────────────────────────────────────────────

function generateRepoListHTML() {
  // All vault projects as searchable table
  const rows = vaultProjects.map(p => {
    const c = orgColor(p.org);
    return `<tr class="border-b border-white/5 hover:bg-white/[0.02]">
      <td class="py-3 px-4 text-xs text-${c.bg}-400 font-mono whitespace-nowrap">${escapeHtml(p.org)}</td>
      <td class="py-3 px-4 text-sm text-gray-300">${escapeHtml(p.project)}</td>
      <td class="py-3 px-4 text-sm text-gray-400 font-mono text-right">${p.mdCount.toLocaleString()}</td>
      <td class="py-3 px-4 text-xs text-gray-500 font-mono text-right">${fmtSize(p.size)}</td>
    </tr>`;
  }).join('\n');

  // Symlinked repos table
  const symRows = repos.symlinked.sort((a, b) => b.mdCount - a.mdCount).map(r => {
    return `<tr class="border-b border-white/5 hover:bg-white/[0.02]">
      <td class="py-2 px-4 text-sm text-gray-300 font-mono truncate max-w-[350px]">${escapeHtml(r.rel)}</td>
      <td class="py-2 px-4 text-xs text-emerald-400 font-mono truncate max-w-[350px]">${escapeHtml(r.target)}</td>
      <td class="py-2 px-4 text-sm text-gray-400 font-mono text-right">${r.mdCount.toLocaleString()}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oracle Vault - All Repos</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: {
        colors: { surface: '#0a0a0f', 'surface-2': '#111118', 'surface-3': '#1a1a24' },
        fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] }
      }}
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    body { font-family: 'Inter', system-ui, sans-serif; background: #000; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  </style>
</head>
<body class="bg-black min-h-screen text-white antialiased">
  <div class="max-w-7xl mx-auto px-4 py-8">
    <header class="mb-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold">Oracle Vault Repos</h1>
          <p class="text-gray-500 text-sm mt-1">${totalVaultProjects} projects in vault &middot; ${totalSymlinked} symlinked repos</p>
        </div>
        <a href="vault-report.html" class="text-sm text-gray-500 hover:text-gray-300">&larr; Dashboard</a>
      </div>
      <div class="mt-4">
        <input type="text" id="search" placeholder="Search repos..." class="w-full sm:w-96 bg-surface-3 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/50">
      </div>
    </header>

    <h2 class="text-lg font-semibold mb-4">Vault Projects (${totalVaultProjects})</h2>
    <div class="overflow-x-auto mb-12">
      <table class="w-full text-left" id="vault-table">
        <thead class="text-xs text-gray-500 uppercase tracking-wider border-b border-white/10">
          <tr>
            <th class="py-3 px-4">Org</th>
            <th class="py-3 px-4">Project</th>
            <th class="py-3 px-4 text-right">.md files</th>
            <th class="py-3 px-4 text-right">Size</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <h2 class="text-lg font-semibold mb-4">Symlinked Repos (${totalSymlinked})</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-left" id="sym-table">
        <thead class="text-xs text-gray-500 uppercase tracking-wider border-b border-white/10">
          <tr>
            <th class="py-2 px-4">Repo</th>
            <th class="py-2 px-4">Vault target</th>
            <th class="py-2 px-4 text-right">.md in vault</th>
          </tr>
        </thead>
        <tbody>${symRows}</tbody>
      </table>
    </div>
  </div>
  <script>
    const search = document.getElementById('search');
    const tables = ['vault-table', 'sym-table'];
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      tables.forEach(id => {
        document.querySelectorAll('#' + id + ' tbody tr').forEach(r => {
          r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    });
  </script>
</body>
</html>`;
}

#!/usr/bin/env python3
"""Short helper: gather today's ground truth, return JSON for MCP"""
import os, json, subprocess
from datetime import datetime
from pathlib import Path

PSI = os.path.expanduser("~/Code/github.com/laris-co/Nat-s-Agents/ψ")
REPO = os.path.expanduser("~/Code/github.com/laris-co/Nat-s-Agents")

def find_files(folder, date_str):
    """Find .md files with date in name"""
    path = Path(PSI) / folder
    if not path.exists(): return []
    return [{"path": str(f), "size": f.stat().st_size, "name": f.name}
            for f in path.rglob("*.md") if date_str in f.name]

def get_commits(date_str):
    """Get commits for date"""
    try:
        r = subprocess.run(['git', '-C', REPO, 'log', '--oneline', '--after', f'{date_str} 00:00',
                           '--before', f'{date_str} 23:59', '--format=%h|%s'], capture_output=True, text=True)
        return [{"hash": l.split('|')[0], "msg": l.split('|')[1][:60]}
                for l in r.stdout.strip().split('\n') if '|' in l]
    except: return []

def main():
    date = datetime.now().strftime('%Y-%m-%d')
    print(json.dumps({
        "date": date,
        "learnings": find_files("memory/learnings", date),
        "retrospectives": find_files("memory/retrospectives", date),
        "drafts": find_files("writing/drafts", date),
        "commits": get_commits(date)
    }))

if __name__ == '__main__': main()

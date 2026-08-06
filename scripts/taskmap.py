#!/usr/bin/env python3
"""taskmap — parse a spec-kit tasks.md into a wave-ordered maw dispatch plan.

Waves group tasks that can run concurrently: same phase, [P]-marked, and
pairwise-disjoint file sets. Dishonest [P] tasks (file overlap) are demoted
to their own wave and flagged (Constitution III: Dispatch-Honest Tasks).
"""
import argparse
import json
import re
import sys
from pathlib import Path

TASK_RE = re.compile(r"^[-*]\s+\[(?P<done>[ xX])\]\s+(?P<id>T\d{3}(?:\.\d+)?)\s+(?P<rest>.+)$")
OPENSPEC_TASK_RE = re.compile(r"^[-*]\s+\[(?P<done>[ xX])\]\s+(?P<id>\d+\.\d+)\s+(?P<rest>.+)$")
PHASE_RE = re.compile(r"^#{2,3}\s*(?P<title>Phase\s+\d+\b.*?)\s*$")
OPENSPEC_PHASE_RE = re.compile(r"^#{2,3}\s*(?P<title>\d+\.\s+.*?)\s*$")
P_MARK_RE = re.compile(r"\[P\]\s*")
STORY_RE = re.compile(r"\[(?P<story>US\d+|Story\s*\d+)\]\s*")
EXT_FILE_RE = re.compile(r"^[\w./-]+\.(py|md|sh|bash|ts|js|json|yml|yaml|toml|txt|rs|go)$")
DEFAULT_DONE_NOTE = "run tests, reply via maw hey when done"


def extract_files(text):
    files = []
    for backticked, bare in re.findall(r"`([^`]+)`|(\S+)", text):
        tok = (backticked or bare).strip(".,;:()[]")
        if not tok or tok.startswith(("http://", "https://")):
            continue
        if "/" in tok and re.search(r"\w", tok) or EXT_FILE_RE.match(tok):
            if tok not in files:
                files.append(tok)
    return files


def detect_grammar(lines, openspec=False):
    has_tid = any(TASK_RE.match(line) for line in lines)
    has_openspec = any(OPENSPEC_TASK_RE.match(line) for line in lines)
    if has_tid and has_openspec:
        raise SystemExit("taskmap: mixed task ID grammars — refusing to plan")
    if openspec:
        return "openspec"
    return "openspec" if has_openspec else "tid"


def parse_tasks(path, openspec=False):
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise SystemExit(f"taskmap: cannot read {path}: {exc.strerror or exc}")
    grammar = detect_grammar(lines, openspec=openspec)
    task_re = OPENSPEC_TASK_RE if grammar == "openspec" else TASK_RE
    phase_re = OPENSPEC_PHASE_RE if grammar == "openspec" else PHASE_RE
    tasks, seen = [], set()
    phase, phase_index = "(no phase)", 0
    for line in lines:
        m = phase_re.match(line)
        if m:
            phase = m.group("title")
            phase_index += 1
            continue
        m = task_re.match(line)
        if not m:
            continue
        tid = m.group("id")
        if tid in seen:
            raise SystemExit(f"taskmap: duplicate task ID {tid} — refusing to plan")
        seen.add(tid)
        # markers are only valid as prefixes (`[ID] [P?] [Story] Description`);
        # a literal "[P]" later in the description is content, not a marker
        rest = m.group("rest").lstrip()
        parallel, story = False, None
        while True:
            if rest.startswith("[P]"):
                parallel = True
                rest = rest[3:].lstrip()
                continue
            sm = STORY_RE.match(rest)
            if sm:
                story = sm.group("story")
                rest = rest[sm.end():].lstrip()
                continue
            break
        tasks.append({
            "id": tid,
            "description": rest,
            "phase": phase,
            "phase_index": phase_index,
            "parallel": parallel,
            "story": story,
            "files": extract_files(rest),
            "done": m.group("done") != " ",
        })
    if not tasks:
        raise SystemExit(f"taskmap: no tasks found in {path}")
    return tasks


def build_waves(tasks):
    waves = []
    pending = [t for t in tasks if not t["done"]]
    for phase_index in sorted({t["phase_index"] for t in pending}):
        current = None
        for task in [t for t in pending if t["phase_index"] == phase_index]:
            joinable = (
                task["parallel"]
                and current is not None
                and all(m["parallel"] for m in current["tasks"])
            )
            conflict = None
            if joinable:
                for member in current["tasks"]:
                    shared = set(task["files"]) & set(member["files"])
                    if shared:
                        conflict = (
                            f"{task['id']} shares {sorted(shared)[0]} with "
                            f"{member['id']} — [P] demoted to new wave"
                        )
                        joinable = False
                        break
            if joinable:
                current["tasks"].append(task)
            else:
                current = {
                    "index": len(waves) + 1,
                    "phase": task["phase"],
                    "tasks": [task],
                    "conflicts": [conflict] if conflict else [],
                }
                waves.append(current)
    return waves


def build_dispatch(waves, workers, done_note, session=None):
    if not waves:
        return []
    dispatch = []
    for i, task in enumerate(waves[0]["tasks"]):
        worker = workers[i % len(workers)]
        target = f"{session}:{worker}" if session else worker
        files = ", ".join(task["files"]) or "-"
        message = (
            f"{task['id']} {task['description']} | files: {files} | done: {done_note}"
        )
        quoted = "'" + message.replace("'", "'\\''") + "'"
        dispatch.append({
            "task_id": task["id"],
            "worker": worker,
            "command": f"maw hey {target} {quoted}",
        })
    return dispatch


def render_human(source, tasks, waves, dispatch):
    done = sum(t["done"] for t in tasks)
    out = [
        f"taskmap: {source}",
        f"tasks: {len(tasks)} total, {done} done, {len(tasks) - done} pending"
        f" → {len(waves)} wave(s)",
        "",
    ]
    for wave in waves:
        out.append(f"wave {wave['index']} — {wave['phase']}")
        for note in wave["conflicts"]:
            out.append(f"  ⚠ {note}")
        for t in wave["tasks"]:
            p = " [P]" if t["parallel"] else ""
            story = f" [{t['story']}]" if t["story"] else ""
            files = ", ".join(t["files"]) if t["files"] else "no files listed"
            out.append(f"  {t['id']}{p}{story} {t['description']}  ({files})")
        out.append("")
    if dispatch:
        out.append(f"## dispatch — wave {waves[0]['index']}")
        out.extend(d["command"] for d in dispatch)
    elif not waves:
        out.append("nothing to dispatch — all tasks complete ✅")
    return "\n".join(out).rstrip() + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="taskmap.py", description=__doc__.splitlines()[0]
    )
    parser.add_argument("tasks_md", help="path to a spec-kit tasks.md")
    parser.add_argument("--json", action="store_true", help="emit JSON plan")
    parser.add_argument("--workers", help="comma-separated worker names for dispatch")
    parser.add_argument("--done-note", default=DEFAULT_DONE_NOTE,
                        help="done-criteria appended to each dispatch command")
    parser.add_argument("--session", help="maw session prefix for dispatch commands")
    parser.add_argument("--openspec", action="store_true",
                        help="force OpenSpec N.N task IDs and numbered section phases")
    args = parser.parse_args(argv)

    tasks = parse_tasks(args.tasks_md, openspec=args.openspec)
    waves = build_waves(tasks)
    workers = [w.strip() for w in args.workers.split(",") if w.strip()] if args.workers else []
    dispatch = build_dispatch(waves, workers, args.done_note, args.session) if workers else []

    if args.json:
        done = sum(t["done"] for t in tasks)
        plan = {
            "source": str(args.tasks_md),
            "total": len(tasks),
            "done": done,
            "pending": len(tasks) - done,
            "waves": [
                {
                    "index": w["index"],
                    "phase": w["phase"],
                    "conflicts": w["conflicts"],
                    "tasks": [
                        {k: t[k] for k in
                         ("id", "description", "parallel", "story", "files", "done")}
                        for t in w["tasks"]
                    ],
                }
                for w in waves
            ],
        }
        if workers:
            plan["dispatch"] = dispatch
        print(json.dumps(plan, ensure_ascii=False, indent=2))
    else:
        sys.stdout.write(render_human(args.tasks_md, tasks, waves, dispatch))
    return 0


if __name__ == "__main__":
    sys.exit(main())

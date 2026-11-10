#!/usr/bin/env python3
"""
PreToolUse hook (T290) — fires before every Edit, Write, MultiEdit and NotebookEdit call.

A task guide may name its oracle files on one line:

    **Locked oracle**: `tests/test_x.py`, `.claude/hooks/tests/test_y.py`

While that task's board row sits under `### In Progress`, a sub-agent that is not `qa-expert`
(bare or `easy-kit:qa-expert`) is denied an Edit or Write to those files. The Supervisor (the main
thread: the hook event has no `agent_id`) and `qa-expert` may edit them. When the row leaves In
Progress the lock ends. A path that no guide names is never locked. Why it lasts one task only: a
permanent lock on `test_agent_guide_dedup.py` would have blocked 52 later edits (T283 spike 1).

Claude Code 2.1.319 sets `agent_id` only for a sub-agent ("Absent for the main thread") and
`agent_type` beside it. The deny reason names the guide.

Decisions, and the direction every uncertainty resolves (toward deny):

* Not an edit tool, the main thread, or a judge -> no output, exit 0.
* A sub-agent edit that no In Progress guide locks -> no output, exit 0.
* Locked and In Progress -> `permissionDecision: deny`, the reason naming the guide.
* Missing `agent_type`, malformed stdin, an edit with no usable path, an unreadable guide or board,
  a lock line in a guide whose name holds no task ID, or a helper module that fails to import ->
  deny for a sub-agent that is not a judge (malformed stdin and a malformed event: deny for all).

Paths are compared by real path: `..`, `//`, symlinks and relative spellings resolve first, and a
path inside any git worktree of the project's repository compares by its path in that checkout, so
an implementer that edits the oracle through `../wt-txxx/...` is caught. Case is folded, so a
case-insensitive file system cannot dodge the lock. Guides and the board are read from the main
checkout when the session runs inside a linked worktree (the row moves on main).

Accepted format: `**Locked oracle**:` at the start of a line, then exact file paths, in backticks or
bare, comma-separated (no glob, directory or `:line`). Any other spelling (`**Locked oracle:**`, no
bold, indented, quoted, another case, a lowercase task ID that no board row matches) locks nothing.

Known limits (cut list, TASK_GUIDE_T290): the lock stops accidents, not an adversary. A bound
sub-agent can remove the lock line from the guide, move the board row, create a new guide or
edit this hook; behaviour is unchanged on purpose, because implementers tick guide checklists.
Writes through `Bash` (`sed -i`, `>`) are not parsed; a hard link to the oracle is a different
path; the plugin copy of this hook is not wired.
"""
import glob
import json
import os
import re
import sys

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
TAG = "[hook:locked-oracle]"
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
JUDGES = {"qa-expert", "easy-kit:qa-expert"}
LOCK_LINE = re.compile(r"^\*\*Locked oracle\*\*:[ \t]*(.*)$", re.MULTILINE)
BACKTICK_SPAN = re.compile(r"`([^`]+)`")
GUIDE_ID = re.compile(r"^TASK_GUIDE_([A-Za-z]+-?\d+)")

# Guarded like pre_tool_sensitive_path.py: an unguarded ImportError exits 1 with empty stdout, which
# the harness treats as a non-blocking error and lets the call through. The failure is kept and
# turned into a deny for a bound caller in decide().
sys.path.insert(0, os.path.join(HOOKS_DIR, "lib"))
try:
    from project_root import exit_outside_kit_project, project_root  # noqa: E402
    exit_outside_kit_project()  # T232: first, so a broken lib stays silent in a non-kit project
    IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - exercised via subprocess test
    IMPORT_ERROR = exc


# --- Who is bound --------------------------------------------------------------------------

def is_bound(event):
    """True for a sub-agent that is not a judge. The main thread has no `agent_id`; a sub-agent
    with a missing or odd `agent_type` is bound (fail closed)."""
    if event.get("agent_id") is None:
        return False
    agent_type = event.get("agent_type")
    return not (isinstance(agent_type, str) and agent_type in JUDGES)


# --- Path identity -------------------------------------------------------------------------

def git_common_dir(checkout):
    """The shared `.git` directory of the checkout (a linked worktree points at the main one), or None."""
    git = os.path.join(checkout, ".git")
    try:
        if os.path.isdir(git):
            return os.path.realpath(git)
        with open(git, encoding="utf-8") as handle:
            first = handle.readline().strip()
        if not first.startswith("gitdir:"):
            return None
        gitdir = os.path.realpath(os.path.join(checkout, first[len("gitdir:"):].strip()))
        with open(os.path.join(gitdir, "commondir"), encoding="utf-8") as handle:
            return os.path.realpath(os.path.join(gitdir, handle.read().strip()))
    except OSError:
        return None


def nearest_checkout(path):
    """The nearest folder at or above `path` that holds a `.git`, or None."""
    here = os.path.dirname(path)
    while True:
        if os.path.lexists(os.path.join(here, ".git")):
            return here
        parent = os.path.dirname(here)
        if parent == here:
            return None
        here = parent


def is_under(path, folder):
    return path == folder or path.startswith(folder.rstrip(os.sep) + os.sep)


def identity(path, root):
    """The comparison key of a real path: ('repo', path inside its checkout) when the path lies in
    `root` or in another worktree of root's repository, else ('abs', path). Case-folded."""
    checkout = nearest_checkout(path)
    if checkout is None:
        checkout = root if is_under(path, root) else None
    elif checkout != root:
        common = git_common_dir(checkout)
        if common is None or common != git_common_dir(root):
            checkout = None
    if checkout is None:
        return ("abs", path.casefold())
    return ("repo", os.path.relpath(path, checkout).casefold())


def data_root(root):
    """Where guides and the board are read: the main checkout when `root` is a linked worktree."""
    common = git_common_dir(root)
    if common and os.path.isfile(os.path.join(root, ".git")):
        main = os.path.dirname(common)
        if os.path.isfile(os.path.join(main, "PROJECT_KANBAN.md")):
            return main
    return root


# --- Locks and the board -------------------------------------------------------------------

def lock_table(data, root):
    """[(identity, guide path relative to `data`, task ID or None)] for every path on a
    `**Locked oracle**:` line of every tasks/TASK_GUIDE_*.md. An unreadable guide raises."""
    table = []
    for guide in sorted(glob.glob(os.path.join(data, "tasks", "TASK_GUIDE_*.md"))):
        with open(guide, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        hit = GUIDE_ID.match(os.path.basename(guide))
        task_id = hit.group(1) if hit else None
        for line in LOCK_LINE.findall(text):
            entries = BACKTICK_SPAN.findall(line) or line.split(",")
            for entry in (e.strip() for e in entries):
                if entry:
                    real = os.path.realpath(os.path.join(root, entry))
                    table.append((identity(real, root), os.path.relpath(guide, data), task_id))
    return table


def read_board(data):
    try:
        with open(os.path.join(data, "PROJECT_KANBAN.md"), encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def in_progress(task_id, kanban):
    """True when the task's row is a list item under `### In Progress`. An unknown task ID or an
    unreadable board answers True: the lock cannot be cleared, so it stays."""
    if task_id is None or kanban is None:
        return True
    section = re.search(r"^### In Progress[^\n]*\n(.*?)(?=^##|\Z)", kanban, re.DOTALL | re.MULTILINE)
    return bool(section and re.search(rf"^- \[[ x~]\] \*\*{re.escape(task_id)}\*\*", section.group(1),
                                      re.MULTILINE))


# --- Hook protocol -------------------------------------------------------------------------

def target_path(tool, tool_input, root, cwd):
    key = "notebook_path" if tool == "NotebookEdit" else "file_path"
    target = tool_input.get(key) if isinstance(tool_input, dict) else None
    if not isinstance(target, str) or not target.strip():
        raise ValueError(f"{tool} call has no {key}")
    base = cwd if isinstance(cwd, str) and os.path.isabs(cwd) else root
    return os.path.realpath(os.path.join(base, target))


def decide(event, root):
    """Return a deny reason, or None for no decision. Raises on an event it cannot read."""
    if not isinstance(event, dict) or not isinstance(event.get("tool_name"), str):
        raise ValueError("event is not a tool call")
    tool = event["tool_name"]
    if tool not in EDIT_TOOLS or not is_bound(event):
        return None
    agent = f"agent '{event.get('agent_type')}'"
    if IMPORT_ERROR is not None:
        return (f"Locked-oracle check unavailable ({type(IMPORT_ERROR).__name__}: {IMPORT_ERROR}); "
                f"{agent} is denied until .claude/hooks/lib/ is restored. Report to the Supervisor.")
    root = os.path.realpath(root)
    real = target_path(tool, event.get("tool_input"), root, event.get("cwd"))
    key = identity(real, root)
    data = data_root(root)
    locks = lock_table(data, root)
    kanban = read_board(data)
    for lock_key, guide, task_id in locks:
        if lock_key == key and in_progress(task_id, kanban):
            return (f"{os.path.relpath(real, root) if is_under(real, root) else real} is the Locked oracle "
                    f"of {guide} while {task_id or 'its task'} is In Progress; {agent} may not edit it. "
                    "Stop and report to the Supervisor. The Supervisor or qa-expert changes the oracle.")
    return None


def main():
    try:
        event = json.load(sys.stdin)
        reason = decide(event, project_root() if IMPORT_ERROR is None else "")
    except Exception as exc:  # fail closed
        reason = f"unreadable hook input or state ({exc.__class__.__name__}: {exc}); denied"
    if reason:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"{TAG} {reason}"}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

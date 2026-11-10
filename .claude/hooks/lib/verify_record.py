"""Auto verify (T182): the run record (D5) and the hook-written `verify` row (D4).

Shared by the writer (`.claude/hooks/stop_auto_verify.py`, which runs `/verify` headless and writes
both) and the reader (`.claude/hooks/pre_bash_block_unsafe_merge.py`, which accepts an
`auto-run by hook` row only with a matching record).

The record is JSON at

    <anchor base>/<repo-slug>/verify-runs/<task>-<40-hex commit>.json

with the same base as T148's trace anchors (`CLAUDE_TRACE_ANCHOR_DIR`, else
`~/.claude/harness-anchors`). `.claude/settings.json` denies agents write access there:
`Edit(~/.claude/harness-anchors/**)` covers the Edit and Write tools, `Bash(*harness-anchors*)` any
shell command that names the directory. A record anywhere else is never read. Like the anchors, this
raises the bar, it is not a proof: the human operator can write there, a Bash deny rule is
pattern-based, and an agent that runs `stop_auto_verify.py` itself with a fake `claude` first on
its PATH gets a record from the script, because no deny rule names that command.
"""
import json
import os
import re
import subprocess

import auto_mode
from trace_chain import ANCHOR_DIR_ENV, DEFAULT_ANCHOR_BASE, repo_slug, safe_name

AUTO_ROW_TAG = "auto-run by hook"
AUTO_CHECKED_TAG = "auto-checked"
VERDICTS = ("pass", "fail", "blocked", "skip-pass")  # the record's `verdict` values (T289 added skip-pass)
# T289: a run that answers SKIP on a branch whose every changed path is docs-only is recorded as
# `skip-pass`. The hook decides that from git (`docs_only_change`); the model's text only says SKIP.
SKIP_PASS = "skip-pass"
RESULT_CELL = {"pass": "☑ pass", "fail": "☑ fail", "blocked": "☐ blocked", SKIP_PASS: "☑ pass"}
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
ROW_COMMIT = re.compile(r"\bcommit ([0-9a-f]{40})\b")
ROW_SESSION = re.compile(r"\bsession ([A-Za-z0-9-]+)")
GIT_TIMEOUT_S = 5

# T188 D3 — the minimal track has no Evidence table, so the result is one line under the Decision
# record's `Checked:` field, in the shape the Evidence row uses:
#
#     - verify: ☑ pass — auto-run by hook, session <id>, commit <sha>, log .claude/verify-runs/<f>
#
# `CHECKED_FIELD` is that field's header plus the bullet lines directly under it. The writer appends
# at its end and the reader looks only inside it, so a `verify:` line anywhere else in the record is
# never read as this one. The record's `Not done:` line cannot match `VERIFY_LINE`: it starts
# `**Not done:**`, and the slot it carries reads `auto verify:`, not a line-leading `verify:`.
MINIMAL_LOG_REL = auto_mode.MINIMAL_LOG_REL
VERIFY_LINE_PREFIX = "verify: "
# A bullet is `-`, `+`, or a `*` that does not start a `**bold**` field name: `[-*]` would read the
# record's own `**Files:**` and `**Not done:**` lines as bullets of the `Checked:` field, and the
# appended line would then land after them instead of inside the field (caught by a real run).
BULLET = r"(?:[-+]|\*(?!\*))"
CHECKED_FIELD = re.compile(rf"^[ \t]*(?:\*\*)?Checked:(?:\*\*)?[^\n]*(?:\n[ \t]*{BULLET}[^\n]*)*",
                           re.M)
VERIFY_LINE = re.compile(rf"^[ \t]*{BULLET}?[ \t]*verify:[ \t]*(?P<result>[^—\n]*?)[ \t]*"
                         r"(?:—[ \t]*(?P<notes>[^\n]*))?$", re.M | re.I)


# --- T289: the paths that have no runtime surface -------------------------------------------
#
# One literal list, in one place. A path is docs-only when it is a plain file name (the safe
# characters below, no `.`/`..` part, 200 bytes at most) and one of these three:
#   * a root `*.md` file, except the prompt-config and control-state ones (ROOT_MD_EXCEPT);
#   * under `tasks/`, `memory/` or `docs/` (TEXT_DIRS): only `.md`, `.txt` or `.gitkeep` files, and
#     not `docs/claude-md/` (prompt config), `memory/MEMORY.md` or `tasks/TASK_GUIDE_*` (they steer
#     agents and hooks: STEERING_EXCEPT, GUIDE_NAME);
#   * under `tests/` or `.claude/hooks/tests/` (TEST_DIRS): only `test_*.py` files and `tests/fixtures/`,
#     and never a `conftest.py`, a `.sh` file, `tests/lib/` or `merge_gate_guard.py`. A `test_*.py` runs
#     at the next pytest collection: accepted risk (`docs/claude-md/tracks.md`).
# Everything else has a runtime surface (`skills/`, `agents/`, `templates/`, `AGENTS.md`, `CLAUDE.md`,
# the hook scripts, `scripts/`, `lib/`, `site/`, code). The exceptions and the steering names are
# compared in lower case, so a case-folding file system cannot reach them through another spelling;
# the prefixes and suffixes are compared exactly.
DOCS_ONLY_PREFIXES = ("tasks/", "memory/", "docs/", "tests/", ".claude/hooks/tests/")
DOCS_ONLY_EXCEPT = ("docs/claude-md",)
ROOT_MD_EXCEPT = ("agents.md", "claude.md", "claude_legacy.md", "project_kanban.md", "project_spec.md",
                  "project_kanban_site.md", "project_spec_site.md")
TEXT_DIRS = ("tasks/", "memory/", "docs/")
TEXT_SUFFIXES = (".md", ".txt")
TEXT_NAMES = (".gitkeep",)
STEERING_EXCEPT = ("memory/memory.md",)
GUIDE_NAME = "task_guide_"  # a `tasks/**/TASK_GUIDE_*` file, any case
TEST_DIRS = ("tests/", ".claude/hooks/tests/")
TEST_FILE = re.compile(r"test_[A-Za-z0-9_.-]*\.py")
TEST_FIXTURES = ("tests/fixtures/",)
TEST_EXCEPT_NAMES = ("conftest.py", "merge_gate_guard.py")
TEST_EXCEPT_DIRS = ("tests/lib/",)
SAFE_PATH = re.compile(r"[A-Za-z0-9._/-]+")  # used with fullmatch: `$` would let a trailing newline in
MAX_PATH_BYTES = 200
BASE_REF = "refs/heads/main"  # the branch a task branch is judged against: `main`, as the admin push rule
REGULAR_MODES = ("100644", "100755")  # a symlink (120000) or a gitlink (160000) is never docs-only
RAW_RECORD = re.compile(r"^:(\d{6}) (\d{6}) [0-9a-f]{40} [0-9a-f]{40} ([AMD])$")
NOTE_PATHS = 12  # the notes name this many paths; the check always covers all of them


def docs_only_path(path):
    """True when `path` (as git prints it) is in the docs-only list. Any doubt is False."""
    if (not isinstance(path, str) or not path or len(path) > MAX_PATH_BYTES
            or not SAFE_PATH.fullmatch(path)):
        return False
    if path.startswith("/") or any(part in ("", ".", "..") for part in path.split("/")):
        return False
    low = path.lower()
    name = low.rsplit("/", 1)[-1]
    if any(low.startswith(exception) for exception in DOCS_ONLY_EXCEPT):
        return False
    if "/" not in path:
        return path.endswith(".md") and path != ".md" and low not in ROOT_MD_EXCEPT
    if path.startswith(TEXT_DIRS):
        if low in STEERING_EXCEPT or (path.startswith("tasks/") and name.startswith(GUIDE_NAME)):
            return False
        return path.endswith(TEXT_SUFFIXES) or path.rsplit("/", 1)[-1] in TEXT_NAMES
    if path.startswith(TEST_DIRS):
        if name in TEST_EXCEPT_NAMES or name.endswith(".sh") or low.startswith(TEST_EXCEPT_DIRS):
            return False
        return path.startswith(TEST_FIXTURES) or bool(TEST_FILE.fullmatch(path.rsplit("/", 1)[-1]))
    return False


def record_dir(root):
    base = os.environ.get(ANCHOR_DIR_ENV) or os.path.expanduser(DEFAULT_ANCHOR_BASE)
    if not os.path.isabs(base):
        raise OSError("record directory is not absolute: %r" % base)
    return os.path.join(base, repo_slug(root), "verify-runs")


def record_path(root, task_id, sha):
    if not isinstance(sha, str) or not SHA_PATTERN.match(sha):
        raise ValueError("not a full commit hash: %r" % (sha,))
    return os.path.join(record_dir(root), f"{safe_name(task_id, '_untagged')}-{sha}.json")


def write_record(root, task_id, sha, verdict, session, log, base=None):
    """`base` (T289) is the merge-base a `skip-pass` was judged against; the merge gate repeats the
    path check between it and `commit`. Other verdicts carry none."""
    path = record_path(root, task_id, sha)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    data = {"task": task_id, "commit": sha, "verdict": verdict, "session": session, "log": log}
    if base is not None:
        data["base"] = base
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)
    return path


def read_record(root, task_id, sha):
    """The record as a dict, or None (missing, unreadable, not a JSON object)."""
    try:
        with open(record_path(root, task_id, sha), encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _git(checkout, *args):
    # T289: `git replace` refs would show a fake commit in place of the real one to every read
    # below (the diff, the merge-base, the ancestor checks); switch them off for all of them.
    env = dict(os.environ, GIT_NO_REPLACE_OBJECTS="1")
    done = subprocess.run(["git", "-C", checkout, *args], capture_output=True, text=True,
                          timeout=GIT_TIMEOUT_S, env=env)
    if done.returncode != 0:
        raise OSError(done.stderr.strip())
    return done.stdout


def head_commit(checkout):
    """The checkout's HEAD as a full hash, or None."""
    try:
        sha = _git(checkout, "rev-parse", "HEAD").strip()
    except Exception:
        return None
    return sha if SHA_PATTERN.match(sha) else None


def _raw_diff(checkout, base, tip):
    """The sorted changed paths between two full hashes, or None on any doubt: an unreadable range,
    an empty diff, a status other than add/modify/delete (renames are off, so a moved file lists its
    old path as a delete), a mode other than a regular file, or a path that `docs_only_path` refuses."""
    if not all(isinstance(sha, str) and SHA_PATTERN.match(sha) for sha in (base, tip)):
        return None
    out = _git(checkout, "diff", "--raw", "-z", "--no-abbrev", "--no-renames", "--no-ext-diff",
               "--no-textconv", "--ignore-submodules=none", base, tip)
    tokens = out.split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()
    if not tokens or len(tokens) % 2:
        return None
    paths = []
    for meta, path in zip(tokens[0::2], tokens[1::2]):
        record = RAW_RECORD.match(meta)
        if not record:
            return None
        old_mode, new_mode, status = record.groups()
        missing = "000000"
        if old_mode not in REGULAR_MODES + (missing,) or new_mode not in REGULAR_MODES + (missing,):
            return None
        if (status == "A") != (old_mode == missing) or (status == "D") != (new_mode == missing):
            return None
        if not docs_only_path(path):
            return None
        paths.append(path)
    return sorted(set(paths))


def docs_only_change(checkout, tip):
    """(base, paths) when every file the branch at `tip` changed since it left `main` is docs-only,
    else None. `base` is the one merge-base of `refs/heads/main` and `tip`, as a full hash; `paths`
    are the changed files, sorted. Fail closed (T289): a missing `main`, two merge-bases, an
    unreadable range and an empty diff are all None. Never raises."""
    try:
        if not isinstance(tip, str) or not SHA_PATTERN.match(tip):
            return None
        bases = _git(checkout, "merge-base", "--all", BASE_REF, tip).split()
        if len(bases) != 1 or not SHA_PATTERN.match(bases[0]):
            return None
        paths = _raw_diff(checkout, bases[0], tip)
        return (bases[0], paths) if paths else None
    except Exception:
        return None


def record_confirms_pass(checkout, record):
    """True when a run record counts as a pass: `pass`, or a `skip-pass` that git still backs. The
    second needs a full-hash `base` that is an ancestor of the record's commit and of `main`, and
    a docs-only change between the two. The model's SKIP is never read here. Any doubt is False."""
    try:
        verdict = record.get("verdict")
        if verdict == "pass":
            return True
        if verdict != SKIP_PASS:
            return False
        base, sha = record.get("base"), record.get("commit")
        if not (isinstance(base, str) and isinstance(sha, str)
                and SHA_PATTERN.match(base) and SHA_PATTERN.match(sha)):
            return False
        _git(checkout, "merge-base", "--is-ancestor", base, sha)
        _git(checkout, "merge-base", "--is-ancestor", base, BASE_REF)
        return bool(_raw_diff(checkout, base, sha))
    except Exception:
        return False


def same_code(checkout, task_id, verified, head, report_rel=None):
    """True when `head` is the verified commit, or differs from it only in the file that holds this
    task's result (the Supervisor committed the hook-written row or line). Any doubt is False.

    `report_rel` is that file, relative to the checkout: the task's review file by default, and
    `tasks/MINIMAL_LOG.md` for a minimal-track task (T188 D5).
    """
    if not verified or not head:
        return False
    if verified == head:
        return True
    try:
        changed = _git(checkout, "diff", "--name-only", verified, head).split()
    except Exception:
        return False
    return set(changed) <= {report_rel or f"tasks/TASK_REVIEW_{task_id}.md"}


def skip_note(paths):
    """T289: `skip (no runtime surface: <paths>)`. The note names the first NOTE_PATHS paths. Each is
    a safe name (`docs_only_path`), so it cannot add a cell, a line or a `commit <sha>` of its own."""
    paths = sorted(paths)
    shown = ", ".join(paths[:NOTE_PATHS])
    more = f", +{len(paths) - NOTE_PATHS} more" if len(paths) > NOTE_PATHS else ""
    return f"skip (no runtime surface: {shown}{more})"


def row_cells(sha, verdict, session, log, reason="", paths=()):
    """The D4 `verify` row's Result and Notes cells. Notes for a run that did not pass never
    contain "pass" (the merge gate looks for that word in Notes). A `skip-pass` (T289) says
    `skip (no runtime surface: <paths>)` and ends `— pass`."""
    if verdict == SKIP_PASS:
        notes = f"{AUTO_ROW_TAG}, session {session}, commit {sha}, log {log}, {skip_note(paths)} — pass"
        return RESULT_CELL[verdict], re.sub(r"[|\n\r]", " ", notes)
    notes = f"{AUTO_ROW_TAG}, session {session}, commit {sha}, log {log} — {verdict}"
    if reason:
        notes += f" ({reason})"
    notes = re.sub(r"[|\n\r]", " ", notes)
    if verdict != "pass":
        notes = re.sub(r"pass", "p-ss", notes, flags=re.IGNORECASE)
    return RESULT_CELL[verdict], notes


def auto_row_confirmed(root, checkout, task_id, notes, report_rel=None):
    """D5: an `auto-run by hook` row counts only when the record for this task and the row's commit
    exists, names the same task, commit and session, says pass (or a `skip-pass` that git still
    backs: `record_confirms_pass`), and the commit is the checkout's head (or differs from it only
    in the file that holds the result)."""
    commit = ROW_COMMIT.search(notes or "")
    session = ROW_SESSION.search(notes or "")
    if not commit or not session:
        return False
    sha = commit.group(1)
    record = read_record(root, task_id, sha)
    if not record:
        return False
    if (record.get("task"), record.get("commit"), record.get("session")) != (
            task_id, sha, session.group(1)) or not record_confirms_pass(checkout, record):
        return False
    return same_code(checkout, task_id, sha, head_commit(checkout), report_rel)


def record_line(sha, verdict, session, log, reason="", paths=()):
    """The D3 `verify:` line for a minimal-track Decision record (T188), bullet excluded.

    Same facts as the Evidence row's two cells, on one line. A line that did not pass never
    contains the word "pass": the merge gate reads that word as the result. A `skip-pass` (T289)
    adds `skip (no runtime surface: <paths>)`.
    """
    tail = f"{AUTO_ROW_TAG}, session {session}, commit {sha}, log {log}"
    if verdict == SKIP_PASS:
        tail += f", {skip_note(paths)}"
    elif reason:
        tail += f" ({reason})"
    tail = re.sub(r"[\n\r]", " ", tail)
    if verdict != "pass":
        tail = re.sub(r"pass", "p-ss", tail, flags=re.IGNORECASE)
    return f"{VERIFY_LINE_PREFIX}{RESULT_CELL[verdict]} — {tail}"


def checked_field(body):
    """The `Checked:` field of a Decision record `body` — its header plus the bullets under it —
    as a match, or None. The one place the D3 `verify:` line is written and read."""
    return CHECKED_FIELD.search(body or "")


def record_verify_line(body):
    """(match, result, notes) of the `verify:` line inside the record body's `Checked:` field, or
    (None, "", ""). Offsets are into `body`."""
    field = checked_field(body)
    if field is None:
        return None, "", ""
    hit = VERIFY_LINE.search(body, field.start(), field.end())
    if hit is None:
        return None, "", ""
    return hit, (hit.group("result") or "").strip(), (hit.group("notes") or "").strip()


def minimal_verify_line(task_id, tasks_dir):
    """(result, notes) of the `verify:` line in this task's Decision record under `tasks_dir`, or
    None. For the merge gate, which must never raise: every failure returns None."""
    try:
        text = auto_mode.read(os.path.join(tasks_dir, auto_mode.MINIMAL_LOG))
        if text is None:
            return None
        block = auto_mode.record_block(text, task_id, skip_comments=True)
        if block is None:
            return None
        hit, result, notes = record_verify_line(block[2])
        return None if hit is None else (result, notes)
    except Exception:
        return None


def record_verify_lines(body):
    """[(result, notes)] of every `verify:` line inside the record body's `Checked:` field, in
    order (T250: the user's `/verify` line may follow a blocked hook line)."""
    field = checked_field(body)
    if field is None:
        return []
    return [((hit.group("result") or "").strip(), (hit.group("notes") or "").strip())
            for hit in VERIFY_LINE.finditer(body, field.start(), field.end())]


def minimal_verify_lines(task_id, tasks_dir):
    """`record_verify_lines` of this task's Decision record under `tasks_dir`; [] on any failure."""
    try:
        text = auto_mode.read(os.path.join(tasks_dir, auto_mode.MINIMAL_LOG))
        block = auto_mode.record_block(text, task_id, skip_comments=True) if text else None
        return record_verify_lines(block[2]) if block else []
    except Exception:
        return []

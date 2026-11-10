#!/usr/bin/env python3
"""Shared task attribution for hooks — answers "which task is this tool call
about?" from a *structural* signal only.

Used by `post_tool_trace.py` (which trace file a record lands in) and
`pre_agent_step_limit.py` (which task a tool call is counted against). Both
previously took the first `T\\d{3}` substring found anywhere in the tool
payload, so merely *reading* a file whose body mentions a task ID attributed the
call to that task. A wrong tag is worse than a missing one: attribution comes
from where the work is happening, never from what the text happens to mention.

The structural-reference idea is lifted from
`pre_agent_validate_guide.py:extract_structural_task_ids` (T022), which already
solved the same problem for the agent-spawn hard block.

Precedence — first match wins:

  1. ``CLAUDE_ACTIVE_TASK`` env var, when it is well-formed (``T`` + 3 digits,
     case-insensitive). Anything else is ignored rather than trusted — this is
     the only externally-supplied value that reaches a file name.

     **Known-dead in practice (T047):** a hook process is spawned by the
     harness as a *sibling* of the tool call, not a child of the command run
     inside it. It inherits the harness's own environment, never the
     subshell an ``export FOO=bar && cmd`` or ``FOO=bar cmd`` creates inside a
     single ``Bash`` tool call. This precedence slot still fires correctly
     when the var is set in the process that launched the whole session
     (e.g. a sub-agent's terminal, before ``claude`` starts) — it just cannot
     be set *from inside* a running session. See slots 2 and 3.
  2. **Spawn binding** (T196) — sub-agent calls only. The harness puts
     ``agent_id`` on every hook event a sub-agent's tool call fires, and
     nothing on a main-session call. The sub-agent's transcript is
     ``<dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl``
     and its first line is the spawn prompt, verbatim. The task is read with
     the same two patterns slot 5 uses, but in the opposite order: an explicit
     ``Task ID:`` line wins, and the first ``TASK_GUIDE_Txxx.md`` path counts
     only when there is none — a prompt may cite another task's guide as
     context, and a binding attributes every call. The agent writes
     nothing. The result is cached at
     ``.state/agent_task/<session_id>/<agent_id>`` so later calls do not
     re-read the transcript. That transcript layout is internal to Claude Code
     and undocumented (measured on 2.1.312, `tasks/TASK_GUIDE_T196.md` F1–F3):
     if it moves, this slot yields nothing and resolution falls through.
  2b. **The worktree a ``Bash`` call runs in** (T287) — only when the caller
     passes ``per_call=True``, which ``post_tool_trace.py`` alone does. An
     ALLOWLIST, for the directory and for the command words (fix rounds 2-3):
     a call is filed under a task only when the WHOLE command is
     ``cd <dir> && cmd [&& cmd]...`` (a ``|`` may follow a later command),
     ``<dir>`` is an existing searchable directory inside a live worktree of
     this repo, and that worktree's branch names one task (``fix/t120-x``
     names T120). Every other shape says nothing and the slots below decide.
     See ``_leading_cd_dir`` for the rules:
       * the joiner after the ``cd`` is ``&&`` only (no ``;``, ``||``,
         newline, ``&``, ``(``); the target is no ``-``, ``~``, ``$``, glob or
         bare name under ``CDPATH``;
       * every command starts with a word of ``ALLOWED_HEADS`` (``pytest``,
         ``python3 -m pytest|unittest`` or a relative script, ``git`` without
         ``-C`` and only a reading verb, ``add`` or ``commit`` (T296: a verb that
         can rename or switch the branch is out, because the hook reads the branch
         after the command ran), ``ls``, ``echo``, ``cat``, ``head``, ``tail``,
         ``grep``, ``wc``, ``true``, ``timeout <n>``). zsh's ``chdir`` is ``cd``, so
         the words are an allowlist, not a denylist; ``cd``/``chdir``/``builtin``/
         ``eval``/... anywhere is a second layer;
       * no ``<<``, ``$``, backtick, ``#``, ``@file``, inline-code flag
         (``-c``, ``-e``), argument ``-`` or ``[-+]N``, control or non-ASCII
         space character, and no argument whose real path (absolute, or
         relative through a symlink) is outside the worktree;
       * T296: no ``{`` or ``}`` and no unquoted ``*``, ``?`` or ``[`` (brace
         expansion and globs name files the tokens do not: ``> {.,..}/f``,
         ``pytest mt*``); a backslash is read as the shell reads it (a backslash
         and a newline join the two lines; ``\\*`` is a plain star).
     The event's ``cwd`` only resolves a relative target; a call with no
     ``cd`` is never filed by it. A failure of the slot (no ``git``, a timeout)
     also says nothing. Limits (``docs/claude-md/tracks.md`` ``### Known
     limits``): it shows where the command started, not what it ran; a branch
     name that contains the task ID is enough (C9). Why: on 2026-11-04 the
     Supervisor ran T120's tests in ``wt-t120`` while the session's one pointer
     (slot 3) named T250, so they were filed under T250 and the Stop check
     paused T120 (T283 spike 6). The step limit and the sensitive-path hook
     keep the slots below: a safety stop sees the task it saw before T287.
  3. **The per-session state file** (T196; replaces T047's shared file),
     ``.claude/hooks/.state/active_task.d/<session_id>`` — a plain two-line file
     (``Txxx`` on line 1, an ISO-8601 UTC "written at" timestamp on line 2)
     that a ``Bash`` tool call inside a running session writes with a shell
     redirect, using ``$CLAUDE_CODE_SESSION_ID`` (set in every ``Bash`` call's
     environment, equal to the hook's ``session_id``, F2). The
     ``<session_id>`` comes from the event, never from the file. Rejected when
     malformed, unreadable, or older than ``CLAUDE_ACTIVE_TASK_STATE_MAX_AGE_S``
     seconds (default 21600 = 6h) — a stale pointer left over from a finished
     task is worse than no pointer (the T043 mis-attribution class). Nothing
     clears it automatically; the age rule degrades it.

     **Why per session (T196).** T047's file was ``.state/active_task``, one
     per checkout. On 2026-10-28 the T190 agent wrote it and, six minutes
     later, another live session overwrote it with ``T188``: 89 of T190's
     calls were filed under T188, and ``trace_shows_verification("T188")``
     passed on T190's test run without anyone lying. A sub-agent shares its
     parent's ``session_id`` — slot 2 is what separates sibling sub-agents.
     **The shared file is no longer read** (D2): a file left there is ignored.
     **Residual:** two sub-agents of one session spawned *without* a structural
     ID in their prompt both fall through to that session's file. The file
     names one task, but the main session may work on several: T287 slot 2b
     files a ``Bash`` call by the worktree it runs in first (trace only).

     **Path resolution (T047 Stage 4 fix — see `_resolve_root`).** The state
     root is ``$CLAUDE_PROJECT_DIR`` when set, never ``__file__`` arithmetic
     alone. The harness always invokes hooks as
     ``$CLAUDE_PROJECT_DIR/.claude/hooks/*.py`` (see `settings.json`) — the
     *main checkout*, regardless of which worktree's cwd triggered the tool
     call. A writer must therefore use the main checkout's literal absolute
     path: a cwd-relative path from a worktree writes a file the hook never
     reads, and ``$CLAUDE_PROJECT_DIR`` is empty inside a ``Bash`` tool call.

     **Path safety (D3).** ``session_id`` and ``agent_id`` reach a file name
     only when they match ``SAFE_KEY`` (letters, digits, ``_``, ``-``; 1–128);
     otherwise slots 2 and 3 are skipped. The transcript path is derived only
     from the event's absolute ``transcript_path``, and is only ever read.
  4. A ``TASK_GUIDE_Txxx.md`` reference inside a **path-valued** ``tool_input``
     field (``file_path``, ``notebook_path``, ``path``). Path fields only, an
     explicit list — a whole-payload scan is the defect being removed. This is
     what makes writing/reading a task's own guide attribute to it.
  5. ``Agent`` calls only: a structural reference inside ``tool_input.prompt`` —
     a ``TASK_GUIDE_Txxx.md`` path, or an explicit ``Task ID:`` declaration
     line. Only an ``Agent`` spawn prompt is task-scoped by construction; any
     other tool's prompt-ish field is free text.
  6. Otherwise ``None`` — unattributed. The caller decides what that means
     (`_untagged.jsonl` for the trace; no counting for the step limit).

Deliberate decisions:

* **A ``Bash`` ``command`` string is never scanned for task IDs**, even when it
  legitimately contains a guide path (``cat tasks/TASK_GUIDE_T012.md``). Command
  text is free text that can quote arbitrary file content; scanning it is the
  same class of guess this module exists to remove. Such a call is
  unattributed. Slot 2b (T287) reads only the leading ``cd`` target — where the work
  runs, not what it mentions — and takes the task from the worktree's branch,
  never from the command text.
* **``tool_response`` is never read.** A tool's *output* describes what a file
  says, not what the agent is working on. The one file slot 2 reads is the
  sub-agent's own transcript, and only its first line: the spawn prompt, which
  is task-scoped by construction exactly as slot 5's ``Agent`` prompt is.
* Task IDs are matched case-insensitively and normalized to upper case with at
  least 3 digits (``t44`` and ``T044`` are the same bucket, never two).

``resolve_task_id`` never raises: any unexpected input degrades to ``None``, so
a hook that runs on every tool call in the repo can never crash or block on it.
"""
import json
import os
import re
import shlex
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone

# Board IDs (T153). This module must never fail to import (both callers would lose
# attribution repo-wide), so an absent `board` package degrades to today's `T` IDs.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project_root import project_root  # noqa: E402
try:
    from board.config import (  # noqa: E402
        PATH_SAFE_ID,
        normalize_task_id as _canonical_task_id,
        task_id_pattern,
    )
except Exception:  # pragma: no cover - exercised by copying this file alone
    PATH_SAFE_ID = re.compile(r"\AT\d+\Z")

    def _canonical_task_id(task_id):
        return "T" + str(task_id).strip().lstrip("Tt").zfill(3)

    def task_id_pattern(root=None, local=r"T\d+", bounded=False):
        return rf"(?<![A-Za-z0-9_])(?:{local})(?![A-Za-z0-9_])" if bounded else local

ENV_VAR = "CLAUDE_ACTIVE_TASK"

# tool_input fields whose value is a file-system path. Explicit list by design.
PATH_FIELDS = ("file_path", "notebook_path", "path")

# The `T` alternatives below are today's patterns; `task_id_pattern` adds the board's
# `id_pattern` (T153) when `.claude/board.json` sets one. Built per call, not at import:
# the config lives under `_resolve_root()`, and a hook process is short-lived anyway.
ENV_TASK_LOCAL = r"T\d{3}"


def _env_task_pattern():
    return re.compile(rf"({task_id_pattern(_resolve_root(), ENV_TASK_LOCAL)})\Z", re.IGNORECASE)


def _guide_path_pattern():
    return re.compile(rf"TASK_GUIDE_({task_id_pattern(_resolve_root())})(?:_[A-Z0-9_]+)?\.md",
                      re.IGNORECASE)


def _task_id_declaration_pattern():
    return re.compile(rf"(?:\*\*Task ID\*\*|Task ID)\s*:\s*"
                      rf"({task_id_pattern(_resolve_root(), bounded=True)})", re.IGNORECASE)


def _resolve_root():
    """Where the active-task state file lives. Prefer $CLAUDE_PROJECT_DIR —
    the harness sets it to the main checkout for every hook invocation
    (settings.json already relies on it for every hook command), regardless
    of which worktree's cwd triggered the tool call. Falling back to
    __file__ arithmetic would silently resolve to whichever copy of this
    module happens to execute (the worktree's, in a subprocess-sandboxed
    test) — which is exactly the split that made the state file unreadable
    by the real hook (T047 Stage 4 review): an agent's `mkdir -p
    .claude/hooks/.state && ... > .claude/hooks/.state/active_task` (T047's
    shared file, no longer read since T196), run from a worktree cwd, wrote to `<worktree>/.claude/hooks/.state/`, while
    the live hook — always invoked as `$CLAUDE_PROJECT_DIR/.claude/hooks/*.py`
    — read `<main-checkout>/.claude/hooks/.state/`. Different files, so the
    agent's own writes were invisible to the hook it was trying to satisfy.
    T232: `lib/project_root.py` now decides, for this module and every hook:
    the env var when it is set and a directory, otherwise __file__ arithmetic,
    so the module still works when $CLAUDE_PROJECT_DIR is unset (e.g. this
    module invoked directly in a test or a checkout with no harness wrapping
    it)."""
    return project_root()


# Structural channels, per caller (T196). See module docstring, precedence
# slots 2 and 3. Resolved once at import time — matches every other
# module-level constant here (PATH_FIELDS, the compiled patterns); see
# resolve_task_id's never-raises contract for what happens if the resolved
# path is bogus. T047's shared `STATE_DIR/active_task` is deliberately not
# named here: it is no longer read (D2).
STATE_DIR = os.path.join(_resolve_root(), ".claude", "hooks", ".state")
ACTIVE_TASK_DIR = os.path.join(STATE_DIR, "active_task.d")  # slot 3: <session_id>
AGENT_TASK_DIR = os.path.join(STATE_DIR, "agent_task")     # slot 2 cache: <session_id>/<agent_id>
ACTIVE_TASK_MAX_AGE_DEFAULT_S = 21600  # 6h

# D3: the only shape of `session_id` / `agent_id` allowed into a file name.
SAFE_KEY = re.compile(r"\A[A-Za-z0-9_-]{1,128}\Z")
# The first transcript line is the whole spawn prompt; read no more than this.
TRANSCRIPT_FIRST_LINE_MAX_BYTES = 1 << 20  # 1 MB


def _resolve_max_age_s():
    """Staleness window for the state file, overridable by env.

    Parsed defensively because this runs at **import** time, one layer below
    `resolve_task_id`'s never-raises contract. A bare `int(os.environ[...])`
    raises `ValueError` on any non-numeric value (`"6h"`), and both callers
    wrap their `from task_context import ...` in `except Exception` — so a
    single malformed env var would silently disable attribution *repo-wide*,
    including the path-field precedence that has nothing to do with this
    setting. Fail to the default rather than taking the whole module down
    (T047 Stage 4 review).
    """
    raw = os.environ.get("CLAUDE_ACTIVE_TASK_STATE_MAX_AGE_S", "").strip()
    if not raw:
        return ACTIVE_TASK_MAX_AGE_DEFAULT_S
    try:
        parsed = int(raw)
    except ValueError:
        return ACTIVE_TASK_MAX_AGE_DEFAULT_S
    return parsed if parsed > 0 else ACTIVE_TASK_MAX_AGE_DEFAULT_S


ACTIVE_TASK_MAX_AGE_S = _resolve_max_age_s()


def normalize_task_id(task_id):
    """`44` / `t44` -> `T044` (digit strings longer than 3 are kept as-is); a board ID
    is upper-cased (`eng-170` -> `ENG-170`). None when the result could not safely
    name a file (an over-broad `id_pattern` must not reach a trace path)."""
    canonical = _canonical_task_id(task_id)
    return canonical if PATH_SAFE_ID.match(canonical) else None


def _task_id_from_env():
    raw = os.environ.get(ENV_VAR, "")
    match = _env_task_pattern().match(raw.strip())
    return normalize_task_id(match.group(1)) if match else None


def _safe_key(value):
    """`value` when it may name a file (D3), else None."""
    return value if isinstance(value, str) and SAFE_KEY.match(value) else None


def _task_id_from_cache(cache_path):
    try:
        with open(cache_path) as f:
            match = _env_task_pattern().match(f.read().strip())
        return normalize_task_id(match.group(1)) if match else None
    except Exception:
        return None


def _write_cache(cache_path, task_id):
    """Best effort: a read-only state dir still resolves, from the transcript."""
    try:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w") as f:
            f.write(task_id + "\n")
    except Exception:
        pass


def _spawn_prompt(transcript_path, session_id, agent_id):
    """The sub-agent's spawn prompt: the first line of its own transcript (F3),
    or None when that line is missing, too long, or not a user message."""
    if not isinstance(transcript_path, str) or not os.path.isabs(transcript_path):
        return None
    path = os.path.join(os.path.dirname(transcript_path), session_id, "subagents",
                        f"agent-{agent_id}.jsonl")
    with open(path, "rb") as f:
        first = f.readline(TRANSCRIPT_FIRST_LINE_MAX_BYTES + 1)
    if len(first) > TRANSCRIPT_FIRST_LINE_MAX_BYTES:
        return None
    record = json.loads(first.decode("utf-8"))
    if not isinstance(record, dict):
        return None
    message = record.get("message")
    if record.get("type") != "user" or not isinstance(message, dict):
        return None
    if message.get("role") != "user" or not isinstance(message.get("content"), str):
        return None
    return message["content"]


def _task_id_from_spawn_prompt(prompt):
    """Slot 2's reading of a spawn prompt: an explicit `Task ID:` declaration
    wins; the first guide path counts only when there is none. Slot 5 scans
    guide paths first, which is acceptable for one `Agent` record but not here:
    a binding attributes every call the sub-agent makes and is cached, so a
    prompt that cites another task's guide before its own `Task ID:` line
    (T196 Stage 4 P2) must not bind to that other task."""
    if not isinstance(prompt, str):
        return None
    for pattern in (_task_id_declaration_pattern(), _guide_path_pattern()):
        match = pattern.search(prompt)
        if match:
            return normalize_task_id(match.group(1))
    return None


def _task_id_from_spawn_binding(event):
    """Slot 2: the task a sub-agent's spawn prompt structurally names. Never
    raises; a non-binding prompt is not cached, so it is simply re-checked."""
    try:
        session_id = _safe_key(event.get("session_id"))
        agent_id = _safe_key(event.get("agent_id"))
        if not session_id or not agent_id:
            return None
        cache_path = os.path.join(AGENT_TASK_DIR, session_id, agent_id)
        task_id = _task_id_from_cache(cache_path)
        if task_id:
            return task_id
        prompt = _spawn_prompt(event.get("transcript_path"), session_id, agent_id)
        task_id = _task_id_from_spawn_prompt(prompt)
        if task_id:
            _write_cache(cache_path, task_id)
        return task_id
    except Exception:
        return None


def _task_id_from_state_file(event):
    """Slot 3: read + validate this session's state file. Never raises: an
    unsafe session ID, any read error, bad format, or stale timestamp degrades
    to None (falls through to the next precedence slot), never to a
    trusted-but-wrong task ID."""
    try:
        session_id = _safe_key(event.get("session_id"))
        if not session_id:
            return None
        with open(os.path.join(ACTIVE_TASK_DIR, session_id)) as f:
            lines = f.read().splitlines()
        if len(lines) < 2:
            return None

        match = _env_task_pattern().match(lines[0].strip())
        if not match:
            return None

        written_at = datetime.fromisoformat(lines[1].strip().replace("Z", "+00:00"))
        if written_at.tzinfo is None:
            written_at = written_at.replace(tzinfo=timezone.utc)
        age_s = (datetime.now(timezone.utc) - written_at).total_seconds()
        if age_s < 0 or age_s > ACTIVE_TASK_MAX_AGE_S:
            return None

        return normalize_task_id(match.group(1))
    except Exception:
        return None


GIT_TIMEOUT_S = 5


# Slot 2b is an ALLOWLIST (fix round 2). Only `cd <dir> && cmd [&& cmd]...` is understood; every
# other shape says nothing. `cd` is the one word a blocklist cannot enumerate (`builtin cd`, `eval`,
# `{ cd; }`, `if cd`, `cd -`, `CDPATH=`, a heredoc marker inside quotes, ...), so the rule is not
# "find the bad forms" but "accept one good form".
ANYWHERE_WORDS = re.compile(r"(?<![\w-])(?:cd|chdir|builtin|command|eval|exec|source|pushd|popd)(?![\w-])")
HEAD_WORDS = frozenset({".", "if", "while", "until", "for", "case", "select", "function", "coproc",
                        "time", "!", "{", "}", "(", ")", "do", "then", "else", "elif", "fi", "done",
                        "esac", "in"})
REDIRECTS = frozenset({">", ">>", "<", ">&", "<&", "&>", "&>>"})
ASSIGNMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=")
TARGET_FORBIDDEN = re.compile(r"[*?\[\]{}$`]")
OUTSIDE_OK = frozenset({"/dev/null"})
# Inline code (`python3 -c`, `bash -lc`, `node -e`, `perl -e`, `ruby -e`) can `chdir` anywhere; a
# quote or paren next to a `/` is a path inside such code (`os.chdir('/home')`). Both fail closed.
INLINE_CODE = re.compile(r"-[A-Za-z]*[ce]|--(?:eval|exec|command)(?:=.*)?")
CODE_WITH_PATH = re.compile(r"""['"()]""")
# Fix round 3: the COMMAND WORDS are an allowlist too (zsh's `chdir` is `cd`; a denylist of words
# was extended three times). A command that starts with any other word says nothing.
ALLOWED_HEADS = frozenset({"pytest", "py.test", "python", "python3", "git", "ls", "echo", "cat",
                           "head", "tail", "grep", "wc", "true", "timeout"})
PYTHON_FLAGS = frozenset({"-B", "-u", "-O", "-s", "-E", "-I"})
GIT_REDIRECTORS = ("-C", "--git-dir", "--work-tree")
COUNT_EXEMPT = frozenset({"head", "tail", "git"})  # `tail -3`, `git log -1` are not a `chdir -1`
# T296 (P3-2): the hook runs AFTER the command, and files a call by the branch the worktree is on
# then. A git verb that can rename or switch that branch (`branch -m`, `checkout -b`, `switch -c`,
# `symbolic-ref`, `rebase <a> <b>`, ...) would file the call by a name the command chose. So the git
# verbs are an allowlist too: reading verbs, `add` and `commit`, and `branch` only to list.
GIT_VERBS = frozenset({"status", "log", "diff", "show", "rev-parse", "ls-files", "grep", "blame",
                       "describe", "shortlog", "merge-base", "cat-file", "add", "commit"})
GIT_BRANCH_LISTING = frozenset({"--show-current", "--list", "-l", "-a", "--all", "-r", "--remotes",
                                "-v", "-vv", "--verbose"})


# T296 (SL7): the git global options that take NO value. Any other `-` word before the verb is a
# doubt: an option that takes a value (`--namespace log`) would hide the real verb behind it, and
# `-c` can define an alias, so none of them is read.
GIT_NO_VALUE_OPTIONS = frozenset({"--no-pager", "-P", "-p", "--paginate", "--no-optional-locks",
                                  "--no-replace-objects", "--literal-pathspecs", "--glob-pathspecs",
                                  "--noglob-pathspecs", "--icase-pathspecs", "--no-lazy-fetch",
                                  "--no-advice"})


def _git_verb_allowed(args):
    """T296 (P3-2, SL7): True when the git verb of `args` cannot move the worktree's branch: a verb of
    `GIT_VERBS`, `branch` with listing options only, or no verb. Only the no-value global options of
    `GIT_NO_VALUE_OPTIONS` may stand before the verb; any other `-` word is refused."""
    index = 0
    while index < len(args) and args[index].startswith("-"):
        if args[index] not in GIT_NO_VALUE_OPTIONS:
            return False
        index += 1
    if index >= len(args):
        return True
    verb, rest = args[index], args[index + 1:]
    if verb == "branch":
        return all(a in GIT_BRANCH_LISTING for a in rest)
    return verb in GIT_VERBS


def _allowed_command(words):
    """True when the words of one simple command (redirects removed) start with an allowed word, in
    an allowed form: `python3` only as `-m pytest|unittest` or a relative script path; `git` without
    `-C`/`--git-dir`/`--work-tree`; `timeout <n>` only before an allowed word; no argument that is
    exactly `-` or `[-+]N` (zsh `cd -`, `cd -2`) except for `head`, `tail` and `git`."""
    words = list(words)
    if words and words[0] == "timeout":
        if len(words) < 3 or not re.fullmatch(r"\d+[smhd]?", words[1]):
            return False
        words = words[2:]
    if not words or words[0] not in ALLOWED_HEADS or words[0] == "timeout":
        return False
    head, args = words[0], words[1:]
    if head in ("python", "python3"):
        while args and args[0] in PYTHON_FLAGS:
            args = args[1:]
        if not args:
            return False
        if args[0] == "-m":
            return len(args) > 1 and args[1] in ("pytest", "unittest")
        if args[0].startswith(("-", "/", "~")):
            return False  # a relative script path only
    if head == "git" and any(a.startswith(GIT_REDIRECTORS) for a in args):
        return False
    if head == "git" and not _git_verb_allowed(args):
        return False
    if head not in COUNT_EXEMPT and any(a == "-" or re.fullmatch(r"[-+]\d+", a) for a in args):
        return False
    return True


def join_line_continuations(command):
    """T296 (SL6): `command` with each line continuation removed, the way the shell reads it: left to
    right, a backslash escapes the next character, so `\\\\` + newline is an escaped backslash and a
    line break, and only a lone backslash + newline joins two lines. A single-quoted span has no
    escapes. A trailing backslash is kept."""
    out, index, quote = [], 0, None
    while index < len(command):
        char = command[index]
        if char == "\\" and quote != "'":
            if command[index + 1:index + 2] == "\n":
                index += 2
                continue
            out.append(command[index:index + 2])
            index += 2
            continue
        if quote is None and char in "'\"":
            quote = char
        elif quote == char:
            quote = None
        out.append(char)
        index += 1
    return "".join(out)


def _unquoted_glob(command):
    """T296 (P2-3): True when `command` holds `*`, `?` or `[` outside quotes and not escaped by a
    backslash, read the way the shell reads quotes: a single-quoted span has no escapes, and in a
    double-quoted span or outside quotes a backslash escapes the next character."""
    quote, index = None, 0
    while index < len(command):
        char = command[index]
        if quote == "'":
            quote = None if char == "'" else quote
        elif char == "\\":
            index += 1
        elif quote == '"':
            quote = None if char == '"' else quote
        elif char in "'\"":
            quote = char
        elif char in "*?[":
            return True
        index += 1
    return False


def _escapes(token, worktree):
    """True when `token` (or a piece of it) names a place outside `worktree`: `..`, `~`, or a path
    whose real path (absolute, or relative to the worktree) is not inside it. Nothing proves a runner reads only its own directory, but a
    plain `--rootdir <main>` or `../main/tests` must not be filed under the worktree (P2)."""
    for piece in re.split(r"[\s=:,;]+", token):
        if piece.startswith("~") or ".." in piece.split("/"):
            return True
        if not piece or piece in OUTSIDE_OK:
            continue
        # an absolute path, or a relative one (a symlink inside the worktree may point out of it)
        real = os.path.realpath(piece if piece.startswith("/") else os.path.join(worktree, piece))
        if real != worktree and not real.startswith(worktree + os.sep):
            return True
    return False


def _leading_cd_dir(command, cwd):
    """Slot 2b: the existing directory that `command` changes into, when `command` is exactly
    `cd <dir> && cmd [&& cmd]...` and nothing in it can move the shell or run a command elsewhere;
    otherwise None. The rules (each one a Stage 4 finding, tests `test_round2_*`):

    * `cd` is the first word and the only `cd`; `&&` is the only joiner after it. Never `;`, `||`,
      a newline, a pipe or `&` after it, nor `cd -`, `~`, `$`, backticks or a glob in the target.
    * the target exists (`isdir`) and is searchable, so the `cd` cannot fail and leave the command in
      the event's directory; and its logical and physical paths agree (`cd W/link/..`).
    * no heredoc `<<` anywhere (a body is not a command; a quoted marker hides one), no `$`, no
      backticks, no comment, no leading `VAR=` before a word, and none of `builtin command eval exec
      source pushd popd` or a shell keyword (`if while for time ! { function ...`) as a word.
    * T296: no `{` or `}` anywhere and no unquoted, unescaped `*`, `?` or `[` (`_unquoted_glob`); a
      backslash + newline is deleted, as the shell does, before the command is read.
    * no argument that names `..`, `~` or an absolute path outside the worktree (`--rootdir <main>`),
      no inline-code flag (`-c`, `-e`, `-lc`, `--eval`) and no argument that holds a quote or paren
      next to a `/` (`os.chdir('/home')`).
    """
    if not isinstance(cwd, str) or not os.path.isabs(cwd):
        cwd = None
    command = join_line_continuations(command)  # T296: the shell deletes a lone backslash + newline
    if not command.startswith("cd ") or "\n" in command or "\r" in command:
        return None
    if "<<" in command or "$" in command or "`" in command:
        return None
    if "{" in command or "}" in command or _unquoted_glob(command):
        return None  # brace expansion and globs name files the tokens do not (`{.,..}/f`, `mt*`)
    if any(unicodedata.category(c)[0] in "CZ" and c != " " and c != "\t" for c in command):
        return None  # a control char or a non-ASCII space: not what the shell reads as a word break
    # keep in step with session_work.SEPARATORS / its shlex setup (same punctuation_chars lexer)
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        tokens = list(lexer)
    except ValueError:
        return None
    if len(tokens) < 4 or tokens[0] != "cd" or tokens[2] != "&&":
        return None
    target = tokens[1]
    if (not target or target.startswith(("-", "~")) or TARGET_FORBIDDEN.search(target)
            or ANYWHERE_WORDS.search(target)):
        return None
    dotted = target.startswith(("/", "./", "../")) or target in (".", "..")
    if not dotted and ("CDPATH" in command or os.environ.get("CDPATH")):
        return None  # a bare name is looked up in $CDPATH first
    if os.path.isabs(target):
        joined = target
    elif cwd:
        joined = os.path.join(cwd, target)
    else:
        return None
    directory = os.path.normpath(joined)
    if (not os.path.isdir(directory) or not os.access(directory, os.X_OK)
            or os.path.realpath(directory) != os.path.realpath(joined)):
        return None
    worktree = os.path.realpath(directory)
    head, target_next = True, False  # head: the next word starts a command; target_next: a redirect's
    words = []  # the words of the simple command being read, redirects removed
    for token in tokens[3:]:
        if token in ("&&", "|"):
            if not _allowed_command(words):
                return None
            head, words = True, []
            continue
        if token in REDIRECTS:
            target_next = True
            continue
        if re.fullmatch(r"[();&|<>]+", token):
            return None  # `;` `||` `&` `|&` `(` `)` `;;` `<<` ...
        if token.startswith(("#", "@")) or ANYWHERE_WORDS.search(token):
            return None  # a comment, an argfile (`@args.txt`), a `cd`-like word
        if target_next:
            target_next = False
        else:
            words.append(token)
            if head:
                if token in HEAD_WORDS or ASSIGNMENT.match(token):
                    return None
                head = False
                continue
        if (INLINE_CODE.fullmatch(token) or (CODE_WITH_PATH.search(token) and "/" in token)
                or _escapes(token, worktree)):
            return None
    if not _allowed_command(words):
        return None
    return directory


def _worktree_branches(root):
    """[(real path, branch)] of each live worktree of the repo at `root`, the main checkout and
    detached worktrees excluded; [] when `git` exits non-zero. Raises when `git` cannot run: the
    caller treats that as "says nothing" (Stage 4 P2)."""
    done = subprocess.run(["git", "worktree", "list", "--porcelain", "-z"], cwd=root,
                          capture_output=True, text=True, timeout=GIT_TIMEOUT_S)
    if done.returncode != 0:
        return []
    found, path = [], None
    for field in done.stdout.split("\0"):
        if field.startswith("worktree "):
            path = os.path.realpath(field[len("worktree "):])
        elif field.startswith("branch refs/heads/") and path and path != root:
            found.append((path, field[len("branch refs/heads/"):]))
    return found


def _task_id_from_worktree(event):
    """Slot 2b (T287): the task whose worktree a `Bash` call of the exact form
    `cd <dir> && cmd [&& cmd]...` runs in (see `_leading_cd_dir`), or None. Anything else —
    a directory that is the main checkout, no worktree, or a worktree whose branch names no task or
    two — says nothing."""
    if event.get("tool_name") != "Bash":
        return None
    tool_input = event.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str) or not command.startswith("cd "):
        return None  # the usual call: no tokenizer, no `git`
    directory = _leading_cd_dir(command, event.get("cwd"))
    if not directory:
        return None
    root = os.path.realpath(_resolve_root())
    real = os.path.realpath(directory)
    if real == root:
        return None
    hits = [(p, b) for p, b in _worktree_branches(root) if real == p or real.startswith(p + os.sep)]
    if not hits:
        return None  # a directory that is no worktree of this repo
    branch = max(hits, key=lambda hit: len(hit[0]))[1]
    branch_task = re.compile(task_id_pattern(root, bounded=True), re.IGNORECASE)
    named = {normalize_task_id(m) for m in branch_task.findall(branch)}
    return named.pop() if len(named) == 1 and None not in named else None


def _task_id_from_path_fields(tool_input):
    for field in PATH_FIELDS:
        value = tool_input.get(field)
        if not isinstance(value, str):
            continue
        match = _guide_path_pattern().search(value)
        if match:
            return normalize_task_id(match.group(1))
    return None


def _task_id_from_agent_prompt(tool_input):
    prompt = tool_input.get("prompt")
    if not isinstance(prompt, str):
        return None
    for pattern in (_guide_path_pattern(), _task_id_declaration_pattern()):
        match = pattern.search(prompt)
        if match:
            return normalize_task_id(match.group(1))
    return None


def resolve_task_id(event, per_call=False):
    """Return the Task ID (`Txxx`) this hook event structurally belongs to, or
    None when nothing structural says which task it is. `per_call` (T287, the
    trace hook only) adds slot 2b. Never raises."""
    try:
        task_id = _task_id_from_env()
        if task_id:
            return task_id

        if not isinstance(event, dict):
            return None

        task_id = _task_id_from_spawn_binding(event)
        if task_id:
            return task_id

        if per_call:
            try:  # Stage 4 P2: no `git`, a timeout or an OSError must not drop slots 3-5
                task_id = _task_id_from_worktree(event)
            except Exception:
                task_id = None
            if task_id:
                return task_id

        task_id = _task_id_from_state_file(event)
        if task_id:
            return task_id

        tool_input = event.get("tool_input")
        if not isinstance(tool_input, dict):
            return None

        task_id = _task_id_from_path_fields(tool_input)
        if task_id:
            return task_id

        if event.get("tool_name") == "Agent":
            return _task_id_from_agent_prompt(tool_input)

        return None
    except Exception:
        return None

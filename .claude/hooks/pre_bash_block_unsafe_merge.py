#!/usr/bin/env python3
"""
PreToolUse hook — fires before every Bash tool call.

Blocks git push/merge/rebase/pull commands if:
  1. Any task in PROJECT_KANBAN.md is still In Progress or Ready for Review
  2. No Stage 5 verify evidence is found in any pending task guide

This enforces the pipeline gate: Stage 4 review + Stage 5 verify must
complete before code ships.

T211: git's global options between `git` and the verb (`git -C <dir> push`, `git -c k=v merge`,
`git --no-pager pull`, an unknown `--x`) do not hide it, and `git -c alias.<x>=… <x>` (or
`--config-env alias.<x>=…`) is gated as a merge. Known limit, by design: an alias set in a git
config file, or through the `GIT_CONFIG_*` environment variables, is out of reach of a static
check of the command text — this hook never reads git config to find an alias (it reads config
only for the push checks and, for an `[admin]` merge or push, for the T295 repo rule). Shell
aliases and functions, scripts that call git, and `gh pr merge` are out of scope too.

T232: the project comes from `lib/project_root.py`, and from a plugin the hook stands down in a
non-kit project. Inside one, input it cannot read is a block: it cannot tell the call is not a push.

T284: while the session's latest user request carries `[auto]` or `[admin]`, a merge, push or pull
is blocked, unless `[admin]` allows that one command (see `auto_mode_blocker`).

T296: in that mode a git word or git verb that is not a plain literal word is a block too
(`hidden_git_verb`); a `git merge` option's value is never read as the branch (`_merge_sources`);
a branch push goes only to the repository's own remote; `invokes_test_runner` reads backslashes
as the shell does.
"""
import fnmatch
import json
import os
import re
import shlex
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone

HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))

# The Evidence table may live in the guide or in the sibling TASK_REVIEW file
# (T064). Imported off __file__, like post_tool_trace.py does for task_context.
#
# This gate must fail **closed**, and an unguarded import does NOT achieve that
# (Stage 4 finding). This hook signals a block by printing a `decision: block`
# JSON object on stdout and exiting 0; a bare ImportError exits 1 with *empty*
# stdout, which the harness reads as a non-blocking hook error and the merge
# proceeds — the precise direction AC7 exists to prevent. So the import is
# guarded and its failure is turned into an explicit block.
#
# `shell_data.strip_heredoc_bodies` (T095 defect C) and `strip_quoted_spans`
# (T099) are imported in the same guarded block for the same reason, though they
# fail in the opposite direction: losing them would make the gate classify
# heredoc bodies and quoted arguments as commands again (over-blocking, not
# under-blocking). Blocking on their absence keeps one rule here — an
# unavailable resolver is a block — rather than two.
sys.path.insert(0, os.path.join(HOOKS_DIR, "lib"))
try:
    from project_root import exit_outside_kit_project, project_root  # noqa: E402
    exit_outside_kit_project()  # T232: first, so a broken lib stays silent in a non-kit project
    from guide_sections import (  # noqa: E402
        GUIDE_PREFIX, REVIEW_PREFIX, _candidate_paths, is_pointer_only, normalize_task_id,
        read_guide_section, slice_section)
    from shell_data import (  # noqa: E402
        DATA_COMMAND_PATTERN, strip_heredoc_bodies, strip_quoted_spans)
    from board.config import load_config, task_id_pattern  # noqa: E402
    from board.moments import (  # noqa: E402
        board_mode, my_blocking_tasks, my_review_tasks, pull_cache)
    from verify_record import (  # noqa: E402
        AUTO_CHECKED_TAG, AUTO_ROW_TAG, MINIMAL_LOG_REL, ROW_COMMIT, ROW_SESSION, SHA_PATTERN,
        auto_row_confirmed, head_commit, minimal_verify_lines, read_record, record_confirms_pass,
        record_verify_lines, same_code)
    import auto_mode  # noqa: E402
    from auto_mode import record_block  # noqa: E402
    import session_work  # noqa: E402
    from task_context import join_line_continuations  # noqa: E402
except Exception as exc:  # pragma: no cover - exercised via subprocess test
    print(json.dumps({
        "decision": "block",
        "reason": (
            "[hook:pre_bash] Evidence resolver unavailable "
            f"({type(exc).__name__}: {exc}) — cannot confirm Stage 5 verify "
            "evidence for any task, so this push/merge is blocked. Restore "
            ".claude/hooks/lib/project_root.py, .claude/hooks/lib/guide_sections.py, "
            ".claude/hooks/lib/shell_data.py, .claude/hooks/lib/board/config.py, "
            ".claude/hooks/lib/board/moments.py, .claude/hooks/lib/verify_record.py and "
            ".claude/hooks/lib/session_work.py."
        ),
    }))
    sys.exit(0)

ROOT = project_root()
KANBAN = os.path.join(ROOT, "PROJECT_KANBAN.md")
TASKS_DIR = os.path.join(ROOT, "tasks")
TRACE_DIR = os.path.join(ROOT, "memory", "event-trace")

# T210: `git pull` fetches and merges, so it is a merge (D1), in every form (`--ff-only` and
# `--rebase` both move the branch). `git merge-base` is a read-only query and is the only
# `merge-*` subcommand exempted (D3): `merge-file` and `merge-tree` stay blocked.
#
# T211 (D1, D4): any run of git's global options may come between `git` and the verb. The ones
# that take an argument are `GIT_OPTIONS_WITH_ARG` (separate, attached `-Cdir`, or `--opt=value`);
# every other `-` word is skipped as a flag, known (`--no-pager`, `-P`, `--bare`,
# `--no-replace-objects`, `--literal-pathspecs`, `--exec-path[=<p>]`) or not (D4: fail closed).
# `_git_actions` resolves only `-C`, `-c`, `--no-pager` and `-P` of these and treats any other
# option as unresolved, so narrowing can never read a command classification did not. An argument
# may be quoted (`-C "dir with space"`). Each option consumes its argument with no alternative
# parse — the flag clause never starts with an arg-taking name — so matching stays linear.
# T296 (S1): every global option git reads a separate value for (git.c `handle_options`): `--attr-source`
# and `--super-prefix` too; `--exec-path[=<p>]` and `--list-cmds=<g>` take only an attached value.
GIT_OPTIONS_WITH_ARG = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
                        "--attr-source", "--super-prefix")
_GIT_ARG = r"""(?:"[^"\n]*"|'[^'\n]*'|[^\s;&|"'])+"""
_GIT_SHORT_WITH_ARG = "".join(o[1] for o in GIT_OPTIONS_WITH_ARG if not o.startswith("--"))
_GIT_LONG_WITH_ARG = "|".join(re.escape(o[2:]) for o in GIT_OPTIONS_WITH_ARG if o.startswith("--"))
GIT_GLOBAL_OPTION = (
    rf"(?:-[{_GIT_SHORT_WITH_ARG}]\s*{_GIT_ARG}"
    rf"|--(?:{_GIT_LONG_WITH_ARG})(?:=|\s+){_GIT_ARG}"
    rf"|-(?![{_GIT_SHORT_WITH_ARG}]|-(?:{_GIT_LONG_WITH_ARG})(?:[=\s]|$))[^\s;&|]*)"
)
GIT_VERB_PREFIX = rf"\bgit(?:\s+{GIT_GLOBAL_OPTION})*\s+"
BLOCKED_PATTERNS = [
    GIT_VERB_PREFIX + r"push\b",
    GIT_VERB_PREFIX + r"merge\b(?!-base\b)",
    GIT_VERB_PREFIX + r"rebase\b",
    GIT_VERB_PREFIX + r"pull\b",
]

# T211 (D3): `git -c alias.p=push p` defines and runs an alias in one command, so the verb never
# appears. `-c alias.` (or `--config-env alias.`) anywhere in a `git` command gates it as a merge:
# the whole board. Matched per command segment, and skipped only when that segment's command is
# one T099's `DATA_COMMAND_PATTERN` names (`echo git -c alias.p=push p` prints it) — the same
# keep-unless-known-data direction as `strip_quoted_spans`.
GIT_ALIAS_PATTERN = re.compile(
    r"\bgit\b.*?\s(?:-c\s*|--config-env(?:=|\s+))[\"']?(?i:alias)\.")


def defines_git_alias(scannable):
    """True when a command segment of `scannable` runs `git` with an inline alias (T211 D3)."""
    return any(GIT_ALIAS_PATTERN.search(segment) and not DATA_COMMAND_PATTERN.match(segment)
               for segment in COMMAND_SEPARATOR_PATTERN.split(scannable))

# --- Evidence matching: "invoked" vs "merely mentioned" (T044 defect C) ------
#
# This used to be a single `\b(pytest|npm test|jest|…|verify)\b` substring search
# over the trace record's `summary`. That made the gate satisfiable by a *claim*:
# a Supervisor inspection command such as `grep -c "pytest" …T043.jsonl`, or a
# `python3 -c "…re.compile(r'\b(pytest|jest|verify)\b')…"`, both qualified — and
# on T043 those were the only two qualifying records, so the gate would have
# passed a merge on which no test had ever run. A check that has never rejected
# anything is not a check.
#
# The rule now is structural: a runner token counts only where a shell would
# actually *execute* it — at the head of a command, after stripping leading
# environment assignments and benign wrappers. Two consequences follow:
#   * A token inside a quoted string is data (an `echo` argument, a `grep`
#     pattern, a regex literal), so quoted spans are removed before matching.
#   * Only a `Bash` record can invoke anything; a `Read` of a file named after a
#     test runner is not evidence.
#
# Residual limit, stated plainly: this still trusts that a recorded command
# *ran*. `is_error: false` supports that but does not prove it, and the trace
# records the command, not its exit status of the tests themselves. The goal is
# to close the gap between "a string looked like a test" and "a test command was
# invoked" — not certainty this design cannot deliver.
#
# Deliberately not a shell parser (Simplicity First). Boundary anchoring is
# enough to reject both real false-positive records while accepting every
# genuine invocation the project uses.
#
# Two known limits, both erring toward fail-closed:
#   * An invocation wrapped entirely in quotes (`bash -c "python3 -m pytest"`)
#     is treated as a mention and rejected. Run the runner directly, unwrapped.
#     (Pre-T095 this said "or export CLAUDE_ACTIVE_TASK and run it unwrapped",
#     which carried the same false premise as the block message below: T047
#     measured that a hook is a *sibling* process of the tool call and never
#     inherits a `Bash` call's subshell, so an in-session `export` reaches
#     nothing. Attribution is a separate concern from this rule anyway — see
#     ATTRIBUTION_REMEDY.)
#   * The gate proves a runner was *invoked*, not that a test suite *passed*
#     (`pytest --version` would qualify). `is_error: false` excludes a failing
#     run, which is the strongest signal the trace carries.

# Quoted spans are data, not commands. Replaced with a space, not deleted, so
# removal cannot glue two separate words into a spurious invocation.
QUOTED_SPAN_PATTERN = re.compile(r"\"[^\"]*\"|'[^']*'")

# Where a shell starts a new command.
COMMAND_SEPARATOR_PATTERN = re.compile(r"[;&|\n]+|\$\(|`")

# `CLAUDE_ACTIVE_TASK=T044 python3 -m pytest …` — the assignment is not the command.
ENV_ASSIGNMENT_PREFIX = re.compile(r"^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+")

# Wrappers that pass through to the real command. T210 (D2): `timeout [options] <duration>`,
# where `-k`/`-s` take a separate argument (`timeout -k 5 60s pytest`). The duration is
# required, so `timeout pytest` stays a mention.
BENIGN_COMMAND_PREFIX = re.compile(
    r"^(?:(?:sudo|env|time|nohup|npx|uv\s+run|poetry\s+run|pipenv\s+run|"
    r"pnpm\s+exec|yarn\s+exec|"
    r"timeout(?:\s+(?:-[ks]\s+\S+|-[-\w=]+))*\s+\d+(?:\.\d+)?[smhd]?)\s+)+",
    re.IGNORECASE,
)

# A subshell's opening paren: `(timeout 300 python3 -m pytest)` runs the runner (T210 AC 3).
# One paren only — `((` opens an arithmetic expression, not a command.
SUBSHELL_OPEN = re.compile(r"^\((?!\()\s*")

# Harmless interpreter flags that may sit between `python3` and `-m` (T291): `-B -u -O -s -E -I`,
# alone or in a run (`-uB`). A fixed list, case exact (`(?-i:…)`: the pattern below is
# IGNORECASE, which would also admit `-b -S -i`). Any other flag (`-X dev`, `-W error`, `-c`)
# is not in it, so that command is not counted: fail closed.
INTERPRETER_FLAGS = r"(?:\s+(?-i:-[BuOsEI]+))*"

# Anchored at the head of a command — `match`, never `search`.
TEST_INVOCATION_PATTERN = re.compile(
    r"^(?:"
    r"(?:python3?|py)" + INTERPRETER_FLAGS + r"\s+-m\s+(?:pytest|unittest)\b"
    r"|pytest\b"
    r"|jest\b"
    r"|tox\b"
    r"|(?:npm|yarn|pnpm)\s+(?:run\s+)?test\b"
    r"|go\s+test\b"
    r"|cargo\s+test\b"
    r"|(?:bash|sh|zsh)\s+\S*(?:test|verify|smoke)\S*"
    r"|\.{0,2}/\S*(?:test|verify|smoke)\S*"
    r")",
    re.IGNORECASE,
)


def strip_command_prefixes(candidate):
    """Peel a subshell paren, leading env assignments and benign wrappers until nothing changes."""
    while True:
        shorter = BENIGN_COMMAND_PREFIX.sub("", ENV_ASSIGNMENT_PREFIX.sub(
            "", SUBSHELL_OPEN.sub("", candidate)))
        if shorter == candidate:
            return candidate
        candidate = shorter


# A trace record's `summary` is the JSON-serialized `tool_input`, truncated by
# post_tool_trace.py to 300 chars — so the command arrives JSON-escaped, and
# often as invalid JSON. Both layers must be peeled before shell quoting means
# anything: `{"command": "echo \"pytest\""}` is a quoted mention, not a run.
COMMAND_FIELD_PATTERN = re.compile(r'"command"\s*:\s*"')
JSON_ESCAPE_PATTERN = re.compile(r"\\(.)")
JSON_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f"}

# The command value's body, stopping at its first *unescaped* closing quote.
# Without this bound the fallback swallowed every sibling field, and a
# `description` is agent-authored prose — a separator inside it ("...records;
# pytest was run") would promote the next word to a command head, reinstating
# defect C through a side door.
COMMAND_VALUE_BODY_PATTERN = re.compile(r'(?:[^"\\]|\\.)*')


def extract_command(summary):
    """Recover the Bash command from a trace record's `summary`, or None."""
    if not isinstance(summary, str):
        return None
    try:
        payload = json.loads(summary)
    except Exception:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("command"), str):
        return payload["command"]
    match = COMMAND_FIELD_PATTERN.search(summary)
    if not match:
        return None
    # Truncated record: take only the command value's own body, then unescape it
    # in one left-to-right pass, so a literal `\\` can never be re-read as the
    # start of another escape.
    fragment = COMMAND_VALUE_BODY_PATTERN.match(summary, match.end()).group(0)
    return JSON_ESCAPE_PATTERN.sub(
        lambda m: JSON_ESCAPES.get(m.group(1), m.group(1)), fragment
    )


# T296 (P3-1): the shell's reading of data in a command, left to right. A quoted span is data (a
# double-quoted one may hold an escaped quote), a backslash + newline continues the line and joins its
# two sides, and any other backslash makes the next character an ordinary one that cannot separate
# commands. Used by `invokes_test_runner` only; `QUOTED_SPAN_PATTERN` keeps its other users.
SHELL_DATA_PATTERN = re.compile(r"\"(?:[^\"\\]|\\.)*\"|'[^']*'|\\\n|\\.", re.S)


def _shell_data_removed(match):
    text = match.group(0)
    if text == "\\\n":
        return ""
    return " " if text[0] in "\"'" else "x"


def invokes_test_runner(command):
    """True only if `command` contains a test-runner invocation at a command
    boundary — not merely a mention of one inside a quoted string or argument."""
    if not isinstance(command, str):
        return False
    unquoted = SHELL_DATA_PATTERN.sub(_shell_data_removed, command)
    for part in COMMAND_SEPARATOR_PATTERN.split(unquoted):
        if TEST_INVOCATION_PATTERN.match(strip_command_prefixes(part.strip())):
            return True
    return False


def trace_shows_verification(task_id):
    """Check memory/event-trace/<task>.jsonl for a real, non-error `Bash` call
    that *invoked* a test runner — not text in the task guide claiming it
    passed, and not a command that merely mentions a runner's name.
    Missing/empty/malformed trace = not verified (fail closed)."""
    trace_path = os.path.join(TRACE_DIR, f"{task_id}.jsonl")
    if not os.path.exists(trace_path):
        return False
    try:
        with open(trace_path) as f:
            for line in f:
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                if not isinstance(record, dict):
                    continue
                if record.get("is_error"):
                    continue
                if record.get("tool_name") != "Bash":
                    continue
                if invokes_test_runner(extract_command(record.get("summary"))):
                    return True
    except Exception:
        return False
    return False

# The T026 two-bug fix, byte-for-byte: the Check cell must be the literal word
# `verify` immediately before its `|`, AND the word "pass" must appear in the
# *Notes* column, not only the Result column. T064 changed **where** this text
# is read from; it must never change **what** is matched.
# Same three-part shape as before T068 (Check cell literally `verify`, Result
# and Notes are the two pipe-delimited cells that follow, "pass" required in
# the third/Notes cell — the T026 property) but Result/Notes are now captured
# separately so an *unchecked* box can be told apart from a filled one.
VERIFY_ROW_PATTERN = re.compile(
    r"verify\s*\|(?P<result>[^|\n]*)\|(?P<notes>[^|\n]*pass[^|\n]*)",
    re.IGNORECASE,
)

# The template's own placeholder guidance text writes "pass" as one of the
# unchecked options: `☐ pass / ☐ fail / ☐ N/A`. That is guidance, not a filled
# answer, so a literal unchecked "☐ pass" in the Result cell disqualifies the
# row — but only that exact combination. A legitimately filled
# `☑ pass / ☐ N/A` row (the shape occurs in tasks/TASK_GUIDE_T063.md) must NOT
# trip this: the guard checks for ☐ directly attached to "pass", not for ☐
# appearing anywhere in the cell.
UNCHECKED_PASS_PATTERN = re.compile(r"☐\s*pass\b", re.IGNORECASE)


# --- Where the Evidence table can live (T095 defect A) ----------------------
#
# `TASKS_DIR` is always the **main checkout's** `tasks/`: `ROOT` derives from
# this file's own location and `settings.json` invokes every hook as
# `python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/...`. But since T064 the Evidence
# table lives in `tasks/TASK_REVIEW_Txxx.md`, which the agent creates **in its
# worktree, on its task branch** — Stage 3 is worktree-isolated by mandate
# (`AGENTS.md`), so until the branch merges that file does not exist in the main
# checkout at all. Every worktree-isolated task therefore read as
# `(no evidence row)`; three consecutive sessions paid for it by hand-landing the
# review file on the integration branch before merging.
#
# The worktree list is an *additional place to look*, never a reason to skip the
# check. So every failure of the enumeration — git absent, non-zero exit, a
# timeout, unparsable output — degrades to "main checkout only", which is exactly
# the pre-T095 behaviour and still fails closed. It can never degrade to "allow".
#
# Resolving the file from the *branch* via `git show` was considered and rejected
# at grill: this gate runs BEFORE a push, when the commit may not exist in the
# main checkout's object store at all.
GIT_WORKTREE_TIMEOUT_S = 5


def worktree_tasks_dirs():
    """Each live worktree's `tasks/` directory, main checkout excluded.

    Never raises and never blocks for long: returns `[]` on any failure, and the
    caller still has the main checkout to search.
    """
    try:
        completed = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=GIT_WORKTREE_TIMEOUT_S,
        )
        if completed.returncode != 0:
            return []
        dirs = []
        for line in completed.stdout.splitlines():
            if not line.startswith("worktree "):
                continue
            path = line[len("worktree "):].strip()
            if not path or os.path.abspath(path) == os.path.abspath(ROOT):
                continue
            dirs.append(os.path.join(path, "tasks"))
        return dirs
    except Exception:
        return []


def evidence_search_dirs(tasks_dir=None):
    """The ordered directories to resolve a task's Evidence section across.

    `tasks_dir` keeps its existing single-directory shape — every current caller
    and test passes one path, or None for "the live repo". It additionally
    accepts a sequence of paths, which is how a test injects a constructed
    directory list instead of shelling out to git.

    **Main checkout first**, always: the common post-merge case then resolves on
    the first candidate, unchanged in behaviour and cost, and a worktree copy can
    never shadow evidence already integrated.
    """
    if tasks_dir is None:
        return [TASKS_DIR] + worktree_tasks_dirs()
    if isinstance(tasks_dir, str):
        return [tasks_dir]
    try:
        return [d for d in tasks_dir if isinstance(d, str) and d]
    except TypeError:
        return [TASKS_DIR]


def has_filled_verify_row(task_id, tasks_dir=None):
    """True only when the task's Evidence table — wherever it resolves: the main
    checkout first, then each live worktree, and within each of those the guide
    first then `TASK_REVIEW_Txxx.md` — carries a filled `verify` row. The first
    filled row found wins.

    **Fails closed.** A missing guide, a missing review file, an unreadable
    one, an absent Evidence section, an unfilled row, or a row still carrying
    the template's unchecked `☐ pass` placeholder all return False — in every
    searched directory, and when there are no directories to search. This is
    the one place in T064 where a wrong answer is silent and repo-wide: if
    "review file missing" ever became anything other than "no evidence", the
    merge gate would stop gating on every task at once.

    T188 D5 adds one more place to look, and only after every Evidence table has
    said no: a **minimal-track** task has no guide and no review file, so its
    result is a `verify:` line in its Decision record (`tasks/MINIMAL_LOG.md`).
    An `auto-run by hook` line is read under exactly T182's rule — its run
    record exists for this task and the checkout's head commit and says pass.
    T250 G1 adds one hand-written shape, and only with proof the hook cannot
    fake: `/verify by the user, session <sid>, commit <sha>` counts when the
    transcript of session `<sid>` (in this session's transcripts folder) holds a
    human `/verify <ID>` entry dated after `<sha>` was committed and before the
    line was, and `<sha>` is the same code as the head (`user_line_confirmed`).
    Any other hand-typed line still counts for nothing. Every `verify:` line of
    the record is read, so the user's line may follow a blocked hook line.
    """
    for directory in evidence_search_dirs(tasks_dir):
        checkout = os.path.dirname(os.path.abspath(directory))
        if verify_row_passes(
                read_guide_section(task_id, "Evidence", directory),
                lambda notes, rel: auto_row_confirmed(ROOT, checkout, task_id, notes, rel)):
            return True
    for directory in evidence_search_dirs(tasks_dir):
        checkout = os.path.dirname(os.path.abspath(directory))
        lines = minimal_verify_lines(task_id, directory)
        if any(minimal_line_passes(
                line,
                lambda notes, rel: auto_row_confirmed(ROOT, checkout, task_id, notes, rel),
                lambda notes: user_line_confirmed(checkout, task_id, notes,
                                                  head_commit(checkout)))
               for line in lines):
            return True
    return False


def verify_row_passes(section, confirm, hook_only=False):
    """True when an Evidence `section` holds a filled `verify` pass row. `confirm(notes, None)`
    decides an `auto-run by hook` row (T182 D5): against which commit is the caller's choice.
    `hook_only` (T284) counts only such a row: a hand-typed pass row is skipped."""
    if not section:
        return False
    for match in VERIFY_ROW_PATTERN.finditer(section):
        if UNCHECKED_PASS_PATTERN.search(match.group("result")):
            continue
        notes = match.group("notes").lower()
        # T182: the Supervisor's own real-run check (T180) is never `/verify`, and an
        # `auto-run by hook` row counts only with its run record (D5) for this task and the
        # head commit of the checkout (or branch) this row was read from.
        if AUTO_CHECKED_TAG in notes:
            continue
        if hook_only and AUTO_ROW_TAG not in notes:
            continue
        if AUTO_ROW_TAG in notes and not confirm(match.group("notes"), None):
            continue
        return True
    return False


def minimal_line_passes(line, confirm, confirm_user=None):
    """True when a minimal-track `verify:` line `(result, notes)` is a confirmed hook pass (T188
    D5), or a user `/verify` line `confirm_user(notes)` proves (T250 G1). Any other hand-typed
    line counts for nothing."""
    if not line:
        return False
    result, notes = line
    if "☑" not in result or "pass" not in result.lower():
        return False
    low = notes.lower()
    if AUTO_CHECKED_TAG in low:
        return False
    if AUTO_ROW_TAG in low:
        return confirm(notes, MINIMAL_LOG_REL)
    if confirm_user is not None and USER_LINE.match(notes.strip()):
        return confirm_user(notes)
    return False


# --- The user's `/verify` line (T250 G1) --------------------------------------
#
# A blocked auto verify run falls back to the user's own `/verify <ID>` (tracks.md). For a
# minimal-track task the fallback's result is one hand-written line under `Checked:`:
#
#     - verify: ☑ pass — /verify by the user, session <session id>, commit <40-hex sha>
#
# The line's text is never the proof. It counts only when (all of): the session's transcript —
# `<sid>.jsonl` in the folder of this hook event's own `transcript_path` — holds a human
# `/verify <ID>` entry (`session_work.verify_typed`); that entry is dated after `<sha>` was
# committed and before the line itself was (when it is committed; a line only in the working tree
# has no upper date); and `<sha>` is the same code as the head (`same_code`, the record excepted).
# No transcript folder, a missing or unreadable file, a short hash, an unknown commit: not a pass.
USER_LINE = re.compile(r"/verify by the user, session ([A-Za-z0-9-]{1,128}), commit ([0-9a-f]{40})$")
TRANSCRIPTS_DIR = None  # set by main() from the event's transcript_path


def _commit_time(directory, *args):
    """The committer time of the last line `git log`/`git show` prints, as an aware datetime, or
    None (no output, a failure)."""
    done = _git(directory, *args)
    if done is None or done.returncode != 0 or not done.stdout.strip():
        return None
    return datetime.fromtimestamp(int(done.stdout.split()[-1]), timezone.utc)


def user_line_confirmed(checkout, task_id, notes, head, ref=None):
    """True when the user `/verify` line `notes` is proven (see above). `ref` is the branch tip
    the line was read from (a committed read: the line must be in its history), or None for a
    working-tree read. Never raises; any doubt is False."""
    try:
        match = USER_LINE.match((notes or "").strip())
        if not match or not TRANSCRIPTS_DIR or not head:
            return False
        sid, sha = match.groups()
        after = _commit_time(checkout, "show", "-s", "--format=%ct", f"{sha}^{{commit}}")
        if after is None:
            return False
        before = _commit_time(checkout, "log", "--format=%ct", "-S", notes.strip(),
                              ref or head, "--", MINIMAL_LOG_REL)
        if before is None and ref is not None:
            return False
        transcript = os.path.join(TRANSCRIPTS_DIR, f"{sid}.jsonl")
        if not session_work.verify_typed(transcript, task_id, after, before):
            return False
        return same_code(checkout, task_id, sha, head, MINIMAL_LOG_REL)
    except Exception:
        return False


# --- The verify row must be committed on the branch (T210 D4) -----------------
#
# The working-tree read above let T207 and T208 merge with a pass their merged commit did not
# contain: the auto verify run writes its row into the worktree AFTER the branch's last commit.
# So for a merge, or a narrowed push, of one task's branch, that task's row is read from the
# branch tip with `git show <tip>:tasks/...` — guide first, review second, then the minimal-track
# Decision record, the same order as `has_filled_verify_row`. An `auto-run by hook` row is
# confirmed against the tip, not the checkout's HEAD: a merge runs on `main`.
#
# The T095 note above rejected `git show` because a pushed commit may not be in the main
# checkout's object store. This reads in the directory the command runs in, where the merged or
# pushed ref must resolve for the command itself to work.
#
# Never weaker than before: when the tip cannot be resolved, the caller falls back to
# `has_filled_verify_row` (the working trees), exactly the pre-T210 rule.
UNCOMMITTED_ROW_MESSAGE = "verify row for {tid} is not committed on {branch} — commit it, then merge"


def _auto_row_confirmed_at(directory, task_id, notes, tip, report_rel=None):
    """`verify_record.auto_row_confirmed`, with the branch `tip` in place of the checkout HEAD."""
    commit, session = ROW_COMMIT.search(notes or ""), ROW_SESSION.search(notes or "")
    if not commit or not session:
        return False
    sha = commit.group(1)
    record = read_record(ROOT, task_id, sha)
    if not record or (record.get("task"), record.get("commit"), record.get("session")) != (
            task_id, sha, session.group(1)) or not record_confirms_pass(directory, record):
        return False  # T289: a `skip-pass` record counts only when git, read here, still backs it
    return same_code(directory, task_id, sha, tip, report_rel)


def committed_verify_row(task_id, branch, directory, hook_only=False):
    """True/False: whether `branch`'s tip, read in `directory`, commits a filled `verify` row (or a
    confirmed minimal-track `verify:` line) for `task_id`. None when the tip cannot be resolved —
    the caller then keeps the pre-T210 working-tree read. `hook_only` (T284) accepts only the
    hook's own `auto-run by hook` result, confirmed by its run record. Never raises."""
    try:
        done = _git(directory, "rev-parse", "--verify", "--quiet", f"{branch}^{{commit}}")
        tip = done.stdout.strip() if done is not None and done.returncode == 0 else ""
        normalized = normalize_task_id(task_id, ROOT)
        if not SHA_PATTERN.match(tip) or not normalized:
            return None

        def show(rel):
            shown = _git(directory, "show", f"{tip}:{rel}")
            return shown.stdout if shown is not None and shown.returncode == 0 else None

        def confirm(notes, rel):
            return _auto_row_confirmed_at(directory, task_id, notes, tip, rel)

        sections = (slice_section(show(rel), "Evidence")
                    for prefix in (GUIDE_PREFIX, REVIEW_PREFIX)
                    for rel in _candidate_paths("tasks", prefix, normalized))
        if verify_row_passes(next((s for s in sections if s is not None
                                   and not is_pointer_only(s)), None), confirm, hook_only):
            return True
        block = record_block(show(MINIMAL_LOG_REL) or "", task_id, skip_comments=True)
        user = None if hook_only else (
            lambda notes: user_line_confirmed(directory, task_id, notes, tip, ref=tip))
        return any(minimal_line_passes(line, confirm, user)
                   for line in (record_verify_lines(block[2]) if block else []))
    except Exception:
        return False


# --- The companion score row and the three UI design rows (T190) ------------
#
# Four Evidence rows become binding here, named by their Check cell:
# `Companion score (easy-verifier)`, `UI: Visual regression`,
# `UI: Design-system compliance` and `UI: Responsiveness`. Only the **Result**
# cell decides, and only one spelling decides it: a checked `☑ fail`.
#
# **This check is deliberately fail-OPEN, and that inverts the rule every other
# check in this file follows. It is intentional — do not "fix" it.** Above,
# every absence resolves to *block*: a missing guide, an unreadable review file,
# an unparsable trace all mean "not verified". Here every absence resolves to
# *allow*: no row, a blank row, the unchecked template placeholder, `☑ N/A`, a
# malformed table, an unreadable file — none of them block.
#
# The reason is user decision D6 (2026-10-28): *"if you use verifier mcp, and ui
# to check, the code must pass them. if not, just work on the normal flow, that
# all"*. The companion tools (easy-verifier, easy-ui) are optional, so a machine
# with neither — no Docker, no Python package, no MCP server — must behave
# exactly as it did before this feature existed (FR-006, FR-014;
# `.claude/hooks/tests/data/t190_pre_change_gate_output.txt` is that assertion's
# oracle). Reading these rows fail-closed would require a score row on every
# task, which is how an optional tool becomes a mandatory one.
# The binding half is FR-015: a tool that *did* run is binding, and the only
# thing that tells this hook it ran is an explicit `☑ fail`.
#
# Structural, never a substring search — the T044 comment at the top of this
# file records what a `\bfail\b` scan over the row would cost: Notes prose such
# as "no failures observed" or "the M2 mutation must fail" would refuse a push.
# The Check cell is matched inside a pipe-delimited row and the verdict is read
# from the Result cell alone.
#
# Not generalised to the other Evidence rows (`Negative cases hold`, `Full smoke
# suite still green`). Deliberate cut: binding rows this feature was not asked
# to touch would block a push on a pre-existing `☑ fail` the moment it ships.
COMPANION_ROW_NAMES = (
    "Companion score",
    "UI: Visual regression",
    "UI: Design-system compliance",
    "UI: Responsiveness",
)


def _companion_row_pattern(name):
    """A pipe-delimited Evidence row whose Check cell contains `name`, with its
    Result and Notes cells captured separately. Line-anchored, and no cell can
    span a `|` or a newline — the same shape as `VERIFY_ROW_PATTERN`."""
    return re.compile(
        r"^[ \t]*\|[^|\n]*" + re.escape(name) + r"[^|\n]*\|"
        r"(?P<result>[^|\n]*)\|(?P<notes>[^|\n]*)",
        re.IGNORECASE | re.MULTILINE,
    )


COMPANION_ROW_PATTERNS = tuple(
    (name, _companion_row_pattern(name)) for name in COMPANION_ROW_NAMES)

# The checked box, attached to its verdict. `UNCHECKED_PASS_PATTERN` above is
# the same idea in the other direction: `☐ fail` is the template's guidance text,
# not an answer, so it must never match. Optional `**` because a reviewer may
# bold the verdict.
#
# `(?:ed)?` is deliberate and the two patterns must stay symmetric. `fail\b`
# alone did not match `☑ failed` — `\b` cannot sit between `l` and `e` — so a
# reviewer who wrote the `-ed` form of the one word that makes this gate fire
# got a **silent allow** (Stage 4 P2). The template prescribes `fail`, but on the
# blocking side the safe direction is to catch more, not less. Widening only the
# fail side would trade that gap for another: `☑ passed` would stop being read
# as a pass, so `companion_report_advisories` would skip the FR-005 report check
# on it. Bounded there on purpose: `failing`, `failure` and every prose variant
# belong in the Notes cell, and `\b` after the optional `ed` is what keeps them
# out.
CHECKED_FAIL_PATTERN = re.compile(r"☑\s*\**\s*fail(?:ed)?\b", re.IGNORECASE)
CHECKED_PASS_PATTERN = re.compile(r"☑\s*\**\s*pass(?:ed)?\b", re.IGNORECASE)

# The verifier report a `pass` row cites, read after a literal `report:` label.
#
# **The label is load-bearing; do not drop it back to "the first path in the
# cell".** That is what this did until the Stage 4 P1 on T190, and it failed in
# both directions at once:
#   * False advisory on the common case. The Notes cell must also carry the ref
#     (FR-001, and T191's AC 11), and a ref is naturally written in backticks —
#     `plan/t190-t194-companion-scoring...HEAD`. That has a `/` in it, so the ref
#     was read as the report path, which does not exist, and an honest row warned.
#   * Silent inertness, which is the one that matters. A row citing **no report
#     at all** was excused by any unrelated backticked path that happened to sit
#     in the cell: `skills/score/SKILL.md` exists on disk, `os.path.isfile` said
#     true, and the advisory never fired. FR-005 is the whole "measured, not
#     claimed" protection for this row, so that made it inert while still
#     looking like a check — the same shape of defect as T044's substring scan.
#
# So: the path is the first backticked-or-bare path token **after** `report:`.
# No label means no citation, which the caller reports as "cites no verifier
# report path". Deterministic, unsatisfiable by an unrelated path elsewhere in
# the cell, and it survives the cell gaining more fields later.
REPORT_LABEL_PATTERN = re.compile(r"report\s*:", re.IGNORECASE)

# A backticked span first, so a path containing a space resolves whole; else a
# bare whitespace-delimited token. A candidate without a `/` is not a path — the
# same cell also carries `overall`, `change_risk`, the scope and the ref.
REPORT_PATH_PATTERN = re.compile(r"`([^`\n]+)`|([^\s|`]+)")


def cited_report_path(notes, checkout_root=None):
    """The verifier report path a Notes cell cites after its `report:` label,
    resolved, or None when the cell carries no label or no path after it.

    `~` is expanded (`EASY_VERIFIER_REPORTS_DIR` writes to
    `$HOME/.easy-verifier-reports/<repo>/`) and a relative path resolves against
    the checkout the row was read from. Never raises.
    """
    if not isinstance(notes, str):
        return None
    label = REPORT_LABEL_PATTERN.search(notes)
    if not label:
        return None
    for match in REPORT_PATH_PATTERN.finditer(notes, label.end()):
        candidate = (match.group(1) or match.group(2) or "").strip()
        if "/" not in candidate or "\x00" in candidate:
            continue
        try:
            path = os.path.expanduser(candidate)
            if not os.path.isabs(path):
                path = os.path.join(checkout_root or ROOT, path)
        except Exception:
            return None
        return path
    return None


def companion_rows(task_id, tasks_dir=None):
    """Every bound Evidence row present for `task_id`:
    `({row name: (result cell, notes cell)}, checkout root)`.

    Resolved exactly like `has_filled_verify_row`: main checkout first, then each
    live worktree, and within each the guide first then `TASK_REVIEW_Txxx.md`.
    The first directory carrying any bound row wins, and its checkout root is
    returned so a relative report path resolves against the right tree.

    Never raises. Every failure — a missing file, an unreadable one, an absent
    Evidence section, a malformed table — resolves to `({}, None)`, which means
    "no companion row" and therefore allows.
    """
    try:
        for directory in evidence_search_dirs(tasks_dir):
            section = read_guide_section(task_id, "Evidence", directory)
            if not section:
                continue
            rows = {}
            for name, pattern in COMPANION_ROW_PATTERNS:
                match = pattern.search(section)
                if match:
                    rows[name] = (match.group("result"), match.group("notes"))
            if rows:
                return rows, os.path.dirname(os.path.abspath(directory))
    except Exception:
        pass
    return {}, None


def failed_companion_rows(task_id, tasks_dir=None):
    """The bound rows whose Result cell carries a checked `☑ fail`, in table
    order — `[]` when there are none.

    Named for what it returns: the row names, not a verdict, because the block
    message must name the row it refuses on (AC 2), and
    `docs/claude-md/code-naming-conventions.md` reserves the `has_` prefix for
    booleans. An empty list is falsey, so the caller still reads as a predicate,
    and `[]` is the answer for every absence: see the inversion comment above.
    """
    rows, _ = companion_rows(task_id, tasks_dir)
    return [name for name in COMPANION_ROW_NAMES
            if name in rows and CHECKED_FAIL_PATTERN.search(rows[name][0])]


def companion_report_advisories(task_id, tasks_dir=None):
    """One line per `☑ pass` **Companion score** row whose cited verifier report
    is not a file on disk (FR-005: a `pass` is trusted only against the report
    it cites, the same rule the `verify` row follows against the event trace).

    Advisory only, never a block — an unresolvable citation costs a warning on
    stderr, so this cannot refuse a push on a path the hook merely failed to
    parse. The three UI rows are not checked: easy-ui is one named method among
    screenshot diff, LLM vision and Storybook snapshot (FR-011), and the other
    three cite no report file.
    """
    rows, checkout_root = companion_rows(task_id, tasks_dir)
    result, notes = rows.get("Companion score", (None, None))
    if result is None or not CHECKED_PASS_PATTERN.search(result):
        return []
    if CHECKED_FAIL_PATTERN.search(result):
        return []  # already blocking; one message about this row is enough
    path = cited_report_path(notes, checkout_root)
    if path is None:
        return [f"{task_id} Companion score row reads pass but its Notes cite no "
                f"verifier report path — that row is unscored, not a pass (FR-005)."]
    try:
        is_file = os.path.isfile(path)
    except Exception:
        is_file = False
    if not is_file:
        return [f"{task_id} Companion score row reads pass but the verifier report "
                f"it cites is not a file on disk: {path} — that row is unscored, "
                f"not a pass (FR-005)."]
    return []


# --- Which task a `git push` touches (T197) ---------------------------------
#
# Until T197 `main()` checked the whole board on every trigger, so one task parked
# in Ready for Review by another live session refused every other session's push.
# Now a `git push` of one task's branch is judged by that task alone (D3), and
# `pushed_task_ids` is the only thing that decides "one task's branch".
#
# **This loosens a fail-closed gate, so the resolver is built the other way
# round: it says which task only when it can prove it, and returns None on every
# doubt.** None leaves `main()` exactly as it was — the whole board (D2). It
# reads the branch from the command, never from the board (D1):
#   * the source ref the command names (`src:dst` → `src`), or for `HEAD` or no
#     refspec, the current branch of the directory the push runs in — the event's
#     `cwd`, moved by a leading `cd <dir> &&` or `git -C <dir>`;
#   * that name must hold exactly one whole task ID (`feat/t9000-x` is T9000, never
#     T900; `plan/t190-t194` is two IDs, so None), and `main()` then also requires
#     that task to be one it checks: a row in In Progress or Ready for Review that the
#     online filters kept. Any other task keeps the whole board.
# Everything else is None, by allowlist, never by denylist: an unknown option
# (`--all`, `--mirror`, `--tags`, `-o`), a remote that is not a plain name (bash
# expands `{origin,--all}` to `origin --all`), a tag, a deletion, a destination that
# is not the same task (`HEAD:main`, `release/*`), `git merge`/`rebase` anywhere in
# the command (D4), any segment that is not `cd`, a read-only `git` subcommand with
# only its allowlisted options, or a pipe reader of the push's output, a `&` anywhere
# (a backgrounded `cd` does not move the push), `$`/backticks/subshells/unknown
# redirections, a `{` or `}` anywhere (brace expansion can turn a word into an
# option), a glob in a path argument, a `cd` whose effect is not certain (`||`, `;`,
# a pipe, `~`), a detached HEAD, a git that fails or takes over 5 s, and push config
# that can move the destination (`remote.*.push`, `remote.*.mirror`, a
# `push.default` other than simple/current).
#
# Tokenized with stdlib `shlex` — a tokenizer, not a shell parser — with
# **comments switched off**: shlex reads `#` mid-word as a comment and would drop
# a following line, so `... feat/t900-x #x` + newline + a push of main would read
# as one scoped push. Seeing more text than bash runs can only make this global.
#
# Stated trust boundaries, both residual:
#   * The scoping trusts the branch name. T901's work pushed on `feat/t900-x` is
#     checked against T900 when T900 is itself in In Progress or Ready for Review,
#     so it needs T900's evidence and no longer T901's. When T900 is in neither, the
#     push checks the whole board, T901 included.
#   * `git commit` can run the repo's own hooks, which run code no name check sees
#     (they could switch the branch before the push reads `HEAD`).
PUSH_SEPARATORS = frozenset({";", "&&", "||", "|"})  # `&` is not here: it is a None
SHELL_PUNCTUATION = frozenset("();<>|&")
EXPANSION_CHARS = frozenset("{}$`")  # brace, parameter and command expansion
GLOB_CHARS = frozenset("*?[")
REMOTE_NAME_PATTERN = re.compile(r"[A-Za-z0-9._-]+")

# The two redirections agents append to a push. Removed before tokenizing; any
# other `<`/`>` survives as a token and makes the command unresolved.
OUTPUT_REDIRECT_PATTERN = re.compile(r"(?<!\S)(?:[12]?>&[12]|(?:[12]|&)?>>?\s*/dev/null)(?!\S)")

SAFE_REF_PATTERN = re.compile(r"[A-Za-z0-9._/-]+")
SAFE_PATH_PATTERN = re.compile(r"[A-Za-z0-9._/+-]+")  # no `~`, `$` or glob: no expansion
GLOBAL_REF_ROOTS = frozenset({"release", "integration"})

# Subcommands that cannot change which branch is checked out or merge anything, each
# with the only options it may carry. Never add `merge` or `rebase`: their absence is
# how D4 keeps a merge on the whole board. `fetch` is out: `--upload-pack` runs a
# command. Any other `-` token is None, so `--output=<path>` cannot rewrite `.git/HEAD`.
SAFE_GIT_OPTIONS = {
    "add": frozenset({"-A", "-a", "--all", "-u"}),
    "commit": frozenset({"-m", "-a", "-am", "--amend", "--no-edit", "-q", "-s", "--signoff",
                         "--no-verify"}),
    "status": frozenset({"-s", "--short", "-b", "--branch", "--porcelain"}),
    "log": frozenset({"--oneline", "-n", "--stat", "--graph"}),
    "diff": frozenset({"--stat", "--name-only", "--name-status", "--cached", "--staged",
                       "--shortstat"}),
    "show": frozenset({"--stat", "--name-only", "--oneline", "-s"}),
}
SAFE_GIT_SUBCOMMANDS = frozenset(SAFE_GIT_OPTIONS)
MESSAGE_OPTIONS = frozenset({"-m", "-am"})  # `git commit`: the next token is the message
LOG_COUNT_PATTERN = re.compile(r"-\d+")
PIPE_READERS = frozenset({"tail", "head", "cat", "grep", "wc"})
SCOPED_PUSH_FLAGS = frozenset({
    "-u", "--set-upstream", "-f", "--force", "--force-with-lease", "--force-if-includes",
    "-n", "--dry-run", "-v", "--verbose", "-q", "--quiet", "--no-verify", "--progress",
})
SAFE_PUSH_DEFAULTS = frozenset({"simple", "current"})
PUSH_CONFIG_KEYS = r"^(push\.default|remote\..*\.(push|mirror))$"


def _git(directory, *args):
    """`git -C <directory> <args>` with the 5-second timeout, or None on any failure."""
    try:
        return subprocess.run(["git", "-C", directory, *args], capture_output=True,
                              text=True, timeout=GIT_WORKTREE_TIMEOUT_S)
    except Exception:
        return None


def _current_branch(directory):
    """The branch checked out in `directory`; None when detached, not a repo, or git failed."""
    done = _git(directory, "rev-parse", "--abbrev-ref", "HEAD")
    if done is None or done.returncode != 0:
        return None
    name = done.stdout.strip()
    return name if name and name != "HEAD" else None


def _push_config_is_plain(directory, keys=PUSH_CONFIG_KEYS):
    """True only when no config in `directory` can send a push somewhere its refspec
    does not say: no `remote.*.push`, no `remote.*.mirror`, `push.default` simple/current.
    T284 passes `ADMIN_PUSH_CONFIG_KEYS`, which also refuses URL rewrites and hook/pack config."""
    done = _git(directory, "config", "--get-regexp", keys)
    if done is None:
        return False
    if done.returncode == 1 and not done.stdout.strip():
        return True  # none of the keys is set
    if done.returncode != 0:
        return False
    for line in done.stdout.splitlines():
        key, _, value = line.partition(" ")
        if key.lower() != "push.default" or value.strip().lower() not in SAFE_PUSH_DEFAULTS:
            return False
    return True


def _ref_task_id(name, id_regex):
    """The one task ID a branch name holds, upper-cased, or None."""
    if name.startswith("refs/heads/"):
        name = name[len("refs/heads/"):]
    if (not SAFE_REF_PATTERN.fullmatch(name) or name.startswith("refs/")
            or name.split("/")[0].lower() in GLOBAL_REF_ROOTS):
        return None
    ids = {match.group(0).upper() for match in id_regex.finditer(name)}
    return ids.pop() if len(ids) == 1 else None


def _push_task_id(args, directory, id_regex, sources=None):
    """The one task a single `git push <args>` run in `directory` pushes, or None.
    `sources`, when a list, collects `(directory, source branch)` per refspec (T210 D4)."""
    if directory is None:
        return None
    positionals = []
    for arg in args:
        if arg.startswith("-"):
            if arg in SCOPED_PUSH_FLAGS or arg.startswith("--force-with-lease="):
                continue
            return None
        positionals.append(arg)
    if positionals and not REMOTE_NAME_PATTERN.fullmatch(positionals[0]):
        return None  # a URL, a path, or a word bash expands (`{origin,--all}`)
    branch = _current_branch(directory)
    if branch is None or not _push_config_is_plain(directory):
        return None
    ids = set()
    for spec in positionals[1:] or ["HEAD"]:  # positionals[0] is the remote
        src, colon, dst = (spec[1:] if spec.startswith("+") else spec).partition(":")
        # Only the source may be `HEAD` (the current branch); an empty source is a delete.
        names = [branch if src == "HEAD" else src] + ([dst] if colon else [])
        for name in names:
            task_id = _ref_task_id(name, id_regex)
            if task_id is None:
                return None
            ids.add(task_id)
        if sources is not None:
            sources.append((directory, names[0]))
    return ids.pop() if len(ids) == 1 else None


def _read_only_git_args_ok(subcommand, args):
    """True only when every option is on `subcommand`'s allowlist and no path argument
    carries a glob (a file named `--output=.git/HEAD` would expand into an option).
    A commit message is the token after `-m`/`-am`; it may hold a glob, never a `-`."""
    allowed = SAFE_GIT_OPTIONS[subcommand]
    index = 0
    while index < len(args):
        arg = args[index]
        if arg.startswith("-"):
            if arg not in allowed and not (subcommand == "log" and LOG_COUNT_PATTERN.fullmatch(arg)):
                return False
            if subcommand == "commit" and arg in MESSAGE_OPTIONS:
                index += 1
                if index >= len(args) or args[index].startswith("-"):
                    return False
        elif GLOB_CHARS & set(arg):
            return False
        index += 1
    return True


def _command_segments(command):
    """`[(tokens, separator before, separator after)]` for each simple command, or None
    when the text holds anything this resolver does not read."""
    text = OUTPUT_REDIRECT_PATTERN.sub(" ", strip_heredoc_bodies(command)).replace("\n", " ; ")
    lexer = shlex.shlex(text, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        tokens = list(lexer)
    except ValueError:
        return None
    segments, current, before = [], [], None
    for token in tokens:
        if token in PUSH_SEPARATORS:
            segments.append((current, before, token))
            current, before = [], token
        elif set(token) <= SHELL_PUNCTUATION or EXPANSION_CHARS & set(token):
            return None  # `&` lands here too: a background job never moves the push
        else:
            current.append(token)
    segments.append((current, before, None))
    return [segment for segment in segments if segment[0]]


def _git_actions(command, cwd):
    """`[(git args, directory)]` for every `git` segment that is not an allowlisted read-only
    one, in order, or None when the command holds anything else this resolver does not read."""
    if not isinstance(command, str) or not isinstance(cwd, str) or not os.path.isabs(cwd):
        return None
    segments = _command_segments(command)
    if not segments:
        return None
    directory, actions = cwd, []
    for tokens, before, after in segments:
        head, args = tokens[0], tokens[1:]
        if head == "cd":
            # Only `cd <dir> &&` certainly runs the next command in <dir>.
            certain = (len(args) == 1 and before in (None, ";", "&&") and after == "&&"
                       and directory is not None and SAFE_PATH_PATTERN.fullmatch(args[0]))
            directory = os.path.normpath(os.path.join(directory, args[0])) if certain else None
            continue
        if before == "|" and head in PIPE_READERS:
            continue  # reads the push's output in a subshell; cannot move the push
        if head != "git":
            return None
        # T211 D1: git's global options. `-C <dir>` moves the directory, like `cd <dir> &&`.
        # `-c <k=v>` can change what a push or a read-only command does (`push.default`,
        # `core.fsmonitor`), so it is read only before `merge`, where it cannot change which tip
        # is merged. `--no-pager`/`-P` change nothing. Every other option — another repository,
        # work tree or ref namespace, an attached form, an unknown flag — is unresolved.
        where, configured = directory, False
        while args and args[0].startswith("-"):
            if args[0] in ("--no-pager", "-P"):
                args = args[1:]
                continue
            if args[0] not in ("-C", "-c") or len(args) < 2:
                return None
            if args[0] == "-C":
                if where is None or not SAFE_PATH_PATTERN.fullmatch(args[1]):
                    return None
                where = os.path.normpath(os.path.join(where, args[1]))
            configured = configured or args[0] == "-c"
            args = args[2:]
        if not args or (configured and args[0] != "merge"):
            return None
        if args[0] in SAFE_GIT_SUBCOMMANDS:
            if not _read_only_git_args_ok(args[0], args[1:]):
                return None
            continue
        actions.append((args, where))
    return actions


def _resolve_pushed_task(command, cwd, id_pattern, sources=None):
    actions = _git_actions(command, cwd)
    if not actions:
        return None
    id_regex = re.compile(id_pattern or task_id_pattern(ROOT, bounded=True), re.IGNORECASE)
    found = set()
    for args, where in actions:
        if args[0] != "push":
            return None
        task_id = _push_task_id(args[1:], where, id_regex, sources)
        if task_id is None:
            return None
        found.add(task_id)
    return found.pop() if len(found) == 1 else None


def pushed_task_ids(command, cwd, id_pattern=None):
    """The one task ID (upper-cased) that every `git push` in `command` pushes, or None.

    None means "unresolved — check the whole board" and is the answer to every doubt;
    see the T197 comment above. `cwd` is the event's own `cwd`. `id_pattern` is a
    bounded regex source, defaulting to the board's (`task_id_pattern`). Never raises.
    """
    try:
        return _resolve_pushed_task(command, cwd, id_pattern)
    except Exception:
        return None


# T211 D2: the `git merge` options that take a separate argument. Every other `-` word is skipped
# alone (`--opt=value` and `-Xours` are one word), so any option leaves the branches resolvable.
# T296: `--message`, `--file` and `--cleanup` too, and git's own reading of an option word: an
# unambiguous prefix of a long option is that option (`--mess <x>`), and a short option in a run
# takes the rest of the run, or the next word when it ends the run (`-qm <x>`). `-S` takes only an
# attached value, so it never takes the next word.
MERGE_OPTIONS_WITH_ARG = frozenset({"-m", "--message", "-F", "--file", "-s", "--strategy", "-X",
                                    "--strategy-option", "--cleanup", "--into-name"})
MERGE_SHORT_WITH_ARG = frozenset(o[1] for o in MERGE_OPTIONS_WITH_ARG if not o.startswith("--"))
MERGE_LONG_WITH_ARG = tuple(o for o in MERGE_OPTIONS_WITH_ARG if o.startswith("--"))
OCTOPUS_DOUBT_MESSAGE = ("octopus merge: cannot confirm {branch} — each branch must name exactly "
                         "one task and resolve to a commit")


def _merge_option_takes_next(arg):
    """T296: True when the option word `arg` takes the NEXT word as its value (git's parse-options)."""
    if arg.startswith("--"):
        return len(arg) > 2 and any(o.startswith(arg) for o in MERGE_LONG_WITH_ARG)
    for index, char in enumerate(arg[1:], 1):
        if char in MERGE_SHORT_WITH_ARG:
            return index == len(arg) - 1  # the rest of the run is the value, else the next word is
        if char == "S":
            return False  # `-S[<keyid>]`: an attached value only
    return False


def _merge_sources(args, where):
    """`[(directory, branch)]` for every branch `git merge <args>` names, in order."""
    names, index = [], 0
    while index < len(args):
        if args[index].startswith("-") and _merge_option_takes_next(args[index]):
            index += 2  # the option and its argument (a message, a strategy, …)
            continue
        if not args[index].startswith("-"):
            names.append(args[index])
        index += 1
    return [(where, name) for name in names]


def branch_targets(command, cwd, id_pattern=None):
    """`(targets, doubts)` for what `command` merges or pushes (T210 D4, T211 D2), never raising.

    `targets` is `[(task ID, branch, directory)]`, each branch whose task's verify row must be
    committed on it. One merged or pushed branch that cannot be resolved gives `([], [])`: the
    pre-T210 working-tree read. An octopus merge (two or more branches) resolves every branch, and
    each one that names no single task, or whose tip does not resolve, is a `doubts` entry (a
    block). `git pull` and `git rebase` are always `([], [])`: what they merge is not a local tip.
    """
    try:
        actions = _git_actions(command, cwd)
        if not actions:
            return [], []
        id_regex = re.compile(id_pattern or task_id_pattern(ROOT, bounded=True), re.IGNORECASE)
        sources = []
        if len(actions) == 1 and actions[0][0][0] == "merge":
            sources = _merge_sources(actions[0][0][1:], actions[0][1])
        elif _resolve_pushed_task(command, cwd, id_pattern, sources) is None:
            return [], []
        if len(set(sources)) == 1:
            directory, branch = sources[0]
            task_id = _ref_task_id(branch, id_regex) if directory is not None else None
            return ([(task_id, branch, directory)] if task_id else []), []
        if actions[0][0][0] != "merge" or len(sources) < 2:
            return [], []
        targets, doubts = [], []
        for directory, branch in sources:
            task_id = _ref_task_id(branch, id_regex)
            tip = None if directory is None else _git(
                directory, "rev-parse", "--verify", "--quiet", f"{branch}^{{commit}}")
            if task_id is None or tip is None or tip.returncode != 0:
                doubts.append(branch)
            else:
                targets.append((task_id, branch, directory))
        return targets, doubts
    except Exception:
        return [], []


def branch_target(command, cwd, id_pattern=None):
    """The one `(task ID, branch, directory)` `command` merges or pushes, or None (T210 D4)."""
    targets, doubts = branch_targets(command, cwd, id_pattern)
    return targets[0] if len(targets) == 1 and not doubts else None


# --- An In Progress task blocks only this session's merge (T250 G2) ---------
#
# Before T250 any In Progress row refused every merge, so a task another session was working on
# (T249, in its own worktree) blocked this session's merge of an unrelated branch. Now, for a
# `git merge` whose every branch names exactly one task, an In Progress task stays a blocker when
# this session worked on it (`session_work.worked_on`: an edit, a writing `Bash` command or a spawn
# for it, in the session's transcript or a sub-agent's), or the merge brings in its branch. A branch
# name is not enough for that: `fix/t251-x` cut from T249's branch carries T249's unfinished
# commits, so each of the task's branches (`branch_carries_task_work`) is also compared by commit.
# Every doubt keeps the blocker: another command (push, pull, rebase, `merge --abort`), a branch
# that names no task, no transcript, an unreadable one, a task with no known branch, a missing ref,
# or any error.


def merge_brought_task_ids(command, cwd, id_pattern=None):
    """The task IDs (upper-cased) of every branch a `git merge` command merges, or None when the
    command is anything else or one branch names no single task. Never raises."""
    try:
        actions = _git_actions(command, cwd)
        if not actions or any(args[0] != "merge" for args, _ in actions):
            return None
        id_regex = re.compile(id_pattern or task_id_pattern(ROOT, bounded=True), re.IGNORECASE)
        ids = set()
        for args, where in actions:
            names = [name for _, name in _merge_sources(args[1:], where)]
            if not names:
                return None
            for name in names:
                task_id = _ref_task_id(name, id_regex)
                if task_id is None:
                    return None
                ids.add(task_id)
        return ids
    except Exception:
        return None


def _merged_refs(command, cwd):
    """`[(directory, ref)]` for every ref the `git merge` segments of `command` merge."""
    sources = []
    for args, where in _git_actions(command, cwd) or []:
        if args and args[0] == "merge":
            sources.extend(_merge_sources(args[1:], where))
    return sources


def branch_carries_task_work(command, cwd, task_id, row):
    """False only when every merged ref is proven to bring in none of the task's own commits: for
    each merged ref M and each branch B of the task (its board row's, and each of its worktrees'),
    `git merge-base M B` is already in HEAD. True on any doubt — no branch known, no merged ref, a
    missing ref, a git error (fail closed)."""
    try:
        branches = {auto_mode.row_branch(row or "")}
        branches.update(auto_mode.branch_of(path)
                        for path in session_work.task_worktrees(ROOT, task_id, row))
        branches.discard(None)
        refs = _merged_refs(command, cwd)
        if not branches or not refs:
            return True
        for where, ref in refs:
            if where is None:
                return True
            for branch in branches:
                base = _git(where, "merge-base", f"{ref}^{{commit}}", f"{branch}^{{commit}}")
                if base is None or base.returncode != 0 or not base.stdout.strip():
                    return True
                held = _git(where, "merge-base", "--is-ancestor", base.stdout.strip(), "HEAD")
                if held is None or held.returncode != 0:
                    return True
        return False
    except Exception:
        return True


def session_owned_in_progress(rows, command, cwd, transcript_path):
    """The In Progress task IDs (from `[(ID, board row)]`) that still block this command (T250 G2).
    Fails closed: on any doubt every ID is kept."""
    ids = [task_id for task_id, _ in rows]
    try:
        brought = merge_brought_task_ids(command, cwd)
        if brought is None or not ids:
            return ids
        calls = session_work.load_work(transcript_path)
        if calls is None:
            print("[hook:pre_bash] cannot read this session's transcript — every In Progress "
                  "task blocks this merge", file=sys.stderr)
            return ids
        kept = []
        for task_id, row in rows:
            if task_id.upper() in brought or session_work.worked_on(
                    calls, task_id, session_work.task_worktrees(ROOT, task_id, row)):
                kept.append(task_id)
            elif branch_carries_task_work(command, cwd, task_id, row):
                kept.append(task_id)
                print(f"[hook:pre_bash] {task_id} is In Progress and this merge may bring in "
                      "commits of its branch (or its branch is not known) — still blocking (T250)",
                      file=sys.stderr)
            else:
                print(f"[hook:pre_bash] {task_id} is In Progress, but this session did not work "
                      "on it and this merge does not bring in its branch — not blocking (T250)",
                      file=sys.stderr)
        return kept
    except Exception as exc:
        print(f"[hook:pre_bash] session ownership check failed ({type(exc).__name__}) — every "
              "In Progress task blocks this merge", file=sys.stderr)
        return ids


# --- Auto mode: merge and push stay the user's, except under `[admin]` (T284) ---------------
#
# While the session's latest user request carries `[auto]` or `[admin]` (`lib/auto_mode.py`, the
# reader the Stop check shares), a `git merge`, `git push` or `git pull` — or an inline git alias,
# which may be one — is blocked. Before T284 "never in auto mode: merge, push" was doctrine only:
# this gate did not read the tag. `git rebase` is not part of this rule; it keeps its board check.
#
# `[admin]` lifts that block for one command, and only when every one of these holds (any doubt is
# a block):
#   * the latest request is one the user typed (`origin.kind` "human", not a sidechain) and carries
#     `[admin]` outside code spans and `>` quoted lines — `auto_mode.admin_request`;
#   * each git action of the command is `git merge <one branch>` or a plain `git push` of a branch
#     to the same branch name: no force flag, no `+refspec`, no other destination, no `--no-verify`;
#   * every branch names the same one task, and that task is the request's: the request names it
#     with no negation in its clause, or it is the one task whose guide was first added after the
#     request (`_named_tasks`, `_guides_added_since`);
#   * a push of `main` (round 2): the remote's real `main` comes from `git ls-remote origin`, the
#     local `main` is that sha plus only this session's merge of the task branch (run with `main`
#     checked out), and the merge commit's tree is `git merge-tree --write-tree`'s result;
#   * the branch tip commits the hook's own `auto-run by hook` verify result for the task, confirmed
#     by its run record for that commit (`committed_verify_row(..., hook_only=True)`): a hand-typed
#     pass row never counts.
#   * round 3: one git write per command; push and merge in the same repository; no executable
#     merge/push hook and no repo config that can run a command; `-c` refused anywhere before the
#     verb; a hidden git verb (quotes, `${IFS}`, `$(…)`, backticks, `eval`; since T296 also a `$`, brace
#     or glob in the git word or verb or its wrapper chain, and `send-pack`) is a block in auto mode.
#   * T295: the repo rule is an allowlist of config keys, no executable hook file, no attributes line
#     with `merge=`, `filter=` or `diff=`, and no other git command in the same command line.
# The gate's other checks then still run. No transcript, or one that cannot be read, means no
# request is known: the rule does not apply and the gate is exactly as before T284.
AUTO_MODE_PATTERNS = [p for p in BLOCKED_PATTERNS if not p.endswith(r"rebase\b")]
ADMIN_MAIN_BRANCH = "main"  # AC 8: the one branch `[admin]` may push besides the task branch
ADMIN_REMOTE = "origin"     # P2: the one remote `[admin]` may push to
# P1: a task ID in the request counts only when no negation stands before it in its clause.
NEGATION = re.compile(r"\b(?:not|never|no|without|except|skip|leave|don't|dont|hold|wait|later|"
                      r"postpone)\b|n't\b", re.I)
LS_REMOTE_TIMEOUT_S = 10
# T296 still reads a read-only verb set (the scan's env-risk doubt); T295 lets no other git command
# share an `[admin]` command with its merge or push at all.
ADMIN_READ_ONLY_GIT = frozenset({"status", "log", "diff", "show", "rev-parse"})
GIT_OPTION_ARGS = GIT_OPTIONS_WITH_ARG
# T295 (finding P1-2, replaces the T284 round-3 deny lists): the repo/worktree config of an `[admin]`
# merge or push is read as an allowlist. Each key is `(section, has a subsection, variable)`, with
# section and variable in lower case (git ignores their case; the subsection is case-sensitive).
# A key not here is refused by name; a longer deny list failed against `merge.<d>.driver`,
# `filter.<f>.smudge`, `diff.<d>.textconv`, `gpg.program` and `core.editor`. The value is the reason
# the key cannot run code or reach another host. Add a key only with a reason and a test.
ADMIN_ALLOWED_CONFIG = {
    ("core", False, "repositoryformatversion"): "a number that git reads; it names no program",
    ("core", False, "filemode"): "a boolean about the executable bit; it names no program",
    ("core", False, "bare"): "a boolean about the repository kind; it names no program",
    ("core", False, "logallrefupdates"): "a boolean about the reflog; it names no program",
    ("core", False, "ignorecase"): "a boolean about file name case; it names no program",
    ("core", False, "precomposeunicode"): "a boolean about file name encoding on macOS",
    ("core", False, "autocrlf"): "a line-ending mode; git converts text itself, no program",
    ("core", False, "safecrlf"): "a line-ending warning mode; it names no program",
    ("core", False, "symlinks"): "a boolean that WSL and Windows checkouts set; no program",
    ("remote", True, "url"): ("the address of a remote; checked below: no helper or option form, one "
                              "URL per remote, and for a push no local target whose hooks could run"),
    ("remote", True, "fetch"): "a refspec that only maps ref names",
    ("branch", True, "remote"): "a remote name; a bare push checks that it is origin",
    ("branch", True, "merge"): "a ref name; it names no program",
    ("branch", True, "vscode-merge-base"): "a ref name that only an editor reads",
    ("pull", False, "rebase"): "a boolean here (checked below); `git pull` is blocked anyway",
    ("push", False, "default"): "simple or current only (checked below): the push destination",
    ("user", False, "name"): "the commit author name; text only",
    ("user", False, "email"): "the commit author address; text only",
    ("extensions", False, "worktreeconfig"): "makes git read the per-worktree config the gate reads",
}
ADMIN_REMOTE_URL_HELPER = re.compile(r"^-|^[A-Za-z0-9+.-]+::|://-|@-")  # option, `ext::` helper
# F3: read on bytes, as git reads them. git separates attributes by space, tab or CR only, and a
# quoted pattern (`"*"merge=x`) may be followed by an attribute with no blank between them.
ADMIN_ATTRIBUTE_PATTERN = re.compile(rb'(?:^|[ \t\r"])(?:merge|filter|diff)=', re.I)
ADMIN_ATTRIBUTE_MACRO = re.compile(rb"(?:merge|filter|diff)=", re.I)  # anywhere in an `[attr]` line
ADMIN_ATTRIBUTES_MAX_BYTES = 1 << 20
ADMIN_ATTRIBUTES_WALK_S = 10  # F4: the attributes scan of a checkout refuses after this many seconds
ADMIN_BOOLEAN_VALUES = frozenset({"", "true", "false", "yes", "no", "on", "off", "1", "0"})
ADMIN_SHOWN_CHARS = 120  # F6d: at most this many characters of a name the repository chose
# Round 3 (N5): shell forms that hide which word is `git` or its verb.
OBFUSCATION = re.compile(r"\$\{?IFS\b|\$\(|`|\beval\b")
# T296 (P2-1, Stage 4 fix round): the words that pass their command on (the wrapper chain), the shell
# keywords that start a command, the shells that run a `-c` string, and the git verbs that publish.
# Rule: EVERY word whose basename is `git` or `git-<verb>` is a git word; a git word whose verb cannot
# be read (an option git does not know, a verb that is not a plain word, no verb after a wrapper such
# as `xargs`) is a doubt; and a doubt is a block in auto mode, never an allow.
SHELL_WRAPPERS = frozenset({"command", "env", "sudo", "doas", "nohup", "time", "exec", "timeout", "nice",
                            "ionice", "setsid", "stdbuf", "xargs"})
SHELL_KEYWORDS = frozenset({"do", "then", "else", "elif", "if", "while", "until", "!", "{", "coproc"})
SHELLS = frozenset({"bash", "sh", "zsh", "dash", "ksh"})
DATA_HEADS = frozenset({"echo", "printf", "grep", "egrep", "fgrep", "rg", "ag"})  # print or match only
# The verbs that publish or run a program that does. `push`, `merge`, `pull` are the gate's own;
# `merge-*` (but `merge-base`) is read as `merge`. Each other one, and why it is here:
#   send-pack, http-push   plumbing that pushes refs to a remote (the T296 finding);
#   receive-pack           updates refs of a repository and runs its hooks;
#   remote-ext             runs an arbitrary command as the transport;
#   subtree                `git subtree push` pushes a split branch (really pushed in the review);
#   svn, p4                `git svn dcommit` and `git p4 submit` publish to another server;
#   cvsexportcommit        commits to a CVS checkout.
# Not here, on purpose: `fetch` (reads), `submodule` and `rebase --exec` (run a program but are a
# documented limit), `fast-import`, `archimport` (write to the local repository only).
PUBLISH_VERBS = frozenset({"push", "merge", "pull", "send-pack", "http-push", "receive-pack",
                           "remote-ext", "subtree", "svn", "p4", "cvsexportcommit"})
# The global options that take no value (git.c `handle_options`, `--version`/`--help`); an option that
# is neither here nor in `GIT_OPTIONS_WITH_ARG` is unknown, and an unknown option before the verb is a
# doubt in a command position (git itself refuses it, but a newer git may take a value with it).
GIT_NOVALUE_GLOBALS = frozenset({
    "--no-pager", "-P", "-p", "--paginate", "--bare", "--no-replace-objects", "--literal-pathspecs",
    "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks",
    "--no-lazy-fetch", "--no-advice", "--version", "--help", "-h", "-v", "--html-path", "--man-path",
    "--info-path", "--exec-path"})
GIT_ATTACHED_GLOBALS = ("--exec-path=", "--list-cmds=")
# An assignment that makes git read another config or program path: with a git word in the same
# command it can define an alias (`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.x ... git x`), a doubt.
GIT_ENV_RISK = re.compile(r"^(?:GIT_(?:CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+"
                          r"|EXEC_PATH|CONFIG_GLOBAL|CONFIG_SYSTEM))=")
# `GIT_CONFIG_COUNT` or `GIT_CONFIG_PARAMETERS` with a value can define an alias, so it is a doubt before
# any verb; the other `GIT_ENV_RISK` names are a doubt only before a verb that is not read-only.
GIT_ENV_ALIAS = re.compile(r"^GIT_CONFIG_(?:COUNT|PARAMETERS)=.")
# One shell operator out of a run of punctuation (`>|` is a redirect, not a pipe; `&>>`, `<>`, `>&`).
OPERATOR_PIECE = re.compile(r"&>>|<<<|<<-|&>|>>\||>\||<>|>>|>&|<&|<<|\|&|\|\||&&|;;|[<>|&;()]")
ANSI_MARK = "\x01"  # stands for the `$` of an ANSI-C `$'…'` or locale `$"…"` quote while shlex runs
FIND_EXEC = frozenset({"-exec", "-execdir", "-ok", "-okdir"})  # the word after these is a command
ASSIGNMENT_NAME = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\+?=")
VARIABLE_REFERENCE = re.compile(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)")
VARIABLE_PART = re.compile(r"\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*")
ANSI_ESCAPE = re.compile(r"\\(?:x[0-9A-Fa-f]|[0-7]{1,3}|[uU][0-9A-Fa-f]|c.)")  # a hex, octal or code-point escape
BRACE_EXPANSION = re.compile(r"(?<!\$)\{[^{}]*(?:,|\.\.)[^{}]*\}")
NONLITERAL = re.compile(r"[$`{}*?\[]")
PLAIN_VERB = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
TEST_BRACKETS = frozenset({"[", "[["})
HIDDEN_DEPTH_LIMIT = 6
FUTURE_SLACK_S = 60  # B11: a commit dated later than now + this is not trusted as "added after"
# B7: config that can send an `[admin]` push somewhere else or run code during it.
ADMIN_PUSH_CONFIG_KEYS = (r"^(push\.default|remote\..*\.(push|mirror)|push\.followtags|core\.hookspath"
                          r"|remote\..*\.(receivepack|pushurl)|url\..*\.(insteadof|pushinsteadof))$")
CLAUSE_END = re.compile(r"[.;,!?\n]")
ADMIN_PUSH_FLAGS = frozenset({"-u", "--set-upstream", "-q", "--quiet", "-v", "--verbose",
                              "--progress", "-n", "--dry-run"})
AUTO_MODE_LIMIT = ("With `[auto]`, merge and push stay the user's. `[admin]` allows only a merge or a "
                   "plain push of the request's own task branch (or of `main` after that merge), "
                   "after its auto verify passed "
                   "(docs/claude-md/tracks.md `### Admin tag`).")


def _config_value(directory, key):
    """`git config --get <key>` in `directory`: the value, "" when unset, None on any failure."""
    done = _git(directory, "config", "--get", key)
    if done is None:
        return None
    if done.returncode == 1 and not done.stdout.strip():
        return ""
    return done.stdout.strip() if done.returncode == 0 else None


def _admin_push_branch(args, directory):
    """The one branch a `git push <args>` run in `directory` sends to the same branch name on
    `origin`, or None (a force, an unknown option, another remote or a URL, more than one refspec,
    another destination; for a bare push, `pushRemote`/`pushDefault`/the branch remote not origin)."""
    positionals = []
    for arg in args:
        if arg.startswith("-"):
            if arg not in ADMIN_PUSH_FLAGS:
                return None
        else:
            positionals.append(arg)
    if len(positionals) > 2 or (positionals and not REMOTE_NAME_PATTERN.fullmatch(positionals[0])):
        return None
    current = _current_branch(directory)
    if current is None or not _push_config_is_plain(directory, ADMIN_PUSH_CONFIG_KEYS):
        return None
    fetch_url = _git(directory, "remote", "get-url", ADMIN_REMOTE)
    push_url = _git(directory, "remote", "get-url", "--push", ADMIN_REMOTE)
    if (fetch_url is None or push_url is None or fetch_url.returncode != 0
            or push_url.returncode != 0 or fetch_url.stdout.strip() != push_url.stdout.strip()):
        return None
    if positionals:
        if positionals[0] != ADMIN_REMOTE:
            return None
    else:
        for key in (f"branch.{current}.pushRemote", "remote.pushDefault", f"branch.{current}.remote"):
            if _config_value(directory, key) not in ("", ADMIN_REMOTE):
                return None
    spec = positionals[1] if len(positionals) == 2 else "HEAD"
    if spec.startswith("+"):
        return None
    src, colon, dst = spec.partition(":")
    strip = lambda name: name[len("refs/heads/"):] if name.startswith("refs/heads/") else name
    src = current if src == "HEAD" else strip(src)
    if colon and strip(dst) != src:
        return None
    return src or None


def _origin_url(directory):
    """The URL of `origin` in `directory`, or None. A local path (absolute, or relative to the
    repository) is resolved first, so a symlink or `../origin.git` to the same bare repository is the
    same remote."""
    done = _git(directory, "remote", "get-url", ADMIN_REMOTE)
    if done is None or done.returncode != 0:
        return None
    url = done.stdout.strip()
    if url and "://" not in url and not re.match(r"^[\w.-]+@[\w.-]+:", url):
        path = url if os.path.isabs(url) else os.path.join(directory, url)
        if os.path.exists(path):
            return os.path.realpath(path)
    return url


def _own_origin_refusal(where, cwd):
    """T296 (P3-3): None when the repository a push runs in (`where`) is the one the command started
    in (`cwd`) or the project's (`ROOT`), or when its `origin` has the URL of either one's `origin`.
    Otherwise why: `cd <clone> && git push origin <branch>` in a clone whose `origin` is another remote
    would send the branch there (the `main` push has had the same-repository rule since T284)."""
    mine, url = _common_dir(where), _origin_url(where)
    for base in (cwd, ROOT):
        if not isinstance(base, str) or not os.path.isdir(base):
            continue
        if mine is not None and mine == _common_dir(base):
            return None
        known = _origin_url(base)
        if url is not None and known is not None and url == known:
            return None
    return (f"the `origin` of the repository at {where} is another remote than this repository's "
            "`origin`: `[admin]` pushes only to this repository's own remote")


def _session_admin_merges(transcript_path, when, id_regex):
    """`[(task ID, branch, directory)]` for each `git merge <one task branch>` this session (or a
    sub-agent) ran since `when` and whose result is in the transcript and not an error — read from
    the transcript, never from a command's own text."""
    found = []
    for command, call_cwd, ok in session_work.merge_calls(transcript_path, when):
        if not ok:
            continue
        for args, where in _git_actions(command, call_cwd) or []:
            # Round 2: only a merge run with `main` checked out counts.
            if args[0] != "merge" or where is None or _current_branch(where) != ADMIN_MAIN_BRANCH:
                continue
            names = [n for _, n in _merge_sources(args[1:], where)]
            task_id = _ref_task_id(names[0], id_regex) if len(names) == 1 else None
            if task_id:
                found.append((task_id, names[0], where))
    return found


def _git_verb(tokens):
    """The git subcommand of a `git …` token list, past git's global options; None if absent."""
    i = 1
    while i < len(tokens) and tokens[i].startswith("-"):
        i += 2 if tokens[i] in GIT_OPTION_ARGS else 1
    return tokens[i] if i < len(tokens) else None


def _common_dir(where):
    """The absolute, resolved `git rev-parse --git-common-dir` of `where`, or None."""
    done = _git(where, "rev-parse", "--path-format=absolute", "--git-common-dir")
    path = done.stdout.strip() if done is not None and done.returncode == 0 else ""
    return os.path.realpath(path) if path else None


def _config_key_shape(key):
    """`(section, has a subsection, variable)` of a `git config --list` key, section and variable in
    lower case; the subsection (case-sensitive, it may hold dots) is not part of the shape."""
    section, _, rest = key.partition(".")
    subsection, dot, variable = rest.rpartition(".")
    if not dot:
        return (section.lower(), False, rest.lower())
    return (section.lower(), True, variable.lower()) if subsection else (section.lower(), False, "?")


def _shown(text, limit=ADMIN_SHOWN_CHARS):
    """F6d: `text` the repository chose (a hook file name, a config key, a path) as a refusal may
    show it: control and non-ASCII characters escaped, a backtick as `'`, at most `limit` chars."""
    safe = text.encode("unicode_escape").decode("ascii").replace("`", "'")
    return safe if len(safe) <= limit else safe[:limit] + "..."


def _config_value_ok(shape, value):
    """The few allowlisted keys whose value matters: a push default, a rebase mode, a remote URL,
    and the two booleans (F6a)."""
    if shape == ("push", False, "default"):
        return value.strip().lower() in SAFE_PUSH_DEFAULTS
    if shape == ("pull", False, "rebase"):
        return value.strip().lower() in ("true", "false")
    if shape in (("core", False, "symlinks"), ("extensions", False, "worktreeconfig")):
        return value.strip().lower() in ADMIN_BOOLEAN_VALUES
    if shape == ("remote", True, "url"):
        return not ADMIN_REMOTE_URL_HELPER.search(value.strip())
    return True


def _admin_config_refusal(where):
    """Why the repo/worktree config at `where` is refused (a key not on `ADMIN_ALLOWED_CONFIG`, an
    allowlisted key with a value that can run a command, or a remote with a second `url`), or None.
    User-global and system config are trusted and not read. `-z` ends an entry at NUL, so a newline
    in a value is not a new key."""
    done = _git(where, "config", "--list", "--show-scope", "-z")
    if done is None or done.returncode not in (0, 1):
        return "cannot read the repository config"
    fields = done.stdout.split("\0")
    if fields and not fields[-1]:
        fields.pop()
    if len(fields) % 2:
        return "cannot read the repository config"
    url_counts = {}
    for scope, entry in zip(fields[0::2], fields[1::2]):
        key, _, value = entry.partition("\n")
        shape = _config_key_shape(key)
        if scope not in ("local", "worktree"):
            # Review P1: a `url` set in global or system config adds a push target too, so count it
            # with the repo's own; nothing else in those scopes is read.
            if shape == ("remote", True, "url"):
                remote = key.partition(".")[2].rpartition(".")[0]
                url_counts[remote] = url_counts.get(remote, 0) + 1
                if url_counts[remote] > 1:
                    return (f"repo config `{_shown(key)}` is set more than once: a push to that "
                            "remote would go to every URL")
            continue
        if shape not in ADMIN_ALLOWED_CONFIG:
            return (f"repo config `{_shown(key)}` is not on the `[admin]` allowlist: it can run a "
                    "command or send git elsewhere, so `[admin]` refuses")
        if not _config_value_ok(shape, value):
            return (f"repo config `{_shown(key)}` has a value that can run a command or send git "
                    "elsewhere")
        if shape == ("remote", True, "url"):
            # F2a: git pushes to every `url` of a remote, but `git remote get-url` shows the first.
            remote = key.partition(".")[2].rpartition(".")[0]
            url_counts[remote] = url_counts.get(remote, 0) + 1
            if url_counts[remote] > 1:
                return (f"repo config `{_shown(key)}` is set more than once: a push to that remote "
                        "would go to every URL")
    return None


def _admin_hooks_refusal(hooks, whose="the repository"):
    """T295: why the hooks directory `hooks` refuses an `[admin]` merge or push (any executable file
    that is not a `.sample` file, whatever its name), or None. A symlinked directory or file is
    followed. `whose` names the repository in the refusal (the local one, or a push target)."""
    try:
        with os.scandir(hooks) as entries:
            for entry in entries:
                if (not entry.name.endswith(".sample") and not os.path.isdir(entry.path)
                        and os.access(entry.path, os.X_OK)):
                    return (f"{whose} has an executable `{_shown(entry.name)}` hook, which this "
                            "merge or push could run")
    except FileNotFoundError:
        return None
    except OSError:
        return f"cannot read the hooks directory of {whose}"
    return None


def _attributes_bytes(path):
    """F4: the bytes of the attributes file `path` (at most `ADMIN_ATTRIBUTES_MAX_BYTES` + 1), b""
    when it does not exist, or a refusal (a str). `os.lstat` first: a FIFO, device or directory is
    refused and never opened; the open is `O_NONBLOCK | O_NOFOLLOW` and `fstat` checks it again."""
    shown = _shown(path, 2 * ADMIN_SHOWN_CHARS)
    try:
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode):
            path = os.path.realpath(path)
            info = os.lstat(path)
    except FileNotFoundError:
        return b""  # no file, or a dangling symlink: git reads nothing either
    except OSError:
        return f"cannot read the attributes file {shown}"
    if not stat.S_ISREG(info.st_mode):
        return f"the attributes file {shown} is not a regular file"
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                return f"the attributes file {shown} is not a regular file"
            chunks, size = [], 0
            while size <= ADMIN_ATTRIBUTES_MAX_BYTES:
                chunk = os.read(descriptor, ADMIN_ATTRIBUTES_MAX_BYTES + 1 - size)
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
            return b"".join(chunks)
        finally:
            os.close(descriptor)
    except OSError:
        return f"cannot read the attributes file {shown}"


def _sets_a_driver(raw):
    """F3: True when an attributes file's bytes hold a line that can set `merge=`, `filter=` or
    `diff=`, read as git reads it: lines end at `\\n` only; space, tab and CR at the start are
    skipped, then `#` is a comment (a NBSP or `\\v` before it is not). An `[attr]` macro line that
    holds `merge=`, `filter=` or `diff=` anywhere refuses too (stricter than git)."""
    for line in raw.split(b"\n"):
        line = line.lstrip(b" \t\r")
        if not line or line.startswith(b"#"):
            continue
        if ADMIN_ATTRIBUTE_PATTERN.search(line) or (
                line.startswith(b"[attr]") and ADMIN_ATTRIBUTE_MACRO.search(line)):
            return True
    return False


def _admin_attributes_refusal(where, common):
    """T295: why the attributes of the repository at `where` refuse an `[admin]` merge or push (a
    line with `merge=`, `filter=` or `diff=` in `.git/info/attributes` or any `.gitattributes` of the
    checkout), or None. Such a line names a driver or filter that a config outside the allowlist, or
    user-global config, could define. The scan of the checkout stops with a refusal after
    `ADMIN_ATTRIBUTES_WALK_S` seconds (F4)."""
    files = [os.path.join(common, "info", "attributes")]
    top = _git(where, "rev-parse", "--show-toplevel")
    if top is not None and top.returncode == 0 and top.stdout.strip():
        deadline = time.monotonic() + ADMIN_ATTRIBUTES_WALK_S

        def raise_walk_error(error):
            raise error
        try:
            for directory, subdirs, names in os.walk(top.stdout.strip(), onerror=raise_walk_error):
                if time.monotonic() > deadline:
                    return (f"the attributes scan of the repository took longer than "
                            f"{ADMIN_ATTRIBUTES_WALK_S} s")
                subdirs[:] = [d for d in subdirs if d != ".git"]
                files += [os.path.join(directory, n) for n in subdirs + names if n == ".gitattributes"]
        except OSError:
            return "cannot read the attributes of the repository"
    for path in files:
        raw = _attributes_bytes(path)
        if isinstance(raw, str):
            return raw
        if len(raw) > ADMIN_ATTRIBUTES_MAX_BYTES:
            return f"the attributes file {_shown(path, 2 * ADMIN_SHOWN_CHARS)} is too large to read"
        if _sets_a_driver(raw):
            return (f"the attributes file {_shown(path, 2 * ADMIN_SHOWN_CHARS)} sets `merge=`, "
                    "`filter=` or `diff=`, which can run a driver or filter during this merge or push")
    return None


def _admin_repo_refusal(where):
    """Why the repository at `where` may not run an `[admin]` merge or push, or None (T295, finding
    P1-2): repo/worktree config off the allowlist, an executable hook, a legacy `remotes/` or
    `branches/` file, or an attributes line with `merge=`, `filter=` or `diff=`. User-global and
    system config are trusted (not read here). Read at hook time: a change between this check and
    the command stays a documented limit."""
    common = _common_dir(where)
    if common is None:
        return f"cannot read the repository at {_shown(where, 2 * ADMIN_SHOWN_CHARS)}"
    for legacy in ("remotes", "branches"):
        # F2b: a file here defines a remote (and its URL) outside the config the gate reads.
        try:
            if os.listdir(os.path.join(common, legacy)):
                return f"the repository has a file in `.git/{legacy}/`, which can define a remote"
        except FileNotFoundError:
            pass
        except OSError:
            return f"cannot read `.git/{legacy}/` of the repository"
    return (_admin_hooks_refusal(os.path.join(common, "hooks")) or _admin_config_refusal(where)
            or _admin_attributes_refusal(where, common))


def _local_push_path(url):
    """F2b: the path of a push URL that git reaches on this machine (a path or `file://`), or None
    for a network URL (`scheme://…` or the scp form `host:path`)."""
    if url.startswith("file://"):
        return url[len("file://"):]
    if "://" in url:
        return None
    colon, slash = url.find(":"), url.find("/")
    return url if colon < 0 or 0 <= slash < colon else None


def _admin_push_target_refusal(where):
    """F2b: why the push target of `origin` refuses an `[admin]` push, or None. A local or `file://`
    target runs its own `pre-receive`, `update`, `post-receive`… hooks (from its `core.hooksPath`
    too), and `receive.denyCurrentBranch=updateInstead` makes a non-bare target check out the push
    with its own filters. A relative URL is resolved from the worktree top, as git does. The target
    is only read (`rev-parse`, `config --get`), never run. A network URL is not checked."""
    done = _git(where, "remote", "get-url", ADMIN_REMOTE)
    if done is None or done.returncode != 0:
        return None  # `_admin_push_branch` refuses a push with no readable origin URL
    local = _local_push_path(done.stdout.strip())
    if local is None:
        return None
    if "%" in local:
        return "the push target of origin is a `file://` URL with an escape the gate does not decode"
    top = _git(where, "rev-parse", "--show-toplevel")
    base = top.stdout.strip() if top is not None and top.returncode == 0 else ""
    base = base or _common_dir(where) or ""
    target = os.path.join(base, os.path.expanduser(local)) if base else ""
    found = next((target + suffix for suffix in ("/.git", "", ".git/.git", ".git")
                  if target and os.path.exists(target + suffix)), None)
    shown = _shown(target, 2 * ADMIN_SHOWN_CHARS)
    hooks = found and _git(found, f"--git-dir={found}", "rev-parse", "--path-format=absolute",
                           "--git-path", "hooks")
    if not hooks or hooks.returncode != 0 or not hooks.stdout.strip():
        return f"cannot read the push target of origin at {shown}"
    refusal = _admin_hooks_refusal(hooks.stdout.strip(), "the push target of origin")
    if refusal:
        return refusal
    mode = _git(found, f"--git-dir={found}", "config", "--get", "receive.denyCurrentBranch")
    if mode is None or mode.returncode not in (0, 1):
        return f"cannot read the config of the push target of origin at {shown}"
    if mode.stdout.strip().lower() == "updateinstead":
        return ("the push target of origin sets `receive.denyCurrentBranch=updateInstead`: the push "
                "would check out files there, with that repository's own filters")
    return None


def _basename(word):
    """The last path part of a command word; a leading `=` (zsh's `=git` is git's path) is dropped."""
    return word.lstrip("=").rsplit("/", 1)[-1]


def _is_git_word(word):
    """True for `git`, a path to it, and a dashed command `git-push` (or a path to one)."""
    base = _basename(word)
    return base == "git" or base.startswith("git-")


def _publishes(verb):
    return verb in PUBLISH_VERBS or (verb.startswith("merge-") and verb != "merge-base")


def _read_git_word(words, index, strict):
    """`(verb or None, doubt)` for the git word `words[index]` of one simple command (redirects already
    removed). A dashed command `git-push` has its verb in its name. For `git`, the verb is the first
    word past git's global options; an option with a value (`GIT_OPTIONS_WITH_ARG`) takes the next word.
    `strict` is true for a word in a command position (first word, or after a wrapper): there an unknown
    option, a verb that is not a plain word and no verb at all (after a wrapper such as `xargs`, which may
    take it from stdin) are a doubt. Elsewhere (`man git`, `strace -f git push`) only a verb that
    publishes or holds an expansion character is."""
    word = words[index]
    base = _basename(word)
    if base.startswith("git-"):
        verb = base[4:]
        return verb, bool(NONLITERAL.search(base)) or not verb or bool(re.search(r"[^A-Za-z0-9._-]", verb))
    if NONLITERAL.search(base):
        return None, True
    j = index + 1
    while j < len(words) and words[j].startswith("-"):
        option = words[j]
        if option in GIT_OPTIONS_WITH_ARG or option == "--":
            j += 2 if option != "--" else 1
        elif option.startswith(tuple(o + "=" for o in GIT_OPTIONS_WITH_ARG if o.startswith("--"))) \
                or option in GIT_NOVALUE_GLOBALS or option.startswith(GIT_ATTACHED_GLOBALS):
            j += 1
        elif strict:
            return None, True
        else:
            j += 1
    verb = words[j] if j < len(words) else None
    if verb is None:
        return None, False
    if strict:
        return verb, not PLAIN_VERB.fullmatch(verb)
    return verb, bool(NONLITERAL.search(verb))


class _Scan:
    """What one pass over a command found: `doubt` (a form the gate cannot read), `verbs` (the verb of
    each git word whose verb could be read) and `git_words` (how many git words there were)."""

    def __init__(self):
        self.doubt = False
        self.verbs = []
        self.git_words = 0
        self.env_risk = False
        self.env_alias = False


def _assigned_names(simple_commands):
    """The names this command sets: `NAME=value` in any word, `for NAME in`, `read NAME`."""
    names = set()
    for words in simple_commands:
        for word in words:
            found = ASSIGNMENT_NAME.match(word)
            if found:
                names.add(found.group(1))
        if len(words) > 1 and words[0] == "for":
            names.add(words[1])
        if words and words[0] == "read":
            names.update(w for w in words[1:] if not w.startswith("-"))
    return names


def _scan_simple(words, depth, tainted, scan, ansi=False):
    """Read one simple command (`words`: shlex-unquoted, redirects removed) into `scan`. Every word is
    examined: nothing returns at the first word that looks like git. `ansi` is true when a word was an
    ANSI-C `$'…'` or locale `$"…"` quote, which shlex cannot unquote the way the shell does."""
    if depth > HIDDEN_DEPTH_LIMIT:
        scan.doubt = True
        return
    if any(GIT_ENV_RISK.match(w) for w in words):
        scan.env_risk = True
    if any(GIT_ENV_ALIAS.match(w) for w in words):
        scan.env_alias = True
    start = 0
    while start < len(words) and (ASSIGNMENT_NAME.match(words[start]) or words[start] in SHELL_KEYWORDS):
        start += 1
    words = words[start:]
    if words and words[0] == "function" and "{" in words:
        words = words[words.index("{") + 1:]  # `function f { git push; }`: the body is a command
    if not words or _basename(words[0]) in DATA_HEADS:
        return
    git_before, verbs_before = scan.git_words, len(scan.verbs)
    wrapped = _basename(words[0]) in SHELL_WRAPPERS
    xargs_at = next((i for i, w in enumerate(words) if _basename(w) == "xargs"), len(words))
    for k, word in enumerate(words):
        if wrapped and k:
            split = None
            if word in ("-S", "--split-string") and k + 1 < len(words):
                split = words[k + 1]
            elif word.startswith("--split-string="):
                split = word[len("--split-string="):]
            elif re.match(r"^-[A-Za-z]*S.", word):
                split = word.split("S", 1)[1]
            if split:  # `env -S 'git "push" x'`, `env -S'…'`, `env --split-string='…'`
                _merge_scan(scan, split, depth + 1, tainted)
        if k and (word.startswith("-") or ASSIGNMENT_NAME.match(word)):
            continue  # a wrapper's option, or a `VAR=value` it sets: not a command word
        base = _basename(word)
        command_position = wrapped or k == 0 or words[k - 1] in FIND_EXEC
        if _is_git_word(word):
            if base.startswith("git-") and not command_position:
                continue  # `man git-push`, `ls /usr/lib/git-core/git-push`: a name, not a command
            scan.git_words += 1
            verb, doubt = _read_git_word(words, k, command_position)
            if verb is None and k > xargs_at:
                doubt = True  # `env xargs git`, `busybox xargs git`: the verb may come on stdin
            scan.doubt = scan.doubt or doubt
            if verb is not None:
                scan.verbs.append(verb)
            continue
        if not command_position:
            continue
        if base == "eval":
            scan.doubt = True  # the string it runs is built at run time
        elif base in SHELLS:
            for j in range(k + 1, len(words) - 1):
                if re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", words[j]):
                    if ansi:
                        scan.doubt = True  # `sh -c $'git \\x70ush x'`: the string is not what shlex sees
                    _merge_scan(scan, words[j + 1], depth + 1, tainted)
                    break
        elif NONLITERAL.search(base) and base not in TEST_BRACKETS:
            names = set(VARIABLE_REFERENCE.findall(base))
            # A variable the command sets, a head that says git once its variables are cut out (`$GIT`,
            # `${G:-git}`, `g${E}it`) and a glob that matches `git` (`gi?`) may be git; a variable it does
            # not set (`$PY`, `$DOCKER`) is data (`$DOCKER push registry/img`).
            if (BRACE_EXPANSION.search(base) or names & tainted
                    or "git" in base.lower() or "git" in VARIABLE_PART.sub("", base).lower()
                    or fnmatch.fnmatchcase("git", base)
                    or any(w == "-c" for w in words[k + 1:])
                    or ("$" not in base and any(_publishes(w) for w in words[k + 1:]))):
                scan.doubt = True  # (a glob or a backtick word, not a variable, plus a publish verb)
    if ansi and (any(_publishes(w) or BRACE_EXPANSION.search(w) or ANSI_ESCAPE.search(w) for w in words)
                 or (scan.git_words > git_before
                     and any(v not in SAFE_GIT_SUBCOMMANDS for v in scan.verbs[verbs_before:]))):
        # `$'\\x67it' push x`, `$'git-push' x`: an ANSI-C or locale quote hides the git word, and shlex
        # reads `\\x67it` as a plain word. Doubt only when a publishing verb, an expansion or a git verb
        # that is not a plain commit or read stands in the same simple command.
        scan.doubt = True


def _merge_scan(scan, command, depth, tainted=frozenset()):
    inner = _scan_command(command, depth, tainted)
    scan.doubt = scan.doubt or inner.doubt
    scan.verbs += inner.verbs
    scan.git_words += inner.git_words
    scan.env_risk = scan.env_risk or inner.env_risk
    scan.env_alias = scan.env_alias or inner.env_alias


def _mark_ansi_quotes(text):
    """`(text, unbalanced)`: `text` with the `$` of each ANSI-C `$'…'` and locale `$"…"` quote that the
    shell reads (not one inside another quote) replaced by `ANSI_MARK`. `unbalanced` is true when an
    ANSI-C span holds `\\'`, where shlex and the shell disagree about where the quote ends."""
    out, mode, unbalanced, i, n = [], None, False, 0, len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if mode == "s":
            out.append(c)
            mode = None if c == "'" else mode
        elif mode == "d":
            out.append(c)
            if c == "\\" and nxt:
                out.append(nxt)
                i += 1
            elif c == '"':
                mode = None
        elif c == "\\" and nxt:
            out.append(c + nxt)
            i += 1
        elif c == "$" and nxt == "'":
            j = i + 2
            while j < n and text[j] != "'":
                j += 2 if text[j] == "\\" else 1
            unbalanced = unbalanced or "\\'" in text[i + 2:j]
            out.append(ANSI_MARK + text[i + 1:j + 1])
            i = j
        elif c == "$" and nxt == '"':
            out.append(ANSI_MARK)
        else:
            out.append(c)
            mode = "s" if c == "'" else "d" if c == '"' else None
        i += 1
    return "".join(out), unbalanced


def _scan_command(command, depth=0, outer_tainted=frozenset()):
    """Read `command` into a `_Scan`. Two layers: `${IFS}`, `$(…)`, a backtick or `eval` in a segment that
    names git; then each simple command, after shlex removed quotes and backslashes (a lone backslash +
    newline is joined first, as the shell does): redirects are skipped, every git word is read. An
    empty quoted word is a word. `>|` and the other redirect operators are not pipes."""
    scan = _Scan()
    text = join_line_continuations(strip_heredoc_bodies(command))
    for segment in re.split(r"[;&|\n]+", QUOTED_SPAN_PATTERN.sub(" ", text)):
        if re.search(r"git", segment, re.I) and OBFUSCATION.search(segment):
            scan.doubt = True
            return scan
    text, unbalanced = _mark_ansi_quotes(text)
    if unbalanced or any(m.group(1).count("'") % 2 or m.group(1).count('"') % 2
                         for m in re.finditer(r"`([^`]*)`", text)):
        # `echo $'\\'' ; git "push" x #'`, "echo `echo '` ; git push x": the shell and shlex end the
        # quote in different places, so shlex would read a command as quoted data. Rare in real use.
        scan.doubt = True
        return scan
    lexer = shlex.shlex(text.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        tokens = list(lexer)
    except ValueError:
        scan.doubt = "git" in text.lower()
        return scan
    simple, words, skip, ansi = [], [], False, False
    for token in tokens + [";"]:
        if token and set(token) <= SHELL_PUNCTUATION:
            for operator in OPERATOR_PIECE.findall(token):
                skip = False
                if "<" in operator or ">" in operator:
                    if words and words[-1].isdigit():
                        words.pop()  # `2>/dev/null`: the fd number
                    skip = True
                else:  # `;` `&&` `||` `|` `&` `(` `)`: ends a simple command
                    simple.append((words, ansi))
                    words, ansi = [], False
        elif skip:
            skip = False  # the target of a redirect
        else:
            ansi = ansi or ANSI_MARK in token
            words.append(token.replace(ANSI_MARK, ""))
    tainted = _assigned_names([w for w, _ in simple]) | set(outer_tainted)
    for words, ansi in simple:
        _scan_simple(words, depth, tainted, scan, ansi)
    if scan.git_words and (scan.env_alias or (scan.env_risk and (
            len(scan.verbs) != scan.git_words or any(v not in ADMIN_READ_ONLY_GIT for v in scan.verbs)))):
        scan.doubt = True  # an alias through the environment, or a program path, before more than a read
    return scan


def hidden_git_verb(command, depth=0):
    """Round 3 (N5), T296: True when `command` may run git push/merge/pull (or another verb that
    publishes, `PUBLISH_VERBS`) in a form the patterns do not read, or holds a doubt (`_scan_command`).
    Used only in auto mode (a block on doubt). Covers a `$`, brace, glob or quote in the git word, the
    verb or a wrapper chain before it; a redirect between git and its verb; `--attr-source <tree>` and
    the other options with a value; dashed `git-push`; `git` found later in a command, or after an unknown
    head; an alias set by `GIT_CONFIG_COUNT` and its kin; `xargs git`; `eval`; `bash -c '…'`; `env -S`."""
    scan = _scan_command(command, depth)
    return scan.doubt or any(_publishes(v) for v in scan.verbs)


def _remote_main(where):
    """Round 2: the remote's real `main` sha from `git ls-remote origin refs/heads/main` (argv, no
    shell, a 10 s timeout, no prompt), never the local `refs/remotes/origin/main` the model can move.
    None on any failure, a timeout or no answer."""
    try:
        done = subprocess.run(
            # Round 3 (N4): the gate's own call never runs a repo-set upload-pack (an explicit
            # `--upload-pack` wins over `remote.origin.uploadpack`; a `-c` override does not, tested)
            # nor a repo-set proxy. Repo-local `core.sshCommand` was already refused above.
            ["git", "-c", "remote.origin.proxy=", "-C", where, "ls-remote",
             "--upload-pack=git-upload-pack", ADMIN_REMOTE, f"refs/heads/{ADMIN_MAIN_BRANCH}"],
            capture_output=True, text=True, timeout=LS_REMOTE_TIMEOUT_S,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except Exception:
        return None
    words = done.stdout.split() if done.returncode == 0 else []
    return words[0] if len(words) >= 2 and SHA_PATTERN.match(words[0]) and \
        words[1] == f"refs/heads/{ADMIN_MAIN_BRANCH}" else None


def _rev(where, ref):
    done = _git(where, "rev-parse", "--verify", "--quiet", ref)
    sha = done.stdout.strip() if done is not None and done.returncode == 0 else ""
    return sha if SHA_PATTERN.match(sha) else None


def _main_push_refusal(where, merged):
    """P0 (rounds 1-2): why `main` may not be pushed after the merge of branch `merged`, or None.
    Allowed: `main` is the branch tip and contains the remote's real `main` (a fast-forward), or
    `main` is one merge commit whose parents are the remote's real `main` and the tip and whose tree
    is `git merge-tree --write-tree <remote main> <tip>`. Anything else is refused."""
    # T295: `git merge-tree` below runs the repo's own merge drivers, so it cannot tell a tree a
    # driver rewrote; the same repository rule as for the merge is what refuses it. `admin_refusal`
    # already ran this check before it calls here; it is repeated so that a direct call is not open
    # (tested: `test_ac6_main_push_refusal_itself_refuses_a_tree_a_driver_changed`).
    repo_refusal = _admin_repo_refusal(where)
    if repo_refusal:
        return repo_refusal
    remote = _remote_main(where)
    if remote is None:
        return ("cannot read the remote's real `main`: `git ls-remote origin refs/heads/main` "
                "failed, timed out or returned nothing")
    # Round 3 (N8): always the branch, never a tag of the same name.
    merged = merged if merged.startswith("refs/") else f"refs/heads/{merged}"
    tip = _rev(where, f"{merged}^{{commit}}")
    main_sha = _rev(where, f"refs/heads/{ADMIN_MAIN_BRANCH}^{{commit}}")
    if tip is None or main_sha is None:
        return f"cannot resolve `main` or {merged}"
    if main_sha == tip:
        held = _git(where, "merge-base", "--is-ancestor", remote, tip)
        return None if held is not None and held.returncode == 0 else (
            f"`main` is {merged}, which does not contain the remote's `main`")
    parents = _git(where, "rev-list", "--parents", "-n", "1", main_sha)
    if parents is None or parents.returncode != 0 or parents.stdout.split()[1:] != [remote, tip]:
        return (f"`main` carries commits besides the merge of {merged}: it is not one merge commit "
                "of the remote's `main` and the branch tip")
    expected = _git(where, "merge-tree", "--write-tree", remote, tip)
    tree = expected.stdout.split()[0] if expected is not None and expected.returncode == 0 \
        and expected.stdout.split() else ""
    if not SHA_PATTERN.match(tree):
        return ("`git merge-tree --write-tree` failed or found a conflict: push a merge that "
                "resolves a conflict yourself")
    if _rev(where, f"{main_sha}^{{tree}}") != tree:
        return f"the merge commit on `main` changes files the merge of {merged} does not"
    return None


def _named_tasks(text, id_regex):
    """P1: the task IDs `text` names as tasks to do — an ID with a negation before it in its own
    clause ("do NOT merge T900") is left out. A plain reading, not a parser (documented limit)."""
    named = set()
    for match in id_regex.finditer(text or ""):
        start = max((m.end() for m in CLAUSE_END.finditer(text, 0, match.start())), default=0)
        after = CLAUSE_END.search(text, match.end())
        end = after.start() if after else len(text)
        # Round 2 (B9): a negation after the ID in the same clause counts too ("T900 is not ready").
        if not NEGATION.search(text[start:match.start()]) and \
                not NEGATION.search(text[match.end():end]):
            named.add(match.group(0).upper())
    return named


def _guides_added_since(directory, when):
    """P1: the task IDs whose `tasks/TASK_GUIDE_<ID>.md` was first added, on any ref, at or after
    `when`. None when git cannot be read."""
    done = _git(directory, "log", "--all", "--diff-filter=A", "--format=%x00%ct", "--name-only",
                "--", "tasks/")
    if done is None or done.returncode != 0:
        return None
    first, latest = {}, time.time() + FUTURE_SLACK_S
    for chunk in done.stdout.split("\x00")[1:]:
        lines = [l.strip() for l in chunk.splitlines() if l.strip()]
        if not lines or not lines[0].isdigit() or int(lines[0]) > latest:
            continue  # B11: a commit dated in the future is not trusted (the date is git's record)
        for name in lines[1:]:
            hit = re.fullmatch(r"tasks/TASK_GUIDE_([A-Za-z]+-?\d+)\.md", name)
            if hit:
                task = hit.group(1).upper()
                first[task] = min(first.get(task, int(lines[0])), int(lines[0]))
    return {task for task, at in first.items() if at >= when.timestamp()}


def admin_refusal(command, cwd, transcript_path, admin):
    """Why `[admin]` (`admin` = `(timestamp, text)` of the request) does not allow `command`, or
    None when it does. Never raises: an error is a refusal."""
    try:
        when, text = admin
        # Round 2: any `git -c <k>=<v>` (or `--config-env`) before the verb can change what a merge
        # or push runs (`core.hooksPath`) or where it goes, so `[admin]` refuses it.
        git_commands = 0
        for tokens, _, _ in _command_segments(command) or []:
            if tokens and tokens[0] == "git":
                i = 1  # Round 3 (N7): every global option up to the verb, past `-C <dir>` too
                while i < len(tokens) and tokens[i].startswith("-"):
                    if tokens[i].startswith(("-c", "--config-env")):
                        return "`[admin]` refuses `git -c` (or `--config-env`) before merge or push"
                    i += 2 if tokens[i] in GIT_OPTION_ARGS else 1
                verb = tokens[i] if i < len(tokens) else None
                if verb in SAFE_GIT_SUBCOMMANDS and not _read_only_git_args_ok(verb, tokens[i + 1:]):
                    # T296 (P3-4): say why, instead of "cannot tell which branch"
                    if verb in ADMIN_READ_ONLY_GIT:
                        return (f"`git {verb}` carries an option or a glob outside the read-only "
                                "allowlist (`--output=` writes a file, `--ext-diff` runs a program): "
                                "`[admin]` refuses it")
                    return (f"`git {verb}` carries an option outside its short allowlist, and `[admin]` "
                            "allows no git write besides its one merge or push")
                git_commands += 1
        # Round 3 (N1): a chained `git add`/`commit`/`reset`/… runs after this check and could change
        # what the push publishes, so the command holds exactly one git command: its merge or push.
        # T295: no exception either: `git status`, `show`, `diff` and `log` can run a textconv, a
        # clean filter or an external diff, so only `cd <dir> &&` may stand before it.
        if git_commands != 1:
            return ("an `[admin]` command holds exactly one git merge or push, and no other git command "
                    "(run the others in their own command)")
        # Stage 4 fix round: this loop read only a `git` that starts a segment. The scan reads every git
        # word (a redirect before the verb, a dashed `git-push`, `git` after another command), so the two
        # must agree: a doubt, a dashed command or a git write the loop did not count is refused.
        scan = _scan_command(command)
        if scan.doubt:
            return ("`[admin]` refuses a command in which a git word, its verb or a wrapper before it is "
                    "not a plain literal word")
        if any(_basename(w).startswith("git-") for tokens, _, _ in _command_segments(command) or []
               for w in tokens):
            return "`[admin]` refuses a dashed git command (`git-push`): write `git push`"
        if len(scan.verbs) != git_commands:  # T295 counts every git command, T296's scan every git word
            return ("`[admin]` cannot tell which git writes this command holds (a git word that is not "
                    "the first word of a plain segment)")
        actions = _git_actions(command, cwd)
        if not actions:
            return "cannot tell which branch this command merges or pushes"
        id_regex = re.compile(task_id_pattern(ROOT, bounded=True), re.IGNORECASE)
        targets = set()
        for args, where in actions:
            if where is None:
                return "cannot tell which directory this command runs in"
            repo_refusal = _admin_repo_refusal(where)
            if repo_refusal:
                return repo_refusal
            if args[0] == "merge":
                names = [name for _, name in _merge_sources(args[1:], where)]
                if len(names) != 1:
                    return "an `[admin]` merge names exactly one task branch"
                branch = names[0]
            elif args[0] == "push":
                target_refusal = _admin_push_target_refusal(where)
                if target_refusal:
                    return target_refusal
                branch = _admin_push_branch(args[1:], where)
                if branch is None:
                    return ("`[admin]` allows only a plain push of the task branch, or of `main` "
                            "after the task's own merge, to the same branch: no force, no other "
                            "destination")
                own = _own_origin_refusal(where, cwd)
                if own:
                    return own
                if branch == ADMIN_MAIN_BRANCH:
                    # AC 8 / 7b: `main` only after this session's own merge of the task branch,
                    # and only when `main` really holds that branch's tip.
                    merges = _session_admin_merges(transcript_path, when, id_regex)
                    if not merges:
                        return ("a push of `main` needs the task's own `[admin]` merge into `main` "
                                "in this session, after the request")
                    for task_id, merged, merge_where in merges:
                        # Round 3 (N2): the push and the merge are in the same repository.
                        if _common_dir(where) is None or _common_dir(where) != _common_dir(merge_where):
                            return ("the push of `main` and the task's merge are not in the same "
                                    "repository")
                        held = _git(where, "merge-base", "--is-ancestor",
                                    f"refs/heads/{merged}^{{commit}}",
                                    f"refs/heads/{ADMIN_MAIN_BRANCH}^{{commit}}")
                        if held is None or held.returncode != 0:
                            return f"`main` does not hold the merged branch {merged}"
                        refusal = _main_push_refusal(where, merged)
                        if refusal:
                            return refusal
                        targets.add((task_id, merged, merge_where))
                    continue
            else:
                return f"`[admin]` allows only merge and push, not `git {args[0]}`"
            task_id = _ref_task_id(branch, id_regex)
            if task_id is None:
                return f"{branch} names no single task"
            targets.add((task_id, branch, where))
        task_ids = {task_id for task_id, _, _ in targets}
        if len(task_ids) != 1:
            return "an `[admin]` command covers one task only"
        task_id = task_ids.pop()
        if task_id not in _named_tasks(text, id_regex):
            added = _guides_added_since(sorted(targets)[0][2], when)
            if added != {task_id}:
                return (f"{task_id} is not the task of the `[admin]` request: the request does not "
                        "name it, and it is not the one task whose guide was first added after "
                        "the request")
        for _, branch, where in sorted(targets):
            if committed_verify_row(task_id, branch, where, hook_only=True) is not True:
                return (f"{task_id} has no passed auto verify committed on {branch} (a hook-written "
                        "`auto-run by hook` row with its run record for that commit)")
        return None
    except Exception as exc:
        return f"the `[admin]` check failed ({type(exc).__name__})"


def auto_mode_blocker(command, cwd, transcript_path):
    """The block line for a merge, push or pull while the latest request carries `[auto]` or
    `[admin]`, or None (no such request, or `[admin]` allows this command)."""
    latest = auto_mode.latest_request(transcript_path)
    if latest is None or not auto_mode.auto_tagged(latest[1]):
        return None
    admin = auto_mode.admin_request(transcript_path)
    if admin is None:
        return "auto mode (`[auto]`): merge, push and pull stay the user's"
    why = admin_refusal(command, cwd, transcript_path, admin)
    return f"`[admin]` does not allow this command: {why}" if why else None


# --- What to actually do about an unattributed Bash call (T095 defect B) ----
#
# This gate used to end its block with "a Bash command is attributed to a task
# **only** via CLAUDE_ACTIVE_TASK — run the task's verification command as
# `CLAUDE_ACTIVE_TASK=Txxx <command>`". Two things were wrong with it, and it
# was printed at the exact moment an operator is looking for a way out:
#
#   * The mechanism does not work from inside a session. T047 measured it: the
#     harness spawns a hook as a *sibling* process of the tool call, not a child
#     of the command inside it, so the hook inherits the harness's environment
#     and never the subshell a `Bash` call creates. Every record produced under
#     that instruction landed in `_untagged.jsonl`, and this gate then correctly
#     failed closed on it — blocking honest tasks.
#   * "only" was false. The env var *is* a working channel when it is set in the
#     process that launches the session; the state file is a second one, and the
#     only one reachable mid-session. `task_context.py`'s precedence list has
#     carried both since T047.
#
# The wording below is the one already written and proven in
# `craft-spawn-prompt` element 6 and `task_context.py`'s slot 2, condensed —
# deliberately reused rather than re-composed, because a third phrasing of this
# mechanism is exactly how the first two drifted apart. The absolute-path
# requirement is named because it is load-bearing: a sub-agent's cwd is its own
# worktree, so a relative path (or an unset `$CLAUDE_PROJECT_DIR`, which is
# empty inside a `Bash` tool call) silently writes a file the live hook never
# reads. That was T047's own Stage 4 P1 finding.
ATTRIBUTION_REMEDY = (
    "Note: if a task above is missing its trace record rather than its evidence "
    "row, attribute your Bash calls. A sub-agent whose spawn prompt carries "
    "`Task ID: Txxx` or a `tasks/TASK_GUIDE_Txxx.md` path is attributed from its "
    "own transcript and writes nothing. Otherwise write this session's state file "
    "first: `mkdir -p <main-checkout>/.claude/hooks/.state/active_task.d && "
    "printf '%s\\n%s\\n' \"Txxx\" \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > "
    "<main-checkout>/.claude/hooks/.state/active_task.d/$CLAUDE_CODE_SESSION_ID` "
    "— using the literal "
    "absolute path of the main checkout (not $CLAUDE_PROJECT_DIR, which is empty "
    "inside a Bash tool call, and not a relative path, which resolves into your "
    "worktree). Valid for CLAUDE_ACTIVE_TASK_STATE_MAX_AGE_S seconds (default "
    "6h). CLAUDE_ACTIVE_TASK=Txxx <command> does NOT work from inside a session: "
    "a hook is a sibling process of the tool call and never inherits its "
    "subshell (T047). The env var only takes effect when set before the session "
    "starts."
)


def block_unreadable_input(detail):
    """T232 D4: a call this hook cannot read may be a push, so it never passes silently."""
    print(json.dumps({
        "decision": "block",
        "reason": (f"[hook:pre_bash] Hook input unreadable ({detail}) — cannot tell whether this "
                   "call is a push or a merge, so it is blocked. Retry the call."),
    }))
    sys.exit(0)


def main():
    try:
        event = json.load(sys.stdin)
    except Exception as exc:
        block_unreadable_input(type(exc).__name__)

    if not isinstance(event, dict):
        block_unreadable_input("event is not an object")
    if event.get("tool_name") != "Bash":
        sys.exit(0)

    # T250 G1: the folder holding this session's transcript, where a user `/verify` line's own
    # session file is looked up. No path, no folder: such a line never passes.
    global TRANSCRIPTS_DIR
    transcript_path = event.get("transcript_path")
    if isinstance(transcript_path, str) and os.path.isabs(transcript_path):
        TRANSCRIPTS_DIR = os.path.dirname(transcript_path)

    tool_input = event.get("tool_input")
    if not isinstance(tool_input, dict):
        block_unreadable_input("tool_input is not an object")
    command = tool_input.get("command", "")
    if not isinstance(command, str):
        block_unreadable_input("command is not a string")

    # Classify the command, not the data it carries (T095 defect C, T099).
    # Heredocs first, then quoted spans — that order is required, and
    # `strip_quoted_spans`'s docstring says why. A heredoc body is an argument
    # being written to a file, so a `git push` inside one is a mention. A quoted
    # span is a mention only when nothing will execute it: `grep "git push"` is
    # data, `bash -c "git push"` is a push, and the wrapper is what tells them
    # apart. Both strips remove less on any uncertainty, so this composition can
    # only ever over-block — never disarm the gate.
    #
    # Note this is NOT the same call as `invokes_test_runner`'s unconditional
    # `QUOTED_SPAN_PATTERN.sub`, and must not be collapsed into it: there a false
    # negative means "not verified" and refuses the merge; here it would mean
    # "not a push" and wave one through.
    scannable = strip_quoted_spans(strip_heredoc_bodies(command))
    auto_pattern = (any(re.search(p, scannable) for p in AUTO_MODE_PATTERNS)
                    or defines_git_alias(scannable))
    if not auto_pattern:
        # T284 round 3 (N5), T296: in auto mode a git word or verb the patterns cannot read is a block on
        # doubt. It runs whenever the auto-mode patterns do not match (a `rebase` earlier in the command
        # matches a blocked pattern but is no auto-mode pattern, and must not hide the rest). An error in
        # the check is a doubt too: an uncaught exception exits 1, which does not block. Outside auto
        # mode nothing changes.
        try:
            hidden = hidden_git_verb(command)
        except Exception:
            hidden = True
        if hidden:
            latest = auto_mode.latest_request(transcript_path)
            if latest is not None and auto_mode.auto_tagged(latest[1]):
                print(json.dumps({"decision": "block", "reason": (
                    "[hook:pre_bash] Auto-mode gate — cannot push/merge:\n  • cannot tell: the "
                    "command may run git push, merge or pull in a hidden form (a `$`, brace, glob, "
                    "quote, backslash, redirect or backtick between or in the git word and its verb, "
                    "or before it in a wrapper chain such as `env` or `timeout`; a dashed `git-push`; "
                    "`${IFS}`, `$(…)`, `eval`; an alias set in the environment; or a verb that "
                    "publishes such as `send-pack`)\n" + AUTO_MODE_LIMIT)}))
                sys.exit(0)
        if not any(re.search(p, scannable) for p in BLOCKED_PATTERNS):
            sys.exit(0)

    # T284: in auto mode a merge, push or pull is the user's, unless `[admin]` allows this one.
    if auto_pattern:
        auto_block = auto_mode_blocker(command, event.get("cwd"), transcript_path)
        if auto_block:
            print(json.dumps({"decision": "block", "reason": (
                "[hook:pre_bash] Auto-mode gate — cannot push/merge:\n  • " + auto_block
                + "\n" + AUTO_MODE_LIMIT)}))
            sys.exit(0)

    # T157: in board mode `online` the board cache is refreshed before it is evaluated
    # (the pre-merge pull moment). A failed or hanging pull is a warning, and the gate
    # evaluates the cache it already has. Local and unusable configs never pull.
    mode = board_mode(ROOT)
    notes = []
    if mode == "online":
        warning = pull_cache(ROOT)
        if warning:
            print(f"[hook:pre_bash] {warning}", file=sys.stderr)
            notes.append(warning)

    try:
        with open(KANBAN) as f:
            kanban = f.read()
    except FileNotFoundError:
        sys.exit(0)

    def tasks_in_section(section_title, id_pattern=r"T\d+", with_lines=False):
        row_id = re.compile(rf"\*\*({id_pattern})\*\*")
        m = re.search(
            rf"### {re.escape(section_title)}\n(.*?)(?=^###|\Z)", kanban,
            re.DOTALL | re.MULTILINE,
        )
        if not m:
            return []
        block = m.group(1).strip()
        return [(row_id.search(l).group(1), l) if with_lines else row_id.search(l).group(1)
                for l in block.splitlines()
                if l.strip().startswith("- ") and row_id.search(l)]

    # `T\d+`, plus the board's `id_pattern` when `.claude/board.json` sets one (T153).
    id_pattern = task_id_pattern(ROOT)
    in_progress = tasks_in_section("In Progress", id_pattern)
    ready_review = tasks_in_section("Ready for Review", id_pattern)

    # T157 / FR-011: online, the cache holds the whole team's board, so only my In
    # Progress tasks block. Every doubt (`me` unset, a cache that is not a board render,
    # two assignee fields on one row) resolves to blocking. T161: likewise only my Ready
    # for Review tasks (and unassigned ones) are checked for verify evidence; a filter
    # that raises checks every row.
    if mode == "online":
        in_progress, filter_notes = my_blocking_tasks(
            tasks_in_section("In Progress", id_pattern, with_lines=True),
            (load_config(ROOT) or {}).get("me"), kanban)
        try:
            ready_review, review_notes = my_review_tasks(
                tasks_in_section("Ready for Review", id_pattern, with_lines=True),
                (load_config(ROOT) or {}).get("me"), kanban)
        except Exception:
            review_notes = ["the Ready for Review filter failed — every Ready for Review "
                            "task is checked (safe side)"]
        filter_notes = filter_notes + review_notes
        notes.extend(filter_notes)
        for note in filter_notes:
            print(f"[hook:pre_bash] {note}", file=sys.stderr)

    # T197: a push of one task's branch is judged by that task alone, on top of the
    # online filters above, never instead of them. It narrows only when that task is
    # one the gate checks — its row is in In Progress or Ready for Review, and online
    # the filters kept it. Narrowing to any other task (Todo, Done, outside the two
    # lanes, a teammate's row) would empty both lists, so a branch named after it
    # would meet no check at all (Stage 4 finding 4; D3 as revised). An unresolved
    # push, and every such task, keep the whole board (D2).
    scoped = pushed_task_ids(command, event.get("cwd"))
    if scoped is not None and scoped in {tid.upper() for tid in [*in_progress, *ready_review]}:
        in_progress = [tid for tid in in_progress if tid.upper() == scoped]
        ready_review = [tid for tid in ready_review if tid.upper() == scoped]

    # T250 G2: of the In Progress tasks left, only this session's work blocks a merge.
    if in_progress:
        rows = dict(tasks_in_section("In Progress", id_pattern, with_lines=True))
        in_progress = session_owned_in_progress(
            [(tid, rows.get(tid, "")) for tid in in_progress], command, event.get("cwd"),
            event.get("transcript_path"))

    blockers = []

    if in_progress:
        blockers.append(f"Tasks still In Progress: {', '.join(in_progress)}")

    if ready_review:
        # Check each for verify evidence in their task guide
        unverified = []
        failed_rows = []
        uncommitted = []
        # T210 D4: the task branches this command merges or pushes, where they can be resolved;
        # T211 D2: every branch of an octopus merge, and the ones it cannot confirm.
        targets, doubts = branch_targets(command, event.get("cwd"))
        uncommitted.extend(OCTOPUS_DOUBT_MESSAGE.format(branch=branch) for branch in doubts)
        for tid in ready_review:
            # Look for a filled verify row in the Evidence table — in the guide,
            # or in the sibling TASK_REVIEW file it may have moved to (T064) —
            # AND a matching real tool call in the event trace. The text claim
            # alone is not trusted (the model can lie about success). Every
            # absence resolves to False, so this stays fail-closed.
            # T210 D4: for a merged or pushed task, the row must be committed on each of its
            # branches; a branch without it wins, and an unresolvable tip (None) otherwise keeps
            # the working-tree read.
            verdicts = [(committed_verify_row(tid, branch, directory), branch)
                        for task_id, branch, directory in targets if task_id == tid.upper()]
            missing_on = next((branch for found, branch in verdicts if found is False), None)
            committed = (False if missing_on is not None
                         else True if verdicts and all(found for found, _ in verdicts) else None)
            has_evidence_row = has_filled_verify_row(tid) if committed is None else committed
            has_trace = trace_shows_verification(tid)
            if committed is False and has_filled_verify_row(tid):
                uncommitted.append(UNCOMMITTED_ROW_MESSAGE.format(tid=tid, branch=missing_on))
            elif not has_evidence_row or not has_trace:
                unverified.append(tid if has_evidence_row else f"{tid} (no evidence row)")
                if has_evidence_row and not has_trace:
                    unverified[-1] = f"{tid} (evidence row present but no verified tool call in memory/event-trace/{tid}.jsonl)"

            # T190: a companion score row or a UI design row that explicitly
            # reads `☑ fail` is binding. Everything else about those four rows
            # is silent — see the inversion comment above
            # `COMPANION_ROW_NAMES`: this check allows unless a fail is explicit.
            failed_rows.extend(f"{tid} ({row})" for row in failed_companion_rows(tid))
            for advisory in companion_report_advisories(tid):
                print(f"[hook:pre_bash] {advisory}", file=sys.stderr)

        if unverified:
            blockers.append(
                f"Tasks in Ready for Review missing Stage 5 verify evidence: "
                f"{', '.join(unverified)}"
            )

        blockers.extend(uncommitted)

        if failed_rows:
            blockers.append(
                f"Tasks in Ready for Review with an Evidence row marked fail: "
                f"{', '.join(failed_rows)}"
            )

    if blockers:
        result = {
            "decision": "block",
            "reason": (
                "[hook:pre_bash] Pipeline gate failed — cannot push/merge:\n  • "
                + "\n  • ".join(blockers + [f"Board: {n}" for n in notes])
                + "\nComplete Stage 4 review and Stage 5 verify first."
                + "\n  " + ATTRIBUTION_REMEDY
            )
        }
        print(json.dumps(result))

main()

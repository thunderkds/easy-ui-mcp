# Tracks — minimal and extended

> Extracted from `AGENTS.md` (`## Tracks`), which keeps the short rule and points here. Evidence: the
> kit-arms experiment (T175–T177). On 6 small tasks, a 26-line `AGENTS.md` scored 12/12 with 3 stops; the
> full kit scored 12/12 only after 7 stops (5 about its own process) at 2.3× the cost.

Every implementation request goes on one of two tracks:

- **Minimal track** — small, low-risk work. The Supervisor writes the code itself and runs straight
  through: test first, change, a `/simplify` pass, real run. No process stop. It ends with a **Decision record**.
- **Extended track** — big, risky or multi-session work. This is the full Stage 0–5 pipeline
  (`docs/claude-md/pipeline-stages.md`), unchanged.

The rule below picks the track, never how small a task feels.

---

## Track rule

Assign Complexity and Risk as today (the Complexity matrices in `agents/<role>.md`). Then check each row.
If **any** row is true, the task goes on the extended track.

| Condition | Track |
|---|---|
| Complexity C2 or above: 3+ files, a design choice, or a new component | extended |
| Risk Medium or High. A request that touches a risky file counts here even when it looks small: a migration, auth or secrets, a delete of user data | extended |
| The request has a Gate-2 word (*refactor*, *restructure*, *migrate to pattern*, *clean architecture*, *QA suite*, *test coverage*) or the word *migrate* | extended |
| The change deletes, moves, renames or converts user data or its storage format (for example CSV to JSON, or "get rid of the old file"), even when the request does not say *migrate*. This row needs no rating first: the data change alone decides | extended |
| The work clearly spans more than one session, or more than one agent | extended |
| A UI component: the Gate 6 design Evidence rows do not fit a Decision record | extended |

Otherwise the task goes on the **minimal** track: C0 or C1, Risk Low, no Gate-2 word, no change to user data,
one session, one agent, no UI.

---

## Announcement

Before any work, the Supervisor says the track in one line, with the reasons that decided it:

```
Track: minimal — C0, Risk Low, one file, no Gate-2 word
Track: extended — C2 (a new command across 3 files), Risk Medium
```

Then it starts the work at once. The announcement is a statement, not a question: it does not wait for a
reply. The Supervisor must never ask which track, never recommend a lower one. On the extended track it goes
on with the pipeline at once, from the first stage not yet done; a stage is done only when its `## Readiness`
lines in `PROJECT_SPEC.md` are filled (`docs/claude-md/pipeline-stages.md`, "Stage done"), so
scaffold code or a spec file never makes a project "not new".

---

## Switching track

- The user can reply `full` (extended track) or `minimal` at any time, and the Supervisor switches. The
  Supervisor does not prompt for it: never ask which track, never recommend a lower one; the user's `minimal`
  is their own choice.
- The Supervisor may move a task **up** (minimal → extended) mid-task when it finds a row of the rule that
  is true. It says so in one line: `Track: extended — moved up: <reason>`. It never moves a task **down** on
  its own.
- When a task moves up, or when `verify` returns `fail` (not `blocked`), the Supervisor first raises the
  effort of the next spawn by one step on the ladder `low`, `medium`, `high`, `xhigh`, `max`. The count
  starts from the effort of the task's last spawn, whoever set it, even if the cell of its Complexity in
  `## CLI Effort Table` is empty, or, with no spawn yet, from that cell; two failures with a spawn between
  them raise two steps, but two triggers before the same spawn raise one step in total. This comes before it
  changes the model, splits the task or moves any other lever. At `max`, or when the last spawn passed no
  effort and the task has an empty or missing cell, the rule changes nothing and the other levers apply; the
  Supervisor never lowers effort on its own.
- A task grows when it needs more than one file beyond its first estimate, a design choice, or a second
  session. Move it up, then write the task guide from what was learned. The extended track continues from
  Stage 2 with that guide.
- The user says `minimal` for a task that the rule puts on the extended track (for example High risk): the
  Supervisor complies. It states the risk in one line, and the record's `Decisions:` says "track set by the
  user".

---

## Minimal-track flow

The Supervisor runs these steps itself, in one context, straight through. No task guide, no sub-agent, no
Stage 4 skills. In auto mode, the Debate's read-only `Explore` Advocates are one exception
(`## Auto mode`). The read-only reviewers that `simplify` starts in step 4 are the other.

1. **Register.** Take the next task ID and set the active-task state for this session (`.claude/hooks/.state/active_task.d/$CLAUDE_CODE_SESSION_ID`, at the literal absolute path of the main checkout), so the trace hook attributes every call to the task.
2. **Branch.** Work on a new branch for the task, never on `main`.
3. **Test first.** Write a new test that fails for the right reason, and run it to see it fail. Gate 5 holds on this track too: a new test, and its passing output in the record's `Checked:` field.
4. **Change.** Make the smallest change that passes the test. Touch only the code the task needs. Then run `Skill({ skill: "simplify" })` on the branch diff, unless fewer than 20 changed lines lie outside tests and docs. Keep only the edits that change no behavior; if step 5's suite run goes red, undo the edit that broke it. A finding that simplify skips because it reaches outside the diff goes in the record's `Not done:` as a follow-up.
5. **Run it for real.** Run the full test suite. Then run the program the way a user would, and note the command and what it printed.
6. **Record.** Append the Decision record to `tasks/MINIMAL_LOG.md`, newest first, with every field of the template: the `## <ID> — <title> · <track>` heading, `Asked:`, `Decisions:`, `Checked:`, `Files:`, `Not done:`. If the file does not exist, create it from `templates/MINIMAL_LOG_template.md`. The same block is the Supervisor's final chat message.
7. **Board.** Add one board row under Ready for Review in `PROJECT_KANBAN.md`, marked `| Track: minimal | Record: tasks/MINIMAL_LOG.md` at its end. Commit on the task branch without asking: the commit is part of this step.

**The only stop.** When the request itself is unclear (it has more than one reasonable reading), ask one
clear question and stop. Asking is cheaper than undoing a wrong guess. In auto mode, a Debate settles it
instead (`## Auto mode`). A question about a fact in the code is not a stop: read the code and go on.
Asking whether to commit is not a stop either: step 7 commits.

**Backups.** A backup must sit inside the project or in a path the user named, never in `/tmp`: a temp
directory can be gone by the time the user needs it.

**Merge is automatic only under `[admin]`.** The row stays in Ready for Review, so the merge gate blocks every merge, and
every push of the task's own branch, while it is there. The branch merges only when the user asks, or
when the request carried `[admin]` and the auto verify run passed (`### Admin tag`). Stage 5 verify is still mandatory before
any merge: the Supervisor starts the headless auto verify run and reports its verdict
(`### Auto verify (Stop hook)`). You may still run `/verify` yourself. You must run it when that run is
blocked or `CLAUDE_AUTO_VERIFY=off`. Then the Supervisor moves the row to Done and merges. The record's
`Not done:` field always names the merge.

---

## Hard-Stop Gates on the minimal track

| Gate | On the minimal track |
|---|---|
| 1. No TASK_GUIDE = no work | Does not apply: it is scoped to the extended track. |
| 2. Complexity floor | A Gate-2 word puts the task on the extended track (rule row 3). |
| 3. KANBAN current | Applies: step 7 adds the row; the merge moves it to Done. |
| 4. One project per KANBAN | Applies unchanged. |
| 5. No tests = not done | Applies, through the record's `Checked:` field (step 3 and step 5). |
| 6. UI evidence | A UI component puts the task on the extended track (rule row 6). |

---

## Hooks for a task with no guide

`tests/test_tracks.py` pins each of these (AC 6 of T178):

- `pre_bash_block_unsafe_merge.py` — blocks every merge, and every push of the task's own branch, while the
  row is In Progress or Ready for Review. A Decision record is not Evidence, so the row reads
  `(no evidence row)`. The `Track: minimal` marker exempts nothing. Since T197 a push of a branch that names
  exactly one task in In Progress or Ready for Review is judged by that task alone: another session's open
  task does not block it. A merge, a push of a branch named after a Todo, Done or absent task, and every
  push the hook cannot tie to one task (`main`, `release/*`, `--all`, a tag, two IDs in the branch name, an
  unclear `cd`, a `&`, an option it does not know), check the whole board.
- `pre_agent_step_limit.py` — counts the task's calls by the active-task state from step 1, with the same
  limit as any task. A call with no task stays uncounted.
- `post_write_register_task.py` — fires only on a `TASK_GUIDE_*.md` write, so a write to
  `tasks/MINIMAL_LOG.md` leaves the board alone. Step 7 adds the row by hand.
- `stop_review_reminder.py` — lists a `Track: minimal` row as waiting for the user's merge decision, not
  for Stage 4 review.

---

## Board mode `online`

In board mode `online` the record still goes to `tasks/MINIMAL_LOG.md`. The board row goes through
`scripts/board_sync.py` as today. If the board's render drops the `Track: minimal` marker, the stop reminder
lists the row for Stage 4. That is a wrong reminder, not a weaker gate.

---

## Auto mode

The user turns auto mode on with the literal tag `[auto]` anywhere in the request, for example
`move the data from CSV to JSON [auto]`. Only the bracketed tag counts, exactly as written: a bare word
*auto* (for example "add auto-save") or `[Auto]` is not the tag, and the task runs in normal mode. Without
the tag, both tracks behave as the sections above say.

The tag `[admin]` turns on the same auto mode. It also lets the Supervisor merge and push the task's own
branch, but only after the auto verify run passed (`### Admin tag`). `[auto]` alone never does.

In auto mode the Supervisor picks the track by the same rule and runs it to the end without asking the user
anything. Each decision it would have asked about is made by a rule, a Citation or a Debate
(`skills/resolve-question/SKILL.md`), and goes in the **final report**. The track line says so:

```
Track: extended · auto — <reasons>. I won't stop for questions; every decision goes in the final report.
Track: minimal · auto — <reasons>. I won't stop for questions; every decision goes in the final report.
```

**Marker.** The task records auto mode in one line that a hook can read: `Mode: auto`, exactly as written,
alone on its line, outside any HTML comment. On the extended track it is the first line under
`## Auto decisions` in `tasks/TASK_REVIEW_<ID>.md`. On the minimal track it is the line right under the
Decision record's heading. T182's hook keys on this line. Both templates hold the line inside an HTML
comment, so a copied template is not marked.

### Debate size by Risk

The task's **Risk** label sets how every decision that would have been a question to the user is made:

| Risk | Who decides | Advocates |
|---|---|---|
| Low | The Supervisor decides alone and logs `RULE`, `FACT` or `SAFER OPTION` with the reason | none: no Debate |
| Medium | A Debate (`resolve-question`): the Advocates propose, the Supervisor decides by its rules | exactly 2, required |
| High | A Debate (`resolve-question`): the Advocates propose, the Supervisor decides by its rules | exactly 3, required; the third favours the smallest safe thing |

At Risk High, at least one decision is always debated by 3 Advocates: pick the decision with the biggest
effect on the user's data or scope (for example, convert `recurring.csv` too, or leave it). Cited `RULE:`
lines do not replace it; they stay valid for safety actions.

Each Advocate `Agent` call's `description` is `Advocate <n>: <short question>` (for example
`Advocate 1: convert recurring.csv?`) and its `prompt` starts with the template's first line
(`Using the repo, answer alone:`), so the auto-mode check below can count them. A call with only one of the
two is not counted.

Every decision, at every Risk level, has its log line in the final report. This supersedes T179's count
("2, or 3 for 3+ options or High risk") in auto mode. Outside auto mode, `resolve-question` is unchanged.

### Minimal track in auto mode

The one stop of the minimal track (an unclear request) is decided by `### Debate size by Risk`. A
minimal-track task is Risk Low by the track rule, so the Supervisor decides and logs the reason: no
Advocates are required. When the user set the minimal track for a Medium or High risk task, the table's
Advocates are required, and they are one exception to the track's no-sub-agent rule (the other is the `simplify` reviewers of step 4); the Supervisor
starts them (`resolve-question`) and never argues both sides itself. The Decision record carries the
final report: the `Mode: auto` line, each decision with how it was made, and the flag
(`templates/MINIMAL_LOG_template.md`). A minimal-track task has no guide, so it counts its Debates per
session.

### Every user stop and its auto rule

These are all the places where a track waits for the user today: `AGENTS.md`,
`docs/claude-md/pipeline-stages.md` and the skills the stages run. In auto mode each one follows its rule.
`⚠` in the last column means the report line ends with `⚠ decided for you — please review`. "Debate" in
this table follows `### Debate size by Risk`: on a Risk Low task the Supervisor decides alone, and the line
is logged `RULE`, `FACT` or `SAFER OPTION`, not `DEBATED`. At Risk Medium or High, every decision flagged
`⚠` is a Debate, whatever the last column says.

| # | Stop today (where) | Auto rule | Logged as |
|---|---|---|---|
| 1 | Stage 0 step Requirements: the questions and the `PRD.md` confirmation, while `Requirements` or `Approved by` is not filled (`PROJECT_SPEC.md` `## Readiness`; `docs/claude-md/stage0-define.md`) | Answer each question from the request and the repo, with Citations. A question they cannot answer is a Choice question: Debate. | `FACT` / `DEBATED` ⚠ |
| 2 | Stage 0 step Grilling `grill-with-docs`: "Resolve all flagged items with the user" | Answer from the docs and code with Citations. What they cannot answer is a Choice question: Debate. | `FACT` / `DEBATED` ⚠ |
| 3 | `grill-with-docs`: an ADR-eligible decision ("ask the user whether to escalate") | Write the DDR; do not escalate to an ADR (the smaller change). | `SAFER OPTION` ⚠ |
| 4 | Stage 0 step Direction `brainstorming`: the user approves one direction | Take the recommended direction and list the alternatives in the report. | `RULE` ⚠ (taste) |
| 5 | Stage 1 step Environment item 1: one-time setup (`fewer-permission-prompts`, `update-config`, `companion-setup`) | Skip the first two: they change the user's permission settings and hooks. Name them under `Not done:`. `companion-setup` asks nothing and installs nothing: one line under `Not done:`. | `RULE` |
| 6 | Stage 1 step Environment item 2 and `AGENTS.md` `## Multi-CLI Configuration`: the user lists the CLIs and their models | Read the `## CLI Model Table` in `PROJECT_SPEC.md`. No row or an empty cell: row 14. Also read the `## CLI Effort Table`: an empty effort cell means no effort is passed, not a stop. | `FACT` |
| 7 | Stage 1 step Environment item 3: a missing agent guide ("ask the user to save it") | The Supervisor writes it from `templates/` on the task branch. | `RULE` |
| 8 | Stage 1 step Environment item 4: "run `git status` … and paste the output" | The Supervisor runs it itself. | `RULE` |
| 9 | Stage 1 step Environment item 6: the user must save or confirm `PROJECT_SPEC.md` | The Supervisor checks the file, or writes it from `templates/PROJECT_SPEC_template.md`. | `RULE` |
| 10 | Stage 1 step Environment item 8: "Are they correct?" (the domain models) | Record the models the scan found, with their paths. | `FACT` ⚠ (taste) |
| 11 | Stage 1 step Agent team: "Approve or request any modifications?" (the sub-agent team; asked only when `craft-agent` proposes a role beyond the base team) | The base team; `craft-agent` only for a role the base team does not cover. | `RULE` |
| 12 | Stage 2: the user approves the task breakdown and confirms `tasks/` | The Supervisor's own breakdown, labelled by the Complexity matrices. It lists `tasks/` itself. | `RULE` |
| 13 | Stage 2/3: the Requirement Fidelity Gate ("Restated intent confirmed") | Signed `auto (Supervisor)`, not by the user. | `RULE` |
| 14 | Stage 3 `craft-spawn-prompt` returns STOP-and-ask: no CLI named, no `## CLI Model Table` row, or an empty cell | Spawn on the CLI that runs this session, with the model this session runs as. Never invent another CLI's model name. | `SAFER OPTION` ⚠ |
| 15 | Stage 3: a sub-agent reports `Status: blocked` with a `Question:`, or asks to approve its `tdd` plan | `resolve-question`: a Fact question by Citation or Scanners, a Choice question by Debate. The Supervisor approves a `tdd` plan that matches the guide. | `FACT` / `DEBATED` ⚠ / `RULE` |
| 16 | Stage 4 pull moment 3 (board mode `online`): "review against the new version?" | Review against the new version. | `RULE` |
| 17 | Stage 4 item 7: a finding whose fix needs a choice | Debate. | `DEBATED` ⚠ |
| 18 | Stage 5 item 1: `/verify` (never in the Supervisor's own session) | The Supervisor starts the headless auto verify run (T182; every task since T203) with `python3 .claude/hooks/stop_auto_verify.py --start <ID>`, and writes its own real-run check under `Checks:` as `auto-checked, not /verify`. The `verify` Evidence row stays unchecked until that run fills it from a real `/verify`, or the user does: a blocked run falls back to `/verify (yours)`. | `Checks:` / `Not done:` |
| 19 | Stage 5 items 3–6: memory update, merge, Done, `ship` | Memory update: the Supervisor runs the diff-driven pass before it stops, and writes the `Memory:` line. Done: after an auto verify pass, the hook moves the row (`### Auto close-out`). Merge, push and `ship`: never in auto mode, except the merge and push that `[admin]` allows (`### Admin tag`). The task waits in Ready for Review until the hook moves it. | `Memory:` / `Closed:` / `Not done:` |
| 20 | `AGENTS.md` self-monitoring: "want me to compact before continuing?" | Do not ask. Near the session's context or usage limit, stop at a clean point (see Edge cases). | `Paused:` |
| 21 | Minimal track: an unclear request (its one stop) | By `### Debate size by Risk`. At Risk Low (the minimal track's own level) the Supervisor decides the reading and logs why. | `RULE` / `SAFER OPTION` ⚠ |

The skills these rows name keep their own stop text. In auto mode this table wins over it.

**No stage skipped (T223).** Stage 0 and Stage 1 are never skipped as an auto decision: they run, with the
auto rules of rows 1–11. A locked spec or a stand-in like `docs/SPEC.md` is not a reason to skip them;
it is the input step Grilling grills. `Approved by` is never filled by the Supervisor in auto mode: the line
stays empty, so the readiness warning keeps firing until the user confirms. The rule everywhere:
`Approved by` is written only on the user's explicit confirmation, never in auto mode.

### Final report

The final report is the `## Auto decisions` section of `tasks/TASK_REVIEW_<ID>.md` (extended track), or
the Decision record itself (minimal track). It is written to its file before the run ends. If
`tasks/TASK_REVIEW_<ID>.md` does not exist yet, create it from `templates/TASK_REVIEW_template.md`. The
chat message is a copy, not the report. On the extended track, Stage 4 `code-review` still runs before
the run ends, plus `security-review` at Risk Medium or High, because it is not a user stop. Copy the report's shape from `templates/TASK_REVIEW_template.md` or
`templates/MINIMAL_LOG_template.md`:

- `Mode: auto`, then one numbered line per decision: what was decided, then how — `RULE: …`,
  `FACT: <Citation>`, `DEBATED: <option> (Advocate 1: <its proposal>; Advocate 2: <its proposal>)` or
  `SAFER OPTION: …`. Every Debate, safer-option and taste decision ends with
  `⚠ decided for you — please review`.
- Write `DEBATED` only when ≥2 Advocate `Agent` calls ran for that question, naming each Advocate's
  option. A decision with no Advocates is labelled `RULE`, `FACT` or `SAFER OPTION`, never `DEBATED`: the
  Supervisor's own weighing of options is not a Debate.
- A decision flagged `⚠ decided for you` is a choice, and is never labelled `FACT`. A safety action a rule
  requires (for example the backup before a delete) is `RULE` without the flag.
- At Risk Medium or High, every `⚠` line is `DEBATED` with exactly 2 or 3 Advocates named.
- At Risk Medium or High, a `RULE:` counts only when it names a written rule: a repo path with a line or a
  section — `path:line`, `path § <heading>`, or `docs/claude-md/tracks.md` `### <section>`. `FACT:` needs a
  Citation (`path:line "quoted text"`) under the same rule. A `RULE:` or `FACT:` without one counts as a
  choice, so it is `DEBATED` with 2 or 3 Advocates. Good: `2. backed up the CSV before the delete — RULE:
  `docs/claude-md/tracks.md` `### Stops that stay``. Bad: `1. kept recurring.csv untouched — RULE: Surgical Changes`
  (it names no written rule, so it is a choice). Low risk is unchanged.
- `Paused:` — a stop that stayed (below), and why. Only when one paused the task.
- `Checks:` — the tests, the reviews, and the real run, labelled `auto-checked, not /verify`.
- `Memory:` — the diff-driven memory pass (`docs/claude-md/memory-write-protocol.md`), which the
  Supervisor runs before it stops. Name each entry it wrote, or write `Memory: nothing new`. The memory
  writes stay the Supervisor's; no hook writes memory.
- `Not done: merge (yours)` (with `[admin]`: `Not done: merge (admin: after the auto verify pass)`), plus the `/verify` state: `auto verify: running (T182)`, its result, or
  `/verify (yours)` when the hook is not installed, its run was blocked, or `CLAUDE_AUTO_VERIFY=off`.
  When the spawn hook's `⚠ HIGH RISK — project readiness incomplete:` warning fired in the run, the
  same `Not done:` line (never a second one) also names it: `readiness incomplete: <gaps> (yours)` (T223).
- `Closed:` — written by the hook, never by the Supervisor, when it moves the row to Done
  (`### Auto close-out`). When a check stops the move, the hook writes `Paused: done not moved — <reason>`.

The Supervisor's final chat message repeats the block. It is not the `delivery-report` HTML page, and it is
not Evidence: the merge gate does not read it. A Debate also leaves its `DEBATE` line under the guide's
`## Questions Log` (`resolve-question`); the report collects those lines.

### Auto-mode check (Stop hook)

`.claude/hooks/stop_auto_mode_check.py` runs when the Supervisor is about to stop. It finds auto-mode tasks
from the board's In Progress and Ready for Review rows, and also from their files: every
`tasks/TASK_REVIEW_*.md` with `## Auto decisions` or a `Mode: auto` line, and the newest `tasks/MINIMAL_LOG.md`
record with `Mode: auto`. A project with no `PROJECT_KANBAN.md` is still checked. It skips a finished task: one
whose row is in Done, or whose review file has `☑ pass` in its `verify` row's Result cell. It blocks the stop
with a short reason when:

1. the report has no `## Auto decisions` section whose first line is `Mode: auto` (extended), the Decision
   record does not start with `Mode: auto` (minimal), or there is no report file at all;
2. at Risk Medium or High, a choice is not `DEBATED` with exactly 2 or 3 Advocates named. A choice is a `⚠`
   line, a `SAFER OPTION`, or an uncited `RULE:` or `FACT:`: an uncited `RULE:` or `FACT:` counts as a choice.
   The reason gives the decision number and its label, for example decision 1 (`RULE`);
3. the event trace holds fewer Advocate `Agent` calls (description `Advocate <n>:` and a prompt starting
   `Using the repo, answer alone:`) than 2 or 3 per `DEBATED` line;
4. on the extended track, the trace has no `code-review` Skill call, or no `security-review` Skill call at
   Risk Medium or High;
5. at Risk High, no `DEBATED` line names 3 Advocates, or the trace holds fewer than 3 Advocate `Agent`
   calls: `Risk High, but no decision was DEBATED with 3 Advocates`;
6. the report has no `Memory:` line (T189): the memory pass is done before the stop, and recorded;
7. the task's own trace `memory/event-trace/<ID>.jsonl` holds no test run (Gate 5): register the task (minimal-track step 1), rerun its tests, then stop.

A board row counts as auto mode when its report carries `## Auto decisions` or a `Mode: auto` line, when its
Decision record's request carries `[auto]`, or when the task's files changed while a request carrying
`[auto]` was this session's latest user request (T229: up to the next request without the tag; tool
results, task notifications and `!` commands are not requests). Since T250, a task whose files changed in that window counts as this session's auto work only when this session (or one of its sub-agents) worked on it, by `.claude/hooks/lib/session_work.py`. Since T252 the same rule also applies to an extended-track task whose report is already marked auto mode (`Mode: auto`): if this session did not work on it, the check skips it and writes one stderr note. A minimal-track task whose Decision record is marked is still checked, because work in the main checkout cannot be told apart from the transcript. A transcript that cannot be read, or an ownership answer that cannot be told, keeps the check (fail closed). A task this session ran in `[auto]`, and the user then `/resume`d into a new session id, is not checked in the new session, because that session did not work on it; the session that ran it was already checked at its own stop (T252, accepted gap). Risk comes from the guide's `**Risk Level**`, else the review file, else the board
row, else Low; a Decision record is Risk Low unless it says otherwise. The trace is `memory/event-trace/<ID>.jsonl` plus the last 6 hours of
`memory/event-trace/_untagged.jsonl` (`CLAUDE_AUTO_CHECK_WINDOW_S`): Advocate prompts carry no task ID, so
their calls land in `_untagged.jsonl` unless the active-task state file is set.
Since T287, two more signals find the work. First, the trace hook files a `Bash` call that runs in a task's
worktree under that task, before the session's active-task file. It does so only for the exact form
`cd <dir> && cmd [&& cmd]...`, where `<dir>` is an existing, searchable directory inside a worktree whose
branch names the task (`fix/t120-x`). Every command after the `cd`, and every command after a `|`, must start
with one word of a fixed list: `pytest`, `py.test`, `python`/`python3` (only as `-m pytest`, `-m unittest` or a
relative script path), `git` (without `-C`, `--git-dir`, `--work-tree`, with no global option except one that takes no value
(`--no-pager`, `-P`, `--paginate`, `--no-optional-locks` and the like; `-c` and every option that takes a value
are refused), and only with a reading verb such as
`status`, `log`, `diff`, `show`, `rev-parse`, `ls-files` or `grep`, or `add`, `commit`, or `branch` to list), `ls`,
`echo`, `cat`, `head`, `tail`, `grep`, `wc`, `true`, and `timeout <n>` before one of these. Any other form is not filed by its directory, and
the session's active-task file decides, as before. That covers any other first word (`env`, `make`, `xargs`,
`find`, `sudo`, `bash`, `sh`, `zsh`, `chdir`, `time`, a path to a program) and: a `;`, `||`, newline, `&` or pipe after the `cd`, a second
`cd` (`cd -` too), `builtin`, `command`, `eval`, `exec`, `source`, `pushd`, `popd`, a shell keyword
(`if`, `while`, `for`, `time`, `!`, `{`, `function`), a leading `VAR=` before a word, a heredoc `<<`, `$`,
backticks, a `{` or `}` (brace expansion), a `*`, `?` or `[` outside quotes (a glob), a `#` comment, a directory that does not exist or is a file, the main checkout, a directory that is
no worktree, a `~`, `..` or `CDPATH` target, and an argument that names `..` or an absolute path outside the
worktree (`--rootdir <main>`), an inline-code flag (`-c`, `-e`, `-lc`), an argument that holds a quote
or paren next to a `/` (`os.chdir('/home')`), an argument `-` or `+N`/`-N` (zsh `cd -`, `cd -2`; `head`, `tail`
and `git` may take `-N`), an `@file` argument, a relative path whose real path leaves the worktree (a symlink
to main), and a control character or non-ASCII space anywhere. A call with no `cd` is not filed by the session's directory. So a test run in
the worktree counts for item 7 and for the auto close-out. Second, items 3 and 5 also count the Advocate calls this session
made after a `resolve-question` Skill call whose last top-level `task=<ID>` names the task, wherever the trace
filed them. Only a call that ran counts: its result in the transcript is not an error. The check uses the
larger count. It reads only this session's transcript files: it skips symlinks and entries with another
session's id.

Since T293 a Debate counts only from the start of its task's change window. The Skill call and each Advocate must be dated at or after the first change of the task's files in this session: the earliest call that `lib/session_work.py` counts as work on the task, the same test T250 uses. A Debate before that start does not count; a missing or unparsable timestamp does not count. There is no upper bound. A task with no recorded change window keeps the whole-session rule: no dated change was found, the transcript could not be read, or the reader failed (one stderr line). The Advocate trace records obey the same window: a record in `<ID>.jsonl` or `_untagged.jsonl` counts only when it is dated at or after the start, and a missing or unparsable date does not count. A Debate that runs before any file of the task changes is therefore not counted: make the first change to a task file (the guide, the review file or the failing test in its worktree) before the Debate. When the Stop check pauses a task and the transcript held Debate calls before the start, the reason ends with `(a Debate was found before the task's first change in this session; rerun it after the first change)`.

It never loops: on the second fire (`stop_hook_active`) it allows the stop and appends
`Paused: auto-mode check failed — <reasons>` to the report, ending in a stamp, `[report <stamp>]`. The
stamp is a hash of the report block, not counting its `Paused:`, `Closed:`, `Not done:` and `- verify:` lines. A task whose last
`Paused:` line carries the stamp of the report as it is now, or carries no stamp (a line from before
T186; the hook stamps it once, on first sight), is paused: the first fire does not block it again. After you edit the report, the task is checked
again. The hook reads and writes `Paused:` lines only outside HTML comments. A second fire adds a new `Paused:` line only when its reasons differ from the last line's. With the
same reasons it only refreshes that line's stamp. Unreadable files fail open, with one line on
stderr. It does not read or write Evidence: the merge gate is unchanged.

### Auto verify (Stop hook)

`.claude/hooks/stop_auto_verify.py` runs the real `/verify` in a separate headless session, so the
Supervisor never runs it in its own session. Since T203 it runs for **every task**, with or without
`[auto]`, on **both tracks** (T188). It acts on a task only when all of these hold:

1. The task's row is in `### Ready for Review` on `PROJECT_KANBAN.md`.
2. The task has a report file: `tasks/TASK_REVIEW_<ID>.md` with a `verify` Evidence row on the extended
   track, or the task's own record in `tasks/MINIMAL_LOG.md` with a `Checked:` field on the minimal track.
   A task without one gets one line on stderr and no run.
3. Its result is empty, or holds an earlier auto run for other code.

There are two ways in, and they share one lock:

- **The Supervisor starts it.** Right after it moves a task to Ready for Review, the Supervisor runs
  `python3 .claude/hooks/stop_auto_verify.py --start <ID>`. The command checks the three conditions above
  for that task, starts the run, prints the log path and returns at once (exit 0). When it starts nothing,
  it prints one line that says why and exits 1: the task is not at Ready for Review, its result is already
  filled for this commit, or a run for this commit already started. The Supervisor then waits for the run
  (it watches the log or the result) and puts the verdict in its reply or final report.
- **The Stop hook is the backstop.** It fires when the Supervisor stops and does the same for every task on
  the board.

Both read the main checkout's board only. Run from a linked worktree, they start nothing and say so in one
line. A task's report is read from its worktree first, so the run uses the task's own code and head commit,
never a placeholder copy on main. The worktree is the one whose branch the task's board row names
(`Started …: branch `<name>``). If the row names no branch, exactly one worktree whose branch names the task
may be used. With none or several, nothing starts and one line says the checkout is ambiguous. The order of
`git worktree list` never decides.

`CLAUDE_AUTO_VERIFY=off` turns this back to the T182 rule. Then only a task whose report has the
`Mode: auto` line runs, through the hook and through `--start`. Every other task's `/verify` stays yours.
The default is on. Each run costs at most `CLAUDE_AUTO_VERIFY_BUDGET_USD` (default 2), so several tasks at
Ready for Review at once cost up to that much each.

`.claude/hooks/lib/auto_mode.py` is the one reader of which tasks those are, which track each one is on, and
which file holds its report. The auto-mode check above reads the same module, so the two hooks can never
disagree about which tasks are in auto mode.

The hook then starts one new headless session in the task's checkout (the main checkout or its worktree):
`claude -p "/verify <ID>" --max-budget-usd 2 --output-format json`. The session uses your normal permission
settings, never `--dangerously-skip-permissions`. The hook returns at once: the run is detached in its own
session (`setsid`). `CLAUDE_AUTO_VERIFY_BUDGET_USD` changes the budget, and `CLAUDE_AUTO_VERIFY_TIMEOUT_S`
the time limit (default 1800). The run writes its output to `.claude/verify-runs/<ID>-<commit>.log`
(gitignored) — the same path and the same one-run-per-commit lock on both tracks. One task and commit run
once: to run again on the same commit, delete that log. A commit that changes only the file holding the
task's result counts as the same code.

When the run ends, the hook, never the Supervisor, writes three things:

- A run record, in the directory that `.claude/settings.json` denies agents write access to (the trace
  anchors' directory, `~/.claude/harness-anchors/`).
- The result, where that track keeps its evidence:
  - **extended track** — the `verify` Evidence row: `☑ pass`, `☑ fail` or `☐ blocked`, with the Notes
    `auto-run by hook, session <id>, commit <sha>, log .claude/verify-runs/<file> — <pass|fail|blocked>`.
    A docs-only skip is `☑ pass` with the Notes
    `auto-run by hook, session <id>, commit <sha>, log <file>, skip (no runtime surface: <paths>) — pass`.
  - **minimal track** — one line under the Decision record's `Checked:` field, in the same shape:
    `- verify: ☑ pass — auto-run by hook, session <id>, commit <sha>, log .claude/verify-runs/<file>`
    (a docs-only skip ends `log <file>, skip (no runtime surface: <paths>)`). A
    `Checked:` line you wrote is never edited or removed.
- The report's `Not done:` auto verify slot, so the report you read stops saying
  `auto verify: running (T182)` after the run ended. It becomes
  `auto verify: ☑ pass (session <id>, commit <sha>, log .claude/verify-runs/<file>)` (a docs-only skip adds
  `, skip (no runtime surface)` after the result), in
  `## Auto decisions` (extended) or the record's `**Not done:**` line (minimal). The merge clause is left
  exactly as it is. A slot you wrote by hand is left alone, and the reason goes in the run log.

Only a verdict line of the skill's result sets the result. The line starts with the bold label and names one
word, `PASS`, `FAIL` or `SKIP`, in one of four shapes: `**Verdict:** PASS`, `**Verdict: PASS**`,
`**Verdict: PASS. <sentence>**` or `**Verdict**: PASS`. A line that lists choices (`**Verdict:** PASS | FAIL | BLOCKED | SKIP`,
`PASS / FAIL`, `PASS or fail`, `PASS - FAIL`; a second verdict word in any case, after `|`, `/`, `,`, a dash, `or` or `and`) is not a verdict and is ignored, so the blank report template never reads as a
pass. The parser fails closed: anything it does not recognise is `blocked`. Each of these is
`blocked`: a BLOCKED verdict, no verdict line, a budget stop, a timeout, or no `claude` on the PATH. A lone
SKIP verdict is `blocked` too, unless the hook proves from git that the task has no runtime surface (below).
A blocked result never contains the word "pass". The hook never overwrites a row or a line you filled. The
merge gate accepts an `auto-run by hook` row — or a minimal-track `verify:` line — only when its run record
exists for that task and the head commit, and says pass. A hand-typed line in a Decision record counts for
nothing, except one shape (T250). When the run is blocked and you run `/verify <ID>` yourself on the minimal
track, its pass goes under `Checked:` as
`- verify: ☑ pass — /verify by the user, session <id>, commit <sha>`. `<id>` is the session you typed
`/verify` in, and `<sha>` is the full 40-character commit you verified. The gate does not accept the line on its text alone.
It accepts the line only when that session's transcript (in the same folder as the merging session's) holds
your own `/verify <ID>` entry, dated after `<sha>` was committed and before the line was committed, and
`<sha>` is the same code as the head (only `tasks/MINIMAL_LOG.md` may differ). A missing transcript, a short
hash or other code: not a pass. The hook never edits or removes this line, and `--start` starts nothing for
it. A blocked hook line above it for other code still gets a new run, and that run rewrites only the hook's
line. After a pass, the same run closes out a task whose report has the `Mode: auto` line (`### Auto close-out`).
A task without it stays in Ready for Review after its pass, and the Supervisor moves it to Done as before.
The merge stays yours, unless the request carried `[admin]` (`### Admin tag`). You may still run `/verify` yourself at any time; when the run is blocked, you must.

**A task with no runtime surface (T289).** A lone SKIP verdict is a pass in one case. The hook, never the
model, asks git: it lists the files the task's branch changed since it left `main`
(`git diff` from the one merge-base of `main` and the head commit, renames off). When every file is in
this list, the hook writes `☑ pass` with the Notes
`auto-run by hook, session <id>, commit <sha>, log <file>, skip (no runtime surface: <paths>) — pass`
(minimal track: the same words in the `verify:` line), and a run record that says `skip-pass` and names the
`base` commit:

- `.md`, `.txt` and `.gitkeep` files under `tasks/`, `memory/` and `docs/`, except `docs/claude-md/`,
  `memory/MEMORY.md` and `tasks/TASK_GUIDE_*` (they steer agents and hooks). `tasks/TASK_REVIEW_*.md` and
  `tasks/MINIMAL_LOG.md` stay in;
- under `tests/` and `.claude/hooks/tests/`: `test_*.py` files and `tests/fixtures/`, but never a
  `conftest.py`, a `.sh` file, `tests/lib/` or `merge_gate_guard.py`;
- a `*.md` file in the repository root, except `AGENTS.md`, `CLAUDE.md`, `CLAUDE_LEGACY.md`,
  `PROJECT_KANBAN.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN_SITE.md` and `PROJECT_SPEC_SITE.md`.

Everything else has a runtime surface, for example `skills/`, `agents/`, `templates/`,
`docs/claude-md/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `lib/`, `scripts/`, `site/`, code, and a `.py`,
`.sh` or `.html` file under `tasks/`, `memory/` or `docs/`. An accepted risk: a `test_*.py` file still runs
at the next pytest collection. The list
is one literal tuple in `.claude/hooks/lib/verify_record.py`. Any doubt keeps `blocked`: one path outside
the list, an empty diff, a missing `main`, two merge-bases, a range git cannot read, a rename (the old
path counts), a symlink or a submodule, or a file name with unusual characters. A PASS or FAIL verdict is
handled as before, and a FAIL never becomes a pass. The merge gate does not trust the record's word: it
repeats the path check from git, between the record's `base` and its commit, before it accepts a
`skip-pass` record. Every git read of the check runs with `GIT_NO_REPLACE_OBJECTS=1`, so a `git replace`
ref cannot show a fake commit.

### Auto close-out

After an auto verify **pass**, the same detached run closes the task out (T189,
`.claude/hooks/lib/auto_closeout.py`). It moves the task's row from `### Ready for Review` to `### Done`.
It is not a merge: the branch stays unmerged, and the merge, the push and `ship` stay yours (with `[admin]`, see
`### Admin tag` for the merge and the push). A `fail` or
`blocked` result leaves the row where it is.

The run moves the row only when all three checks hold:

1. **The run record proves the pass.** The record for that task and the head commit exists and says pass
   (or `skip-pass`, `### Auto verify (Stop hook)`), for the session that ran. The merge gate's own rule accepts the result. A hand-typed `auto-run by hook`
   result never moves a row.
2. **Hard-Stop Gates 5 and 6 hold.** The tests row is `☑ pass` with pasted output (minimal track: a
   `New test` line under `Checked:`), and the trace holds a real test run. Each of the three UI design
   rows is `☑ pass` with evidence, or N/A with a written reason. A task with no UI writes `☐ N/A` and a
   reason in all three. Auto mode never skips a Hard-Stop Gate.
3. **The report is complete.** It holds `Mode: auto`, at least one numbered decision line, `Checks:`
   (minimal: `**Checked:**`), `Memory:`, the `Not done:` auto verify slot with its result, and a
   `Not done:` line that still names the merge. A field that still holds a template `<...>` placeholder
   counts as missing. The report is the only account of a run that nobody watched, so it is a check,
   not a summary.

When all three hold, the run writes
`Closed: row moved to Done <date> — auto verify pass (session <id>, commit <sha>); Gates 5 and 6 checked`
into the report. It reads the report again, then moves the row: `- [ ]` becomes `- [x]`, the row goes to
the top of `### Done`, and it gains `Done <date>: auto verify pass (session <id>, commit <sha>)`. Nothing
else in the row changes. `**Last updated**` at the top of the board gets that date.

When a check fails, the row stays in Ready for Review. The run log says `done not moved: <reason>` or
`report incomplete: <field>`, and the report gains `Paused: done not moved — <reason>`, so the report
names what still waits for you. A failed Gate 5 or 6 check also adds `done not moved: <reason>` to the
end of the hook-written result.

Each line is added once. A line you wrote is never changed. The board in the main checkout is the
registry: the run reads it again just before the write and finds the row by its task ID. A row you
already moved is left alone. The run issues no git command that writes, and it writes no memory file.

### Stops that stay

Even in auto mode, the Supervisor pauses the task, with one message that says why, for:

- a safety-hook block;
- an action that deletes or overwrites data with no backup;
- the 4th Debate in a task (the `resolve-question` cap);
- a paid action outside the task's own work;
- a login or secret the Supervisor does not have;
- the same sub-agent hitting the step limit twice.

The pause also goes in the final report, on its `Paused:` line.

### Never in auto mode

With `[auto]`, these stay the user's:

- merge;
- pull;
- push;
- `ship`.

With `[admin]`, the Supervisor may also do the first two, only as `### Admin tag` says. `ship` stays the
user's with both tags. The memory pass and the move to Done are automatic: see `### Final report`
(`Memory:`) and `### Auto close-out`.

### Admin tag

The user writes the literal tag `[admin]` in a request, for example `add the CSV export [admin]`. The task
runs in auto mode, exactly as with `[auto]`: the same report, the same `Mode: auto` marker, the same hooks.
`[Admin]`, `[ADMIN]`, `[administrator]` and a bare word *admin* are not the tag. `[auto][admin]` is one
admin request.

The tag adds one thing: the Supervisor may merge the task branch and push it, after the auto verify run
passed. The merge gate, `.claude/hooks/pre_bash_block_unsafe_merge.py`, reads the tag at the time of the
command, from this session's transcript. It allows a `git merge` or `git push` only when all of these hold:

1. The session's latest request is text the user typed, and it holds `[admin]` outside code spans and
   outside `>` quoted lines. The tag in a tool result, a fetched page, a file, a PR comment, a branch name,
   a commit message or a sub-agent's prompt does not count. A later request without the tag ends it. A
   tag typed in another session does not count.
2. The command merges one task branch (`git merge <branch>`), or pushes a branch to the same branch name
   (`git push origin <branch>`, `git push -u origin HEAD`), on the remote `origin` only (for a bare
   `git push`, `branch.<b>.pushRemote`, `remote.pushDefault` and `branch.<b>.remote` are unset or
   `origin`). The push URL of `origin` must equal its fetch URL, and no `url.<x>.insteadOf`,
   `url.<x>.pushInsteadOf`, `remote.<name>.pushurl`, `remote.<name>.receivepack`, `push.followTags` or
   `core.hooksPath` may be set. Any `git -c <key>=<value>` (or `--config-env`) anywhere before the verb,
   also after `-C <dir>`, is refused. The command holds exactly one git command, its merge or its push:
   a chained `git add`, `commit`, `reset`, `tag`, `checkout`, `status`, `show`, `diff`, `log` or any other
   git command is refused (`status`, `show`, `diff` and `log` can run a textconv, a clean filter or an
   external diff), while `cd <dir> &&` may stay. 
   A `git merge` option that takes a value (`--message`/`-m`, `--file`/`-F`, `--strategy`/`-s`,
   `--strategy-option`/`-X`, `--cleanup`, `--into-name`, also in git's abbreviated and run-together forms
   such as `--mess` and `-qm`) never gives the branch name. The git word and the verb must be plain
   literal words (the rule for hidden forms is in the limit below that starts `In auto mode`). Every word
   of the command whose name is `git`, or `git-<verb>` such as `git-push`, is a git word: the `[admin]`
   check reads all of them, so a second one that hides behind a redirect (`git >/dev/null push -f origin
   main`) or a dashed name is refused, and any dashed git command is refused. A branch push goes only to
   the repository's own remote: after `cd <clone>`, the clone's `origin` must be the same repository or
   have the same URL (a local path is resolved first, so a symlink or `../origin.git` to the same
   repository matches) as the origin of the directory the command started in or of the project.
   The gate reads the repo config and the worktree config as
   an allowlist (T295): every key must be on this short list of keys that cannot run code or reach another
   host, or the gate refuses and names the key: `core.repositoryformatversion`, `core.filemode`,
   `core.bare`, `core.logallrefupdates`, `core.ignorecase`, `core.precomposeunicode`, `core.autocrlf`,
   `core.safecrlf`, `core.symlinks`, `remote.<name>.url` (no helper `::` form, no leading `-`, one
   URL per remote: git pushes to each one),
   `remote.<name>.fetch`, `branch.<b>.remote`, `branch.<b>.merge`, `branch.<b>.vscode-merge-base`,
   `pull.rebase` (`true` or `false`), `push.default` (`simple` or `current`), `user.name`, `user.email`
   and `extensions.worktreeConfig`. Any other key refuses, for example `merge.<d>.driver`,
   `filter.<f>.smudge`, `diff.<d>.textconv`, `diff.external`, `gpg.program`, `core.editor`, `core.pager`,
   `credential.helper`, `http.proxy`, `include.*`, `url.*`, `alias.*` and `core.fsmonitor`. The hooks
   directory must hold no executable file, whatever its name; a `.sample` file is not a hook. No
   `.gitattributes` of the checkout and no `.git/info/attributes` may have a line with `merge=`, `filter=`
   or `diff=`, read as git reads it (after a quoted pattern too); a FIFO or other file that is not a
   regular file refuses. A file in `.git/remotes/` or `.git/branches/` refuses. For a push to a local
   path or `file://` `origin`, the gate reads that target too (it never runs it): an executable hook
   there (its `core.hooksPath` included) or `receive.denyCurrentBranch=updateInstead` refuses.
   User-global and system config are trusted and not read.
   It may also push `main` (`git push origin main`; the rule names `main` only), but only after this
   session's own `[admin]` merge of the task branch: the merge call is in the transcript after the
   request, its result is not an error, it ran with `main` checked out, and it ran in the same
   repository as the push (the same `git rev-parse --git-common-dir`). The gate then reads the
   remote's real `main` with `git ls-remote origin refs/heads/main` (never the local `origin/main` ref)
   and allows only two shapes: `main` is the branch tip and contains the remote's `main` (a
   fast-forward), or `main` is one merge commit whose parents are the remote's `main` and the branch tip
   and whose tree equals `git merge-tree --write-tree` of those two. If `ls-remote` fails, times out or
   returns nothing, or `merge-tree` fails or finds a conflict, the push is blocked: a merge that resolves
   a conflict is yours to push. A force push (`-f`, `--force`, `--force-with-lease`, `+<branch>`), a push
   of any other ref, another remote, `--no-verify`, `--all`, `--tags`, a `git pull` and an octopus merge
   stay blocked.
3. The branch names the task of the request: the request text names the task ID, and no negation such as
   "not" or "don't" stands before it in its clause; or the task is the one task whose
   `tasks/TASK_GUIDE_<ID>.md` was first added to the repo after the request. The date is git's own
   record of the commit, and a commit dated more than 60 seconds in the future is ignored. A negation
   after the ID in the same clause ("T900 is not ready", "T900 must wait") also leaves it out. Work that
   only names an existing task (an edit, a `touch`, an `Agent` spawn) does not make it the request's task.
4. The branch tip commits the hook-written `auto-run by hook` verify result for the task, with its run
   record for that commit, and the result says pass. A hand-typed pass row does not count. A `skip-pass`
   record counts only because the gate repeats the docs-only path check from git.

With `[admin]`, the Supervisor starts the run itself: as soon as the task is at Ready for Review, it runs
`python3 .claude/hooks/stop_auto_verify.py --start <ID>` and waits for the verdict. It never runs `/verify` in
its own session. Only on a pass does it go on to merge and push, without asking. On `blocked` or
`fail` it merges nothing and reports why. A task that changes only files with no runtime surface (docs, task
files, memory, tests: `### Auto verify (Stop hook)`) gets a pass when the run answers `skip`, so it needs no
typed `/verify`. A `skip` for any other task is `blocked`: its `/verify` then falls back to you.

The gate's other checks then still run, as for every merge. `ship` stays the user's with `[admin]` too.
With `[auto]` alone, the same gate blocks every merge, push and pull while that request is the latest
one. A `git rebase` is not part of this rule. A session with no readable transcript has no known request,
so this rule does not apply and the gate works as before.

Known limits:

- The gate cannot tell typed text from pasted text inside your own message. An `[admin]` in text you
  paste without a code fence or a `>` quote is part of your message, so it counts.
- **An agent can still forge the transcript that carries `[admin]`.** The gate reads the tag from this
  session's `<id>.jsonl` in the transcripts folder, so an agent that appends a human-origin line to it can
  forge the request. This is the same trust root as the transcript that proves your `/verify`
  (`### Known limits`): `.claude/settings.json` denies agents `Edit(~/.claude/projects/**/*.jsonl)` and
  `Bash(*.claude/projects/*)`, which raises the bar and is not a proof.
- The negation check is a plain reading of the clause before a task ID, not a parser: "do NOT merge
  T900" does not bind T900, but a negation phrased another way may be missed. Name only the task you
  want merged.
- For the gate, only an entry marked as typed by a human is a request: an entry with no origin, or a
  sub-agent's prompt, neither ends an `[auto]` request nor carries `[admin]`.
- `[admin]` is a guard against accidents, not against a hostile repo or a hostile agent.
- The gate treats a heredoc body as data only when it can prove the body is data (T294, an allowlist).
  Everything before the `<<` and on its header line must be plain: words, `; & | < >`, and balanced
  quoted strings with no `$`, backtick or backslash in them. The text before the header holds no `$`,
  backslash, backtick, bracket, brace, `#` or `&>`, and no whitespace but space, tab and newline. The
  header is `<<` or `<<-`, then a plain-word tag, then a space, a newline or one of `; & | < >`. The
  terminator is an exact line. An unquoted tag whose body holds `$`, a backtick or a backslash is not
  stripped, because the shell expands it. The one nested form is the commit form
  `git commit -m "$(cat <<'EOF'` newline … `EOF` newline `)"` (also after `gh pr create --body`), with a
  quoted tag, and only as the value of an option: the word before it is `-m`, `-F`, `-b`, `-t` (also in a
  cluster such as `-am`), `--message`, `--msg`, `--body`, `--title`, `--notes`, `--description`, `--file`,
  `--body-file` or `--notes-file`, then a space or `=`. After `)"` the line is empty, or holds a space, a tab
  or `;` and then tokens that do not start with `|`, `$`, a backtick or `<` and name no shell word. So
  `"$(cat <<'EOF'` … `)" push origin main` (the substitution is the command word), `git "$(cat <<'EOF'` …
  (the subcommand), `x="$(cat …)"` and `echo "$(cat …)" | sh` keep their text. A header line that ends in
  `|`, `|&`, `&&` or `||` keeps its text too (the next line is the other side of the pipe). A glob character
  `*` or `?` before the header keeps the text (`/bin/ba?h <<'EOF'` is `bash`). A quoted span behind a data command such as `echo` is kept when it holds `$(` or a backtick, because the substitution runs (`echo "$(git push)"`). Any other `<<` keeps the text after it as command text, in every mode, and ends all
  further stripping in that command: `echo "<<EOF"` followed by `git push --force origin main` is
  blocked. A heredoc that feeds a shell or an interpreter keeps its body as command text, because the
  shell runs it: `bash`, `sh`, `zsh`, `dash`, `ash`, `rbash`, `busybox`, `ksh`, `mksh`, `pdksh`, `csh`,
  `tcsh`, `fish`, `source`, `eval`, `ssh`, `xargs`, `perl`, `node`, `nodejs`, `ruby`, `php`, `lua`, `awk`,
  `gawk`, `ed`, `ex`, `tclsh`, `make`, `expect`, `parallel`, `at`, a `/proc/…` path (`/proc/self/exe` is
  the shell itself) and `env -S…`, anywhere on the header line or before it. When the scan cannot tell, it keeps the text. The
  cost is over-blocking: a push named in the body of a heredoc written as `cd "$WT" && cat > f <<'EOF'`
  (a `$VAR` in the prefix), `echo $(pwd) > f <<EOF`, `(cat <<EOF` (a subshell), `cat &> f <<EOF`, a
  command after `#`, or a heredoc inside `$(…)`, a backtick or `<(…)` (other than the commit form) is
  blocked like a push. Write the body to a file with a plain header, or put `git push` out of the body.
  Still not handled: `eval "…"`, `bash -c '…'` and an interpreter argument stay visible as quoted text
  (which the gate reads under its own quoted-span rule), and a body that an interpreter runs
  (`python3 - <<'EOF'` with `os.system("git push")` inside) is data to this scan, as before. These shapes
  are accepted limits, found by the third adversarial review (T294 round 4), and the scan does not
  follow them: a script file written by a heredoc and run later (`cat > r.sh <<'EOF'` … `EOF` newline
  `sh r.sh`); a heredoc on a file descriptor that a later shell reads (`exec 3<<EOF` … `EOF` newline
  `bash <&3`, `exec 0<<'EOF'`); a fifo; `read -r l; eval "$l"`; a renamed shell (`ln -s /bin/bash b2`, then
  `./b2 <<'EOF'`); `python3 -` and `python -`. A substitution that builds the command word or the subcommand (`"$(cat <<'EOF'` `git` … `)" push origin main`,
  `git "$(cat <<'EOF'` `push` … `)" --force origin main`) keeps its text in the scan, but the gate does not see a
  verb that a substitution builds: that is the hidden-verb limit above, the same as without a heredoc. A header followed on the NEXT command by a shell word
  (`cat <<EOF &` newline `bash`) is also a limit. Not tested: macOS bash 3.2 and bash older than 5.2 may
  close a `$(…)` early on a `)` inside the body of a nested heredoc (suspected, not confirmed). The seeded
  fuzz `.claude/hooks/tests/test_heredoc_fuzz.py` compares the scan with bash and zsh: a line it shows a
  shell running and the scan hiding is a bug.
- The repo rule of item 2 is an allowlist, and it reads the repository at the time of the command.
  A key, hook or attributes line added after that check (a hook another process writes) is out of its
  reach. The gate does not scan the `.gitattributes` of the incoming branch: a merge that brings one in
  is read only by the next `[admin]` command. A `.gitattributes` with `filter=lfs` refuses `[admin]`,
  because the gate cannot tell a safe filter from an unsafe one.
- A local-path or `file://` `origin` runs programs on this machine when you push to it. The gate refuses
  an executable hook in that target and `updateInstead`. It does not stop the other work that target
  does after the push, such as its own `git gc --auto`, and it does not read a network `origin`. A remote
  with a second `url` entry is refused, because git pushes to every URL; the count includes a `url` in
  user-global or system config. A `url` that starts with `-` or `::`, or has the `@-` or `://-` form, is
  refused too.
- The refusals are wide on purpose and may stop an ordinary repo: a `.gitattributes` line with any
  `filter=`, `diff=` or `merge=` driver (including the built-in `diff=markdown` and `merge=union`) and
  one in an ignored or vendored directory; any executable file in `.git/hooks` (such as `pre-commit`);
  a local config key off the allowlist (such as `submodule.active`, `init.defaultBranch`,
  `branch.<b>.pushRemote`); a `file://localhost/…` URL; a path that holds `%`. The refusal text says the
  key "can run a command or send git elsewhere" even when it cannot. Remove the line or key, or push
  yourself.
- The run record the gate trusts is a file in the trace anchors' directory
  (`.claude/hooks/lib/verify_record.py`), the same trust root as for `/verify`.
- Repo config the gate does not read, such as a `core.hooksPath` hook run by `git commit`, and a model
  that runs git through `python3 -c` or a script, are out of the gate's reach (the T211 limit).
- `git merge -s ours` publishes nothing unverified, but it drops the task's changes from `main`.
- A `tool_result` with no `is_error` field counts as a result that is not an error.
- The remote `origin` itself is trusted: the gate checks that its push URL equals its fetch URL, not
  that the URL is the one you meant. `git remote set-url origin <other>` changes both, so it passes.
- In auto mode (`[auto]` or `[admin]`), a command with a git word or a git verb that is not a plain
  literal word is blocked, because the gate cannot tell what it runs (T296). Every word whose name is `git`
  or `git-<verb>` is a git word, wherever it stands in the command, and a git word whose verb cannot be read
  is a doubt, and a doubt is a block. That covers a `$`, backtick, brace or glob in the git word or its verb
  (`v=push; git $v`, `git ${v}sh`, `git {p..p}ush`, `git $'push'`, `{git,push} origin b`, and `$g push`
  when the same command sets `g` or the name says git, `$GIT push`); the
  same in a wrapper chain before it (`env`, `timeout`, `nice`, `sudo`, `nohup`, `xargs`, `command`), also
  with `env -S'…'`; a redirect between git and its verb (`git >/dev/null push`, and `>|`, `>>|`, `<>`, `>&`,
  `<&`, `&>>`, `2>|` the same: none of them is a pipe); a global option with a value, which hides the verb
  (`git --attr-source HEAD push`: read as a push), also when its value is an empty quoted word
  (`git -C '' "push"`); `git` after an unknown command (`flock /tmp/l /usr/bin/git "push"`); `xargs` before
  a git word that has no verb, wherever `xargs` stands (`xargs git`, `env xargs git`, `busybox xargs git`:
  the verb may come on stdin); a dashed command in a command position (`/usr/lib/git-core/git-push`,
  `git-send-pack`, also after `find -exec`; `man git-push` is a name, not a command); an alias set in the
  environment (`GIT_CONFIG_COUNT` or `GIT_CONFIG_PARAMETERS` with a value, `GIT_CONFIG_KEY_*`,
  `GIT_CONFIG_VALUE_*`, `GIT_EXEC_PATH`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`) in a command that names
  git, unless every git verb in it is `status`, `log`, `diff`, `show` or `rev-parse` and `GIT_CONFIG_COUNT`
  and `GIT_CONFIG_PARAMETERS` are empty (`GIT_CONFIG_GLOBAL=/dev/null git status` passes); an ANSI-C
  `$'…'` or locale `$"…"` quote in a simple command that also holds a publishing verb, a brace expansion, a
  hex or octal escape or a git verb that is not `add`, `commit`, `status`, `log`, `diff` or `show`, or in a
  `-c` string; an ANSI-C quote with `\'` inside it, and a backtick span with an odd number of quotes (the
  shell and shlex end the quote in different places); a head word that says git once its variables are cut
  out (`$GIT`, `${G:-git}`, `g${E}it`) or that globs to it (`gi?`); `function f { git push; }`;
  `eval`; a `bash -c '…'` string read the same way; a
  line continuation in the git word; a quote or backslash that hides the verb (`git "push"`, `g''it push`,
  `git p\ush`); `${IFS}`, `$(…)`, a backtick in a segment that names git; and a verb that publishes
  without being `push` (`git send-pack`, `http-push`, `receive-pack`, `remote-ext`, `subtree`, `svn`, `p4`,
  `cvsexportcommit`). The check runs whenever the command holds no plain merge, push or pull, so a `git
  rebase` earlier in the command does not skip it. An error in the check is a block. Outside auto mode
  these forms behave as before (except that `--attr-source` and `--super-prefix` are now read as options
  with a value). What it does not see:
  - A git alias set in config (`git pp`), a script (`bash push.sh`), a git command that runs another
    (`git submodule foreach`, `git rebase --exec`), `python3 -c`, `su -c`, `script -c` and `busybox sh -c`.
  - A shell that reads its program from a heredoc, here-string or pipe: `bash <<'E'` + newline +
    `git push origin b` + newline + `E`, `echo 'git push origin b' | sh`, `bash <<< '…'`. The heredoc case
    overlaps T294.
  - A command that builds a git command from data: `$(echo 'git push origin b')` and a backtick form.
  - Word splitting of a variable (bash only): `g=git\ push; $g origin b`.
  - A variable set outside the command: `$g $v origin b` and `$g push origin b`, with `g` and `v` set earlier
    in the profile. The tool shell keeps no variables between calls, and a variable the same command sets
    (`g=git; $g …`) is read, and so is a name that says git (`$GIT push`). The rule that would catch the
    rest also blocks `$PY -m pytest "$f"` and `$DOCKER push registry/img`.
  - Deliberate obfuscation (round 3 of the T296 review; the gate guards against an accident, not against a
    hostile agent, so these are not chased). An unknown wrapper before a hidden word: `flock /tmp/l $'git' push
    origin b`, `strace -f {git,} push origin`, `taskset 1 bash -c 'git "push" origin b'`, `find . -exec $'git' push
    origin b \;`, `busybox env $'git' push`, `flock /tmp/l git-push origin b` (a dashed name counts only in a
    command position); `g=git; flock /tmp/l $g push origin b`; `env -S` with an exotic split (`env -S'git'
    push origin b`, `env -S "git\_push\_origin\_b"`, `env -vS 'git "push" b'`); a shell alias (`shopt -s
    expand_aliases; alias g=git; g push origin b`); `${G:-git}`, `g${E}it`, `{git,}` and a glob after an
    unknown wrapper (`strace g${E}it pull`, `busybox setsid {git,} push`); a `\$` inside a double-quoted
    `-c` string (`bash -c "\$'\x67it' merge b"`, which shlex does not unescape). A fuzz run of 35000
    commands against a stand-in git let 2848 publishes through before round 3 and 147 after it, 133 of
    them behind an unknown wrapper.
  - `GIT_CONFIG_*` set in the profile or by the harness.
  - The own-remote rule trusts the directory the command starts in: the shell's working directory is
    carried from an earlier call, so a call that starts in a clone with another `origin` is judged against
    that clone. A clone's `origin` URL is compared after its local path is resolved, and not otherwise (an
    `ssh` URL and the `https` URL of the same host are different).
- The gate is a static check of the command text and of the repo config at the time of the command. It
  is not an airtight security boundary: user-global config, a script that calls git, and a hook or
  config added between the check and the push are out of its reach.

### The Supervisor never

- runs `/verify` or writes its `verify` Evidence row (only T182's hook writes it). The Supervisor starts
  the headless run with `--start <ID>`; it never runs the skill in its own session. The merge gate cannot
  tell who wrote the row, so this rule is doctrine: the Supervisor's own check goes under `Checks:`, never
  in the `verify` row. The one exception the gate can check is an `auto-run by hook` row: it needs the
  hook's run record (`### Auto verify (Stop hook)`);
- moves a task to Done (only the hook does, `### Auto close-out`);
- moves a task down a track.

### Edge cases

- `[auto]` with "ask me before X" in the same request: the explicit ask wins for X. Everything else is
  auto.
- A minimal-track task that moves up mid-task stays in auto mode on the extended
  track, and the report says when it moved.
- A sub-agent reports `Status: blocked` with a Choice question: a Debate settles it, not the user.
- The session nears its usage limit: stop at a clean point, write the final report so far, and say what is left.
- Two `[auto]` tasks in one session: each task has its own report and its own Debate count.

### Known limits

Read these before you rely on `[auto]`. T180 left them open, on purpose. T186 records them.

- **A repo with no git remote.** The `security-review` skill needs an `origin/HEAD` ref. In a repo with
  no git remote, the Supervisor may add a temporary `refs/remotes/origin/HEAD` so the skill can start. It
  removes the ref afterwards and logs both steps in the final report. Without that ref, the skill cannot
  start, and the auto-mode check pauses a Medium or High risk task (you accepted this on 2026-10-27).
- **Two auto tasks in one session can share evidence.** The auto-mode check counts the Advocate and
  Skill calls in `memory/event-trace/_untagged.jsonl` from the last 6 hours for every task. Advocate
  prompts carry no task ID. A second task can be credited with the first task's Advocates or reviews.
- **The Stop check finds misfiled work by two signals only (T287).** A `Bash` call of the exact form
  `cd <dir> && cmd [&& cmd]...` whose `<dir>` is a task's worktree is filed under the task. Any other form is
  not (see `### Auto-mode check (Stop hook)`). An Advocate call counts for the task that the Debate's
  `resolve-question` call names with `task=<ID>`, if it is dated at or after the task's first change in this
  session (T293). Other work filed under another task is still not found.
  Examples: a test run in the main checkout while the session's active-task file names another task; a
  `code-review` or `security-review` Skill call made then; a Debate whose `resolve-question` call names no
  task; a test run after a `cd` that uses `;`, or from a session that was already in the worktree.
  Point the session at the task (minimal-track step 1) before you work on it. Ten more limits:
  - The filing proves where the command started, not what it ran. Inline code (`python3 -c`, `bash -c`,
    `node -e`, `perl -e`, `ruby -e`) is refused, but a script file in the worktree that does its own `cd`,
    or a symlink inside the worktree that points to main, is not seen. An agent that wants to mislead the
    check can, so the trace is not a proof.
  - A worktree of this repo on any branch whose name contains the task ID is credited to that task (C9):
    `fix/t120-x` and `scratch/t120` both name T120.
  - A runner that reads paths from a file or from standard input (`xargs`, N13) is not allowed as a first word,
    so it is not filed. A path that a script or config file in the worktree reads is not seen.
  - zsh's `autocd` (a bare directory name as a command) is not on in the tool shell. This is theoretical: if it
    were, `cd <wt> && ../main` would change directory, and the first-word list refuses `../main`.
  - A call that renames or switches the worktree's branch is not filed by the branch it ends on (T296). The
    trace hook runs after the command and reads the branch then, so `cd <wt> && git branch -m fix/t900-x && ...`
    would be filed under T900. A `git` word is therefore filed only with a reading verb, `add`, `commit`, or
    `branch` to list; `branch -m`, `checkout`, `switch`, `symbolic-ref` and `rebase` are not, and the session's
    active-task file decides.
  - The merge gate's `invokes_test_runner` (older than T287, not changed here) counts a runner named in a
    heredoc body, or on the far side of `||` (`true || python3 -m pytest`), as a test run. The filing rules
    above keep such a call out of a worktree's trace, but a call filed by the session's active-task file
    still passes the gate that way. A quote the shell and shlex end in different places desyncs it too:
    `echo $'\' ; pytest ; \''` counts `pytest` as a test run (older than T296; the hidden-verb scan
    reads `$'…'` itself, this reader does not).
  - A file planted in this session's transcript folder with this session's id is still read; only the
    `.claude/settings.json` deny rules (T251) protect that folder.
  - A Debate counts only from the task's first change in this session (T293). A Debate that ran before the
    task's first change does not count, even in the same session: the task's window starts at the first
    call that `session_work.py` sees as work on it. A change it cannot see (a path held in a shell variable,
    code passed to an interpreter, work in the main checkout of a minimal-track task) leaves the task
    with no window or a later one: with no window, every Debate of the session counts, as before T293.
    There is no upper bound, so a Debate after the task's last change still counts. Times of the work and of the
    Debate come from the transcript, and the trace's Advocate records follow the same rule with the trace
    hook's own timestamp. No time comes from git or file times, so clock skew with them does not matter.
  - A session that resumes a task and writes the report must rerun the Debate (T293). The Advocate records
    of an earlier session now fall before the window of the task's first change in the new session, and
    that session's transcript is not read, so they do not count.
  - The window reader does not skip symlinks and does not filter `sessionId` (T293). It uses
    `session_work._session_files`, shared with the merge gate (T250), which reads every
    `subagents/agent-*.jsonl` under this session's folder. A transcript file planted or linked there, with
    an early work call for the task, moves the window start earlier, so an older Debate counts again. It is
    the same trust root as the planted-file limit above (T251): only the `.claude/settings.json` deny rules
    protect the folder.
- **A `skip-pass` rests on the local `main` ref (T289).** The path check judges the branch against
  `refs/heads/main`, a mutable local ref: `git update-ref refs/heads/main <a commit with the branch's runtime
  change>` makes that change part of "main" and the diff look docs-only. This is part of the T182 record
  trust root: a model that can run git and write the run record's directory can already forge a pass. No
  network check is added. `_main_push_refusal` (`git ls-remote origin refs/heads/main`, a fast-forward or
  the exact merge) does not close this. It stops a push of a `main` that differs from the branch tip. It does
  not stop this case: local `main` is moved to a runtime commit C1, the docs-only branch (C1 plus C2) is
  merged by fast-forward, and the push publishes C1, because `main` equals the branch tip and the remote's
  `main` is an ancestor. So the limit also covers a push that publishes the commits below the branch's own
  docs-only tip. Before you trust `[admin]` for a docs-only task, read the diff from `origin/main` to the
  branch tip yourself. The remedy is not to move local `main` by hand (`update-ref`, `reset`).
- **A hand-typed `☑ pass` in the `verify` row ends the check.** The auto-mode check skips a review file
  whose `verify` row says `☑ pass`, so an agent that types that row ends the run unchecked. The merge
  gate still blocks a hand-typed row at merge: it accepts only a row with an `auto-run by hook` run
  record.
- **At Risk High, one Debate is enough.** The check forces at least one Debate with 3 Advocates, not
  one Debate per choice. A decision can still hide behind a loosely related cited `RULE:`, as long as one
  other decision is debated. Read the `RULE:` lines of a High risk report yourself.
- **A paused task is not checked again until its report changes.** If the report block does not change,
  the check does not block the task a second time, even when a later trace would give different
  reasons. Edit the report to have the task checked again.
- **A parallel session's marked minimal-track record can block your stop.** The ownership rule (T250,
  T252) does not apply to a minimal-track task whose Decision record is marked auto mode. A record in
  `tasks/MINIMAL_LOG.md` that fails a check still blocks this session's stop, even when this session did
  not work on it. Fix the record, or wait for the other session to finish it.
- **The Stop check cannot see every kind of work.** The ownership rule (T250, T252) reads the session's
  Edit, Write, Bash and Agent calls (`.claude/hooks/lib/session_work.py`). Work that it cannot see does
  not count. Examples: code passed to an interpreter in one quoted argument (`python3 -c "…"`), a path
  held in a shell variable, a heredoc fed to an interpreter, and a script that writes a task file
  without naming it. If this kind of work is the only work a session did on a task, the Stop check does
  not check that task at stop. This was already true since T250 for a task found by file time. T252
  extends it to a marked extended-track report. The Stop check is a reminder to finish the report, not a
  security boundary: the merge gate and the auto verify still apply.
- **An agent can still forge the transcript that proves your `/verify`, in three ways the rules miss.**
  The merge gate reads the proof for the line `- verify: ☑ pass — /verify by the user, session <id>,
  commit <sha>` from `<id>.jsonl` in the transcripts folder. Since T251, `.claude/settings.json` denies
  agents `Edit(~/.claude/projects/**/*.jsonl)` (the Edit and Write tools) and `Bash(*.claude/projects/*)`
  (any command that names that folder). The Bash rule matches the command text only, so it also refuses
  a command that merely names the folder, for example a `grep` over a repo file that holds the string
  `.claude/projects/`; read such a file with the Read tool. This is the same trust level as the run records in the trace
  anchors' directory (`.claude/hooks/lib/verify_record.py` lines 14–17): it raises the bar, it is not a
  proof. The rules do not cover:
  - A custom `CLAUDE_CONFIG_DIR`, for example `~/.claude-<name>/projects/`. The rules name only the
    default `~/.claude/projects/`. To cover another folder, add the same two rules with that path to your
    own `~/.claude*/settings.json`. The kit does not write your user settings.
  - A command that builds the path at run time. The Bash rule matches the command text, so a command that
    joins the folder name from parts is not stopped.
  - You. The rules stop the agent's tools, not the human operator and not a process outside Claude Code.
  The rules stop an agent's `ls`, `grep` and `cat` on that folder too. To read a transcript, use the
  Read tool. The hooks are not stopped, because they read transcripts in Python, not through a tool call.
- **The proof shows that you typed `/verify <ID>`, not that it passed.** The transcript entry shows only
  that you ran `/verify <ID>` for that code. It does not show the verdict. Read the verdict yourself
  before you merge.

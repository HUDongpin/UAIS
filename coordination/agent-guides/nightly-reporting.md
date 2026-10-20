# Nightly coordination and reporting reference

Read only for assigned overnight or coordinated reporting work. The [main contract](../../AGENTS.md) governs scope and authorization; [session ownership](session-ownership.md) helps split actual parallel assignments. Templates are available for those workflows, not mandatory artifacts for ordinary tasks.

## Nightly AI Coordination Meeting

Use this workflow only when the owner assigns overnight work. It does not activate for ordinary tasks that happen to run at night. This is an asynchronous coordination meeting through session logs, blocker reports, handoff notes, and S10's morning synthesis; it does not require live meetings or messages to others.

Default reporting window:

- Previous day 08:00-current day 08:00 Asia/Hong_Kong: S10 or the reporting automation summarizes AI session work, risks, blockers, test status, and decisions needed.
- 08:00 Asia/Hong_Kong: reporting window closes for the daily president report.
- 07:45 Asia/Hong_Kong: assigned agents stop starting large new edits and complete handoff notes for inclusion when practical.
- 07:50-08:00 Asia/Hong_Kong: S10 reviews logs, blockers, changed files, and check results.
- 08:00 Asia/Hong_Kong: S10 or a Codex automation produces the DOCX president report for Dr. Peter Hu.

Participation rules:

1. Only sessions explicitly assigned by the owner for that night may write feature code.
2. Unassigned sessions may be referenced in logs or reports, but they do not write code or make decisions.
3. S10 is the meeting secretary, quality coordinator, and president-report owner.
4. S10 may read every session log and blocker report, but should not edit another session's log except as part of the morning report process.
5. S10's default write scope for nightly coordination is `coordination/`, docs, config, and reports; S10 must not implement feature work inside non-S10 session scopes unless the owner explicitly assigns that work.
6. If no work or assignment exists in the previous-day-08:00-to-current-day-08:00 reporting window, S10's report should state `No assigned work in this reporting window` and summarize only the latest available project status.

Nightly meeting rhythm:

1. 00:00 kickoff: S10 checks the owner's assignments, confirms each assigned session's write scope, and notes any obvious scope conflicts.
2. 02:30 checkpoint: assigned agents record current progress, risks, changed files so far, and any scope or dependency conflict.
3. 05:30 checkpoint: assigned agents prioritize blockers, test status, cross-role dependencies, and any work that must stop before morning.
4. 07:45 handoff: assigned agents finish their Agent Daily Work Report entries and avoid starting broad new changes.
5. 07:50-08:00 synthesis: S10 reads session logs and blockers from the reporting window, inspects project status, runs safe checks when practical, and writes the president report.

Nightly outputs:

- Agent daily work reports: `coordination/session-logs/YYYY-MM-DD-SXX.md`
- Blocker reports when needed: `coordination/blockers/YYYY-MM-DD-SXX.md`
- President report for Dr. Peter Hu: `coordination/reports/YYYY-MM-DD-president-report.docx`

For blockers, apply the scope and stop conditions in [AGENTS.md](../../AGENTS.md#scope-and-execution).

## 8 AM President Report

This section applies only to an assigned president-report task or an existing authorized reporting automation; the time of day alone does not start it. For that assignment, at 8:00 AM Asia/Hong_Kong time S10 or the automation should create a concise, business-formatted bilingual DOCX president report for Dr. Peter Hu covering the reporting window from the previous calendar day at 08:00 to the report date at 08:00 Asia/Hong_Kong. Creating the local report does not authorize sending it to anyone.

The report should be generated from:

- Session logs in `coordination/session-logs/` relevant to the reporting window, with earlier entries only when needed to explain an unresolved blocker or the latest available status.
- Relevant blocker reports in `coordination/blockers/`.
- Current project files changed during the reporting window.
- Available check outputs from each session.
- Fresh checks run by the report owner when practical.

The report should summarize:

- Chinese Executive Summary.
- English Executive Summary.
- Reporting-window summary.
- Overall project progress.
- Completed work by session.
- In-progress work.
- Blockers.
- Risks.
- Test/build status.
- Files changed.
- Tomorrow priorities.
- Owner decisions needed.

The final artifact should be `coordination/reports/YYYY-MM-DD-president-report.docx`, with simple business formatting: clear title metadata, concise bilingual executive summaries, readable tables, restrained typography, and no decorative layout. A temporary Markdown outline may be used only as an intermediate working artifact; the deliverable for Dr. Peter Hu is the DOCX file.

Only when the owner requests creating or changing a recurring report, use the supported automation tool and first check for an existing matching automation to avoid duplicates. This guide does not itself authorize scheduling. Preserve the owner's notification preference. For an authorized daily 8:00 AM Asia/Hong_Kong reporting automation, use a prompt like:

```text
Every day at 8:00 AM Asia/Hong_Kong, inspect /Volumes/Starship/UAIS. Read AGENTS.md and coordination/agent-guides/nightly-reporting.md, collect the latest session logs and blockers from coordination/, inspect the project status, run safe relevant checks when practical, and produce a concise bilingual DOCX president report for Dr. Peter Hu at coordination/reports/YYYY-MM-DD-president-report.docx. The reporting window is previous calendar day 08:00 through report date 08:00 Asia/Hong_Kong. The report must include a Chinese Executive Summary, English Executive Summary, reporting-window summary, project progress update, S01-S25 session status table, blockers, risks, test/build status, files changed, tomorrow priorities, and owner decisions needed. Use simple business formatting with readable tables and restrained typography. If no assignment or fresh work is found in the reporting window, state "No assigned work in this reporting window" and summarize the latest available project status. Do not edit feature code.
```

Do not ask the automation to edit feature code unless the owner explicitly assigns that work. The morning automation's default job is reporting and triage.

## Templates

### Session Assignment Template

```markdown
# Session Assignment

- Date:
- Session ID:
- Workstream:
- Objective:
- Allowed write scope:
- Forbidden write scope:
- Acceptance criteria:
- Required checks:
- Stop conditions:
- Notes from owner:
```

### Nightly Assignment Template

Use this when the owner assigns night work before resting.

```markdown
# Nightly Assignment

- Date:
- Night work window: 00:00-08:00 Asia/Hong_Kong
- President-report window: Previous day 08:00-current day 08:00 Asia/Hong_Kong
- Assigned sessions:
- Meeting secretary: S10
- Reporting deadline: 8:00 AM Asia/Hong_Kong

## Session Packages

| Session | Workstream | Objective | Allowed write scope | Forbidden write scope | Acceptance criteria | Required checks | Stop conditions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SXX |  |  |  |  |  |  |  |

## Cross-Session Notes

- Shared files reserved tonight:
- Known dependencies:
- Owner priorities:
- Decisions already made:
```

### Session Handoff Template

```markdown
# Session Handoff

- Date:
- Session ID:
- Workstream:
- Status: Completed | In progress | Blocked
- Summary:
- Files changed:
- Checks run:
- Checks not run:
- Assumptions:
- Blockers:
- Risks:
- Follow-up recommendations:
- Next suggested owner/session:
```

### Agent Daily Work Report Template

For assigned nightly or daily-report coordination, append this to the agent's own `coordination/session-logs/YYYY-MM-DD-SXX.md` before stopping. It is not a required artifact for an ordinary single-task edit or diagnosis.

```markdown
# Agent Daily Work Report

- Date:
- Session ID:
- Workstream:
- Status: Completed | In progress | Blocked
- Objective:
- Summary of work completed:
- Files changed:
- Checks run:
- Checks not run:
- Blockers:
- Risks:
- Assumptions:
- Coordination notes for other sessions:
- Follow-up recommendations:
- Next suggested owner/session:
```

### Blocker Report Template

```markdown
# Blocker Report

- Date:
- Session ID:
- Task:
- Blocker type: Architecture | Scope conflict | Secret/credential | Missing requirement | Merge conflict | Dependency change | Other
- What happened:
- Files involved:
- Why the session stopped:
- Decision needed from owner:
- Safe next step:
```

### President Report DOCX Content Template

Use this content order for the DOCX president report. The DOCX should be concise, bilingual, and business-formatted with clear headings, readable tables, and restrained typography.

```text
President Report

Report date:
Report time: 8:00 AM Asia/Hong_Kong
Project: UAIS
Reporting session: S10
Audience: Dr. Peter Hu
Reporting window: Previous day 08:00-current day 08:00 Asia/Hong_Kong

中文 Executive Summary

用中文简要说明项目健康度、报告窗口内是否推进、最重要成果、最大风险，以及今天最需要 Dr. Peter Hu 决策的事项。

English Executive Summary

Briefly summarize project health, whether work in the reporting window moved the project forward, the most important outcomes, the largest risks, and decisions needed from Dr. Peter Hu.

Reporting Window Summary

Assigned sessions:
Sessions active:
No assigned work in this reporting window: Yes | No
Coordination highlights:
Cross-session dependencies:

Project Progress

Short summary of current product progress, quality status, and whether the work improved speed, quality, or readiness.

Session Results

Create a table with columns:
Session | Status | Completed | In progress | Blockers | Files changed | Checks

Include rows for S01 through S25.

Completed Work

-

In-Progress Work

-

Blockers

-

Risks

-

Test and Build Status

`npm run lint`:
`npm run test`:
`npm run build`:
Other checks:

Files Changed

-

Recommended Priorities

1.
2.
3.

Owner Decisions Needed

-
```

## Quick Start For Tonight

Use these steps only for an owner-assigned overnight work package.

1. Pick only the sessions you want to run, for example `S02`, `S04`, `S05`, `S08`, and `S11`.
2. Give each selected session one package using the Nightly Assignment Template.
3. Keep write scopes separate. Example: do not assign both `S04` and `S08` to edit `src/data/uais.ts` overnight unless one finishes and hands off before the other starts.
4. Tell each selected session to create or update its own log in `coordination/session-logs/`.
5. Tell S10 to act as meeting secretary and prepare `coordination/reports/YYYY-MM-DD-president-report.docx`.
6. If no assignment is given, the 8:00 AM report should say `No assigned work in this reporting window`.

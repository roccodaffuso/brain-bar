---
name: brainbar-agent-trace
description: Emit metadata-only BrainBar Agent Activity events while working on local notes or project files.
---

# BrainBar Agent Activity Trace

Use this skill when working on local project files or local vault notes that BrainBar can visualize.

BrainBar shows recent local agent activity on the graph. Emit compact metadata events for meaningful reads, writes, creates, deletes, focus changes, opens, graph refreshes, closeouts, and decisions.

## Contract

- Metadata only: path, action, agent, timestamp, optional reason/status. Schema v2 also supports explicit `workflow_id`, `workflow_title`, and `path_role` (`source` or `output`).
- Never infer a workflow or path role; omit `path_role` for a touched-path entry.
- Never record note contents, prompts, raw transcripts, stdout/stderr, secrets, credentials, cache files, build artifacts, temporary files, or files under `.git`.
- Do not emit events for every tiny filesystem touch. Use events for meaningful files that shaped the task or were intentionally changed.
- Prefer relative paths when operating inside a project or vault. Absolute paths are acceptable when needed for disambiguation.

## Helper

Preferred helper locations:

1. `~/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace`
2. `/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace`

Set `BRAINBAR_TRACE` to override the helper path if needed.

## Supported Actions

Use one of:

`read`, `write`, `create`, `delete`, `focus`, `open`, `graph_refresh`, `closeout`, `decision`

## Examples

```bash
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" read "Notes/Example.md" --agent claude --reason "loaded project context"
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" write "Notes/Example.md" --agent claude --reason "updated summary"
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" focus "Notes/Example.md" --agent claude --reason "active working note"
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" write "Notes/Example.md" --agent claude --workflow-id "review-42" --workflow-title "Review notes" --path-role output
```

If the helper is missing, skip tracing silently and continue the task.

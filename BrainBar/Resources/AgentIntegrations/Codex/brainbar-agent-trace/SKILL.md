---
name: brainbar-agent-trace
description: Emit metadata-only BrainBar Agent Activity events while working on local notes or project files.
---

# BrainBar Agent Activity Trace

Use this skill when working in a local vault or project that BrainBar visualizes and the task involves reading, writing, focusing, closing out, or making decisions around durable files.

## Contract

- Emit metadata only: action, path, timestamp, agent, and optional reason/session/project/source/node id/status. Schema v2 additionally accepts explicit `workflow_id`, `workflow_title`, and `path_role` (`source` or `output`).
- Do not infer workflow or path roles. Omit `path_role` for a chronological touched-path entry.
- Never emit note contents, prompts, transcripts, stdout/stderr, secrets, credentials, temporary files, build artifacts, caches, or raw private conversations.
- Skip tracing for files under `.git`, build directories, temporary directories, dependency caches, or files that appear secret-like.

## Helper

Preferred helper locations:

1. `~/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace`
2. `/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace`

Set `BRAINBAR_TRACE` to override the helper path.

## Usage

Call the helper only for meaningful activity:

```sh
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" read "Notes/Example.md" --reason "loaded project context"
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" write "Notes/Example.md" --reason "updated summary"
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" focus "Notes/Example.md" --reason "active working note"
"${BRAINBAR_TRACE:-$HOME/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace}" write "Notes/Example.md" --workflow-id "review-42" --workflow-title "Review notes" --path-role output
```

Supported actions: `read`, `write`, `create`, `delete`, `focus`, `open`, `graph_refresh`, `closeout`, `decision`.

If the helper is missing, continue the task normally and mention that BrainBar tracing is unavailable.

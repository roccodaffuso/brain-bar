# BrainBar Configuration

BrainBar stores local configuration at:

```text
~/Library/Application Support/BrainBar/config.json
```

Development and tests can override the path with `BRAIN_BAR_CONFIG`.

```sh
BRAIN_BAR_CONFIG=/tmp/brainbar-config.json open ~/Applications/BrainBar.app
```

## Default Shape

```json
{
  "commands": {
    "brainCheck": null,
    "refreshGraph": {
      "arguments": ["update", "."],
      "executable": "graphify",
      "workingDirectory": "vault"
    }
  },
  "graphHtmlRelativePath": "graphify-out/graph.html",
  "graphReportRelativePath": "graphify-out/GRAPH_REPORT.md",
  "notificationsEnabled": false,
  "projectDashboardRelativePath": "Project Dashboard.md",
  "reviewQueue": {
    "backgroundWatcherEnabled": false,
    "isEnabled": false,
    "manualCommand": null,
    "preflightCommand": null,
    "timeoutSeconds": 10,
    "watcherIntervalSeconds": 300
  },
  "serverPort": 8765,
  "useObsidianURLScheme": false,
  "vaultPath": ""
}
```

## Command Behavior

`workingDirectory: "vault"` runs the command inside the configured vault. Commands are executed with `Process`, not through a shell.

The default refresh command expects `graphify` to be available on `PATH`. If Graphify is installed somewhere else, set `commands.refreshGraph.executable` to that executable path.

For a vault whose graph exceeds Graphify's visualization ceiling, run Graphify with a larger `GRAPHIFY_VIZ_NODE_LIMIT`. BrainBar command specs do not have a separate environment dictionary, so use `/usr/bin/env` as the executable and put the assignment before the Graphify executable:

```json
{
  "arguments": [
    "GRAPHIFY_VIZ_NODE_LIMIT=15000",
    "/absolute/path/to/graphify",
    "update",
    "."
  ],
  "executable": "/usr/bin/env",
  "workingDirectory": "vault"
}
```

BrainBar 2D still requires Graphify to emit `graphify-out/graph.html`. Once that file exists, BrainBar supplies its pinned Vis Network runtime locally and blocks the matching remote script request, so viewing the 2D graph does not require network access.

Review Queue and Brain Check are optional local command hooks. BrainBar displays their status and only runs explicit configured actions; it does not define those workflows itself.

# Card questions — 0.5.4

MirTar can display questions from a bridge-driven Codex session and return a spoken answer or a selected option to the
original request. Codex retains the conversation. This requires both bridge and firmware 0.5.4 and a **new bridge-owned
session**. Existing desktop-forwarded sessions keep their behavior; their desktop dialogs are not intercepted.

## Existing bridge configuration

Finish the current task and stop the bridge. From the repository, use your actual project directory:

```powershell
.\tools\New-AgentSession.ps1 -WorkingDirectory 'C:\Projects\MyProject' -Name 'MirTar Agent'
.\tools\Start-Bridge.ps1
```

The setup tool creates and initializes a new persistent Codex session and appends it to the private bridge configuration,
preserving existing sessions and device bindings. It never converts a desktop session or silently replaces a missing/busy
one. There are at most eight configured sessions. A short initialization turn ensures the new session has persistent history.
Select MirTar Agent on the card, or hold UP/DOWN to switch from another session. Existing host pairings can be reused.
Omit `-WorkingDirectory` to use the host default described below.
Use the same `-Config` path for both commands when using a non-default config.

For first-time setup, after installing Node.js 24.13+, Edge, signing into a Codex installation with native voice support,
and running `npm.cmd ci --ignore-scripts`:

```powershell
.\tools\New-LocalConfig.ps1 -BluetoothOnly -BridgeOwned
```

This requires no desktop thread ID or home Wi-Fi entry. Then follow [Bluetooth onboarding](server-onboarding.md).
Existing real configuration is never overwritten. This saves an empty session list; the first bridge start initializes
the workspace and Agent session. Add `-WorkingDirectory 'C:\Projects\MyProject'` to select an existing writable project.

## Workspace and first start

- With no sessions, the bridge uses `codex.defaultWorkingDirectory`, if configured, or creates
  `MirTar/workspaces/default` under the current user's home. It checks write access, initializes **MirTar Agent**,
  and saves its ID, `execution: "bridge"`, and absolute `cwd` in local `.private/bridge.config.json`.
  Restarts restore that session and directory.
- The host default applies only to new sessions. Each existing session keeps its own `cwd`; separate sessions may use
  different projects. Existing sessions are never recreated, relocated, or converted automatically.
  Paths are bridge-local and do not belong in the card configuration or public firmware.
- `config/bridge.example.json` shows an empty session list. Actual bindings and the native Codex executable still need
  local setup; use the configuration helpers.
- Missing/unwritable custom directories and removed saved workspaces block that session. The console and updated
  0.5.4 card show a configuration prompt. The bridge never recreates a missing project or switches to another directory,
  including its own source folder. Do not clear `sessions` to fix an existing session.

If first initialization fails before a session exists, choose/create a project folder, add this field inside the local
configuration's `codex` object, save, and restart. This is a placeholder path:

```json
"defaultWorkingDirectory": "D:\\Projects\\MyProject"
```

To change an existing session's directory, finish its task, stop the bridge, edit that entry's `cwd` under `codex.sessions`,
keep its ID/name/execution mode, and restart. Changing the host default neither migrates existing sessions nor moves files.
To create another session, run `New-AgentSession.ps1 -WorkingDirectory 'D:\Projects\MyProject' -Name 'Project Agent'`.

The adjacent `bridge.config.json.session-setup.local.json` receipt contains the local session ID/path and must stay private.
After a recorded setup failure, retry resumes that same thread. Unknown creation outcomes or concurrent configuration changes
stop automatic creation to avoid duplicates. Keep the config and receipt, check Codex login and the receipt, and do not discard
bindings or blindly remove the receipt to retry. Directory changes need neither pairing nor flashing; the new card error
messages require the updated 0.5.4 firmware.

## On the card

1. Record and submit a task with OK as usual. Bridge-owned sessions execute without opening a desktop chat to activate them.
2. A question appears automatically. UP/DOWN scrolls; OK opens the answer menu.
3. Voice answer is selected first. OK starts recording and another OK ends it; completed native transcription answers that
   question. Alternatively select an option with UP/DOWN and confirm with OK. A group supports 1–3 questions and 0–4 options each.
4. Skip this question group keeps earlier answers and skips the remaining questions. Back to question submits nothing.
   Hold UP/DOWN to switch sessions; hold OK to return home and cancel any current recording.

Answers target the original session/request, never a new queued task. Duplicate actions, expired requests and unknown
delivery results are not automatically replayed. A card reconnect restores questions still valid in the running bridge.
Secret-marked questions are redacted and cannot be answered through voice.

## Boundaries

`execution: "desktop"` or an omitted mode retains desktop forwarding. `execution: "bridge"` resumes the new dedicated session
in its configured working directory with workspace-write / on-request policy. Use the setup tool rather than retagging an
existing desktop UUID. Execution/permission approval UI is not implemented; asking a question never grants those approvals.
The backend uses local Codex configuration and tools; desktop-specific integrations are not guaranteed.

Completed history was readable by the desktop API, and another process resumed the same session with context intact after
bridge exit. Actual desktop UI takeover, concurrent desktop/card writers, and in-flight question recovery after bridge restart
remain unverified or unsupported. Finish the task and stop the bridge before switching clients.

Native Codex ASR is reused without another ASR provider or API key. Actual config, receipts and audio stay in ignored private
storage. See [validation and limits](validation/agent-questions-0.5.4.md). Physical badge acceptance is still required.

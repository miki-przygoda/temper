# Spikes (spec section 10.1)

Run on 24 Oct 2026 with Claude Code 2.1.308 on macOS, in a scratch folder. Settings and plugins were loaded per session (`--settings`, `--plugin-dir`, or a throwaway `CLAUDE_CONFIG_DIR`), so the user's own config was never changed.

## S2, UserPromptSubmit input: PASS

- **The hook input has these keys:** `cwd`, `hook_event_name`, `permission_mode`, `prompt`, `prompt_id`, `session_id`, `transcript_path`. `permission_mode` was `auto` under `--permission-mode auto`.
- **The added context reaches the model.** A hook that returns `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}` puts that text in front of the model, which can quote it. This works in `-p` mode too.
- **Lesson: match the keyword against the `prompt` field only.** A first version matched the raw input JSON and fired on a prompt without the keyword, because `cwd` contained "temper-spikes".

## S5, plugin workflows and dependencies: PASS, with one catch

- **A plugin's `workflows/echo.js` runs as `/tspike:echo`,** headless (`claude -p`, `--plugin-dir`), in one turn. The args written after the command arrived in the script as a real JSON object: `{"echoed":{"epic":"demo","done":["1","2"]},"kind":"object"}`. That turn cost $0.004.
- **A dependency in the same marketplace** (`"dependencies": ["tdep"]`) installs with the plugin: "+ 1 dependency: tdep".
- **A dependency in another marketplace is not installed automatically.** The install reports success, but the plugin then fails to load: `Dependency "superpowers@<marketplace>" is not installed — run claude plugin install ...`. This was the same for `@claude-plugins-official` (a marketplace a fresh config doesn't have) and `@anthropic-plugin-directory`, which is built into Claude Code as "Built in (Anthropic Directory)". Once `superpowers@anthropic-plugin-directory` was installed, the plugin loaded.
- **Design consequence.** temper declares `superpowers@anthropic-plugin-directory`, where the owner's copy comes from. The README and `/temper:setup` tell the user to install superpowers first.
- **What `claude plugin validate --strict` asks for:**
  - author details (a warning).
  - For Anthropic's directory: a README of at least 40 words and a LICENSE file (or a `license` field in plugin.json). The directory refuses a submission without them.
  - An icon (recommended): a square PNG of 512–2048 px. It's locked in the first time the plugin is saved or submitted.
- **Also found:** `claude plugin eval` runs eval cases (prompt plus graders) against a plugin. It could test the skills, which spec section 10.2 says are "proven by use".

## S1, a workflow finishing wakes an idle session: PASS

- **Test:** the head session launched a one-agent background workflow (run wf_d217dc3d-3ef), then ended its turn and sat idle.
- **Result:** about 4 s later, the workflow's completion arrived as a task notification and started a new turn on its own, with no user input.
- **The notification carries the script's return value** (`{"s1":"done","agent":"ok"}`), agent counts (done, error, skipped, empty) and the journal path. So the head gets `build.js`'s blocked list straight from the notification, with no file to poll.
- **Not tested:** the same thing when the session is over its usage limit at that moment. That's S4/S6, which waits for the first overnight run.

## S3, the statusline script writes `limits.json`: PASS

- **Test:** with the owner's go-ahead, a test `statusLine` command was added to the user settings. There was no statusline before, so the script printed nothing. Claude Code picked it up live, without a restart, and ran it within seconds.
- **What it received:** the statusline input has these keys: `context_window`, `cost`, `cwd`, `effort`, `exceeds_200k_tokens`, `fast_mode`, `model`, `output_style`, `prompt_cache`, `prompt_id`, `rate_limits`, `scratchpad_dir`, `session_id`, `session_name`, `thinking`, `transcript_path`, `version`, `workspace`. There's no `permission_mode`, so the mode check stays in the hook (S2).
- **`rate_limits`:** `{"five_hour": {"used_percentage": 15, "resets_at": 1792868400}, "seven_day": {"used_percentage": 47, "resets_at": 1793232000}}`. That's Sat 24 Oct 20:00 and Thu 29 Oct 00:00, local time. Both are whole hours.
- **Cleanup:** the settings file was restored byte for byte from its backup (checked with `diff`).
- **Design notes:**
  - The statusline runs only in an interactive session, and only after a reply.
  - `limits.json` records `seen_at`, so the head can tell when the file is stale. The pre-flight treats anything older than about 10 minutes as not fresh.
  - The real script writes to `~/.claude/temper/limits.json` (under `$CLAUDE_CONFIG_DIR` when that's set; the owner's is `~/.claude-work`). If the user already has a statusline, the script runs it and passes its output through.

## S4, S6

Both need a real usage-limit hit, so they're checked on the first real overnight run, with a fallback in the plan:
- **S4:** does a check-in fire, and resume the run, after the limit is hit?
- **S6:** does `autoContinueAtUsageLimit` wait while a workflow is running?

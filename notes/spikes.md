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

## S1, a workflow finishing wakes an idle session: running

## S3, S4, S6

- S3 needs a test statusline in the user's settings, so it waits for the owner's go-ahead.
- S4 and S6 need a real usage-limit hit, so they're checked on the first real overnight run, with a fallback in the plan.

---
# Format version of this file.
version: 1
# How temper asks you questions: open text while you dump ideas, then multiple-choice boxes once there is a base.
question_style: open-then-boxes
# Overnight contact for severe items: report (the morning report only), push (a push notification), or push-blocking (a push for anything blocking).
severe_contact: report
# Whether an overnight run may start without you reviewing the plan first: no or yes.
overnight_without_plan_review: no
# Whether temper may push branches and open PRs on a green full gate: ask, yes or no. It never merges.
may_push: ask
# What gets fixed overnight by default from the stage 4 list, by severity.
overnight_fix_default: critical+important
# Whether temper may schedule overnight wakeups to resume after a usage reset: no or yes.
wakeups_approved: no
# The morning report time (local), which is the end of "overnight".
morning_report_time: 07:00
# Stop cleanly once the weekly usage reaches this percentage.
weekly_stop_percent: 90
# Whether the word "temper" in a prompt starts temper: off or on.
keyword_trigger: off
---

# Your temper preferences

These are your answers from `/temper:setup`. They live in your own Claude config directory, outside the plugin, so a plugin update never overwrites them.

You can ask Claude to change, undo or specialise any of these at any time, for example "let temper push PRs" or "wake me for anything severe". Claude edits this file for you.

Some rules are fixed and no preference can change them: no privileged commands, temper never merges, it never deletes work that isn't on the remote, and anything that would loosen a security decision is confirmed with you every time. If you ask for a preference that contradicts one of these, Claude explains why and doesn't save it.

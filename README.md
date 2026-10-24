# temper

temper is a Claude Code plugin that takes a piece of work from idea, to spec, to plan, to MVP, to stable, to PR, in one fixed order. It builds an MVP, checks it against an independent behaviour spec and acceptance tests, fixes to green, then runs one review sweep, one careful fix wave and a regression check of that wave. It builds on Claude Code's own Workflow tool.

## Install

Install superpowers first. temper depends on `superpowers@anthropic-plugin-directory`. Claude Code doesn't install a dependency from another marketplace automatically, and temper fails to load until superpowers is installed.

## Status

v0.1.0, in development. The design is `docs/specs/2026-10-24-temper-design.md` and the build plan is `docs/plans/2026-10-24-temper-v1.md`.

# temper

A Claude Code plugin, to come: a workflow and a skill that take a planned piece of work from nothing to stable in one fixed order. The order is MVP, then an independent behaviour spec, then acceptance tests, then fixing to green, then one sweep, one fix wave and a regression check of that wave. It builds on Claude Code's own Workflow tool and ultracode instead of replacing them.

Status: design. Nothing is built yet; the design is being agreed section by section.

## Where things are

- `notes/official-workflows.md`: how Claude Code's Workflow tool and ultracode work, with the doc sources checked on 24 Oct 2026 (Claude Code 2.1.308).
- `notes/lessons-from-cairn.md`: what running real milestones as workflows on Cairn taught, written without Cairn specifics.
- `notes/discovery.md`: the owner's idea and every round of answers.
- `notes/design.md`: the design, one approved section at a time.
- `docs/specs/`: the spec, once every design section is approved.

## Origin

The lifecycle came out of building Cairn (R3 and R3b, Oct 2026). Repeated review sweeps found bugs, and fixing them made new ones. Splitting the work into "build an MVP, check it against an independent oracle, then sweep once" kept the branch stable. This project makes that shape reusable across other projects.

# mrmd/src/monitor/tables

Internal linked-table job bridge for the monitor/headless-peer side.

This folder should stay thin. Most semantics should live in pure packages such as runtime/spec, while this layer handles claiming jobs and applying anchored snapshot rewrites.

## Ownership

- observe `tableJobs`
- claim runnable jobs
- call runtime/materialization logic
- rewrite markdown snapshots through anchored document operations
- update job status

## Planned tree

```text
mrmd/src/monitor/tables/
  index.js
  bridge.js
  runner.js
  snapshot-rewriter.js
  status.js
```

## Current phase

A first monitor-side bridge now exists for:
- observing `tableJobs`
- claiming runnable jobs
- creating the first runtime + `r-dplyr` engine path with a local file-source provider
- running subprocess materialization contracts directly when no custom executor is injected
- reading csv/tsv caches back into rows for snapshot generation in the first host-backed path
- rewriting linked-table markdown snapshots through Yjs anchors
- marking jobs `claimed` / `running` / `writing` / `completed` / `error`
- wiring the bridge into `RuntimeMonitor` itself so spawned monitors can process linked-table jobs

The next step is to replace csv/tsv-first host plumbing with broader real filesystem/runtime support and richer diagnostics/status surfacing.

## First slice here

Phase 1 monitor-side work should only prove:
- claim one linked-table sort job
- run one materialization path
- rewrite one markdown snapshot back into the document
- mark the job completed/error

## Non-goals for the first slice

- job queues beyond the Yjs map protocol
- multi-engine orchestration beyond runtime registration
- source editing workflows

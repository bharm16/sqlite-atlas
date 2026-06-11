# No edit-manager wrapper around EditSession

Status: accepted

Architecture reviews keep noticing that `EditSession` returns `EditOp`
objects which the editor provider threads through VS Code's undo stack,
and propose wrapping session + op-log + undo behind an "edit manager"
module. Rejected: the wrapper fails the deletion test. VS Code's
`CustomEditorProvider` contract is what requires each edit event to
carry its own undo/redo closures, so the op-threading knowledge cannot
be hidden from the host side — a wrapper would relocate it, not absorb
it. `EditSession` has exactly one caller path (the webview message
handlers in `messages.ts` plus the provider's `pushEdit`), and one
adapter means a hypothetical seam.

## Considered options

- **EditManager wrapping session, op-log, and undo integration**: pure
  pass-through today; every method would forward to `EditSession` while
  the provider still owns the `CustomDocumentEditEvent` wiring.

## Consequences

- Revisit if a second caller of `EditSession` appears — e.g. a raw-SQL
  or scripting feature that applies structured edits outside the
  webview message path. (That feature also reopens ADR-0001.)
- The edit flow stays testable without VS Code through the
  `messages.ts` seam, which covers update/insert/delete + labels.

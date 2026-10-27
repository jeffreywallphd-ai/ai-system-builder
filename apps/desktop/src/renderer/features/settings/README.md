# Settings UI

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The renderer uses `desktopApplicationSettingsClient`. The host and application
still authorize settings and store secrets. The UI does not read stored secret
values. It displays the masked settings response.

Each committed client, category and key list owns its reads and actions. A late
response from an old view cannot replace current values or publish a result.
Equal key lists reuse that owner. Uncommitted renders grant no action authority.
Each view admits one save or clear at a time, before React disables the controls.
The UI does not cancel a write that the host has already accepted.

Save and Clear return a local success flag. A secret draft clears only after the
current write and settings read both succeed. A failed write keeps the draft for
an explicit retry. A newer draft edit survives an older Save or Clear result.
Malformed returned rows are checked before React receives the read result.
If readback fails after a change, use **Refresh settings** before
another write. Refresh also lets the user recover from an initial read failure.
Ordinary and model-default fields adopt the current returned values. A successful
folder selection changes a draft; it does not save the setting.

Failures and success notices use the notification center. Public failures use
fixed messages. Unknown exception text, credentials and native paths must not
enter notifications or status text. Loading and saving retain their status
announcements. Folder and model-default responses also retire with their view.

The fixed `settings-ui` contributor profile runs the panel, page, view-ownership
and API tests with synthetic values. It starts no app or model and uses no real
credential store or provider. Actual packaged restart and final cross-roadmap
qualification remain separate. Keep those checks pending until executed.

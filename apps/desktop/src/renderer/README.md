> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Desktop renderer startup

The desktop first loads `index.html`, its local `styles/startup.css` and the small
`startup.ts` controller. The document supplies the loading screen before the
larger React graph starts. It uses the existing logo, dark theme and local fonts.

The main process keeps the window hidden until its document has loaded and
Electron reports its first paint. Both `maximize` and `show` run after that gate;
`maximize` itself can show a hidden window. The gate has a 60-second bound for an
unpainted native window. A failed load, preload or renderer, or an expired gate,
shows fixed native failure text. Closing the window does not show that error.
This bound does not change model or app execution budgets.

After the native window is shown, a fixed local DOM attribute/event supplies a
presentation cue. It contains no data and grants no host authority. Later menu
reloads replay it, including while minimized. After two frame opportunities, the
controller keeps the loading screen for at least 1.5 seconds of visible time.
The app loads behind it. Hidden time does not count toward the minimum.
Restoring a hidden window requires fresh frame opportunities before the remaining
time counts. A failed cue for a live document shows fixed native recovery text;
closing or superseded documents use the next load cue. Reload retires old timers
and ignores late results from the previous document.

Actual steps report the document opening, module loading and shell commit. Four
feature tips rotate every 6.5 seconds. Next, Pause and Resume controls are
available. Reduced motion disables animation and automatic tips. Hidden pages
pause timers. A 20-second notice says loading is taking longer; it does not mark
startup failed or cancel it. Successful shell commit dismisses the screen after
the minimum. Focus moves to the app only when a loading control owned it.

A known module or uncaught React error restores a fixed failure screen with an
explicit Reload action. Exceptions, paths and provider data are not displayed.
Reload uses the same document URL. There is no automatic reload loop. Preload,
context isolation, Node integration and trusted IPC rules are unchanged.

Focused controller and native-event tests are in
`tests/app-lazy-pages.ui.test.tsx` and
`../../tests/forge-packaging-boundaries.unit.test.ts`. Run the fixed
`desktop-startup-ui` contributor profile. Synthetic DOM/native-event and bounded
Vite checks qualify this feature; they do not qualify a complete real host,
provider, model, OCR or the deferred combined roadmap suite.

# Runtime status and notification checks

Settings reads Python runtime status only when its runtime controls are open.
Opening or closing the controls does not start or stop a worker. Status reads
retain the ten-second log refresh and five-second resource refresh. These reads
share one pending request within a committed client scope. Start, Stop, Restart
and Clear log remain explicit actions; one action is admitted at a time. An
explicit Refresh joins a pending background read and takes foreground ownership,
including its log result. Its synchronous admission guard prevents controls from
starting before the pending state renders. Background polling alone does not
disable an explicit control.

A committed view owns each read and action result. Replacing the client, disabling
the view or unmounting it retires that ownership. An older read cannot overwrite
a later control result. Its physical request still retires before a new status
read begins in that view. An explicit Refresh can wait for that retirement and
request fresh status. Retiring the renderer does not cancel or undo an action
that the host already accepted.

The controls show a pending response and fixed recovery text. Raw exceptions and
host error messages are not displayed. The client copies known status, model and
log fields. Resource percentages remain finite display values; they do not grant
model admission or change memory limits. Existing generation-capacity validation
and backend authorization remain in place. Activity log content still follows
the host's diagnostic contract; these checks do not qualify arbitrary host logs
as public data or prove native process cleanup.

Run the fixed `operational-ui` contributor profile for the exact runtime,
notification, task-family, shell, dashboard and readiness regressions. It selects
Node or Vitest from the test imports. Its synthetic UI/client evidence does not
start an actual app, worker or model and does not qualify physical runtime,
provider, native offload, actual-host accessibility or the deferred full suite.

# Image form navigation drafts

Leaving Image Generation and returning to the same workspace restores the form
within the current renderer session. The draft belongs to the image, model and
artifact client context. Another workspace or client has a separate draft;
retired callbacks cannot replace it. The cache retains at most eight workspaces
and 128 KiB of serialized known form fields per draft. It copies each snapshot
and never caches task success, errors or preview URLs.

The cache adds no prompt to browser or disk storage. Full reload retains the
existing opaque task-ID recovery, which reads the actual task again. Unsent form
text is not preserved after a process reload. The focused image-hook remount
regression and `image-generation-draft-state.unit.test.ts` cover this feature
without starting ComfyUI. Run the finite `operational-ui` contributor profile
for related checks. Real generation, native cleanup and full testing remain
separate qualification.

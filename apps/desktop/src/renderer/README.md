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

# Changelog

## Unreleased

- **A nested control's event is no longer its parent's**: the events of
  UI5 Web Components bubble, and the two-way bindings and event wires
  listened to them from every descendant. A ComboBox in a list row reset
  the `selected` of every row (the ComboBox's `selection-change` reached
  the list), the toggle of an inner Panel fired the outer one's `expand`,
  the tab select of an IconTabBar on a tab fired the outer bar's `select`,
  and the `close` of a time picker in a dialog fired its `afterClose` and
  took a popover down. An event counts only when the control itself fired
  it - pointer and key events of the browser excepted, and a mapper that
  needs its children's events says so (RadioButtonGroup).
- **IconTabBar** selects among its own tabs and their sub-tabs only, not
  the tabs of an IconTabBar inside one of them.
- **Table**: an invisible `Column` hides the cells of its index in every
  row, not just its header - the cell of a hidden key column showed under
  the next header.
- **RadioButton**: the button a selection deselects writes `false` to its
  `selected` binding (UI5 `RadioButton#setSelected`), so the delta carries
  both, as the UI5 frontend sends it.
- **The edits of a view displayed anew are dropped**: a response that
  displays a new view in MAIN, POPUP or POPOVER has a new model, and the
  unsent edits of the old one were written over it - and went out with
  the new view's next event as attributes nobody edited there.
- **A user event that meets a timer tick is kept**: a click during a
  `START_TIMER` tick in flight was dropped; the first one now waits, goes
  out once the tick's response is adopted, with the id it names, and is
  dropped with its view (an app switch, its popup closed, an error, a
  route restore) - spec/transport.md "A user event that meets a timer
  tick".
- **Back during a roundtrip under KEEP/FRESH routing**: the answer of the
  roundtrip wrote its route over the history entry the browser had gone
  back to; it now leaves the URL alone, and the restore of that entry
  supersedes it.

- **abap2UI5 1.151.0 and later work again**: their backend answers wire
  protocol 3 (`S_FRONT.VIEWS`, `NAV`, `ACTIONS` instead of the `S_ACTION`
  envelope), and the element refused every such answer with "Protocol
  mismatch: this frontend speaks 2". It now reads protocol 3 and still
  reads protocol 2 (`PROTOCOLS`, exported next to `PROTOCOL`, which is 3),
  by the number each response declares: VIEWS in slot order (MAIN, NEST,
  NEST2, POPUP, POPOVER), NAV as the URL intent, ACTIONS as the follow-up
  actions, no popup teardown of its own on an app change (the backend
  states it), and a `START_TIMER` tick marked `TIMER`. The vendored
  mcp-server modules move to
  [8a95a6a](https://github.com/abap2UI5/mcp-server/commit/8a95a6a61560d785a4a0b6688f1faa6b27e8fc49)
  (release 1.3.0, was a4d9f07), whose `applyResponse` folds both wires; a
  weekly workflow (`bump-agent.yml`) re-vendors them from mcp-server's main
  through a PR from now on.
- **Protocol 3 end to end**: the demo backend, the e2e tests and the
  recorded fixtures run on `@abap2ui5/node-runtime` 1.151.0 (was 1.146.0),
  so wire protocol 3 is now exercised against a real backend - and three
  places that still assumed protocol 2 are fixed. An app start or a
  Back/Forward restore sends the route of its hash as `S_FRONT.ROUTE`
  (`#/app/<CLASS>[/<DRAFT>]`, `#/z2ui5-xapp-state=<DRAFT>`): a protocol-3
  backend reads no route out of `HASH`, so a reload, a bookmark or the
  browser Back button started the app afresh instead of restoring the
  draft. The flags of an event wire are read from the options object
  protocol 3 writes (`['EVENT', {queueLast:true,noBusy:true}]`), and still
  from the positions protocol 2 wrote - a protocol-3 `queueLast` wire lost
  its keystrokes and a `noBusy` one showed the busy overlay. Under
  protocol 3 `hash_set` / `hash_replace` are written only for an app that
  owns the hash, as the whole app hash, and reported otherwise (protocol 2
  appended them to the page's hash). The tests read responses through the
  vendored readers, whatever wire they come in.
- **No busy overlay after the element is gone**: removing or restarting the
  element during a roundtrip left the overlay's 400 ms timer running.

- **Renamed to `embed-webcomponent`**: the repository is
  abap2UI5-addons/embed-webcomponent (was abap2UI5/frontend-webcomponent; GitHub redirects
  the old address), and the npm package `@abap2ui5/embed-webcomponent` (was
  `@abap2ui5/frontend-webcomponent`, never published). The custom element
  `<abap2ui5-app>` and `dist/abap2ui5-wc.js` keep their names.
- **Backend markup can no longer restyle the whole view**: FormattedText,
  `core:HTML` and the error dialog's details kept a `<style>` element, and
  its rules applied to the entire shadow root - `ui5-button { display: none }`
  in one text hid every button. `<style>` (HTML and SVG) is now removed with
  its content, as UI5's FormattedText whitelist does; the `style` attribute
  stays.
- **The standalone page takes `?endpoint=` only on its own origin**
  (`index.html`): a link with `?endpoint=https://another.host/` ran that
  host's views under this page's address - a logon form, say - and sent
  what the user typed there. Another origin is refused with a console error,
  and the page talks to the service of its `abap2ui5-endpoint` meta tag.
- **No backend context is left behind by an answer that came too late**:
  an element removed or restarted while its first roundtrip was under way
  ended nothing (there was no `sap-contextid` yet), and the late answer of
  a stateful backend then opened a context that stayed until its timeout.
  That context is ended with `sap-terminate` as soon as the answer names it.
- **Typed numbers are read in the locale they are shown in**: a Float,
  Decimal or Integer binding formats with the browser's locale, and now
  parses with its symbols too - `1.234,56` typed in a German browser went
  into the model as `1.234`, `1’234.56` in a Swiss one as `1`.
- **Retry after a network error or a 502/503**: the error dialog re-sends
  the same body, the edits it carried included (`Session.retry()`), the
  way the UI5 frontend's error overlay does; `abap2ui5-error` carries
  `retry`. The dialog is one at a time and goes with Escape (it stayed in
  the overlay before).
- **The frontend's own texts in the page's language**: message box titles
  and buttons, "No data", "Search", "Back", the error dialog and the
  diagnostics summary - English and German built in, `defineTexts()` adds
  a language, the `language` attribute (or `?sap-language=` standalone)
  overrides the page's `lang` and also sets the web components' language.
- **`busy` and `blocked` on any control** render: a busy control sits in a
  `ui5-busy-indicator` (`busyIndicatorDelay`, `busyIndicatorSize`), a
  blocked one takes no input.
- **`sap.m.Tree`** reads its items binding like every aggregation (sorter,
  `length`, `startIndex` at the top level) and is rebuilt when its
  structure changes - a child moved to another node of the same JSON
  length was missed before; titles still refresh in place.
- **Element binding of a named model** (`binding="{device>/system}"`)
  moves that model's context only; the view model's paths stay.
- **`<abap2ui5-app>` attributes changed at run time**: `diagnostics` and
  `document-title` apply at once, `standalone` and `language` restart the
  element (they were ignored), `headers` assigned after the start is used
  from the next request on.
- **Avatar** checks an image source the way Image does (no script URL);
  **MessageBox** `details` is shown as sanitized formatted text, as UI5
  does; a popup whose slot is gone before the next frame no longer opens;
  `SET_FOCUS` with a selection on an input type without one no longer
  throws; the busy overlay and the shell shadow take their colour from the
  theme (the overlay was white in a dark theme).
- **Package**: `types/index.d.ts` types the element, its events and the
  exports; the package is no longer marked private.

- **A removed or restarted `<abap2ui5-app>` drops the answer still under
  way**: the session ends with the element, and a roundtrip it overtook no
  longer renders, runs its follow-up actions - a `REDIRECT`, the URL hash
  of `routing="hash"`, `SET_TITLE` - or shows "App Terminated" and fires
  `abap2ui5-response` / `abap2ui5-error` for an app that is gone (an `app`
  attribute changed while the start was running). A queued wire or a hash
  change is not sent after the end either.
- **No `resize` listener left behind on the window**: every start of
  `<abap2ui5-app>` - a boot, a restart on a changed attribute - added one
  for the `device>` model and never took it off, which kept the ended
  session's model and the bindings of its view alive and recomputed them on
  every resize. The session's end removes it.
- **Sanitized HTML drops custom elements** (FormattedText, `core:HTML`): an
  element whose name has a hyphen, and the `is` attribute, are removed with
  the scripts. Markup from backend data - a model value a user typed - could
  place `<abap2ui5-app endpoint="https://..." app="...">` in the page, which
  the element's own definition then started: the app of any server, rendered
  inside this one, free to `REDIRECT` the page.
- **`javascript:` URLs are refused the way the browser reads them**, in
  sanitized HTML (`href`, `src`, `xlink:href`, `action`, `formaction`) and in
  `sap.m.Link` `href`: `java<TAB>script:` or a control character in front
  passed the old check and ran on a click. SVG `animate` and `set`, which
  write their parent's `href` after the check, are dropped.
- **`<abap2ui5-app>` starts when `app` or `endpoint` arrives after it was
  connected** - a host that sets the attribute later (a framework binding)
  got an empty element and no error.
- **`HASH_BACK` keeps the page after the browser went back over every
  push**: the router counts the in-app entries behind the browser (the
  trail of the hashes it wrote and saw), not every push of the page load -
  a cold deep link that pushed once and went Back left the page on the next
  `HASH_BACK` instead of showing its fallback route.
- **Profile** re-copied from protocol 604d267 (spec revision 0.3): the
  additive `actions.api` / `actions.wire` split; `scripts/profile-actions.mjs`
  reads `actions.api` too.
- **Vendored agent modules** re-pinned to abap2UI5/mcp-server a4d9f07 (PR
  #44): viewxml, snapshot and appclient follow the protocol's frontend rules
  there too; this frontend's own session already did and is unchanged.
- **The URL hash** (`src/core/router.js`, spec/navigation.md): the `ROUTER`
  system action applied once per response after rendering - `KEEP` routes
  `#/app/<CLASS>/<DRAFT>` and `FRESH` routes `#/app/<CLASS>` that follow every
  draft id, a routed `nav_app_call` repoints the caller's entry and pushes a
  history entry, browser Back/Forward (or a manual edit) sends the
  app-start-shaped restore (no `ID`, the new `HASH`), the app-state hash
  `#/z2ui5-xapp-state=<DRAFT>` written and cleared, app-owned hashes
  (`setPushState` / `setHashReplace`, the `setHashEvent` listener raised on a
  change from outside, parked while a roundtrip runs), `HASH_BACK` with its
  fallback route, the launchpad shell part kept. Every request of the
  standalone page carries the hash as `S_FRONT.HASH`.
- **Embedded routing**: new attribute `routing` (`hash` | `events` | `off`).
  Embedded (the default `events`) the element never touches the host's URL
  and sends no `HASH`; it emits `abap2ui5-route` (`push` / `replace` /
  `back`) instead, and the host hands its own hash changes back with the new
  method `navigate(hash)`.
- **Error body verbatim**: a failed roundtrip shows the response body exactly
  as it came, as text - no markup stripped, no entities decoded
  (spec/errors.md); `HTTP <status>` for an empty body. The session no longer
  uses the vendored `errorText` (the vendored copy is unchanged).
- **Frontend formatters** of the portable profile: `Formatter.DateCreateObject`,
  `Formatter.DateAbapDateToDateObject`, `Formatter.DateAbapDateTimeToDateObject`
  (with `parts`); other formatters keep the placeholder and the report.
- `DatePicker` / `DateTimePicker` / `TimePicker` `dateValue` (one-way, from a
  formatter) and `minDate` / `maxDate`.
- Table and List **growing**: `growing`, `growingThreshold`,
  `growingTriggerText`, `growingScrollToLoad` (`ui5-table-growing`, the
  list's `growing` mode).
- `CONTROL_GLOBAL INVISIBLE_MESSAGE announce` (an aria-live region); the
  navigation family under its client-API names (`SET_PUSH_STATE`,
  `HASH_REPLACE`, `HASH_ATTACH_CHANGED`, `SET_NAV_ROUTING`,
  `SET_APP_STATE_ACTIVE`) handed to the router when it arrives as an `.eF`
  wire. `CONTROL_BY_ID` and `BINDING_CALL` stay unsupported - the portable
  profile excludes them.
- `profile/portable-v1.json` re-copied from abap2UI5/protocol main
  (`d125109`, unchanged content) by the new `scripts/vendor-profile.mjs`;
  `scripts/profile-actions.mjs` reads the profile's action list in both
  shapes (client-API names, or wire actions and client-API names apart).
- Demo: Z2UI5_CL_SMP_APP_480 (+469, hash routing KEEP) and
  Z2UI5_CL_SMP_APP_498 (app state in the URL), with e2e tests - Back and
  Forward, reload, and a cross-check of the restore request against the UI5
  SPA; an embedded routing e2e test.
- Protocol frontend conformance suite (`--adapter webcomponent`): 0 MUST
  failures (before: 4 failures, 1 warning).

## 0.1.0 - first version (PR #1, not published)

First version.

- **Core protocol client** (`src/core/`): app start with location and
  `S_DEVICE`, events with `T_EVENT_ARG` and the model delta of the edited
  paths (`__delta` rows for table cells), the draft id, the five view slots
  (response bookkeeping by the vendored `applyResponse`), POPUP/POPOVER torn
  down on an `APP` change, the app stack followed through `S_FRONT.APP`, the
  `PROTOCOL` check, error texts of failed roundtrips with Restart, one
  roundtrip at a time with the queue-last and no-busy wire flags; fetch
  transport with `sap-contextid`, the CSRF token handshake, credentials and
  extra headers.
- **Renderer** (`src/render/`): view XML to UI5 Web Components through a
  control registry - all 65 controls of portable profile v1 plus 31 more;
  unknown controls as a visible box with their children still rendered, and
  a diagnostics panel / console / `abap2ui5-diagnostic` event.
- **Bindings**: paths, list bindings with templates, element binding,
  two-way binding of value-like properties, typed display formatting,
  expression bindings in the profile grammar (own parser, no eval),
  composite parts, the `device>` model; formatters as visible placeholders.
- **Frontend actions**: message toast and box (incl. client-composed texts,
  custom actions, `onClose`), popup/popover close, `SET_TITLE`,
  `START_TIMER`, `SET_FOCUS`, clipboard, URL actions with the UI5 frontend's
  URL rules, theming, busy indicator.
- **Packaging**: `dist/abap2ui5-wc.js` (registers `<abap2ui5-app>`),
  `dist/index.html` (standalone start, `?app_start=`), on-demand chunks for
  icons, CLDR data and themes; embedding examples.
- **Demo and tests**: 14 sample apps of abap2UI5/samples on
  `@abap2ui5/node-runtime` 1.146.0; Playwright tests of every app with a
  cross-check of the request bodies and models against the official UI5 SPA
  served by the same backend; unit tests on node:test and happy-dom;
  screenshots in `docs/screenshots/`; CI.

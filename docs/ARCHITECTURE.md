# Architecture

InquiryDQB is three static pages (landing, Teacher, Student) that share one design system and one small networking helper. There is no build step: every file is served exactly as it is in the repository.

```
   Student phone ──┐                         ┌── Co-host (second teacher device)
   Student phone ──┼── WebRTC data channels ─┤
   Student laptop ─┘            │            └── (same protocol, extra permissions)
                                ▼
                       Teacher console (host)  ◀── IndexedDB (boards, templates)
                                ▲
              PeerServer: only introduces devices to each other
```

## Roles

| Role | Page | Holds | Connects to |
| --- | --- | --- | --- |
| **Host** | `Teacher/` | The canonical board (`State`), saved in IndexedDB (`DQB_Ultimate`) | Registers the peer id `dqb-<CODE>` with the PeerServer; accepts connections |
| **Student** | `Student/` | Own profile and notes (IndexedDB `DQB_Student`, `localStorage`) | Dials the host's peer id |
| **Co-host** | `Teacher/` ("Join as co-host") | A mirror of the board | Dials the host and authenticates with the secret key from the co-host code (`CODE.KEY`) |

The join code is six characters from an alphabet without look-alikes (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`); the PeerJS id is `dqb-` + code. A student's QR code or link is `Student/?join=CODE`. Optional `?peerHost=…&peerPort=…&peerPath=…&peerSecure=0|1` points a page at a self-hosted PeerServer and is remembered in `localStorage` (see `shared/net.js`).

## Files

| File | Responsibility |
| --- | --- |
| `shared/ui.css`, `shared/ui.js` | Design tokens (light, dark, `[data-theme]`), buttons, inputs, chips; `Overlay` (bottom sheet on phones, modal on desktop), `Dialog` (confirm / alert / prompt without native dialogs), `Menu`, `Toast`; the history manager (`Hist`) so the phone back gesture closes sheets and pages; escaping and validation helpers (`esc`, `safeId`, `safeColor`, `safeImg`, `clampStr`) |
| `shared/net.js` | Code generation and parsing, join URLs, PeerJS options, human-readable error messages, reconnect back-off |
| `shared/icons.js` | Generated from Lucide by `tools/build-icons.mjs` (do not edit by hand) |
| `Teacher/app.js` | `State` and `StateManager`, `Render` loop, `InputController` (Pointer Events), `Modes` (select, pan, draw, erase, laser), `SnapSystem`, `Sanitize`, `Network` (host, co-host, moderation, activities), `Workspace` router (board, consensus, breakout), `Consensus`, `Breakout`, `Board` (save, load, export) |
| `Teacher/shell*.js` | App chrome on top of `app.js`: home screen, tool rail, floating bars, selection toolbar, class panel, sheets (share, settings, templates, accessibility view), phone bottom navigation |
| `Student/app.js` | Store (IndexedDB), `Conn` (connection, watchdog, reconnect, outbox), message handler, views (setup, join, board, notes), full-screen task pages, shared-model viewer |
| `sw.js` | Precaches the shell so the console and student app open offline; network-first for code (updates arrive at once), cache-first for fonts, icons and libraries |

## Wire protocol

Messages are JSON strings with a `type`. The host accepts a **fixed allow-list** from students; everything else is ignored unless the sender authenticated as a co-host.

**Student → host:** `JOIN {name, avatar, sid}`, `NOTE`, `IMG_NOTE`, `DELETE_NOTE`, `POLL_VOTE`, `DATA_SUBMIT`, `SUBMIT_VOTE`, `SUBMIT_SORT`, `COMMENT`, `EXIT_SUBMIT`, `CONSENSUS_INK`, `HEARTBEAT`, `LEAVE`.

**Host → student:** `WELCOME {boardId, mode, payload, sync, rules, muted, color, pending, timer}`, `RULES`, `MUTE`, `KICKED {reason}`, `TIMER`, `NOTE_STATUS {id, status, reason}`, `SET_COLOR`, `MODE`, `ZONE_ACT` / `OPEN_ZONE` / `ACT_VOTE` / `ACT_SORT` / `ACT_DISCUSS`, `ACT_POLL`, `ACT_GRAPH`, `EXIT_TICKET`, `STOP_ACT`, `CONSENSUS_START` / `_STOP` / `_PERMS` / `_INK` / `_CLEAR` / `_SET_INK` / `_ITEM_MOVE` / `_VIEW_SYNC`, `HEARTBEAT`.

**Co-host ↔ host:** `AUTH_COHOST {key}` → `AUTH_OK` or `AUTH_FAIL`, then `FULL_SYNC`, `SYNC_REQ`, `ADD_ITEM`, `NOTE_UPDATE`, `BATCH_UPDATE`, `GROUP_ITEMS`, `UNGROUP_ITEMS`, `ZONE_REORDER`, `INK_ADD`, `LASER`, `STATE_META`.

Every activity start carries a fresh round id (`rid`), so a student can answer again when the teacher re-runs the same item; the host accepts one answer per student per round.

### Connection behaviour

- The host sends `HEARTBEAT` every 3 s. A student that hears nothing for 10 s closes the connection and reconnects with exponential back-off (1 s doubling to 15 s, with jitter). Visibility and `online` events retry immediately.
- A student has a random identity (`sid`) stored on their device. Reconnecting replaces the stale connection instead of creating a duplicate, and mute / removal follow the `sid`.
- Messages that must not be lost (notes, votes, answers) go to a **durable outbox** while the student is offline. Notes keep a status (`sending`, `approved`, `pending`, `rejected`) shown in My notes, and any note still `sending` is resent after the next `WELCOME`.
- "New code" sends `KICKED {reason: "code-reset"}`, waits a moment so it arrives, then re-registers under a new id. A removed student stays blocked for the life of the code.

## Security model

Everything that arrives over the network (and everything imported from a file) is untrusted.

- **No HTML from data.** Text is placed with `textContent` or escaped with `esc()`; ids pass `safeId`, colours `safeColor`, images `safeImg` (raster `data:` URIs only; no SVG, no remote URLs, size-capped). There are no inline event handlers.
- **Allow-listed messages.** Students may send only the types listed above; board-sync messages require co-host authentication. Names lose control characters and angle brackets, avatars must come from the built-in set, note types are coerced to the known list.
- **Limits.** Token-bucket rate limit per connection (cap 40, 15 per second; images cost more), 80 notes per student, 4 MB per message, bounded lists everywhere.
- **Least data.** Students never receive board state, only the activity currently running. Co-host access requires a secret key that changes whenever the code is reset.
- **Content-Security-Policy.** Every page carries a CSP `<meta>` that allows scripts only from this site: no inline `<script>` blocks (the theme and service-worker bootstrap live in `shared/boot.js` and `shared/sw-register.js`), no inline event handlers, no `eval`. If escaping ever failed, the browser would still refuse to run injected markup; `tests/site.test.js` proves this by injecting `onerror`, `srcdoc` and script elements and checking that nothing runs. `connect-src` allows any `https:`/`wss:` host so a self-hosted PeerServer works without edits; `worker-src` allows `blob:` for the confetti worker.
- **No third-party code or analytics.** Libraries, fonts and icons are self-hosted (`vendor/`, `fonts/`, `icons/`); `tests/site.test.js` fails if a page requests anything from another origin. WebRTC itself uses PeerJS's default infrastructure: its signalling service, Google's STUN server and PeerJS's TURN relays (the relays only carry DTLS-encrypted data). All of it can be replaced through `DQB_PEER_OPTS` (see `docs/SELF_HOSTING.md`).

## UI system

- Layout adapts at 768 px: sheets become bottom sheets on phones and centred modals on desktop; the teacher chrome switches between the floating whiteboard layout and the bottom-navigation app layout.
- Only one overlay layer is active at a time. While one is open the page behind it is `inert`, focus is trapped and restored, Escape closes the top layer, and the browser/phone back button closes it too (via `Hist`).
- Colours, radii, shadows and spacing are CSS custom properties in `shared/ui.css`. Dark mode follows the OS unless the user picks a theme; sticky notes stay paper-coloured in both.
- Touch and mouse use Pointer Events. On touch devices a note is moved by its body and edited by a second tap or the Edit button, so scrolling and selecting never fight with the keyboard.

## Tests

`npm test` runs `tests/*.test.js` with Node's built-in runner. `tests/harness.js` starts a static server and a local PeerServer on free ports and opens real Chromium windows.

| File | Covers |
| --- | --- |
| `flow.test.js` | Join, notes, sketches, approvals, muting, vote / rank / discuss, polls, graphs, all exit-ticket formats, timer |
| `resilience.test.js` | Shared model, drafts on a locked board, reconnecting, offline outbox, removing a student, resetting the code |
| `security.test.js` | A hostile client: injected names and text, forbidden messages, spoofed ids, bad images, wrong co-host key, oversize and flood |
| `teacher-ui.test.js` | Pointer and keyboard editing on desktop, exports, co-host, persistence; phone navigation and back button |
| `site.test.js` | Landing page, no third-party requests, manifests and precache list, offline start-up |
| `a11y.test.js` | axe-core audit (WCAG 2.0/2.1 A + AA, best practices) of the landing page, teacher console and student app in light and dark themes, on desktop and phone |
| `legacy.test.js` | Boards and notes saved by earlier versions (same IndexedDB databases) still open, and hostile text inside them stays inert |
| `touch.test.js` | Real touch input on a phone: drawing a sketch, panning, dragging a note and pinch-zooming the board |

## Extending

To add an activity: (1) host side, add a `Network.broadcastX()` that calls `Network.transitionTo(type, targetId, payload)`; (2) add the response type to `STUDENT_MESSAGES` and a `case` in `Network.handle` that validates, de-duplicates with `Network._once`, and updates `State`; (3) student side, add a `case` in `Handle`, a card in `Views.renderBoard` and, if it needs room, a page in `Student/index.html` opened with `Pages.open`; (4) add a test next to the others.

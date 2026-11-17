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
| `shared/media.js`, `shared/media.css` | Pictures and videos: video addresses (`parseVideo`, `cleanVideo`), annotations (`cleanAnno`, `visibleTo`), picture re-encoding (`encodeImage`), players for a `<video>`, YouTube and Vimeo (their `postMessage` protocols, no third-party script), and the **viewer** used by the console and the student app |
| `shared/icons.js` | Generated from Lucide by `tools/build-icons.mjs` (do not edit by hand) |
| `Teacher/app.js` | `State` and `StateManager` (with `batch` for one-step undo of composite edits), `Render` loop, `InputController` (Pointer Events), `Modes` (select, pan, draw, erase, laser), `SnapSystem`, `Sanitize`, `InkTools` (stroke geometry, painting, strokes → one image, clustering) and `InkSel` (selected ink on each canvas), `Network` (host, co-host, moderation, activities, open zones and colour groups), `Workspace` router (board, consensus, breakout), `Consensus`, `Breakout`, `Board` (save, load, export) |
| `Teacher/shell*.js` | App chrome on top of `app.js`: home screen, tool rail, floating bars, selection toolbar, class panel, sheets (share, settings, templates, accessibility view), phone bottom navigation |
| `Student/app.js` | Store (IndexedDB), `Conn` (connection, watchdog, reconnect, outbox), message handler, views (setup, join, board, notes), full-screen task pages, shared-model viewer |
| `sw.js` | Precaches the shell so the console and student app open offline. The install is all or nothing for the app shell (`CORE`: every file must download within 30 s, with one retry, or the browser tries again on the next visit), best effort for extras (`EXTRA`, topped up on later visits). Network-first for code (updates arrive at once; after 4 s without a reply the cached copy answers, if there is one, otherwise it keeps waiting), cache-first for fonts, icons and libraries |

## Wire protocol

Messages are JSON strings with a `type`. The host accepts a **fixed allow-list** from students; everything else is ignored unless the sender authenticated as a co-host.

**Student → host:** `JOIN {name, avatar, sid}`, `NOTE`, `IMG_NOTE`, `DELETE_NOTE`, `POLL_VOTE`, `DATA_SUBMIT`, `SUBMIT_VOTE`, `SUBMIT_SORT`, `COMMENT`, `EXIT_SUBMIT`, `CONSENSUS_INK`, `VIEW {item}`, `ANNO_ADD {id, item, a}`, `ANNO_DEL {item, ids}`, `EXPLORE {set, id, open, done, star}`, `HEARTBEAT`, `LEAVE`.

**Host → student:** `WELCOME {boardId, mode, payload, sync, rules, muted, color, pending, timer, shared}`, `RULES`, `MUTE`, `KICKED {reason, msg}`, `SHARED {items}`, `ITEM {id, src?, annos | gone}`, `ANNO_STATUS {id, aid, status}`, `TIMER`, `NOTE_STATUS {id, status, reason}`, `SET_COLOR {color, name}`, `MODE`, `ZONE_ACT` / `OPEN_ZONE` / `ACT_VOTE` / `ACT_SORT` / `ACT_DISCUSS`, `ACT_POLL`, `ACT_GRAPH`, `EXIT_TICKET`, `STOP_ACT`, `CONSENSUS_START` / `_STOP` / `_PERMS` / `_INK` / `_CLEAR` / `_SET_INK` / `_ITEM_MOVE` / `_ITEMS` / `_VIEW_SYNC`, `HEARTBEAT`.

**Co-host ↔ host:** `AUTH_COHOST {key}` → `AUTH_OK` or `AUTH_FAIL`, then `FULL_SYNC`, `SYNC_REQ`, `ADD_ITEM`, `NOTE_UPDATE`, `BATCH_UPDATE`, `GROUP_ITEMS`, `UNGROUP_ITEMS`, `ZONE_REORDER`, `INK_ADD`, `LASER`, `STATE_META`, and for annotations `ANNO_ADD` / `ANNO_DEL` / `ANNO_OK` (co-host → host, applied by the host) and `ANNOS_SET {id, annos}` (host → co-host). A co-host's item edits never overwrite the host's annotations.

### Pictures, videos and annotations

A **media item** is `{type: 'media', kind: 'image' | 'video', title, desc, src, thumb, video, aspect, url, ref, source, annos}`.
Pictures are re-encoded on the teacher's device (JPEG, at most 1 800 px and 1 MB) and kept in the board, with a small `thumb`;
a video is `{p: 'youtube' | 'vimeo' | 'file', id | url, h?, start}`. Annotations (`annos`, also on link cards, which take
comments only) are `{id, k: 'comment' | 'ink' | 'callout' | 'hotspot', by: {n, r: 't' | 's', sid}, ts, text, tag, x, y, t, t2,
rad, pause, re, pts, c, w, tool, pend}`: places are 0–1 of the picture, moments are seconds. Students may add comments and
ink only; callouts and hotspots are the teacher's.

- **Least data still holds.** `SHARED` lists only display fields; a student who opens an item sends `VIEW`, gets one `ITEM`
  with the picture and the annotations they may see, and gets `ITEM` again only while they look at it.
  `visibleTo()` decides what that is: the teacher's, their own, and classmates' when the class rule "Students see each
  other's comments" is on (not while waiting for approval when "Approve notes first" is on); classmates' names follow
  "Show student names". Student ids are never sent to students; their own annotations carry `mine`.
- **Every annotation is re-checked** (`cleanAnno`): kinds, lengths (500 characters), places and moments clamped, at most
  1 500 points a stroke, 800 annotations an item and 60 per student an item, replies only to existing comments, the author
  taken from the connection, never from the message. Students may annotate only items shared with them (on their own or in a
  set they can see); they may delete only their own.
- **Not undo steps.** Annotations change through `StateManager.setAnnos` (`items:annos`): saved and synced, but undo never
  takes them away from items that still exist.
- **Players.** A `<video>` for files; YouTube (`youtube-nocookie.com`, `enablejsapi=1`) and Vimeo (`dnt=1`) in an iframe behind a
  cover, so nothing is requested from them until someone presses play, then driven through their documented `postMessage`
  protocols. CSP allows exactly those two frame origins and `media-src https:`.

### Exploring a shared zone

Sharing a plain zone (`toggleShare(zoneId)`) sends each student a `set`: the zone's cards, pictures and videos and the
teacher's own text notes as prompts (students' notes are left out). A zone with a group colour goes only to that group.
Students work through it on their own (`EXPLORE` reports opened / done / starred, kept per student and device in
`localStorage` and in `State.explore` on the console, live only). The set follows the board while it is shared: cards added,
renamed or removed reach students at once, and withdrawing it closes their explorer. Vote, rank and discuss also take cards,
pictures and videos (their titles).

Every activity start carries a fresh round id (`rid`), so a student can answer again when the teacher re-runs the same item; the host accepts one answer per student per round.

### Open zones and colour groups

Several zones can be open at once (`State.activity` is `ZONE_ACT` with `payload.subType = 'OPEN_ZONE'` and `payload.zones = [ids]`). Each student gets their **own** `OPEN_ZONE` message rather than a broadcast:

- `zones: [{id, title, zoneType, color, group}]` lists the open zones that student may write into: zones of their colour group plus uncoloured zones. A student with none of their own (no group, or their group's zone is closed) gets every open zone with `unplaced: true` when the class rule "Students without a group pick a zone" is on, or an empty list with `waiting: true` when it is off.
- `actId`, `title` and `zoneType` describe the first zone, so an older student app still works with a single zone.
- The host re-sends it whenever zones open or close, a student's group changes (`SET_COLOR`), or an open zone is renamed, recoloured or deleted. Groups are remembered by `sid`, so a student who reconnects keeps their group.

A student note's `zoneId` is honoured only if that zone is in the student's own list; otherwise the note goes to their first zone, and a student with no zone at all gets `NOTE_STATUS {status: 'rejected', reason: 'group'}` (the student app offers "Try again" once they are placed). Which items are live (`isOpen`) is derived from the activity by `Network.syncOpenFlags()` and is kept out of undo history, so undo never opens or closes anything and a board saved mid-activity reopens with nothing live.

`CONSENSUS_ITEMS {items}` refreshes the notes on a shared model (for example after the teacher turns strokes into a note); students rebuild their model view from it.

### Ink selection

Strokes are picked by geometry (`InkTools.hit`, a fixed number of screen pixels, wider for fingers), not by their thin painted paths. Each canvas has an `InkSel` controller (`InkSel.board`, `.consensus`, `.breakout`) holding the selected stroke ids and an adapter for that canvas's storage, history and network sync, so recolour, thickness, move, duplicate, delete and "make one note" behave the same everywhere. On the board a box selection, Shift-click, Ctrl/⌘A, arrow keys and Delete act on notes and ink together, as one undo step (`StateManager.batch`). "Make one note" renders the selected strokes into a single transparent PNG (`InkTools.toImage`, capped so it syncs to students) and places the note where the drawing was; "Pin ink as notes" makes one note per drawing (strokes within 60 px of each other).

### Connection behaviour

- The host sends `HEARTBEAT` every 3 s. A student that hears nothing for 10 s closes the connection and reconnects with exponential back-off (1 s doubling to 15 s, with jitter). Visibility and `online` events retry immediately.
- A student has a random identity (`sid`) stored on their device. Reconnecting replaces the stale connection instead of creating a duplicate, and mute / removal follow the `sid`.
- Messages that must not be lost (notes, votes, answers) go to a **durable outbox** while the student is offline. Notes keep a status (`sending`, `approved`, `pending`, `rejected`) shown in My notes, and any note still `sending` is resent after the next `WELCOME`.
- "New code" sends `KICKED {reason: "code-reset"}`, waits a moment so it arrives, then re-registers under a new id. A removed student stays blocked for the life of the code.

## Security model

Everything that arrives over the network (and everything imported from a file) is untrusted.

- **No HTML from data.** Text is placed with `textContent` or escaped with `esc()`; ids pass `safeId`, colours `safeColor`, images `safeImg` (raster `data:` URIs only; no SVG, no remote URLs, size-capped). There are no inline event handlers.
- **Allow-listed messages.** Students may send only the types listed above; board-sync messages require co-host authentication. Names lose control characters and angle brackets, avatars must come from the built-in set, note types are coerced to the known list.
- **Limits.** Token-bucket rate limit per connection (cap 40, 15 per second; images and annotations cost more), 80 notes per student, 60 annotations per student per item, 4 MB per message (40 MB from an authenticated co-host, who syncs whole boards), bounded lists everywhere.
- **Least data.** Students never receive board state, only the activity currently running. Co-host access requires a secret key that changes whenever the code is reset.
- **Content-Security-Policy.** Every page carries a CSP `<meta>` that allows scripts only from this site: no inline `<script>` blocks (the theme and service-worker bootstrap live in `shared/boot.js` and `shared/sw-register.js`), no inline event handlers, no `eval`. If escaping ever failed, the browser would still refuse to run injected markup; `tests/site.test.js` proves this by injecting `onerror`, `srcdoc` and script elements and checking that nothing runs. `connect-src` allows any `https:`/`wss:` host so a self-hosted PeerServer works without edits; `worker-src` allows `blob:` for the confetti worker.
- **No third-party code or analytics.** Libraries, fonts and icons are self-hosted (`vendor/`, `fonts/`, `icons/`); `tests/site.test.js` fails if a page requests anything from another origin. The only exception is a YouTube or Vimeo video the teacher added, and only after someone presses play on it (`tests/media.test.js` checks both). WebRTC itself uses PeerJS's default infrastructure: its signalling service, Google's STUN server and PeerJS's TURN relays (the relays only carry DTLS-encrypted data). All of it can be replaced through `DQB_PEER_OPTS` (see `docs/SELF_HOSTING.md`).

## Embedding (host sites)

A site that offers InquiryDQB as a built-in tool defines `window.DQB_HOST` before the app scripts: account storage for boards,
a resource library, signed-in student identities, a roster with an admission rule, extra class rules and group actions, and a
"send to my class" button; the console reports sessions and participation as `dqb:*` events. Standalone nothing changes.
See [EMBEDDING.md](EMBEDDING.md). **Link cards** (`type: 'link'`) and **sharing** (`SHARED`) work standalone too: Insert › Link.

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
| `groups.test.js` | Several colour zones open at once, per-student routing, students without a group (pick a zone or wait, "Put them in groups"), host-side zone validation, live updates when zones are renamed / recoloured / closed, groups surviving a reconnect, the Groups sheet, no stale live zones after reload |
| `ink.test.js` | Picking strokes by click, Shift-click, box and touch; moving, recolouring, thickness, duplicate, delete and undo; several strokes into one note; clustered pinning; the same tools in a consensus model (synced to students) and a breakout room |
| `resilience.test.js` | Shared model, drafts on a locked board, reconnecting, offline outbox, removing a student, resetting the code |
| `security.test.js` | A hostile client: injected names and text, forbidden messages, spoofed ids, bad images, wrong co-host key, oversize and flood |
| `teacher-ui.test.js` | Pointer and keyboard editing on desktop, changing type and locking several notes at once, exports, co-host (including live zones and deletions mirrored from the host), persistence; phone navigation and back button |
| `site.test.js` | Landing page, no third-party requests, manifests and precache list, offline start-up, all-or-nothing install with a retry, slow replies |
| `a11y.test.js` | axe-core audit (WCAG 2.0/2.1 A + AA, best practices) of the landing page, teacher console (including selected ink, the Groups sheet and open zones) and student app (including choosing a zone) in light and dark themes, on desktop and phone |
| `load.test.js` | A full class: 30 students join at once and send 90 notes; nothing overlaps and the host stays responsive |
| `legacy.test.js` | Boards and notes saved by earlier versions (same IndexedDB databases) still open, and hostile text inside them stays inert |
| `touch.test.js` | Real touch input on a phone: drawing a sketch, panning, dragging a note and pinch-zooming the board |
| `media.test.js` | Video addresses, safe media items and annotations, the viewer on the console (pins, drawing, callouts, hotspots; moments, timeline and seeking on a video file), YouTube and Vimeo stand-ins driven through their postMessage protocols and loaded only on play, students annotating over WebRTC, class rules (names, classmates' comments, approval), a hotspot pausing a student's video, hostile annotation messages and limits, undo leaving annotations alone |
| `explore.test.js` | Collections with videos, a zone shared as a set (cards, pictures, videos, the teacher's prompt), opening / finishing / starring with progress on the console and after a reload, group-only sets, the set following the board and being withdrawn, vote and rank on resources |
| `history.test.js` | The browser history behind sheets: a sheet handing over to another, chained dialogs (also with reduced motion) and a sheet opening while the browser is still going back never leave the board |
| `host.test.js` | A fake host (`DQB_HOST`): boards saved to and opened from the account on a second device, no re-upload when nothing changed, the library (cards, pictures, whole collections, unsafe results dropped), Insert › Link, signed-in students (fixed name, check mark, group, contributions), the admission rule, shared links (late joiners, hostile messages, withdrawal on delete), share / groups / join-screen additions |

## Extending

To add an activity: (1) host side, add a `Network.broadcastX()` that calls `Network.transitionTo(type, targetId, payload)`; (2) add the response type to `STUDENT_MESSAGES` and a `case` in `Network.handle` that validates, de-duplicates with `Network._once`, and updates `State`; (3) student side, add a `case` in `Handle`, a card in `Views.renderBoard` and, if it needs room, a page in `Student/index.html` opened with `Pages.open`; (4) add a test next to the others.

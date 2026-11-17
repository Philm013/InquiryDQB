# Embedding InquiryDQB in another site

InquiryDQB runs on its own with no server. A site that wants it as a built-in tool (TechieTeaching does) can plug in its accounts,
storage and library through one optional object, `window.DQB_HOST`, defined by a script that loads **before** the app scripts.
Without it every page behaves exactly as the standalone app. All hooks are optional; each one is used only if it is there.

Everything a host passes in is still treated as untrusted: link addresses go through `DQBUI.safeUrl` (http/https only), pictures
through `DQBUI.safeThumb` (raster data-URIs or a path on the same site, never another site), text is clamped and rendered as text,
and boards loaded from a host are sanitised item by item like anything that arrives over the network.

## Paths

| Key | Type | Used for |
|---|---|---|
| `assetBase` | string | Folder of `vendor/`, `fonts/`, `icons/` when the pages are not served from the repository layout (default `../`) |
| `studentUrl` | string | Absolute address of the student page, used in join links and QR codes (default `../Student/`) |
| `joinPage` | string | The address students are told to type in the Share sheet (a short page with a join form; default the student page) |
| `swUrl` | string or `null` | The host's service worker (and so its scope); `null` registers none (default `../sw.js`) |
| `leaveUrl` | string | Where "Leave board" goes (default: back to the boards home) |

## Teacher console

| Key | Shape | What changes |
|---|---|---|
| `ns` | string (`[A-Za-z0-9_-]`) | Local storage per account: IndexedDB `DQB_Ultimate_<ns>` and `lastBoard:<ns>`, so two teachers who share a browser never see each other's boards |
| `brand` | `{name, sub, homeUrl, homeLabel}` | Name under the logo and a "back" link on the boards home |
| `openBoard` | board id | Opens that board as soon as the console starts (a host's "Open board" link) |
| `storage` | `{label, list(), load(id), save(board), remove(id), rename(id, name)}` (promises) | Boards are saved to the host account as well as the device. `list()` returns `[{id, name, ts, notes, preview}]` (`preview` = light items for the thumbnail). The newest copy (by `ts`) wins when a board opens; a change is sent about 2.5 s after the last edit, one upload at a time, and only when something changed. Offline, the status reads "Saved on this device" and the upload is retried |
| `library` | `{name, title, search(q, kind), items(collectionId)}` | "Library" in the Insert and More menus. `search` returns `[{id, kind: 'resource'|'collection', title, desc, url, thumb, meta, source}]`; each result can become a card, a picture students can annotate (from `thumb`, re-encoded into the board), a video (when `url` is a YouTube, Vimeo or video-file address), a card shared with students at once, or (collections, with `items`) a zone holding every resource, its videos playable. Share the zone and students explore it on their own |
| `roster` | `{lookup(sid), admit(sid, known), refusal}` | `lookup` returns `{name, verified, color, info}` for a student the host knows (shown with a check mark, named by the host, placed in a colour group). `admit` returning `false` turns a student away with `KICKED {reason: 'restricted', msg: refusal}` |
| `rules` | `[{title, sub, get(), set(v)}]` | Extra switches in Class rules (e.g. "Only my students can join") |
| `groupActions` | `[{label, hint, run()}]` | Extra buttons in the Groups sheet (e.g. "Use my class groups") |
| `share` | `{title, label, status(), open(info)}` | A block at the top of the Share sheet (e.g. "Send to my class"); `open` gets `{code, url, boardId, name}` |
| `verifiedLabel` | string | Tooltip of the roster check mark |
| `inbox` | `{pull(boardId), ack(boardId, ids), manageUrl(boardId)}` (promises) | Takes in what students added while the board was open for them without the console (see [Boards open without the teacher](#boards-open-without-the-teacher)). `manageUrl` is the host's page for changing or closing that, opened from the "Open until …" chip in the top bar |

### Events

The console reports what happens with DOM events on `window` (`detail` in brackets), so a host can record sessions and
participation without patching the app:

| Event | When |
|---|---|
| `dqb:board` `{id, name, fresh}` | A board opened |
| `dqb:hosting` `{code, boardId, name}` | The board is reachable under a join code |
| `dqb:rename` `{id, name}` | The board was renamed |
| `dqb:join` `{sid, name, verified, boardId}` | A student joined |
| `dqb:contribution` `{sid, kind, boardId, verified}` | A student added a note or answered (`note`, `poll`, `data`, `vote`, `rank`, `comment`, `exit`), drew on a picture or video (`markup`), or opened something in a shared set (`explore`, once per item) |
| `dqb:share` `{id, title, url, kind, ref}` | Something was shared with students: a card (`kind` `resource`, `collection` or `link`), a picture or video (`image`, `video`) or a zone to explore (`set`) |
| `dqb:leave` `{id}` | The teacher left the board |

## Student app

| Key | Shape | What changes |
|---|---|---|
| `identity` | `{sid, name}` | A signed-in student: the host issues the `sid` and the name (fixed; only the avatar can be chosen, remembered per account). Nothing about the account is stored for the next guest on the device, and "My notes" shows only this student's notes |
| `identityHint` | string | Text under the fixed name |
| `live` | `() => Promise<[{code, title, teacher, lesson}]>` | "Live now" boards on the join screen, joined with one tap |
| `mailbox` | `{list(), view(id), item(id, itemId), send(id, msg)}` (promises) | Boards open for this student without the teacher's console: "Open for you" on the join screen, `?open=<id>` in the address (see below) |

## Boards open without the teacher

Normally a board is live only while its teacher has the console open: the console is the host students connect to. A host site
can also leave a board **open for students** while nobody runs it, for homework or a station. The site then stands in for the
console. It shows students what the teacher shared and, if the teacher allows, the notes on the board. It also keeps what they
add (the same messages a live board gets) in an inbox until the console takes it in.

**Student app (`DQB_HOST.mailbox`).** `?open=<id>` (or "Open for you" on the join screen) opens the board through the host instead
of a peer connection. The board tab shows the board's name and closing time, what is shared and the note tiles, plus "See the
board" (`p-wall`) when the teacher lets students see the notes. Writing, sketching, comments and drawings on pictures, videos and
cards, and exploring a shared zone work as in class; class activities (polls, votes, exit tickets) need the teacher there.

| Call | Resolves with |
|---|---|
| `list()` | `[{id, title, teacher, lesson, until}]` (an ISO time or `null`) |
| `view(id)` | `{board: {id, title}, until, teacher, lesson, notes: {open, zone: {id, title} \| null}, rules: {names, approve, peers}, shared, wall, mine}`, or `{gone: true, msg}` when the board is closed or not for this student. `shared` has the `SHARED` entries below; `wall` is `{zones: [{id, title, notes}], loose: [notes]}` with notes `{id, sub, text, author, mine, sketch, waiting}` (`waiting`: not on the board yet), or `null`; `mine` maps the student's note ids to `on`, `queued` (kept for the teacher), `pending` (the teacher checks it first) or `removed` (declined or taken off) |
| `item(id, itemId)` | `{id, src, annos}` like `ITEM` (the picture, and the annotations this student may see), `{id, gone: true}`, or `{closed: true, msg}` |
| `send(id, msg)` | `{status}`: `queued`, `pending`, `locked` (notes are off), `limit`, `bad`, `gone` (not shared with them) or `closed` (with `msg`). Messages are `NOTE`, `IMG_NOTE`, `DELETE_NOTE`, `ANNO_ADD`, `ANNO_DEL` and `EXPLORE`, as on a live board |

A rejected promise means the host could not be reached: the message stays in the outbox and is sent again in order, and the app
checks the host every 20 seconds (and at once when the page is shown again or the device comes back online). The board tab is
redrawn only when something changed, and keyboard focus stays where it was.

**Console (`DQB_HOST.inbox`).** When a board opens, and every 15 seconds while it is open, the console calls `pull(boardId)`,
which resolves with `{open: {session, until, settings} | null, sessions: {<session>: settings}, entries: [{id, session, sid, name,
msg, ts}]}` (`settings`: `{notes, zone, see, names, approve, shared}`). Every message is checked again as a live one would be:

* Notes go into the zone the teacher chose (`settings.zone`), otherwise into a "From students" zone made the first time. With
  `approve` they wait in the approval queue and stay in the inbox until the teacher decides.
* Comments and drawings go onto the shared picture, video or card (`pend` with `approve`). Withdrawn ones come off.
* Exploring shows on a zone the console is sharing at the time.
* Nothing counts as a contribution here: the host counted it when the student sent it.

The console calls `ack(boardId, ids)` only once the board holding the messages is saved (to the host account when there is one),
so a closed tab or a failed upload loses nothing; taking a message in twice changes nothing (notes and annotations keep their ids).
The "Open until …" chip in the top bar shows while the board is open for students.

## Messages added for hosts and link cards

* `SHARED {items}` (host → student, also inside `WELCOME` as `shared`): what the teacher shares right now, per student.
  Entries are `{type: 'link', id, title, desc, url, thumb, kind, source}`, `{type: 'media', id, kind, title, desc, thumb, video,
  aspect, source}` or `{type: 'set', id, title, color, group, items}` (a zone to explore; its items are links, media and
  `{type: 'text', text}` prompts). Students show them as "Shared with you"; links open in a new tab with `noopener noreferrer`.
  Pictures and annotations come separately (`VIEW` → `ITEM`), see ARCHITECTURE.md.
* `KICKED {reason: 'restricted', msg}`: the host's admission rule turned the student away.

## Link cards

A board item of type `link`: `{url, title, desc, thumb, kind: 'resource'|'collection'|'link', ref, source}`. Teachers add one
with Insert › Link (any web page) or from a host library. A card can be opened, edited (plain links) and shared with the class;
sharing is live state (`State.shared`), never saved with the board, and a deleted or edited card updates every student at once.

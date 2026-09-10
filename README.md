# YARG Remote

A phone app for the song queue in [our YARG fork](https://gitlab.badassium.com/fatalexception/yarg).
Search the library, put songs in the queue, and — when the host turns voting on —
suggest a song and let the room decide.

It talks to the small HTTP server the fork runs in-process
(`Assets/Script/Integration/RemoteQueue/`), on port **8099**. There is no account,
no cloud, and no traffic that leaves the house.

- **Upstream issue:** YARG [#860](https://github.com/YARC-Org/YARG/issues/860),
  "built-in web server for remote song queue/search".
- **Licence:** LGPL-3.0-or-later, matching upstream YARG.

---

## What it does

| Tab | What it is for |
| --- | --- |
| **Find** | Search the library. `Queue` puts a song in. `Suggest` puts it up for a vote. |
| **Up next** | What is actually going to play. Vote a song up or down, or take it out. |
| **Suggestions** | The board. Two votes per song: *play this at all?*, then *next, or the setlist?* |

### The thing that is easy to get wrong about voting

**Nobody can touch a phone during a song.** Both hands are on a plastic guitar.
So the only moment a vote means anything is the gap between two songs, and the
app says so loudly: a yellow **Voting open** banner with a countdown, driven by
`intermission` and `intermission_seconds` from the server.

The game holds the score screen open while that vote is running rather than
advancing to the next song. The host can always override by pressing Continue.

---

## Running it

You need the fork running with **Settings → Experimental → Remote queue** set to
**LAN** (not `Local`, which binds loopback only and is unreachable from a phone).
The game shows the address; type it into the app once and it is remembered.

```bash
npm install --include=dev   # see "npm on Windows" below
npm run dev                 # browser, for development
npm run build               # bundles to dist/
npm test                    # vitest
```

### Native

```bash
npx cap add ios
npx cap add android
npm run build && npx cap sync
npm run ios        # opens Xcode
npm run android    # opens Android Studio
```

#### Native setup, applied after `cap add`

**A console on a home LAN has no certificate, so both platforms need a cleartext
exception.** This is not a shortcut around HTTPS; there is nothing to get a
certificate *for* — the address is an RFC1918 or CGNAT IP that changes per party.

- **iOS** — in `ios/App/App/Info.plist`, under `NSAppTransportSecurity`, set
  `NSAllowsLocalNetworking` to `true`. This permits cleartext to local addresses
  only, which is narrower than `NSAllowsArbitraryLoads` and is the correct one
  here. iOS 14+ also shows a local-network permission prompt on first use, so set
  `NSLocalNetworkUsageDescription` to something a person can act on.
- **Android** — add a `network-security-config` permitting cleartext to private
  ranges and reference it from `AndroidManifest.xml`. `usesCleartextTraffic=true`
  across the whole app is the lazier option and is not what we want.

`ios/` and `android/` are gitignored: they are generated, and regenerating them
is a `cap add` away. The consequence is that the two edits above must be
**re-applied after a fresh clone**, which is exactly why they are written down
here rather than left in a diff.

---

## How it talks to the game

Every request carries **`X-Yarg-Remote: 1`**. The value is irrelevant; the
presence is the point. The server rejects mutating requests without it
(`RemoteQueueServer.IsRequestShapeAllowed`), because a custom header forces a
CORS preflight that the server never answers — so a web page somebody has open
elsewhere in the house cannot drive the console.

This app is not a web page. `CapacitorHttp` routes `fetch()` through the native
stack, where there is no CORS to satisfy, and the request is labelled with the
shell's own origin (`capacitor://localhost` on iOS, `http://localhost` on
Android). The server allows exactly those, deliberately — see
`IsNativeShellOrigin`. That allowance does not weaken the cross-origin check,
because a real web page cannot claim one of those origins.

It sends the header anyway, so that `npm run dev` in a browser exercises the same
code path the shipped app does.

### Endpoints used

| Call | Endpoint |
| --- | --- |
| `health()` | `GET /healthz` |
| `search()` | `GET /api/library?q=&limit=` |
| `board()` | `GET /api/board` |
| `queue()` | `GET /api/queue` |
| `add()` | `POST /api/queue` — hash in the body |
| `move()` | `POST /api/queue?action=up\|down` |
| `remove()` | `DELETE /api/queue?hash=` — hash in the **query**; HttpListener gives no body on a DELETE |
| `suggest()` | `POST /api/suggest` |
| `voteSuggestion()` | `POST /api/vote?dir=up\|down` |
| `voteQueued()` | `POST /api/vote?on=queued&dir=up\|down` |
| `decide()` | `POST /api/decide?choice=next\|setlist` |

Refusals come back as JSON — `{"error": "..."}` — and those messages are written
to be read by a person ("the board is full (40); vote some off first"), so the
app puts them on screen verbatim rather than showing a status code.

---

## Deliberate limits

Stated plainly, because a party jukebox that needed accounts would not get used:

- **No authentication.** Anyone who can reach the port can queue a song. The
  server binds private ranges only (RFC1918, link-local, and 100.64.0.0/10 for
  Tailscale), so "anyone" means anyone already on the network.
- **A vote is one socket address**, not one person. Two people sharing a tablet
  get one vote between them; a determined person with two devices gets two. This
  replaced a client-generated id that was measured and found worthless — one
  client rotating that header scored 51 votes against a threshold of 3.
- **Plain HTTP.** See above.
- **Polling, not push.** Every 2.5 s, paused while the app is backgrounded. The
  server is `HttpListener` inside a Unity game loop; holding a socket open per
  phone is not worth what it would buy.
- **No discovery yet.** The address is typed in once. mDNS on the game side is a
  planned follow-on, not a prerequisite — the sibling ShopStack Mobile app has no
  discovery at all and is in daily use.

---

## npm on Windows

`npm config get omit` returns `dev` on the ENG2 workstation, from the global
npmrc. A plain `npm install` there **silently installs no devDependencies** and
exits 0 — no vite, no typescript, no vitest — and the failure surfaces later as
`'vite' is not recognized`, which reads like a broken package.json. Use
`npm install --include=dev`.

---

## Repository

`origin` is GitLab on Vault2. GitHub is a **downstream, force-overwritten
mirror** — never push, commit, or open a PR there first.

```
origin   https://gitlab.badassium.com/fatalexception/yarg-remote.git
mirror   https://github.com/Coffeehedake/yarg-remote.git   (push-only, downstream)
```

Part of the "YARG — Open Source Contributions" project. The umbrella instructions — every repo,
their remotes, the tooling and the constraints that span them — are in the sibling
`yarg-song-server/docs/WORKSPACE.md`; this file covers only this repo.

## What this is

The phone app for the remote song queue in the fork. It is a **client and nothing else**: it holds
no state the game does not hold, and every screen is a rendering of what the server just said.
If you find yourself keeping a queue in React state and reconciling it, stop — that is how the two
disagree in front of a room full of people.

The server it talks to is in the sibling `yarg` repo, at
`Assets/Script/Integration/RemoteQueue/`. **That code is the authority for every wire shape here**,
and `src/types.ts` is a transcription of `RemoteQueueBridge.cs`, not a design of its own.

## Read before changing anything on the wire

| File | What it settles |
|---|---|
| `../yarg/Assets/Script/Integration/RemoteQueue/RemoteQueueServer.cs` | Every route, method, query parameter and status code. Also the request-shape gate. |
| `../yarg/Assets/Script/Integration/RemoteQueue/RemoteQueueBridge.cs` | The DTOs. Unity's `JsonUtility` serialises public fields verbatim, which is why this repo's types are snake_case. |
| `../yarg/Assets/Script/Integration/RemoteQueue/RemoteQueueVotes.cs` | The two-stage vote, the threshold, and the stable sort. |
| `README.md` | The endpoint table, the native cleartext setup, and the limits we chose on purpose. |

## Rules

- **Push to `origin` only** (`gitlab.badassium.com/fatalexception/yarg-remote`). GitHub is a
  downstream force-overwritten mirror — never push, commit or open a PR there first.
- **`X-Yarg-Remote` goes on every request, reads included.** The server rejects mutating requests
  without it. Losing it breaks every write while every read keeps working, which is the worst
  possible failure to debug on a phone at a party. `src/api.test.ts` asserts it.
- **Never rename a wire field to camelCase.** Nothing on the wire would change; the app would just
  stop reading the response. `src/types.ts` is a transcription — keep it one.
- **Do not sort the queue client-side.** The server's sort is stable and only re-sorts when
  somebody votes, which is what lets a host hand-arrange a setlist and have it survive. A local
  sort quietly undoes that on every poll.
- **`--include=dev` on `npm install` here.** `npm config get omit` is `dev` on the ENG2
  workstation, from the global npmrc, so a plain install exits 0 having installed no build
  tooling at all. The failure surfaces much later as `'vite' is not recognized`.
- **The two native edits are not in the repo.** `ios/` and `android/` are generated and
  gitignored, so `NSAllowsLocalNetworking` and the Android network-security-config must be
  re-applied after a fresh clone. README, "Native setup", is the record.
- **Verify by measuring.** A green `npm test` proves the client sends what we *think* the server
  wants; it proves nothing about the server, because the stub is ours. `src/live.test.ts` is the
  one that settles it, against a real console.

## Running the contract test

```powershell
# 1. a real listener, from the fork. Win32_Process.Create, NOT Start-Process:
#    a process started from a Cowork bridge call inherits a job object that
#    kills Unity's Package Manager child, and the editor then dies claiming
#    anti-virus. Quote the project path; the folder name has spaces.
$cmd = '"C:\Program Files\Unity\Hub\Editor\6000.3.5f2\Editor\Unity.exe" -batchmode -nographics' +
       ' -projectPath "C:\dev\YARG - Open Source Contributions\yarg"' +
       ' -logFile "$env:TEMP\yarg-host.log"' +
       ' -executeMethod Editor.RemoteQueueHost.RunLocal'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
# wait for REMOTE_QUEUE_HOST_READY in the log (~100s from cold)

# 2. drive it
$env:YARG_CONSOLE = 'http://127.0.0.1:8099'; npx vitest run src/live.test.ts

# 3. afterwards: Stop-Process -Name Unity, then in the fork
#    git checkout -- ProjectSettings/ProjectSettings.asset
```

**Red-proof any change to it against a dead port**, not only against a live one. The first version
of this file had two cases that passed with no server at all: they asserted `status !== 400`, and
an unreachable console is `status 0`. A test that a wrong answer and *no answer* both satisfy is
measuring nothing.

## What is NOT verified yet

Written down rather than implied by a passing build:

- **Nothing has been built for a device.** No `cap add` has been run; iOS and Android are untested,
  and the cleartext exceptions above are documented rather than applied.
- **The two-queue routing** (setlist vs running show vs pending) is only PARTLY exercised. See
  below: the `pending` target was driven against a real game on 2026-11-03; the setlist and
  running-show targets were not.
- **The phone app itself has still never driven this.** What was tested is the HTTP surface the
  app speaks, driven with `curl`. That is the same contract and it is not the same thing as the
  app: nothing has exercised `yarg-remote`'s own request building, its error handling, or
  `src/types.ts` against a live listener.

## What the remote queue DID do against a running game — measured 2026-11-03

The first time this has been driven against a real windowed game with a real library, rather
than batchmode where "every hash the contract test sends is deliberately unknown". It matters
because `RemoteQueueBridge` was **ported onto `Setlist`** during the 2026-11-02 upstream merge —
the type it depended on was replaced underneath it — and until now only `SetlistGuardProbe`'s
pure decision functions had been measured.

```
GET  /api/library            4,080 songs offered, 100 per page
GET  /api/queue              {"playing_show":false,"index":0,"target":"pending","songs":[]}
POST /api/queue  (no header) 403            <- the X-Yarg-Remote guard, seen refusing
POST /api/queue  x2          200 {"queued":true,...,"target":"pending"}
GET  /api/queue              both songs, with name/artist/album/charter/length_ms/score
POST /api/queue?action=up    409 "waiting for the music library screen to be opened"
POST /api/queue  bad hash    404 "no song with that hash"
DELETE /api/queue?hash=…     200 {"removed":true,...}, and the queue kept only the other song
GET  /api/board              200
```

**Zero exceptions in the game log for the whole run.** A queued song appearing in the queue with
its metadata is now a measurement rather than an inference.

Two things that are still not:

- ~~**Reorder.** `Move` has never been seen to succeed.~~ **Done, 2026-11-04.** With the music
  library screen open the queue's `target` becomes `setlist` and it moves:
  `{"moved":true,...}`, and the list order actually changed. The 409 is purely about which
  screen the game is on.
- **The running-show target.** `pending` and `setlist` have both now been seen; `show` has not,
  because that needs a show actually playing. `target` is the field to watch.

## Sorting: the app offers what the menu offers — added 2026-11-04

`/api/library` takes `sort`, `offset` and `limit`, and answers with the sorts on offer.

**The app holds no list of sorts.** They arrive with every page, derived on the game side from
`MusicLibraryMenu.NextSort`'s own cycle — `Name` up to `Random`, skipping `Playable` — so the
phone cannot offer a sort the menu lacks or miss one it has. Each carries the game's **own
localized label**, which matters more than it sounds: the game calls `Name` **"Song"** and
`SongLength` **"Duration"**. An app inventing its own labels would have shown the wrong words.

```
17 options: Name Artist Album Artist_Album Genre Subgenre Year Charter Folder
            Source SongLength DateAdded Playcount Stars Percentage Score Random
labels:     Song Artist Album "Artist - Album" Genre Subgenre Year Charter Folder
            Source Duration "Date Added" "Play Count" Stars Percentage Score Random
```

Asking for no sort is the right default: the server then uses whatever the game is showing, and
says which in `sort`. An unrecognised sort falls back the same way rather than failing.

**The 500-song ceiling is gone.** The endpoint used to answer with the first `limit` matches and
nothing else, so a phone could not see most of a 4,085-song library — and sorting on the phone
would only ever have ordered whatever arrived. Measured after the change: **4,080 songs walked in
9 pages.**

`matched` and `total` are different numbers and the UI needs both — the first is how many match
the query, the second how many songs exist. Knowing only `total`, a client cannot tell when a
filtered list has ended.

Songs carry the `category` they sit under so the phone can group its list the way the game groups
its own. One song can appear under two headings — the Folder sort lists it in every playlist it
belongs to, exactly as the game does — so React keys need the index, not just the hash.

One trap for whoever writes the next test: **the hashes come back UPPERCASE.** A `[a-f0-9]{40}`
pattern matches nothing, and the symptom is the server answering `400 "a 'hash' is required"` to
every mutating call, which reads as a broken request body rather than a broken regex.

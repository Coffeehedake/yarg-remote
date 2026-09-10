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
  wants; it proves nothing about the server, because the stub is ours. The only thing that settles
  the contract is driving a real console — the same standard the rest of the project holds to.

## What is NOT verified yet

Written down rather than implied by a passing build:

- **No run against a live console.** Every endpoint spelling here was read off the C# and asserted
  against a stub. That catches a typo in our own code and nothing else.
- **Nothing has been built for a device.** No `cap add` has been run; iOS and Android are untested,
  and the cleartext exceptions above are documented rather than applied.
- **The two-queue routing** (setlist vs running show vs pending) is unexercised end to end. It is
  also unexercised on the game side — batchmode has no menu scene — so "a queued song appears in
  the setlist" is inference on both ends of the wire.

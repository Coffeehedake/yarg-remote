// The contract test: THIS FILE IS THE ONLY THING HERE THAT TALKS TO A REAL
// CONSOLE.
//
// Everything in api.test.ts is asserted against a stub we wrote, which can only
// ever confirm that the client sends what we *think* the server wants. This one
// points the same client at a live listener, so a route we misread, a query
// parameter we misspelled, or an error body shaped differently from our guess
// shows up as a failure rather than as an app that silently does nothing.
//
// Skipped unless YARG_CONSOLE is set, because most runs have no console:
//
//   $env:YARG_CONSOLE = 'http://127.0.0.1:8099'; npx vitest run src/live.test.ts
//
// Bring one up from the fork with:
//
//   Unity.exe -batchmode -nographics -projectPath <yarg> \
//             -executeMethod Editor.RemoteQueueHost.RunLocal
//
// WHAT THIS CANNOT PROVE, stated so a green run is not read as more than it is:
// batchmode has NO SONG LIBRARY, so every hash is unknown and nothing can
// actually be queued. What is verified is that we ask the right questions at
// the right addresses and read the answers correctly. "Queueing a real song
// works" still needs somebody to play the game.

import { describe, expect, it } from "vitest";

import { ApiError, MARK_HEADER, YargClient } from "./api";
import type { DecideResult } from "./types";

const CONSOLE_URL = process.env.YARG_CONSOLE;

// A hash that is 40 hex characters and belongs to nothing. The server should
// reject it on the merits - "no song with that hash" - rather than on its shape,
// which is what makes it useful for probing routes.
const ABSENT = "0".repeat(40);

describe.skipIf(!CONSOLE_URL)("against a live console", () => {
  const client = new YargClient(CONSOLE_URL ?? "", { timeoutMs: 10_000 });

  it("is a YARG console", async () => {
    expect(await client.health()).toBe("ok");
  });

  // ------------------------------------------------------------------
  // Reads: the fields exist and have the types types.ts claims
  // ------------------------------------------------------------------

  it("answers /api/library with the shape types.ts transcribes", async () => {
    const result = await client.search("", 5);
    expect(typeof result.query).toBe("string");
    expect(typeof result.total).toBe("number");
    expect(typeof result.shown).toBe("number");
    expect(Array.isArray(result.songs)).toBe(true);
  });

  it("answers /api/queue with the shape types.ts transcribes", async () => {
    const queue = await client.queue();
    expect(typeof queue.playing_show).toBe("boolean");
    expect(typeof queue.index).toBe("number");
    expect(["show", "setlist", "pending"]).toContain(queue.target);
    expect(Array.isArray(queue.songs)).toBe(true);
  });

  it("answers /api/board with the shape types.ts transcribes", async () => {
    const board = await client.board();
    expect(typeof board.threshold).toBe("number");
    expect(typeof board.voting).toBe("boolean");
    expect(typeof board.intermission).toBe("boolean");
    expect(typeof board.intermission_seconds).toBe("number");
    expect(Array.isArray(board.suggestions)).toBe(true);
    // snake_case, and it must stay snake_case: Unity's JsonUtility serialises
    // public fields verbatim, so a camelCase rename here changes nothing on the
    // wire and just stops us reading the response.
    expect(board.queue).toHaveProperty("playing_show");
  });

  // ------------------------------------------------------------------
  // Writes: reached the right handler, and the refusal is on the merits
  // ------------------------------------------------------------------

  // 404 "no song" means the route matched, the method was allowed, the mark
  // header passed the shape gate, and the hash was read out of the BODY. A
  // wrong path would be 404 "no such endpoint"; a wrong method, 405; a missing
  // header, 403. So the message matters as much as the code.
  it("reads the hash out of the body on POST /api/queue", async () => {
    const error = await client.add(ABSENT).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toMatch(/hash/i);
    expect((error as ApiError).message).not.toMatch(/endpoint/i);
  });

  // HttpListener gives no body on a DELETE, so this one has to be in the query.
  // If it were not, the server would answer 400 "a 'hash' is required".
  it("reads the hash out of the query on DELETE /api/queue", async () => {
    const error = await client.remove(ABSENT).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).not.toBe(400);
  });

  it("routes ?on=queued to the queue vote rather than the suggestion vote", async () => {
    const error = await client.voteQueued(ABSENT, false).catch((caught: unknown) => caught);
    // The queued branch 404s on an unknown song; the suggestion branch answers
    // 200 for anything. So a 200 here would mean ?on=queued never arrived.
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it("accepts our two spellings of the second vote's choices", async () => {
    // The server rejects anything that is not exactly "next" or "setlist", so a
    // 400 here would mean our constants are wrong.
    for (const choice of ["next", "setlist"] as const) {
      const result: unknown = await client.decide(ABSENT, choice).catch((caught: unknown) => caught);
      if (result instanceof ApiError) {
        expect(result.status).not.toBe(400);
      } else {
        expect((result as DecideResult).choice).toBe(choice);
      }
    }
  });

  it("refuses a bad choice, which is how we know the parameter is read at all", async () => {
    const response = await fetch(`${CONSOLE_URL}/api/decide?choice=sideways`, {
      method: "POST",
      headers: { [MARK_HEADER]: "1", "Content-Type": "application/json" },
      body: JSON.stringify({ hash: ABSENT }),
    });
    expect(response.status).toBe(400);
  });

  // ------------------------------------------------------------------
  // The gate the whole security story rests on
  // ------------------------------------------------------------------

  it("refuses a mutating request that is missing the mark header", async () => {
    const response = await fetch(`${CONSOLE_URL}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: ABSENT }),
    });
    expect(response.ok).toBe(false);
    // Not 404: the request must be turned away on its shape, before the hash is
    // ever looked at.
    expect(response.status).not.toBe(404);
  });

  it("still allows reads without it, so a browser can open the built-in page", async () => {
    const response = await fetch(`${CONSOLE_URL}/api/queue`);
    expect(response.ok).toBe(true);
  });

  it("refuses an unknown endpoint distinguishably", async () => {
    const response = await fetch(`${CONSOLE_URL}/api/nonsense`, {
      headers: { [MARK_HEADER]: "1" },
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toMatch(/endpoint/i);
  });
});

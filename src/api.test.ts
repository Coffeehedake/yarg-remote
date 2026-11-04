// These tests assert the things that break silently in the field: a missing
// header the server rejects, a hash in the wrong place, an error the person
// never sees. They use a stub fetch rather than a console, so they say nothing
// about whether the server behaves - that is what the in-editor smoke test is
// for.

import { describe, expect, it, vi } from "vitest";

import { ApiError, MARK_HEADER, YargClient } from "./api";

interface Call {
  url: string;
  init: RequestInit;
}

// `payload`, not `body`: Response already has a `body` of its own (a
// ReadableStream), and reusing the name makes the stub fail to typecheck in a
// way that reads like a bug in the client rather than in the test.
interface Reply {
  ok?: boolean;
  status?: number;
  payload?: unknown;
}

function stub(reply: Reply = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      json: async () => reply.payload ?? {},
      text: async () =>
        typeof reply.payload === "string" ? reply.payload : JSON.stringify(reply.payload ?? {}),
    } as Response;
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function headerOf(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

describe("request shape", () => {
  // The server rejects mutating requests without this header. Losing it would
  // break every write in the app while every read kept working - the worst
  // possible failure to debug on a phone at a party.
  it("marks every request, reads included", async () => {
    const { calls, fetchImpl } = stub({ payload: { songs: [], total: 0, shown: 0, query: "" } });
    const client = new YargClient("http://console:8099", { fetchImpl });

    await client.search("x");
    await client.add("a".repeat(40));

    expect(calls).toHaveLength(2);
    for (const call of calls) expect(headerOf(call, MARK_HEADER)).toBe("1");
  });

  // The library is 4,085 songs and the server sends at most 500, so a phone that cannot ask for
  // a later page simply cannot see most of it. These assert the three parameters that make
  // walking it possible, because a dropped one fails SILENTLY: the first page is always right,
  // and the list just stops early.
  it("asks for a page, not just the first answer", async () => {
    const { calls, fetchImpl } = stub({
      payload: { songs: [], total: 0, matched: 0, shown: 0, offset: 0, query: "", sort: "Name", sorts: [] },
    });
    const client = new YargClient("http://console:8099", { fetchImpl });

    await client.search("green", 50, 150, "Artist");

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/library");
    expect(url.searchParams.get("q")).toBe("green");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("150");
    expect(url.searchParams.get("sort")).toBe("Artist");
  });

  // Omitted rather than defaulted here: with no sort the server uses whatever the game itself is
  // showing, which is a better default than anything this file could choose. Sending an empty
  // sort= would be a different request, and the server would have to decide what it meant.
  it("omits the sort entirely when none is given", async () => {
    const { calls, fetchImpl } = stub({
      payload: { songs: [], total: 0, matched: 0, shown: 0, offset: 0, query: "", sort: "Name", sorts: [] },
    });
    const client = new YargClient("http://console:8099", { fetchImpl });

    await client.search("x");

    const url = new URL(calls[0].url);
    expect(url.searchParams.has("sort")).toBe(false);
    expect(url.searchParams.get("offset")).toBe("0");
  });

  it("strips a trailing slash rather than doubling it", async () => {
    const { calls, fetchImpl } = stub();
    await new YargClient("http://console:8099/", { fetchImpl }).queue();
    expect(calls[0].url).toBe("http://console:8099/api/queue");
  });

  it("sends the hash in the body on POST and the query on DELETE", async () => {
    const { calls, fetchImpl } = stub();
    const client = new YargClient("http://console:8099", { fetchImpl });
    const hash = "b".repeat(40);

    await client.add(hash);
    await client.remove(hash);

    expect(calls[0].init.body).toBe(JSON.stringify({ hash }));
    // HttpListener gives no body on a DELETE, so the server reads the query.
    expect(calls[1].url).toContain(`hash=${hash}`);
    expect(calls[1].init.body).toBeUndefined();
  });

  it("puts the vote's target and direction in the query, where the server reads them", async () => {
    const { calls, fetchImpl } = stub();
    const client = new YargClient("http://console:8099", { fetchImpl });

    await client.voteQueued("c".repeat(40), false);
    await client.voteSuggestion("c".repeat(40), true);
    await client.decide("c".repeat(40), "next");

    expect(calls[0].url).toContain("on=queued");
    expect(calls[0].url).toContain("dir=down");
    expect(calls[1].url).not.toContain("on=queued");
    expect(calls[1].url).toContain("dir=up");
    expect(calls[2].url).toContain("choice=next");
  });
});

describe("errors", () => {
  // SendStatus is SendJson(ctx, status, new { error = message }), and those
  // messages are written for a person to read.
  it("surfaces the server's own sentence, not a status code", async () => {
    const { fetchImpl } = stub({
      ok: false,
      status: 409,
      payload: { error: "the board is full (40); vote some off first" },
    });

    await expect(new YargClient("http://console:8099", { fetchImpl }).suggest("d".repeat(40)))
      .rejects.toThrow("the board is full (40); vote some off first");
  });

  it("still says something useful when the body is not JSON", async () => {
    const { fetchImpl } = stub({ ok: false, status: 500, payload: "<html>500</html>" });
    await expect(new YargClient("http://console:8099", { fetchImpl }).queue())
      .rejects.toThrow(/500/);
  });

  // Status 0 is the difference between "the console refused" and "there is no
  // console", and the UI shows a different sentence for each.
  it("reports an unreachable console as status 0", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const error = await new YargClient("http://console:8099", { fetchImpl })
      .queue()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).unreachable).toBe(true);
  });

  it("gives up on a console that never answers", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abort = new Error("aborted");
            abort.name = "AbortError";
            reject(abort);
          });
        })
    ) as unknown as typeof fetch;

    const client = new YargClient("http://console:8099", { fetchImpl, timeoutMs: 20 });
    await expect(client.health()).rejects.toThrow(/no answer within/);
  });
});

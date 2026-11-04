// The only file that talks to the console.
//
// Two things here are load-bearing and neither is obvious from reading a call
// site, so they are stated once, here:
//
// 1. EVERY request carries X-Yarg-Remote. The server rejects mutating requests
//    without it (RemoteQueueServer.IsRequestShapeAllowed). The value is
//    irrelevant; the presence is the point, because a custom header forces a
//    CORS preflight that the server never answers, so a random web page open on
//    the same phone cannot drive the console. This app is not a web page - it
//    goes through CapacitorHttp, which has no CORS to satisfy - but it sends
//    the header anyway, because `npm run dev` in a browser must exercise the
//    same code path the shipped app does.
//
// 2. EVERY request has a deadline. The default fetch has none, and a console
//    that went to sleep mid-party leaves a spinner up forever rather than
//    saying "cannot reach it". A phone on a LAN either answers in a moment or
//    is not there.

import type {
  DecideResult,
  LibraryResult,
  MovedResult,
  QueuedResult,
  RemoteBoard,
  RemoteNomination,
  RemoteQueueView,
  VoteResult,
} from "./types";

/** The header the server looks for. Its value is irrelevant; its presence is not. */
export const MARK_HEADER = "X-Yarg-Remote";

/** Milliseconds before a request is abandoned. */
export const DEFAULT_TIMEOUT_MS = 6000;

/**
 * A failed call, carrying enough to say something true on screen.
 *
 * `status` is 0 when the request never got an answer at all - wrong address,
 * console asleep, phone on the wrong network. That is a different sentence from
 * a 409, and the UI shows a different one.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** True when the console was never reached, as opposed to refusing. */
  get unreachable(): boolean {
    return this.status === 0;
  }
}

export interface ClientOptions {
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class YargClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  /** @param base an origin with no trailing slash, as normaliseBase() returns. */
  constructor(base: string, options: ClientOptions = {}) {
    this.base = base.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get origin(): string {
    return this.base;
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  /** Cheap liveness check, used by the connect screen. Returns the raw "ok". */
  async health(): Promise<string> {
    const response = await this.send("GET", "/healthz");
    return (await response.text()).trim();
  }

  /**
   * One page of the library.
   *
   * Paged because the library is bigger than any single answer: 4,085 songs against a server
   * that will not send more than 500 at a time. The caller walks it with `offset` until it has
   * `matched` of them.
   *
   * `sort` is omitted rather than defaulted here - the server then uses whatever sort the game
   * itself is showing, which is a better default than anything this file could pick, and it
   * says which one it used.
   */
  search(
    query: string,
    limit = 100,
    offset = 0,
    sort?: string,
  ): Promise<LibraryResult> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      offset: String(offset),
    });
    if (sort) {
      params.set("sort", sort);
    }
    return this.json<LibraryResult>("GET", `/api/library?${params}`);
  }

  queue(): Promise<RemoteQueueView> {
    return this.json<RemoteQueueView>("GET", "/api/queue");
  }

  /** One poll for the whole screen: queue, suggestions, threshold, intermission. */
  board(): Promise<RemoteBoard> {
    return this.json<RemoteBoard>("GET", "/api/board");
  }

  // ------------------------------------------------------------------
  // Writes
  // ------------------------------------------------------------------

  add(hash: string): Promise<QueuedResult> {
    return this.json<QueuedResult>("POST", "/api/queue", { hash });
  }

  move(hash: string, up: boolean): Promise<MovedResult> {
    return this.json<MovedResult>("POST", `/api/queue?action=${up ? "up" : "down"}`, { hash });
  }

  /**
   * The hash goes in the QUERY STRING here, not the body, because the server
   * reads it from there for DELETE - HttpListener gives no body on a DELETE it
   * has already answered. Sending it in the body instead yields a 400 that
   * reads like a bug in the app.
   */
  remove(hash: string): Promise<{ removed: true; hash: string }> {
    const params = new URLSearchParams({ hash });
    return this.json<{ removed: true; hash: string }>("DELETE", `/api/queue?${params}`);
  }

  suggest(hash: string): Promise<RemoteNomination> {
    return this.json<RemoteNomination>("POST", "/api/suggest", { hash });
  }

  /** Vote on a suggestion: should the room play this at all? */
  voteSuggestion(hash: string, up: boolean): Promise<VoteResult> {
    return this.json<VoteResult>("POST", `/api/vote?dir=${up ? "up" : "down"}`, { hash });
  }

  /** Vote on a song already in the queue: should it move up or down? */
  voteQueued(hash: string, up: boolean): Promise<VoteResult> {
    return this.json<VoteResult>("POST", `/api/vote?on=queued&dir=${up ? "up" : "down"}`, { hash });
  }

  /** The second vote: play it next, or drop it at the end of the setlist. */
  decide(hash: string, choice: "next" | "setlist"): Promise<DecideResult> {
    return this.json<DecideResult>("POST", `/api/decide?choice=${choice}`, { hash });
  }

  // ------------------------------------------------------------------
  // Plumbing
  // ------------------------------------------------------------------

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    return (await response.json()) as T;
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { [MARK_HEADER]: "1" };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      // Status 0: no answer at all. Deliberately NOT re-thrown as-is - a bare
      // "Failed to fetch" on screen tells nobody at a party anything.
      const why = cause instanceof Error && cause.name === "AbortError"
        ? `no answer within ${this.timeoutMs / 1000}s`
        : "could not reach the console";
      throw new ApiError(why, 0);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // A refusal is JSON, not text: SendStatus is
      // `SendJson(ctx, status, new { error = message })`. That message is
      // written to be read by a person - "the board is full (40); vote some off
      // first" - so it goes on screen verbatim rather than being replaced by a
      // status code. Parsing it is still best-effort: a 500 from further down
      // the stack may not be JSON at all.
      let detail = "";
      try {
        const text = (await response.text()).trim();
        try {
          const parsed = JSON.parse(text) as { error?: unknown };
          detail = typeof parsed.error === "string" ? parsed.error : text;
        } catch {
          detail = text;
        }
      } catch {
        detail = "";
      }
      throw new ApiError(detail || `request failed (${response.status})`, response.status);
    }

    return response;
  }
}

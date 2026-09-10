// Pure functions only. Nothing here touches the network, Capacitor or the DOM,
// which is the whole reason it is a separate file: this is the part that can be
// tested without a console in the room.

import type { QueueTarget, RemoteNomination } from "./types";

/**
 * m:ss, or h:mm:ss past an hour.
 *
 * Guards against nonsense from the wire rather than trusting it. A chart with
 * no recorded length arrives as 0 - and one corrupt entry arriving as -1 should
 * not render "-1:-1" in the middle of a list.
 */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--:--";

  const total = Math.round(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const ss = String(seconds).padStart(2, "0");
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}

/**
 * What actually happened, in words a person at a party would use.
 *
 * The server answers with the queue it used, and those three words mean
 * genuinely different things - "pending" in particular means NOTHING VISIBLE
 * HAPPENED YET, and a phone that said "Added" there would be lying until
 * somebody opens the library.
 */
export function describeTarget(target: QueueTarget): string {
  switch (target) {
    case "show":
      return "Added to the show";
    case "setlist":
      return "Added to the setlist";
    case "pending":
      return "Held - it joins the setlist when the library opens";
    default:
      return "Queued";
  }
}

/** "3 of 5 votes" - the same sentence for both stages of a nomination. */
export function progress(have: number, needed: number): string {
  const clamped = Math.max(0, have);
  return `${clamped} of ${needed} vote${needed === 1 ? "" : "s"}`;
}

/**
 * The question this nomination is currently asking.
 *
 * A suggestion is voted on twice, and showing the same prompt for both stages
 * was the single most confusing thing about the first web page: people kept
 * up-voting a song that had already won, wondering why nothing moved.
 */
export function stagePrompt(n: RemoteNomination, threshold: number): string {
  if (n.stage === "deciding") {
    return `Won - now: next, or the setlist? (${threshold} decides)`;
  }
  return `Play this? ${progress(n.score, threshold)}`;
}

/**
 * Normalises whatever somebody typed into a base URL we can call.
 *
 * People type `192.168.1.20`, or paste `http://192.168.1.20:8099/` off the
 * game's screen, or add a trailing slash. All three should work, because the
 * alternative is an app that says "cannot connect" to an address that is
 * correct. Only the scheme is filled in, never the host or port: guessing those
 * would hide a typo instead of surfacing it.
 *
 * Returns null when there is nothing usable, so a caller can tell "empty" from
 * "unreachable" - two different messages on screen.
 */
export function normaliseBase(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.hostname === "") return null;

  // Default to the port the game listens on. RemoteQueueServer.Port is 8099 and
  // is not configurable in-game, so an address with no port is unambiguous.
  if (parsed.port === "") parsed.port = "8099";

  return `${parsed.protocol}//${parsed.host}`;
}

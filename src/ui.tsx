// Small pieces shared by more than one tab. Anything used once stays where it
// is used; this file is not a component library.

import type { ReactNode } from "react";

import { duration } from "./format";
import type { RemoteSong } from "./types";

/**
 * Artist, album and charter on one line, skipping whatever is missing.
 *
 * Charts in the wild are missing fields constantly, and " - - " where an album
 * should be looks like corruption to somebody scrolling a list fast.
 */
export function subtitleOf(song: RemoteSong): string {
  return [song.artist, song.album, song.charter].filter((part) => part && part.trim() !== "").join(" - ");
}

export function SongMeta({ song }: { song: RemoteSong }) {
  return (
    <div className="meta">
      <div className="name">{song.name || "(untitled)"}</div>
      <div className="sub">{subtitleOf(song) || "unknown"}</div>
    </div>
  );
}

export function Length({ ms }: { ms: number }) {
  return <span className="len">{duration(ms)}</span>;
}

/**
 * A signed vote count, coloured by sign.
 *
 * "+0" and "0" both read as "nobody has voted", so zero is shown unsigned and
 * uncoloured - the plus sign is information only when it means something.
 */
export function Score({ value }: { value: number }) {
  const className = value > 0 ? "score up" : value < 0 ? "score down" : "score";
  const text = value > 0 ? `+${value}` : String(value);
  return <span className={className}>{text}</span>;
}

/** An error the person can act on, or nothing at all. */
export function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="err" role="alert">
      {message}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}

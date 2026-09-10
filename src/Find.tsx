// Searching the library, and doing one of two things with a result.
//
// "Queue" and "Suggest" are not the same button with different wording. Queue
// puts the song in, full stop - it is what the host uses. Suggest puts it up for
// a vote and it may never play. Both are shown when voting is on, because a
// party has both kinds of person in it, and the difference is spelled out rather
// than implied by which one is bigger.

import { useEffect, useRef, useState } from "react";

import { ApiError, YargClient } from "./api";
import { describeTarget } from "./format";
import { Length, Note, Problem, SongMeta } from "./ui";
import type { RemoteSong } from "./types";

/**
 * Typing is faster than a LAN round trip, and the library search runs on the
 * game's MAIN THREAD - every keystroke that reaches it is a frame the game
 * spends searching instead of drawing. So keystrokes are collected first.
 */
const DEBOUNCE_MS = 220;

interface Props {
  client: YargClient;
  /** Whether the server is accepting suggestions at all. */
  voting: boolean;
  /** Something changed on the console; re-poll the board. */
  onChanged: () => void;
}

export default function Find({ client, voting, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<RemoteSong[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // Answers can arrive out of order - a short query typed after a long one may
  // come back first, leaving results that do not match what is on screen. Only
  // the newest request is allowed to write.
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setSearching(true);
      client
        .search(query, 100)
        .then((result) => {
          if (ticket !== latest.current) return;
          setSongs(result.songs);
          setTotal(result.total);
          setProblem(null);
        })
        .catch((error: unknown) => {
          if (ticket !== latest.current) return;
          setProblem(error instanceof ApiError ? error.message : "Search failed.");
        })
        .finally(() => {
          if (ticket === latest.current) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [client, query]);

  async function act(song: RemoteSong, how: "queue" | "suggest") {
    setProblem(null);
    try {
      if (how === "queue") {
        const result = await client.add(song.hash);
        setSaid(`${song.name}: ${describeTarget(result.target)}`);
      } else {
        await client.suggest(song.hash);
        setSaid(`${song.name}: up for a vote`);
      }
      onChanged();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not work.");
    }
  }

  return (
    <>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the library"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-label="Search the library"
      />

      <Problem message={problem} />
      {said ? <div className="banner">{said}</div> : null}

      {songs.length === 0 ? (
        <Note>
          {searching
            ? "Searching..."
            : total === 0
              ? "The library is empty. YARG has not scanned any songs yet."
              : query === ""
                ? "Type to search."
                : "Nothing matches."}
        </Note>
      ) : (
        <>
          {songs.map((song) => (
            <div className="row" key={song.hash}>
              <SongMeta song={song} />
              <Length ms={song.length_ms} />
              {voting ? (
                <button className="act" onClick={() => void act(song, "suggest")}>
                  Suggest
                </button>
              ) : null}
              <button className="act" onClick={() => void act(song, "queue")}>
                Queue
              </button>
            </div>
          ))}
          {total !== null && total > songs.length ? (
            <Note>
              Showing {songs.length} of {total}. Type more to narrow it down.
            </Note>
          ) : null}
        </>
      )}
    </>
  );
}

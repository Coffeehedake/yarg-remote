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
import type { RemoteSong, RemoteSortOption } from "./types";

/**
 * Typing is faster than a LAN round trip, and the library search runs on the
 * game's MAIN THREAD - every keystroke that reaches it is a frame the game
 * spends searching instead of drawing. So keystrokes are collected first.
 */
const DEBOUNCE_MS = 220;

/**
 * Songs per request.
 *
 * The library is bigger than any one answer - 4,085 songs against a server that will not send
 * more than 500 at a time - so it is walked a page at a time. More pages are fetched only when
 * somebody ASKS, with the button at the end, rather than as they scroll: by the same reasoning
 * as the debounce above, every request is a frame the game spends searching instead of drawing,
 * and a flick through a long list would fire a burst of them.
 */
const PAGE = 100;

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
  /** How many songs match the query, across every page - not how many are on screen. */
  const [matched, setMatched] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // The sorts come from the game, with its own labels, so this file never holds a second list
  // that could drift from the one the quickplay menu offers. Empty until the first answer.
  const [sorts, setSorts] = useState<RemoteSortOption[]>([]);
  // undefined means "whatever the game is showing", which is the better default than picking one.
  const [sort, setSort] = useState<string | undefined>(undefined);

  // Answers can arrive out of order - a short query typed after a long one may
  // come back first, leaving results that do not match what is on screen. Only
  // the newest request is allowed to write.
  const latest = useRef(0);

  // Changing the query OR the sort starts the list again from the top. Appending a differently
  // sorted page to the one on screen would produce a list in no order at all.
  useEffect(() => {
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setSearching(true);
      client
        .search(query, PAGE, 0, sort)
        .then((result) => {
          if (ticket !== latest.current) return;
          setSongs(result.songs);
          setTotal(result.total);
          setMatched(result.matched);
          setSorts(result.sorts ?? []);
          // Adopt whatever the server actually used, so the picker shows the truth rather than
          // a request that may have been ignored.
          setSort(result.sort);
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
  }, [client, query, sort]);

  function loadMore() {
    const ticket = latest.current;
    setLoadingMore(true);
    client
      .search(query, PAGE, songs.length, sort)
      .then((result) => {
        // A query or sort changed while this was in flight; its songs belong to a list that is
        // no longer on screen.
        if (ticket !== latest.current) return;
        setSongs((have) => [...have, ...result.songs]);
        setMatched(result.matched);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (ticket !== latest.current) return;
        setProblem(error instanceof ApiError ? error.message : "Could not load more.");
      })
      .finally(() => {
        if (ticket === latest.current) setLoadingMore(false);
      });
  }

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

      {sorts.length > 0 ? (
        <label className="sortPick">
          Sort by{" "}
          <select
            value={sort ?? ""}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort the library"
          >
            {sorts.map((option) => (
              <option key={option.name} value={option.name}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

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
          {songs.map((song, index) => (
            <div key={`${song.hash}-${index}`}>
              {/* The game groups its library under headings rather than showing one flat list,
                  so the same heading appears here whenever it changes. The key includes the
                  index because one song can legitimately appear under two headings - the Folder
                  sort lists it in every playlist it belongs to, exactly as the game does. */}
              {song.category && song.category !== songs[index - 1]?.category ? (
                <div className="group">{song.category}</div>
              ) : null}
              <div className="row">
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
            </div>
          ))}
          {matched !== null && songs.length < matched ? (
            <>
              <button
                className="act more"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
              <Note>
                Showing {songs.length} of {matched}
                {query === "" ? "" : ` matching, from ${total ?? 0}`}.
              </Note>
            </>
          ) : songs.length > 0 ? (
            <Note>
              {query === ""
                ? `All ${songs.length} songs.`
                : `All ${songs.length} matching, from ${total ?? 0}.`}
            </Note>
          ) : null}
        </>
      )}
    </>
  );
}

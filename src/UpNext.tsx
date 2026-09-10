// What is actually going to play, and the two things a phone may do to it.
//
// The list is whatever the server says: it does NOT sort locally. The server's
// sort is stable and only re-sorts when somebody votes, which is what lets a
// host hand-arrange a setlist and have it survive. A client-side sort would
// quietly undo that every poll.

import { useState } from "react";

import { ApiError, YargClient } from "./api";
import { Length, Note, Problem, Score, SongMeta } from "./ui";
import type { RemoteQueueView } from "./types";

interface Props {
  client: YargClient;
  queue: RemoteQueueView;
  voting: boolean;
  onChanged: () => void;
}

export default function UpNext({ client, queue, voting, onChanged }: Props) {
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setProblem(null);
    try {
      await work();
      onChanged();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not work.");
    }
  }

  if (queue.songs.length === 0) {
    return (
      <>
        <Problem message={problem} />
        <Note>
          Nothing queued. Find a song and it lands here.
          {queue.target === "pending"
            ? " YARG's library menu is closed right now, so anything queued waits until it opens."
            : ""}
        </Note>
      </>
    );
  }

  return (
    <>
      <Problem message={problem} />

      {/* Where these songs actually live. "Queued" means three different things
          depending on what the game is doing, and a phone that hid the
          difference would have people wondering why nothing happened. */}
      <Note>
        {queue.playing_show
          ? "The show is running - these play after the current song."
          : queue.target === "pending"
            ? "Held: these join the setlist when YARG's library menu opens."
            : "This is the setlist in YARG's library menu."}
      </Note>

      {queue.songs.map((song, position) => {
        const playing = queue.playing_show && position === queue.index;
        return (
          <div className="row" key={song.hash}>
            <span className={playing ? "pos now" : "pos"}>{playing ? "▶" : position + 1}</span>
            <SongMeta song={song} />
            <Length ms={song.length_ms} />

            {voting ? (
              <span className="votes">
                <button
                  aria-label={`Vote ${song.name} up`}
                  onClick={() => void run(() => client.voteQueued(song.hash, true))}
                >
                  {"▲"}
                </button>
                <Score value={song.score} />
                <button
                  aria-label={`Vote ${song.name} down`}
                  onClick={() => void run(() => client.voteQueued(song.hash, false))}
                >
                  {"▼"}
                </button>
              </span>
            ) : null}

            <button
              className="act"
              aria-label={`Remove ${song.name}`}
              onClick={() => void run(() => client.remove(song.hash))}
            >
              {"✕"}
            </button>
          </div>
        );
      })}
    </>
  );
}

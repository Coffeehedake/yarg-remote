// The board: songs the room is voting on.
//
// A suggestion is voted on TWICE, and the two votes ask different questions.
// Stage one asks whether to play it at all. Stage two, once it has won, asks
// where it goes: next, or the end of the setlist. Showing one prompt for both
// was the most confusing thing about the first web page - people kept up-voting
// a song that had already won, wondering why nothing moved. So the two stages
// render as different controls, not the same control with different numbers.

import { useState } from "react";

import { ApiError, YargClient } from "./api";
import { progress, stagePrompt } from "./format";
import { Note, Problem, Score } from "./ui";
import type { RemoteNomination } from "./types";

interface Props {
  client: YargClient;
  suggestions: RemoteNomination[];
  threshold: number;
  /** False while the game is mid-song: votes cast then land in an empty room. */
  intermission: boolean;
  onChanged: () => void;
}

export default function Suggestions({ client, suggestions, threshold, intermission, onChanged }: Props) {
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setProblem(null);
    try {
      await work();
      onChanged();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That vote did not go through.");
    }
  }

  if (suggestions.length === 0) {
    return (
      <>
        <Problem message={problem} />
        <Note>Nothing suggested yet. Find a song and press Suggest.</Note>
      </>
    );
  }

  return (
    <>
      <Problem message={problem} />

      {!intermission ? (
        <Note>
          A song is playing. Votes still count, but nothing moves until the score screen -
          that is the gap where the room decides.
        </Note>
      ) : null}

      {suggestions.map((nomination) => (
        <div key={nomination.hash}>
          <div className="row">
            <div className="meta">
              <div className="name">{nomination.name || "(untitled)"}</div>
              <div className="sub">{nomination.artist || "unknown"}</div>
              <div className="stage">{stagePrompt(nomination, threshold)}</div>
            </div>

            {nomination.stage === "suggested" ? (
              <span className="votes">
                <button
                  aria-label={`Vote for ${nomination.name}`}
                  onClick={() => void run(() => client.voteSuggestion(nomination.hash, true))}
                >
                  {"▲"}
                </button>
                <Score value={nomination.score} />
                <button
                  aria-label={`Vote against ${nomination.name}`}
                  onClick={() => void run(() => client.voteSuggestion(nomination.hash, false))}
                >
                  {"▼"}
                </button>
              </span>
            ) : null}
          </div>

          {/* Stage two. The counts are shown on the buttons themselves because
              the choice is between them, not against a threshold in the
              abstract - first to `threshold` wins. */}
          {nomination.stage === "deciding" ? (
            <div className="decide">
              <button onClick={() => void run(() => client.decide(nomination.hash, "next"))}>
                Play next - {progress(nomination.for_next, threshold)}
              </button>
              <button onClick={() => void run(() => client.decide(nomination.hash, "setlist"))}>
                Add to setlist - {progress(nomination.for_setlist, threshold)}
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

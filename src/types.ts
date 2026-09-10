// Wire shapes, transcribed from the server rather than invented here.
//
// The authority for every field below is
// yarg/Assets/Script/Integration/RemoteQueue/RemoteQueueBridge.cs. Unity's
// JsonUtility serialises PUBLIC FIELDS VERBATIM, so these are snake_case and
// stay snake_case: renaming them to camelCase in this file would be a silent
// lie, because nothing on the wire would change.
//
// Keep this file a transcription. Anything derived - a formatted duration, a
// sort order - belongs in format.ts, where it can be tested without a server.

/** One song, as a phone needs to see it. */
export interface RemoteSong {
  hash: string;
  name: string;
  artist: string;
  album: string;
  charter: string;
  length_ms: number;
  /** Net votes, when this song is in the queue. */
  score: number;
}

/**
 * Where a queued song actually went. The three are not interchangeable and the
 * UI says which, because "queued" means something different in each:
 *
 *   show    - a setlist is being played; the song joins the running show.
 *   setlist - the library menu is open; the song joins the menu's playlist.
 *   pending - neither; the song is held and flushed into the setlist when the
 *             library menu next appears.
 */
export type QueueTarget = "show" | "setlist" | "pending";

/** The queue, plus enough context for the UI to explain itself. */
export interface RemoteQueueView {
  playing_show: boolean;
  index: number;
  target: QueueTarget;
  songs: RemoteSong[];
}

/**
 * A suggestion moves through two votes, and the stage says which one is open:
 *
 *   suggested - the room is deciding whether to play it at all.
 *   deciding  - it won that, and is now choosing next-vs-setlist.
 */
export type NominationStage = "suggested" | "deciding";

/** A song somebody suggested, and how the room feels about it. */
export interface RemoteNomination {
  hash: string;
  name: string;
  artist: string;
  stage: NominationStage;
  score: number;
  ups: number;
  downs: number;
  for_next: number;
  for_setlist: number;
}

/** Everything a phone needs in one poll: GET /api/board. */
export interface RemoteBoard {
  queue: RemoteQueueView;
  suggestions: RemoteNomination[];
  /** How many votes promote a suggestion, or settle where it goes. */
  threshold: number;
  /** Whether voting is on at all. */
  voting: boolean;
  /**
   * True during the gap between two songs - the only moment anybody's hands are
   * free to vote. The UI shouts about it, because a vote cast at any other time
   * is a vote cast into an empty room.
   */
  intermission: boolean;
  /** Seconds left in that window, or 0. */
  intermission_seconds: number;
}

/** GET /api/library?q=&limit= */
export interface LibraryResult {
  query: string;
  /** Songs in the whole library, not in this result. */
  total: number;
  /** Songs in this result - `total` clamped by `limit`. */
  shown: number;
  songs: RemoteSong[];
}

/** POST /api/queue */
export interface QueuedResult {
  queued: true;
  hash: string;
  target: QueueTarget;
}

/** POST /api/queue?action=up|down */
export interface MovedResult {
  moved: true;
  hash: string;
  action: "up" | "down";
}

/** POST /api/vote */
export interface VoteResult {
  voted: true;
  on: "queued" | "suggestion";
  hash: string;
  /** Present for queue votes only. */
  dir?: "up" | "down";
  /** Present for suggestion votes only: it crossed the threshold. */
  promoted?: boolean;
}

/** POST /api/decide?choice=next|setlist */
export interface DecideResult {
  voted: true;
  hash: string;
  choice: "next" | "setlist";
  decided: boolean;
  /** NominationOutcome.ToString(): "None", "PlayNext" or "AddToSetlist". */
  outcome: string;
}

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
  /**
   * The heading this song sits under in the current sort - "A", "Metallica", "2016".
   *
   * Absent for the queue and for suggestions, where a song has no sort to sit in. The game's
   * library groups songs under headings rather than showing one flat list, and a phone with the
   * same ORDER but no HEADINGS is a different list that happens to agree.
   */
  category?: string;
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
export interface RemoteSortOption {
  /** The wire value, e.g. "Artist_Album". Case-insensitive on the way back in. */
  name: string;
  /** What the game calls it on screen, localised by the game. */
  label: string;
}

/**
 * One page of the library.
 *
 * `total` and `matched` are different numbers and the UI needs both: the first is how many songs
 * the game has, the second how many this query matches. Knowing only `total` a client cannot
 * tell when a filtered list has ended, and will either stop early or keep asking for pages that
 * are not there.
 *
 * The sorts come down with every page rather than being listed in this file. They are the game's
 * own cycle, labels included, so the phone cannot offer a sort the game lacks or miss one it has
 * - the same reason the rest of this file is a transcription rather than a design.
 */
export interface LibraryResult {
  query: string;
  /** The sort actually used - not necessarily the one asked for. */
  sort: string;
  /** Songs in the whole library. */
  total: number;
  /** Songs matching `query`, across every page. */
  matched: number;
  offset: number;
  /** Songs on this page. Fewer than asked for means the end. */
  shown: number;
  songs: RemoteSong[];
  sorts: RemoteSortOption[];
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

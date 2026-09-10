// The shell: which console, which tab, and the poll that keeps everything true.
//
// POLLING, NOT PUSH. The server is System.Net.HttpListener inside Unity, with no
// websocket and no SSE, and adding one would mean holding a connection open per
// phone against a game loop. A poll every couple of seconds is enough for a
// queue that changes when somebody presses a button, and it recovers by itself
// from the console sleeping, the Wi-Fi dropping, or the phone being pocketed.
//
// The poll STOPS when the app is backgrounded. iOS suspends timers unevenly and
// Android does not; without this, a phone in a pocket spends the evening waking
// up to ask a game about its setlist.

import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";

import Connect from "./Connect";
import Find from "./Find";
import Suggestions from "./Suggestions";
import UpNext from "./UpNext";
import { ApiError, YargClient } from "./api";
import { loadServer } from "./storage";
import type { RemoteBoard } from "./types";

const POLL_MS = 2500;

type Tab = "find" | "next" | "board";

export default function App() {
  const [base, setBase] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [changing, setChanging] = useState(false);
  const [tab, setTab] = useState<Tab>("find");
  const [board, setBoard] = useState<RemoteBoard | null>(null);
  const [offline, setOffline] = useState<string | null>(null);

  // One client per address, not one per render: it is cheap, but a new object
  // every render would restart Find's search effect on every keystroke.
  const clientRef = useRef<YargClient | null>(null);
  if (base !== null && clientRef.current?.origin !== base) {
    clientRef.current = new YargClient(base);
  }
  const client = clientRef.current;

  useEffect(() => {
    void loadServer().then((saved) => {
      setBase(saved);
      setReady(true);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      setBoard(await client.board());
      setOffline(null);
    } catch (error) {
      // The last board stays on screen. A queue from four seconds ago is more
      // use to somebody holding a phone than an empty screen, so the banner says
      // it is stale rather than the list pretending nothing is queued.
      setOffline(
        error instanceof ApiError && error.unreachable
          ? "Lost the console - still trying."
          : error instanceof ApiError
            ? error.message
            : "Lost the console - still trying."
      );
    }
  }, [client]);

  // The polling loop, paused while the app is in the background.
  useEffect(() => {
    if (!client) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    start();

    // Capacitor's appStateChange fires on both platforms; the web fallback keeps
    // `npm run dev` honest in a browser tab.
    const listener = CapacitorApp.addListener("appStateChange", ({ isActive }) =>
      isActive ? start() : stop()
    );
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      void listener.then((handle) => handle.remove());
    };
  }, [client, refresh]);

  if (!ready) return null;

  if (base === null || changing || !client) {
    return (
      <Connect
        initial={base ?? undefined}
        onConnected={(next) => {
          setBase(next);
          setBoard(null);
          setChanging(false);
        }}
        onCancel={base === null ? undefined : () => setChanging(false)}
      />
    );
  }

  const voting = board?.voting ?? false;
  const queued = board?.queue.songs.length ?? 0;
  const pending = board?.suggestions.length ?? 0;

  return (
    <>
      <header>
        <h1>
          YARG Remote <span>{base.replace(/^https?:\/\//, "")}</span>
        </h1>

        {/* The intermission banner is the single most important thing on this
            screen. Nobody can touch a phone during a song, so the gap between
            songs is the ONLY moment a vote means anything - and it is short. */}
        {board?.intermission ? (
          <div className="interm">
            Voting open{board.intermission_seconds > 0 ? ` - ${board.intermission_seconds}s` : ""}
          </div>
        ) : null}

        {offline ? <div className="interm gone">{offline}</div> : null}

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "find"} onClick={() => setTab("find")}>
            Find
          </button>
          <button role="tab" aria-selected={tab === "next"} onClick={() => setTab("next")}>
            Up next{queued > 0 ? ` (${queued})` : ""}
          </button>
          {voting ? (
            <button role="tab" aria-selected={tab === "board"} onClick={() => setTab("board")}>
              Suggestions{pending > 0 ? ` (${pending})` : ""}
            </button>
          ) : null}
          <button role="tab" aria-selected={false} onClick={() => setChanging(true)}>
            {"⚙"}
          </button>
        </div>
      </header>

      <main>
        {tab === "find" ? (
          <Find client={client} voting={voting} onChanged={() => void refresh()} />
        ) : null}

        {tab === "next" && board ? (
          <UpNext
            client={client}
            queue={board.queue}
            voting={voting}
            onChanged={() => void refresh()}
          />
        ) : null}

        {tab === "board" && board ? (
          <Suggestions
            client={client}
            suggestions={board.suggestions}
            threshold={board.threshold}
            intermission={board.intermission}
            onChanged={() => void refresh()}
          />
        ) : null}
      </main>
    </>
  );
}

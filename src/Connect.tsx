// Typing in the console's address.
//
// There is no discovery here, and that is a decision rather than an omission.
// ShopStack Mobile - the house pattern this app follows - has none either and is
// in daily use; mDNS on the game side is a follow-on that makes this screen
// optional, not a prerequisite for shipping it. Meanwhile the address is on
// screen in the game the moment LAN mode is switched on, and somebody at a party
// reads it out once.
//
// The screen VERIFIES before it saves. Storing an address that turns out to be
// wrong just moves the failure to the next screen, where it looks like the app
// is broken instead of like a typo.

import { useState } from "react";

import { ApiError, YargClient } from "./api";
import { normaliseBase } from "./format";
import { saveServer } from "./storage";

interface Props {
  /** Pre-filled when re-opened from the queue screen to change consoles. */
  initial?: string;
  onConnected: (base: string) => void;
  /** Absent on first run: there is nothing to go back to. */
  onCancel?: () => void;
}

export default function Connect({ initial, onConnected, onCancel }: Props) {
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function connect() {
    const base = normaliseBase(text);
    if (base === null) {
      setProblem("Enter the address YARG is showing, for example 192.168.1.20:8099");
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      // /healthz, not /api/board: it answers before the library has finished
      // scanning, so a console that is still starting up reads as reachable
      // rather than as the wrong address.
      await new YargClient(base).health();
      await saveServer(base);
      onConnected(base);
    } catch (error) {
      if (error instanceof ApiError && error.unreachable) {
        setProblem(
          `Nothing answered at ${base}. Check the phone is on the same Wi-Fi, and that Remote queue is set to LAN in YARG's settings.`
        );
      } else if (error instanceof ApiError) {
        setProblem(`${base} answered, but not like YARG (${error.status}). Check the port.`);
      } else {
        setProblem("Could not connect.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect">
      <h2>YARG Remote</h2>
      <p>
        In YARG, open Settings &rarr; Experimental and set <strong>Remote queue</strong> to{" "}
        <strong>LAN</strong>. It will show an address. Type it here.
      </p>

      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void connect();
        }}
        placeholder="192.168.1.20:8099"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        aria-label="Console address"
      />

      {problem ? (
        <div className="banner bad" role="alert">
          {problem}
        </div>
      ) : null}

      <button onClick={() => void connect()} disabled={busy}>
        {busy ? "Checking..." : "Connect"}
      </button>

      {onCancel ? (
        <button className="secondary" onClick={onCancel} disabled={busy}>
          Back
        </button>
      ) : null}
    </div>
  );
}

// Where the console's address lives between launches.
//
// @capacitor/preferences, not localStorage: on iOS the web view's storage can
// be evicted under disk pressure, and an app that forgets the address every few
// weeks is an app nobody trusts to work when the party starts. Preferences maps
// to UserDefaults / SharedPreferences, which do not get evicted.
//
// The wrapper exists so `npm run dev` works in a plain browser too - Preferences
// has a web implementation, but it is async and throws outside a Capacitor
// context in some setups, so failures degrade to "no saved address" rather than
// taking the screen down.

import { Preferences } from "@capacitor/preferences";

const SERVER_KEY = "server_base";

/** The saved console address, or null if none has ever been set. */
export async function loadServer(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: SERVER_KEY });
    return value && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Persists a normalised base URL. Returns false if it could not be saved. */
export async function saveServer(base: string): Promise<boolean> {
  try {
    await Preferences.set({ key: SERVER_KEY, value: base });
    return true;
  } catch {
    return false;
  }
}

/** Forgets the console, sending the app back to the connect screen. */
export async function clearServer(): Promise<void> {
  try {
    await Preferences.remove({ key: SERVER_KEY });
  } catch {
    // Nothing useful to do: the caller is already navigating away.
  }
}

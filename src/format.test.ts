import { describe, expect, it } from "vitest";

import { describeTarget, duration, normaliseBase, progress, stagePrompt } from "./format";
import type { RemoteNomination } from "./types";

describe("duration", () => {
  it("formats under an hour as m:ss", () => {
    expect(duration(213_000)).toBe("3:33");
    expect(duration(61_000)).toBe("1:01");
  });

  it("formats an hour and over as h:mm:ss", () => {
    expect(duration(3_600_000)).toBe("1:00:00");
    expect(duration(3_723_000)).toBe("1:02:03");
  });

  // Charts with no recorded length arrive as 0, and the corpus has them.
  it("refuses to invent a length it does not have", () => {
    expect(duration(0)).toBe("--:--");
    expect(duration(-1)).toBe("--:--");
    expect(duration(Number.NaN)).toBe("--:--");
  });

  it("rounds to the nearest second rather than truncating", () => {
    expect(duration(59_600)).toBe("1:00");
  });
});

describe("describeTarget", () => {
  // The point of this function: "pending" must NOT read as done, because
  // nothing visible has happened yet.
  it("distinguishes held from added", () => {
    expect(describeTarget("pending")).not.toMatch(/^Added/);
    expect(describeTarget("show")).toMatch(/^Added/);
    expect(describeTarget("setlist")).toMatch(/^Added/);
  });
});

describe("progress", () => {
  it("agrees with itself about plurals", () => {
    expect(progress(0, 1)).toBe("0 of 1 vote");
    expect(progress(2, 5)).toBe("2 of 5 votes");
  });

  // A net score can go negative; "-2 of 3 votes" is nonsense on screen.
  it("floors a negative score at zero", () => {
    expect(progress(-2, 3)).toBe("0 of 3 votes");
  });
});

describe("stagePrompt", () => {
  const base: RemoteNomination = {
    hash: "a".repeat(40),
    name: "Song",
    artist: "Band",
    stage: "suggested",
    score: 1,
    ups: 1,
    downs: 0,
    for_next: 0,
    for_setlist: 0,
  };

  it("asks a different question at each stage", () => {
    const one = stagePrompt(base, 3);
    const two = stagePrompt({ ...base, stage: "deciding" }, 3);
    expect(one).not.toBe(two);
    expect(one).toMatch(/Play this\?/);
    expect(two).toMatch(/setlist/);
  });
});

describe("normaliseBase", () => {
  it("fills in the scheme and the game's port", () => {
    expect(normaliseBase("192.168.1.20")).toBe("http://192.168.1.20:8099");
  });

  it("keeps a port that was given", () => {
    expect(normaliseBase("192.168.1.20:9000")).toBe("http://192.168.1.20:9000");
  });

  it("accepts a whole URL pasted off the game's screen", () => {
    expect(normaliseBase("  http://192.168.1.20:8099/  ")).toBe("http://192.168.1.20:8099");
  });

  it("survives a Tailscale address, which is what one of these actually is", () => {
    expect(normaliseBase("100.79.53.15")).toBe("http://100.79.53.15:8099");
  });

  it("returns null rather than guessing at nothing", () => {
    expect(normaliseBase("")).toBeNull();
    expect(normaliseBase("   ")).toBeNull();
    expect(normaliseBase("http://")).toBeNull();
  });
});

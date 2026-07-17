import { describe, expect, test } from "vitest";
import { classifyChannel, isContentStorable } from "../src/capture/content-rule";

/**
 * THE content rule (spec §1.2): DMs and group DMs store both sides in full;
 * guild channels store the user's own messages only. These six cases are
 * mandated by the spec verbatim.
 */
describe("isContentStorable — the six spec cases", () => {
  test("own guild message → store", () => {
    expect(isContentStorable({ isOwn: true, channelKind: "guild" })).toBe(true);
  });

  test("other's guild message → drop", () => {
    expect(isContentStorable({ isOwn: false, channelKind: "guild" })).toBe(false);
  });

  test("own DM → store", () => {
    expect(isContentStorable({ isOwn: true, channelKind: "dm" })).toBe(true);
  });

  test("other's DM → store", () => {
    expect(isContentStorable({ isOwn: false, channelKind: "dm" })).toBe(true);
  });

  test("other's group DM → store", () => {
    expect(isContentStorable({ isOwn: false, channelKind: "group-dm" })).toBe(true);
  });

  test("thread inside a guild → drop for others (threads are not DMs)", () => {
    expect(isContentStorable({ isOwn: false, channelKind: "guild-thread" })).toBe(false);
    // own thread messages are still the user's own words
    expect(isContentStorable({ isOwn: true, channelKind: "guild-thread" })).toBe(true);
  });
});

describe("isContentStorable — fail closed", () => {
  test("unknown channel kind → drop for others, store own", () => {
    expect(isContentStorable({ isOwn: false, channelKind: "unknown" })).toBe(false);
    expect(isContentStorable({ isOwn: true, channelKind: "unknown" })).toBe(true);
  });
});

describe("classifyChannel", () => {
  test("DM (type 1) → dm", () => {
    expect(classifyChannel({ type: 1 })).toBe("dm");
  });

  test("group DM (type 3) → group-dm", () => {
    expect(classifyChannel({ type: 3 })).toBe("group-dm");
  });

  test("guild text/announcement/voice/stage/forum/media → guild", () => {
    for (const type of [0, 2, 5, 13, 15, 16]) {
      expect(classifyChannel({ type, guild_id: "g1" })).toBe("guild");
    }
  });

  test("threads (types 10/11/12) → guild-thread even though they carry a guildId", () => {
    for (const type of [10, 11, 12]) {
      expect(classifyChannel({ type, guild_id: "g1" })).toBe("guild-thread");
    }
  });

  test("missing channel or unrecognised type → unknown (never dm)", () => {
    expect(classifyChannel(undefined)).toBe("unknown");
    expect(classifyChannel(null)).toBe("unknown");
    expect(classifyChannel({})).toBe("unknown");
    expect(classifyChannel({ type: 999 })).toBe("unknown");
    // a hypothetical new channel type with no guild must NOT be mistaken for a DM
    expect(classifyChannel({ type: 999, guild_id: undefined })).toBe("unknown");
  });
});

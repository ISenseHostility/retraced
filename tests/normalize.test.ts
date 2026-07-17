import { describe, expect, test } from "vitest";
import type { ChannelRef } from "../src/capture/types";
import {
  analyzeContent,
  normalizeMessageCreate,
  normalizeMessageDelete,
  normalizeMessageUpdate,
  normalizeReaction,
  type NormalizeCtx,
} from "../src/capture/normalize";

const ME = "100";
const OTHER = "200";

const CHANNELS: Record<string, ChannelRef> = {
  guild1: { channelId: "guild1", guildId: "g1", kind: "guild" },
  thread1: { channelId: "thread1", guildId: "g1", kind: "guild-thread" },
  dm1: { channelId: "dm1", guildId: null, kind: "dm" },
  group1: { channelId: "group1", guildId: null, kind: "group-dm" },
  mystery: { channelId: "mystery", guildId: null, kind: "unknown" },
};

const ctx: NormalizeCtx = {
  ownUserId: ME,
  resolveChannel: (id) => CHANNELS[id] ?? { channelId: id, guildId: null, kind: "unknown" },
  now: () => 1_750_000_000_000,
  contentStorageEnabled: () => true,
};

function makeMessage(over: Record<string, unknown> = {}) {
  return {
    id: "msg1",
    channel_id: "guild1",
    author: { id: ME },
    content: "hello world",
    timestamp: "2026-07-16T12:00:00.000Z",
    attachments: [],
    embeds: [],
    ...over,
  };
}

const createAction = (message: unknown, extra: Record<string, unknown> = {}) => ({
  type: "MESSAGE_CREATE",
  channelId: (message as any)?.channel_id,
  message,
  ...extra,
});

describe("normalizeMessageCreate — content rule enforcement at the boundary", () => {
  test("own guild message keeps content", () => {
    const ev = normalizeMessageCreate(createAction(makeMessage()), ctx)!;
    expect(ev.kind).toBe("message-created");
    expect(ev.isOwn).toBe(true);
    expect(ev.content).toBe("hello world");
    expect(ev.chars).toBe(11);
    expect(ev.words).toBe(2);
  });

  test("other's guild message: content is null but counts survive", () => {
    const ev = normalizeMessageCreate(createAction(makeMessage({ author: { id: OTHER }, content: "secret words here" })), ctx)!;
    expect(ev.isOwn).toBe(false);
    expect(ev.content).toBeNull();
    expect(ev.chars).toBe(17);
    expect(ev.words).toBe(3);
    expect(ev.contentTypes.text).toBe(true);
  });

  test("other's DM and group DM keep content", () => {
    const dm = normalizeMessageCreate(createAction(makeMessage({ channel_id: "dm1", author: { id: OTHER } })), ctx)!;
    expect(dm.content).toBe("hello world");
    const group = normalizeMessageCreate(createAction(makeMessage({ channel_id: "group1", author: { id: OTHER } })), ctx)!;
    expect(group.content).toBe("hello world");
  });

  test("other's message in a guild thread drops content", () => {
    const ev = normalizeMessageCreate(createAction(makeMessage({ channel_id: "thread1", author: { id: OTHER } })), ctx)!;
    expect(ev.content).toBeNull();
  });

  test("unknown channel kind fails closed for others", () => {
    const ev = normalizeMessageCreate(createAction(makeMessage({ channel_id: "mystery", author: { id: OTHER } })), ctx)!;
    expect(ev.content).toBeNull();
  });

  test("optimistic and sending-state actions are skipped", () => {
    expect(normalizeMessageCreate(createAction(makeMessage(), { optimistic: true }), ctx)).toBeNull();
    expect(normalizeMessageCreate(createAction(makeMessage({ state: "SENDING" })), ctx)).toBeNull();
  });

  test("system messages (join/pin/etc) are skipped, replies are kept", () => {
    expect(normalizeMessageCreate(createAction(makeMessage({ type: 7 })), ctx)).toBeNull();
    expect(normalizeMessageCreate(createAction(makeMessage({ type: 19 })), ctx)).not.toBeNull();
  });

  test("reply metadata is extracted from the reference", () => {
    const ev = normalizeMessageCreate(
      createAction(
        makeMessage({
          type: 19,
          message_reference: { message_id: "orig1" },
          referenced_message: { id: "orig1", author: { id: OTHER }, timestamp: "2026-07-16T11:59:00.000Z" },
        })
      ),
      ctx
    )!;
    expect(ev.replyToId).toBe("orig1");
    expect(ev.replyToAuthorId).toBe(OTHER);
    expect(ev.replyToTs).toBe(Date.parse("2026-07-16T11:59:00.000Z"));
  });

  test("timestamp falls back to the snowflake when missing", () => {
    // snowflake for ~2020-01-01: (ts - epoch) << 22
    const ts = Date.parse("2020-01-01T00:00:00.000Z");
    const flake = (BigInt(ts - 1420070400000) << 22n).toString();
    const ev = normalizeMessageCreate(createAction(makeMessage({ id: flake, timestamp: undefined })), ctx)!;
    expect(ev.ts).toBe(ts);
  });

  test("content flags: links and domains", () => {
    const ev = normalizeMessageCreate(
      createAction(makeMessage({ content: "look https://www.example.com/a?b=1 and https://sub.other.org/x" })),
      ctx
    )!;
    expect(ev.contentTypes.link).toBe(true);
    expect(ev.domains).toEqual(["example.com", "sub.other.org"]);
  });

  test("content flags: attachments, images and gifs", () => {
    const img = normalizeMessageCreate(
      createAction(makeMessage({ attachments: [{ content_type: "image/png" }] })),
      ctx
    )!;
    expect(img.contentTypes.attachment).toBe(true);
    expect(img.contentTypes.image).toBe(true);
    expect(img.contentTypes.gif).toBe(false);

    const gif = normalizeMessageCreate(
      createAction(makeMessage({ content: "https://tenor.com/view/xyz", embeds: [{ type: "gifv" }] })),
      ctx
    )!;
    expect(gif.contentTypes.gif).toBe(true);
  });

  test("content flags: stickers", () => {
    const ev = normalizeMessageCreate(createAction(makeMessage({ content: "", sticker_items: [{ id: "s1" }] })), ctx)!;
    expect(ev.contentTypes.sticker).toBe(true);
    expect(ev.contentTypes.text).toBe(false);
    expect(ev.words).toBe(0);
  });

  test("custom emoji are extracted with ids", () => {
    const ev = normalizeMessageCreate(createAction(makeMessage({ content: "hi <:pog:123> and <a:party:456>" })), ctx)!;
    expect(ev.customEmoji).toEqual([
      { id: "123", name: "pog" },
      { id: "456", name: "party" },
    ]);
  });

  test("malformed actions return null", () => {
    expect(normalizeMessageCreate({ type: "MESSAGE_CREATE" }, ctx)).toBeNull();
    expect(normalizeMessageCreate(createAction(makeMessage({ author: undefined })), ctx)).toBeNull();
  });

  test("the content-storage kill switch nulls content everywhere, even own DMs", () => {
    const killed: NormalizeCtx = { ...ctx, contentStorageEnabled: () => false };
    const own = normalizeMessageCreate(createAction(makeMessage({ channel_id: "dm1" })), killed)!;
    expect(own.content).toBeNull();
    expect(own.chars).toBe(11); // counts still flow — only text is dropped
    const edit = normalizeMessageUpdate(
      { type: "MESSAGE_UPDATE", message: makeMessage({ channel_id: "dm1", content: "v2", edited_timestamp: "2026-07-16T12:01:00.000Z" }) },
      killed
    )!;
    expect(edit.content).toBeNull();
  });
});

describe("normalizeMessageUpdate", () => {
  test("embed-unfurl updates (no edited_timestamp) are ignored", () => {
    const action = { type: "MESSAGE_UPDATE", message: makeMessage({ embeds: [{ type: "link" }] }) };
    expect(normalizeMessageUpdate(action, ctx)).toBeNull();
  });

  test("real edits produce an event with latency from original send", () => {
    const action = {
      type: "MESSAGE_UPDATE",
      message: makeMessage({ content: "hello world!!", edited_timestamp: "2026-07-16T12:05:00.000Z" }),
    };
    const ev = normalizeMessageUpdate(action, ctx)!;
    expect(ev.kind).toBe("message-edited");
    expect(ev.isOwn).toBe(true);
    expect(ev.content).toBe("hello world!!");
    expect(ev.ts).toBe(Date.parse("2026-07-16T12:05:00.000Z"));
    expect(ev.editLatencyMs).toBe(5 * 60_000);
  });

  test("other's guild edit carries null content", () => {
    const action = {
      type: "MESSAGE_UPDATE",
      message: makeMessage({ author: { id: OTHER }, content: "edited secret", edited_timestamp: "2026-07-16T12:05:00.000Z" }),
    };
    expect(normalizeMessageUpdate(action, ctx)!.content).toBeNull();
  });
});

describe("normalizeMessageDelete", () => {
  test("produces a tombstone event stamped with now", () => {
    const ev = normalizeMessageDelete({ type: "MESSAGE_DELETE", id: "msg9", channelId: "guild1", guildId: "g1" }, ctx)!;
    expect(ev).toEqual({
      kind: "message-deleted",
      ts: ctx.now(),
      messageId: "msg9",
      channelId: "guild1",
      guildId: "g1",
    });
  });

  test("returns null without an id", () => {
    expect(normalizeMessageDelete({ type: "MESSAGE_DELETE", channelId: "guild1" }, ctx)).toBeNull();
  });
});

describe("normalizeReaction", () => {
  test("own reaction to someone else's message", () => {
    const ev = normalizeReaction(
      { channelId: "dm1", messageId: "m1", userId: ME, messageAuthorId: OTHER, emoji: { id: "123", name: "pog" } },
      1,
      ctx
    )!;
    expect(ev.actorIsOwn).toBe(true);
    expect(ev.messageAuthorIsOwn).toBe(false);
    expect(ev.direction).toBe(1);
    expect(ev.emoji).toEqual({ id: "123", name: "pog" });
  });

  test("someone reacting to my message, unicode emoji, remove direction", () => {
    const ev = normalizeReaction(
      { channelId: "guild1", messageId: "m2", userId: OTHER, messageAuthorId: ME, emoji: { id: null, name: "👍" } },
      -1,
      ctx
    )!;
    expect(ev.actorIsOwn).toBe(false);
    expect(ev.messageAuthorIsOwn).toBe(true);
    expect(ev.direction).toBe(-1);
    expect(ev.emoji.id).toBeNull();
  });
});

describe("analyzeContent", () => {
  test("word and char counts", () => {
    expect(analyzeContent("  two  words  ")).toMatchObject({ words: 2, chars: 14 });
    expect(analyzeContent("")).toMatchObject({ words: 0, chars: 0 });
  });

  test("domain extraction dedupes and lowercases", () => {
    const a = analyzeContent("https://EXAMPLE.com/x https://example.com/y http://www.foo.bar");
    expect(a.domains).toEqual(["example.com", "foo.bar"]);
  });
});

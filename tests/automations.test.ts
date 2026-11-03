import { describe, it, expect, vi } from "vitest";
vi.mock("../src/config.js", () => ({
  config: {
    ownerIds: new Set([900000001]),
    logLevel: "silent",
    databaseUrl: "",
  },
  telegramFileUrl: () => "",
}));
vi.mock("../src/services/advanced-engine.js", () => ({
  runtimeAdvanced: async () => ({ observation: { enabled: false } }),
}));
import {
  wallTimeCandidates,
  firstPublicationTime,
  nextPublicationTime,
  publicationSchema,
} from "../src/services/publications.js";
import {
  parseVisualResponse,
  requiresLocalReview,
  visualSchema,
} from "../src/services/visual-moderation.js";
import { hasFeature } from "../src/services/entitlements.js";
describe("Publications across clock changes", () => {
  it("resolves a Chilean wall clock in summer time", () =>
    expect(
      wallTimeCandidates("2026-11-03T10:00", "America/Santiago").map((d) =>
        d.toISOString(),
      ),
    ).toEqual(["2026-11-03T13:00:00.000Z"]));
  it("rejects impossible calendar dates", () =>
    expect(() => wallTimeCandidates("2027-02-30T10:00", "UTC")).toThrow(
      "Fecha",
    ));
  it("rejects missing and repeated daylight saving hours at creation", () => {
    const now = new Date("2026-01-01Z");
    expect(() =>
      firstPublicationTime("2026-03-08T02:30", "America/New_York", now),
    ).toThrow("no existe");
    expect(() =>
      firstPublicationTime("2026-11-01T01:30", "America/New_York", now),
    ).toThrow("se repite");
  });
  it("requires a future date with a bounded scheduling horizon", () => {
    expect(() =>
      firstPublicationTime(
        "2026-11-02T10:00",
        "UTC",
        new Date("2026-11-02T09:59:45Z"),
      ),
    ).toThrow("30 segundos");
    expect(() =>
      firstPublicationTime("2028-11-02T10:00", "UTC", new Date("2026-11-02Z")),
    ).toThrow("un año");
  });
  it("keeps the local daily time and skips a DST gap", () =>
    expect(
      nextPublicationTime(
        {
          local_time: "2026-03-07T02:30",
          timezone: "America/New_York",
          recurrence: "daily",
        },
        new Date("2026-03-07T07:30:00Z"),
      )?.toISOString(),
    ).toBe("2026-03-09T06:30:00.000Z"));
  it("does not send the second occurrence of a repeated hour", () =>
    expect(
      nextPublicationTime(
        {
          local_time: "2026-10-31T01:30",
          timezone: "America/New_York",
          recurrence: "daily",
        },
        new Date("2026-11-01T05:30:01Z"),
      )?.toISOString(),
    ).toBe("2026-11-02T06:30:00.000Z"));
  it("anchors weekly posts to their weekday and skips missed runs", () =>
    expect(
      nextPublicationTime(
        {
          local_time: "2026-11-02T10:00",
          timezone: "America/Santiago",
          recurrence: "weekly",
        },
        new Date("2026-11-05T22:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-11-09T13:00:00.000Z"));
  it("finishes a one-off post", () =>
    expect(
      nextPublicationTime(
        { local_time: "2026-11-02T10:00", timezone: "UTC", recurrence: "once" },
        new Date(),
      ),
    ).toBeNull());
  it("rejects unsafe or incomplete buttons", () => {
    const p = {
      title: "Aviso",
      content: "Hola",
      timezone: "UTC",
      localTime: "2026-12-01T10:00",
      recurrence: "once",
    };
    expect(
      publicationSchema.safeParse({
        ...p,
        buttonLabel: "Ir",
        buttonUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      publicationSchema.safeParse({ ...p, buttonLabel: "Ir" }).success,
    ).toBe(false);
  });
});
describe("Visual moderation is specific and fails open", () => {
  it("uses the sexual category, not the overall flagged decision", () =>
    expect(
      parseVisualResponse({
        results: [
          {
            flagged: true,
            categories: { sexual: false, violence: true },
            category_scores: { sexual: 0.01 },
          },
        ],
      }),
    ).toEqual({ sexual: false, score: 0.01 }));
  it.each([
    null,
    {},
    { results: [] },
    {
      results: [
        { categories: { sexual: true }, category_scores: { sexual: NaN } },
      ],
    },
    {
      results: [
        { categories: { sexual: true }, category_scores: { sexual: 1.1 } },
      ],
    },
  ])("returns unknown for invalid responses %j", (body) =>
    expect(parseVisualResponse(body)).toBeNull(),
  );
  it("requires explicit consent before enabling", () => {
    expect(
      visualSchema.safeParse({
        enabled: true,
        mode: "review",
        threshold: 0.9,
        consent: false,
      }).success,
    ).toBe(false);
    expect(
      visualSchema.safeParse({
        enabled: false,
        mode: "review",
        threshold: 0.9,
        consent: false,
      }).success,
    ).toBe(true);
  });
  it("keeps clearly suspected illegal captions in local review", () => {
    expect(requiresLocalReview("CSAM")).toBe(true);
    expect(requiresLocalReview("nude underage")).toBe(true);
    expect(requiresLocalReview("niños jugando en el parque")).toBe(false);
  });
  it("requires Pro but always exempts the Developer", () => {
    const free = {
      premium_until: null,
      premium_tier: null,
      pro_license_id: null,
    };
    for (const f of ["nsfw", "scheduledPosts"] as const) {
      expect(hasFeature(free, f)).toBe(false);
      expect(hasFeature(free, f, 900000001)).toBe(true);
      expect(hasFeature({ ...free, pro_license_id: 1 }, f)).toBe(true);
    }
  });
});

import { describe, it, expect, vi } from "vitest";
vi.mock("../src/config.js", () => ({
  config: {
    botVaultKey: Buffer.alloc(32, 7).toString("base64"),
    ownerIds: new Set([900000001]),
    databaseUrl: "",
    logLevel: "silent",
  },
}));
import {
  encryptBotToken,
  decryptBotToken,
  brandedWebhookSecret,
} from "../src/services/bot-vault.js";
import { cleanAIAnswer, aiSchema } from "../src/services/ai-assistant.js";
import { hasFeature } from "../src/services/entitlements.js";
import { brandPublic, updateChatId } from "../src/services/branded-bots.js";
describe("Ultra capabilities", () => {
  it("reserves both features for Ultra and permanently exempts Developer", () => {
    for (const feature of ["ai", "branding"] as const) {
      expect(
        hasFeature(
          { premium_until: null, pro_license_id: 1, premium_tier: null },
          feature,
        ),
      ).toBe(false);
      expect(
        hasFeature(
          {
            premium_until: new Date(Date.now() + 86400000),
            premium_tier: "ultra",
          },
          feature,
        ),
      ).toBe(true);
      expect(hasFeature(null, feature, 900000001)).toBe(true);
    }
  });
  it("requires consent before enabling AI", () => {
    expect(
      aiSchema.safeParse({ enabled: true, consent: false, instructions: "" })
        .success,
    ).toBe(false);
    expect(
      aiSchema.safeParse({ enabled: false, consent: false, instructions: "" })
        .success,
    ).toBe(true);
  });
  it("does not accept missing or empty AI replies", () => {
    expect(cleanAIAnswer(null)).toBeNull();
    expect(
      cleanAIAnswer({ choices: [{ message: { content: "  " } }] }),
    ).toBeNull();
  });
  it("does not expose reasoning tags or echoed token patterns", () => {
    const token = "gsk_" + "x".repeat(30);
    expect(
      cleanAIAnswer({
        choices: [
          { message: { content: "<think>interno</think>Hola " + token } },
        ],
      }),
    ).toBe("Hola [dato privado omitido]");
  });
  it("encrypts with a random nonce and binds ciphertext to its bot identity", () => {
    const a = encryptBotToken("PRIVATE_QA_VALUE", "bot-a"),
      b = encryptBotToken("PRIVATE_QA_VALUE", "bot-a");
    expect(a).not.toBe(b);
    expect(a).not.toContain("PRIVATE_QA_VALUE");
    expect(decryptBotToken(a, "bot-a")).toBe("PRIVATE_QA_VALUE");
    expect(() => decryptBotToken(a, "bot-b")).toThrow();
    const parts = a.split(".");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decryptBotToken(parts.join("."), "bot-a")).toThrow();
  });
  it("derives a different webhook secret for each bot", () => {
    expect(brandedWebhookSecret("a")).toHaveLength(64);
    expect(brandedWebhookSecret("a")).not.toBe(brandedWebhookSecret("b"));
  });
  it("never returns encrypted tokens or their fingerprints in the panel", () => {
    expect(
      brandPublic({
        id: "a",
        username: "qa_bot",
        token_ciphertext: "PRIVATE",
        token_fingerprint: "PRIVATE_HASH",
      } as never),
    ).toEqual({ id: "a", username: "qa_bot" });
  });
  it("extracts the group identity from all supported webhook families", () => {
    for (const key of [
      "message",
      "edited_message",
      "my_chat_member",
      "chat_member",
      "chat_join_request",
    ])
      expect(updateChatId({ [key]: { chat: { id: -123 } } } as never)).toBe(
        -123,
      );
    expect(
      updateChatId({
        callback_query: { message: { chat: { id: -123 } } },
      } as never),
    ).toBe(-123);
  });
});

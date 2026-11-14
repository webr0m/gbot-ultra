import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, applySettingsPatch, findPremiumFeature, settingsPatchSchema } from "../src/services/settings.js";
import { BOT_LANGUAGES } from "../src/services/bot-i18n.js";

describe("settings", () => {
  it.each(BOT_LANGUAGES)("allows group language %s on every plan", (language) => {
    const result = applySettingsPatch(DEFAULT_SETTINGS, { language }, false);
    expect(result.ok).toBe(true);
    expect(result.settings?.language).toBe(language);
  });

  it("rejects unsupported group languages", () => {
    const result = settingsPatchSchema.safeParse({ language: "sv" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["language"]);
  });

  it("merges a simple toggle", () => {
    const result = applySettingsPatch(DEFAULT_SETTINGS, { reports: { enabled: false } }, true);
    expect(result.ok).toBe(true);
    expect(result.settings?.reports.enabled).toBe(false);
  });

  it("rejects premium features on free plans", () => {
    const result = applySettingsPatch(DEFAULT_SETTINGS, { logs: { enabled: true } }, false);
    expect(result.ok).toBe(false);
    expect(result.premiumFeature).toBe("Canal de registros");
  });

  it("identifies premium features", () => {
    expect(findPremiumFeature({ welcome: { media: { type: "photo", fileId: "abc" } } })).toBe(
      "Bienvenida con foto/vídeo/GIF",
    );
    expect(findPremiumFeature({ captcha: { mode: "math" } })).toBe("Captcha matemático");
    expect(findPremiumFeature({})).toBeNull();
  });

  it("validates antiflood limits", () => {
    const result = applySettingsPatch(DEFAULT_SETTINGS, { antiflood: { limit: 0 } }, true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("antiflood");
  });
});

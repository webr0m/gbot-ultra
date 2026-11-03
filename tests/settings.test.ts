import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, applySettingsPatch, findPremiumFeature } from "../src/services/settings.js";

describe("settings", () => {
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
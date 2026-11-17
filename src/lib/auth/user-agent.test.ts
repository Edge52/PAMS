import { describe, expect, it } from "vitest";
import { browserLabel } from "./user-agent";

describe("browser label (wave 27)", () => {
  it("names common browsers and systems", () => {
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")).toBe("Edge on Windows");
    expect(browserLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe("Safari on Mac");
    expect(browserLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1")).toBe("Chrome on iPhone");
    expect(browserLabel("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36")).toBe("Samsung Internet on Android");
    expect(browserLabel("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox on Linux");
  });
  it("keeps a stored label and handles nothing", () => {
    expect(browserLabel("Chrome on Windows")).toBe("Chrome on Windows");
    expect(browserLabel(null)).toBeNull();
    expect(browserLabel("")).toBeNull();
    expect(browserLabel("curl/8.0")).toBe("Unknown browser");
  });
});

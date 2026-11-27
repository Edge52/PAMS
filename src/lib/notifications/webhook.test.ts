import { describe, expect, it } from "vitest";
import { cleanPhone, messageText, sendMessages, webhookConfig, webhookSender, type OutgoingMessage } from "./webhook";

describe("SMS / WhatsApp webhook (wave 41)", () => {
  it("is off without a URL", () => {
    expect(webhookConfig({})).toBeNull();
    expect(webhookConfig({ NOTIFY_WEBHOOK_URL: "ftp://x" })).toBeNull();
    expect(webhookConfig({ NOTIFY_WEBHOOK_URL: "https://relay.example/send", NOTIFY_WEBHOOK_TOKEN: "abc" })).toEqual({ url: "https://relay.example/send", token: "abc" });
  });
  it("cleans phone numbers and keeps messages short", () => {
    expect(cleanPhone("+20 100 123 4567")).toBe("+201001234567");
    expect(cleanPhone("call me")).toBeNull();
    const t = messageText("x".repeat(400), "https://p.eg/assets/work-orders/1");
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t.endsWith("https://p.eg/assets/work-orders/1")).toBe(true);
  });
  it("posts JSON with the token and skips people without a phone", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    const sender = webhookSender({ url: "https://relay.example/send", token: "tok" }, fake);
    const n = await sendMessages(sender, [{ name: "A", phone: "01001234567" }, { name: "B", phone: null }], { kind: "fault_escalated", title: "WO-1", link: null });
    expect(n).toBe(1);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0].init.body)) as OutgoingMessage).toMatchObject({ to: "01001234567", kind: "fault_escalated", text: "PAMS: WO-1" });
  });
  it("counts a failed send as not sent", async () => {
    const sender = { name: "t", send: async () => { throw new Error("down"); } };
    expect(await sendMessages(sender, [{ name: "A", phone: "01001234567" }], { kind: "k", title: "t", link: null })).toBe(0);
  });
});

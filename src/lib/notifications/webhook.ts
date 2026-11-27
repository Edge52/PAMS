/**
 * Wave 41: optional SMS / WhatsApp for urgent notifications, through any gateway that takes an HTTP POST.
 * No vendor is built in: NOTIFY_WEBHOOK_URL receives JSON `{ to, name, text, kind, link }` (one call per person), with
 * `Authorization: Bearer <NOTIFY_WEBHOOK_TOKEN>` when a token is set. The gateway (or a small relay the hospital runs)
 * turns it into an SMS or a WhatsApp message. Only safety-critical kinds and fault escalations use it, and only for
 * people with a phone number on their account.
 *
 * Never throws: a failed send is logged and the in-app notification stands.
 */

export type OutgoingMessage = { to: string; name: string; text: string; kind: string; link: string | null };

/** Anything that can send a short text message. Swap in another sender for a specific vendor. */
export interface MessageSender {
  readonly name: string;
  send(m: OutgoingMessage): Promise<void>;
}

/** Digits with an optional leading +, or null when it doesn't look like a phone number. */
export function cleanPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.replace(/[\s().-]/g, "");
  return /^\+?\d{8,15}$/.test(t) ? t : null;
}

/** Short message text (SMS-sized: 300 characters at most). */
export function messageText(title: string, link: string | null): string {
  const base = `PAMS: ${title}`;
  const out = link ? `${base} ${link}` : base;
  return out.length <= 300 ? out : `${base.slice(0, 300 - (link ? link.length + 2 : 1))}…${link ? ` ${link}` : ""}`;
}

export type WebhookConfig = { url: string; token: string | null };

export function webhookConfig(env: Record<string, string | undefined> = process.env): WebhookConfig | null {
  const url = env.NOTIFY_WEBHOOK_URL?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { url, token: env.NOTIFY_WEBHOOK_TOKEN?.trim() || null };
}

export function webhookSender(cfg: WebhookConfig, fetchImpl: typeof fetch = fetch): MessageSender {
  return {
    name: "webhook",
    async send(m) {
      const res = await fetchImpl(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) },
        body: JSON.stringify(m),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`webhook answered ${res.status}`);
    },
  };
}

/** The configured sender, or null when none is set up. */
export function configuredSender(): MessageSender | null {
  const cfg = webhookConfig();
  return cfg ? webhookSender(cfg) : null;
}

/** Send to each person with a usable phone number; returns how many went out. */
export async function sendMessages(sender: MessageSender | null, people: { name: string; phone: string | null }[], n: { kind: string; title: string; link: string | null }): Promise<number> {
  if (!sender) return 0;
  let sent = 0;
  for (const p of people) {
    const to = cleanPhone(p.phone);
    if (!to) continue;
    try {
      await sender.send({ to, name: p.name, text: messageText(n.title, n.link), kind: n.kind, link: n.link });
      sent++;
    } catch (e) {
      console.error(`[notifications] ${sender.name} message failed:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

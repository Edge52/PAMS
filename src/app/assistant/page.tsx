import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getChat, listChats } from "@/lib/assistant/chats-server";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/format";
import { deleteChatAction } from "./actions";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assistant" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const s = await getSettings();
  const ready = s.assistantEnabled && !!process.env.ANTHROPIC_API_KEY;
  const hints = [
    can(me.role, "assets.view") && "Which devices in the ICU are out of service, and why?",
    can(me.role, "assets.view") && "List the urgent open work orders.",
    can(me.role, "assets.view") && "Which service contracts end in the next 90 days?",
    can(me.role, "assets.view") && "Draft a technical specification for a high-end patient monitor.",
    can(me.role, "boq.view") && "Summarise the latest approved BOQ by department.",
    can(me.role, "procurement.view") && "How much of this year's capital budget is left?",
    can(me.role, "procurement.view") && "Draft a letter to the supplier of the latest late purchase order asking for a delivery date.",
  ].filter(Boolean) as string[];
  const chatParam = Number(typeof sp.chat === "string" ? sp.chat : NaN);
  const [chats, open] = await Promise.all([listChats(me.id), Number.isInteger(chatParam) && chatParam > 0 ? getChat(chatParam, me.id) : null]);

  return (
    <>
      <PageHeader title="Assistant" description="Ask about your devices, work orders, contracts, recalls, BOQs, projects, suppliers and budgets, or have it draft a specification or letter. It only sees what you can see, and can't change anything." />
      {!ready ? (
        <EmptyState title="The assistant is switched off">
          {can(me.role, "settings.manage")
            ? <>Switch it on in <a href="/admin/settings" className="text-primary hover:underline">settings</a>. It also needs <code>ANTHROPIC_API_KEY</code> on the server{!process.env.ANTHROPIC_API_KEY ? " (not set yet)" : ""}. Questions and the records it looks up are sent to Anthropic to answer them.</>
            : "Ask an administrator if you'd like to use it."}
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
          <div className="min-w-0">
            {sp.chat && !open && <p role="alert" className="mb-3 text-sm text-danger">That chat isn&apos;t there any more. Start a new one below.</p>}
            <Chat key={open?.id ?? "new"} hints={hints} chatId={open?.id ?? null} initialTurns={open?.turns ?? []} />
          </div>
          <aside aria-label="Your chats" className="lg:border-l lg:border-line lg:pl-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Your chats</h2>
              {open && <Link href="/assistant" className="text-xs text-primary hover:underline">New chat</Link>}
            </div>
            {chats.length === 0 ? <p className="text-xs text-muted">Chats are kept here after the first answer, for you only (the last 50).</p> : (
              <ul className="space-y-1 text-sm">
                {chats.map((c) => (
                  <li key={c.id} className={`group flex items-start gap-1 rounded px-1.5 py-1 ${open?.id === c.id ? "bg-primary-soft" : "hover:bg-sunken"}`}>
                    <Link href={`/assistant?chat=${c.id}`} className="min-w-0 flex-1">
                      <span className="line-clamp-2">{c.title}</span>
                      <span className="block text-xs text-muted">{formatDate(c.updatedAt)}</span>
                    </Link>
                    <form action={deleteChatAction}><input type="hidden" name="chatId" value={c.id} />
                      <button className="px-1 text-xs text-muted hover:text-danger" aria-label={`Delete chat: ${c.title}`} title="Delete">×</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

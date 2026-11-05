import { EmptyState, PageHeader } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const me = await requireUser();
  const s = await getSettings();
  const ready = s.assistantEnabled && !!process.env.ANTHROPIC_API_KEY;
  const hints = [
    can(me.role, "assets.view") && "Which devices in the ICU are out of service, and why?",
    can(me.role, "assets.view") && "List the urgent open work orders.",
    can(me.role, "assets.view") && "Draft a technical specification for a high-end patient monitor.",
    can(me.role, "procurement.view") && "How much of this year's capital budget is left?",
    can(me.role, "procurement.view") && "Draft a letter to the supplier of the latest late purchase order asking for a delivery date.",
  ].filter(Boolean) as string[];
  return (
    <>
      <PageHeader title="Assistant" description="Ask about your devices, work orders, projects, suppliers and budgets, or have it draft a specification or letter. It only sees what you can see, and can't change anything." />
      {ready ? <Chat hints={hints} /> : (
        <EmptyState title="The assistant is switched off">
          {can(me.role, "settings.manage")
            ? <>Switch it on in <a href="/admin/settings" className="text-primary hover:underline">settings</a>. It also needs <code>ANTHROPIC_API_KEY</code> on the server{!process.env.ANTHROPIC_API_KEY ? " (not set yet)" : ""}. Questions and the records it looks up are sent to Anthropic to answer them.</>
            : "Ask an administrator if you'd like to use it."}
        </EmptyState>
      )}
    </>
  );
}

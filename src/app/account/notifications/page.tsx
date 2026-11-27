import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { control, Field, PageHeader, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ChannelGrid } from "@/components/notifications/channel-grid";
import { DeputyPanel } from "@/components/notifications/deputy-panel";
import { requireUser } from "@/lib/auth/session";
import { currentDelegations } from "@/lib/approvals/delegation-server";
import { todayISO } from "@/lib/format";
import { effectiveChannel } from "@/lib/notifications/prefs";
import { prefsOf, roleDefaults } from "@/lib/notifications/prefs-server";
import { emailStatus } from "@/lib/notifications/email";
import { saveMyNotificationPrefs } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function MyNotificationsPage() {
  const me = await requireUser();
  const today = todayISO();
  const [mine, defaults, mail, dels, people] = await Promise.all([
    prefsOf(me.id), roleDefaults(), emailStatus(), currentDelegations(today, me.id),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)).limit(1000),
  ]);
  return (
    <>
      <PageHeader title="Notifications" description="Choose how you hear about each kind of notice, get one email a day instead of many, and name a deputy for approvals while you are away." />
      <p className="mb-4 text-sm"><Link href="/account" className="font-semibold text-primary hover:underline">Back to your account</Link></p>
      <div className="space-y-6">
        <Panel title="How you get each kind">
          {!mail.active && <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-sm">Email isn&apos;t switched on for this server yet, so only the inbox is used for now.</p>}
          <ActionForm action={saveMyNotificationPrefs} className="space-y-6">
            <ChannelGrid values={mine.channels} fallback={(k) => effectiveChannel(k, null, me.role, defaults)} fallbackLabel="Usual" />
            <fieldset className="rounded-md border border-line p-4">
              <legend className="px-1 text-sm font-bold">Daily digest</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="digest" defaultChecked={mine.digest.enabled} /> One email a day instead of each email (safety notices still come at once)
              </label>
              <Field label="Send it at (Cairo time)" className="mt-3 max-w-48">
                <select name="digestHour" defaultValue={mine.digest.hour} className={`${control} pr-8`}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </Field>
              {mine.digest.lastSentOn && <p className="mt-2 text-xs text-muted">Last digest: {mine.digest.lastSentOn}</p>}
            </fieldset>
            <SubmitButton>Save notification choices</SubmitButton>
          </ActionForm>
        </Panel>
        <DeputyPanel meId={me.id} today={today} forAnyone={false} people={people}
          rows={dels.map((r) => ({ id: r.d.id, userId: r.d.userId, userName: r.userName, deputyId: r.d.deputyId, deputyName: r.deputyName, startsOn: r.d.startsOn, endsOn: r.d.endsOn, reason: r.d.reason, setByName: r.d.setByName }))} />
      </div>
    </>
  );
}

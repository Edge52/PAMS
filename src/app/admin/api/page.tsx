import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiCalls, apiTokens, facilities } from "@/db/schema";
import { Badge, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ApiTokenForm } from "@/components/api-token-form";
import { requirePermission } from "@/lib/auth/session";
import { RATE_PER_MINUTE, SCOPE_LABELS, SCOPES, tokenProblem } from "@/lib/api/tokens";
import { formatDate, formatDateTime } from "@/lib/format";
import { createApiTokenAction, revokeApiTokenAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "API tokens" };

/** Wave 41: tokens for the read-only API (/api/v1). Administrators only. */
export default async function ApiTokensPage() {
  await requirePermission("settings.manage");
  const [tokens, facs, calls] = await Promise.all([
    db.select({ t: apiTokens, calls30: sql<number>`(select count(*) from api_calls c where c.token_id = ${apiTokens.id} and c.at > now() - interval '30 days')::int` })
      .from(apiTokens).orderBy(desc(apiTokens.createdAt)).limit(200),
    db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities).orderBy(facilities.code).limit(200),
    db.select().from(apiCalls).orderBy(desc(apiCalls.at)).limit(50),
  ]);
  const now = new Date();
  const code = new Map(facs.map((f) => [f.id, f.code]));
  const nameOf = new Map(tokens.map(({ t }) => [t.id, t.name]));
  return (
    <>
      <PageHeader title="API tokens" back={{ href: "/admin/settings", label: "Settings" }}
        description={`Tokens let another system (a BI tool, the ministry's dashboard) read PAMS data. They can only read. Each call is logged; at most ${RATE_PER_MINUTE} calls a minute per token. How to call it: docs/api.md in the code.`} />
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Panel title="Tokens" padded={false}>
          {tokens.length === 0 ? <p className="p-4 text-sm text-muted">No tokens yet. Make one with the form.</p> : (
            <Table>
              <THead><tr><Th>Name</Th><Th>Token</Th><Th>May read</Th><Th>Hospitals</Th><Th>Valid until</Th><Th>Last used</Th><Th className="text-right">Calls (30 days)</Th><Th /></tr></THead>
              <tbody>{tokens.map(({ t, calls30 }) => {
                const problem = tokenProblem(t, now);
                return (
                  <tr key={t.id} className="border-t border-line align-top">
                    <Td><b>{t.name}</b><span className="block text-xs text-muted">by {t.createdByName ?? "—"}, {formatDate(t.createdAt)}</span></Td>
                    <Td className="font-mono text-xs">{t.prefix}…</Td>
                    <Td className="text-xs">{t.scopes.join(", ")}</Td>
                    <Td className="text-xs">{t.facilityIds ? t.facilityIds.map((id) => code.get(id) ?? id).join(", ") : "All"}</Td>
                    <Td>{problem ? <Badge tone="danger">{t.revokedAt ? "Revoked" : "Expired"}</Badge> : formatDate(t.expiresAt)}</Td>
                    <Td className="text-xs">{t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "Never"}</Td>
                    <Td className="text-right">{calls30}</Td>
                    <Td>{!t.revokedAt && <ActionForm action={revokeApiTokenAction} confirm={`Revoke "${t.name}"? Calls with it are refused at once.`} tone="danger"><input type="hidden" name="id" value={t.id} /><SubmitButton variant="ghost">Revoke</SubmitButton></ActionForm>}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Make a token">
          <ApiTokenForm action={createApiTokenAction} scopes={SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s] }))} facilities={facs} />
        </Panel>
      </div>
      <Panel title="Last 50 calls" className="mt-5" padded={false}>
        {calls.length === 0 ? <p className="p-4 text-sm text-muted">No calls yet.</p> : (
          <Table>
            <THead><tr><Th>When</Th><Th>Token</Th><Th>Address</Th><Th>Path</Th><Th className="text-right">Answer</Th><Th className="text-right">Rows</Th></tr></THead>
            <tbody>{calls.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <Td className="text-xs">{formatDateTime(c.at)}</Td><Td className="text-xs">{c.tokenId ? nameOf.get(c.tokenId) ?? `#${c.tokenId}` : "No valid token"}</Td>
                <Td className="font-mono text-xs">{c.ip ?? "—"}</Td><Td className="break-all font-mono text-xs">{c.path}</Td>
                <Td className={`text-right ${c.status >= 400 ? "text-danger" : ""}`}>{c.status}</Td><Td className="text-right">{c.rows ?? "—"}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}

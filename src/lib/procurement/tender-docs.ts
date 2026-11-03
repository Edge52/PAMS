import "server-only";
/** Data shared by the printable tender documents (wave 10): the project, its committees and members. */
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { committeeMembers, committees, facilities, projects } from "@/db/schema";

export async function tenderDocBase(projectId: number) {
  const [p] = await db.select({ p: projects, facility: facilities.name }).from(projects).leftJoin(facilities, eq(facilities.id, projects.facilityId)).where(eq(projects.id, projectId));
  if (!p) return null;
  const cs = await db.select().from(committees).where(eq(committees.projectId, projectId));
  const ms = cs.length ? await db.select().from(committeeMembers).where(inArray(committeeMembers.committeeId, cs.map((c) => c.id))).orderBy(asc(committeeMembers.id)) : [];
  /** The committee for a stage: opening (or combined), else adjudication (or combined). */
  const committeeFor = (stage: "opening" | "evaluation") => {
    const want = stage === "opening" ? ["OPENING", "COMBINED"] : ["ADJUDICATION", "COMBINED"];
    const c = cs.find((x) => want.includes(x.kind));
    return c ? { ...c, members: ms.filter((m) => m.committeeId === c.id) } : null;
  };
  return { project: p.p, facility: p.facility, committeeFor };
}

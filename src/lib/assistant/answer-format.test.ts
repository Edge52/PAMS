import { describe, expect, it } from "vitest";
import { docx } from "../docx";
import { chatTitle, fileSlug, parseAnswer, runs } from "./answer-format";

describe("assistant answers", () => {
  it("reads headings, lists, paragraphs and tables", () => {
    const b = parseAnswer("## Patient monitor\nIntro line.\n\n- Screen ≥ 15 in\n  - touch\n2. Second\n\n| Item | Value |\n|---|---:|\n| SpO2 | yes |\n| NIBP | yes |\nAfter.");
    expect(b.map((x) => x.type)).toEqual(["h", "p", "gap", "li", "li", "li", "gap", "table", "p"]);
    expect(b[0]).toEqual({ type: "h", level: 2, text: "Patient monitor" });
    expect(b[4]).toMatchObject({ depth: 1, text: "touch" });
    expect(b[5]).toMatchObject({ n: 2, text: "Second" });
    expect(b[7]).toEqual({ type: "table", rows: [["Item", "Value"], ["SpO2", "yes"], ["NIBP", "yes"]] });
  });
  it("splits bold and code", () => {
    expect(runs("Tag **ICU-MON-1** at `/assets/3`")).toEqual([{ text: "Tag " }, { text: "ICU-MON-1", bold: true }, { text: " at " }, { text: "/assets/3", code: true }]);
  });
  it("names chats and files", () => {
    expect(fileSlug("Draft a spec: ICU ventilator (adult)!")).toBe("draft-a-spec-icu-ventilator-adult");
    expect(fileSlug("???")).toBe("assistant-answer");
    expect(chatTitle("short one")).toBe("short one");
    const t = chatTitle("Which of the devices in the intensive care unit on the third floor are out of service and why are they still waiting");
    expect(t.length).toBeLessThanOrEqual(81); expect(t.endsWith("…")).toBe(true);
  });
  it("writes a Word file with the parts Word needs", () => {
    const f = docx({ title: "Spec", subtitle: "Hospital PAMS", blocks: parseAnswer("# A & B\n- one <x>\n\n|a|b|\n|-|-|\n|1|2|") });
    const s = new TextDecoder().decode(f);
    expect(s.startsWith("PK")).toBe(true);
    for (const part of ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "_rels/.rels", "docProps/core.xml"]) expect(s).toContain(part);
    expect(s).toContain("A &amp; B"); expect(s).toContain("one &lt;x&gt;"); expect(s).toContain("<w:tbl>");
  });
});

/**
 * A minimal Word (.docx) writer (wave 14): headings, paragraphs, bulleted and numbered lines, simple tables, bold and
 * code. Enough for assistant answers (specifications, letters, memos) to open in Word, Pages or Google Docs without a
 * package. Pure; uses the stored-zip writer.
 */
import type { Block, Run } from "./assistant/answer-format";
import { runs } from "./assistant/answer-format";
import { zip } from "./zip";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  // Characters XML 1.0 doesn't allow.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function runXml(r: Run, extraBold = false): string {
  const props = [(r.bold || extraBold) && "<w:b/>", r.code && `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>`].filter(Boolean).join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}
const para = (text: string, pPr = "", bold = false) => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs(text).map((r) => runXml(r, bold)).join("")}</w:p>`;

function tableXml(rows: string[][]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = Math.floor(9000 / Math.max(1, cols));
  const border = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/>`).join("")}</w:tblBorders>`;
  const body = rows.map((r, i) => `<w:tr>${Array.from({ length: cols }, (_, c) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${i === 0 ? `<w:shd w:val="clear" w:color="auto" w:fill="E8EEF0"/>` : ""}</w:tcPr>${para(r[c] ?? "", `<w:spacing w:before="40" w:after="40"/>`, i === 0)}</w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width * cols}" w:type="dxa"/>${border}<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${body}</w:tbl><w:p/>`;
}

export function blocksXml(blocks: Block[]): string {
  return blocks.map((b) => {
    switch (b.type) {
      case "h": return para(b.text, `<w:pStyle w:val="Heading${Math.min(3, b.level)}"/>`);
      case "li": {
        const indent = 360 + b.depth * 360;
        return para(`${b.n != null ? `${b.n}.` : "•"}\t${b.text}`, `<w:tabs><w:tab w:val="left" w:pos="${indent}"/></w:tabs><w:ind w:left="${indent}" w:hanging="300"/><w:spacing w:after="40"/>`);
      }
      case "p": return para(b.text);
      case "table": return tableXml(b.rows);
      case "gap": return "";
    }
  }).join("");
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1D5C4D"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1D5C4D"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`;

/** A .docx file: an optional title and a small grey line under it, then the blocks. */
export function docx(opts: { title?: string; subtitle?: string; blocks: Block[]; footer?: string; created?: Date }): Uint8Array {
  const head = (opts.title ? para(opts.title, `<w:pStyle w:val="Title"/>`) : "") + (opts.subtitle ? para(opts.subtitle, `<w:pStyle w:val="Small"/>`) : "");
  const foot = opts.footer ? para(opts.footer, `<w:pStyle w:val="Small"/><w:spacing w:before="240"/>`) : "";
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${head}${blocksXml(opts.blocks)}${foot}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const enc = new TextEncoder();
  const when = (opts.created ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["word/document.xml", document],
    ["word/styles.xml", STYLES],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title ?? "")}</dc:title><dc:creator>Hospital PAMS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created></cp:coreProperties>`],
  ];
  return zip(files.map(([name, s]) => ({ name, data: enc.encode(s) })), opts.created);
}

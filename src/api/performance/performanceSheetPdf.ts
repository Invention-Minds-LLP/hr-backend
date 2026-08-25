/**
 * Performance Indicator sheet as a PDF, laid out to match the printed form
 * departments already use: a criteria grid grouped by category and section, one
 * score column per assessment period, the scoring-criteria box, the summary
 * table with signature images, and the closing appreciations block.
 *
 * pdfkit, not puppeteer — puppeteer is named in CLAUDE.md but is not installed
 * (see lib/htmlPdf.ts for the reasoning). This follows payslipPdf.ts.
 *
 * Two scopes:
 *   cycle  — the periods belonging to one cycle
 *   tenure — every period the employee has, across every cycle
 *
 * Columns are keyed by (cycle, period), not period alone: every annual review is
 * stored as YEAR_1, so keying on period would collapse a fourth-year review into
 * the same column as the first-year one and silently drop the rest.
 *
 * Layout flows continuously. Blocks start a new page only when they will not fit
 * on the current one, so a short template does not produce four near-empty pages.
 */

import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma";
import {
  parseScoreBands,
  templateMaxMarks,
  bandFor,
  canSeeReviewerScore,
  REVIEWER_ROLE_LABELS,
  MAX_SCORE_PER_QUESTION,
  ReviewerRole,
} from "../../lib/performance-scoring";
import { applyLetterhead, hasLetterhead, LETTERHEAD_SAFE_MARGINS } from "../../lib/pdfLetterhead";
import { labelForCyclePeriod, isFirstYearCycle, cycleEndDate } from "../../lib/appraisal-cycle";

/** Order probation periods run in; anything else sorts after them. */
const PERIOD_ORDER = ["MONTH_1", "MONTH_3", "MONTH_6", "YEAR_1", "YEAR_2"];

/** Side margin; top/bottom come from the letterhead's safe area when one is set. */
const PAGE_MARGIN = 36;
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

/** Widest the criteria text may get squeezed before a table is split. */
const MIN_CRITERIA_WIDTH = 150;
const SCORE_COL_W = 42;

export interface SheetOptions {
  employeeId: number;
  scope: "cycle" | "tenure";
  cycle?: string;
  /**
   * Who is downloading. Only HR gets every reviewer's marks; anyone else gets
   * their own column and blanks elsewhere. Omitted means HR-equivalent, so
   * internal callers must pass this deliberately.
   */
  viewer?: { role: ReviewerRole | null; isHR: boolean };
}

interface Cell { text: string; bold?: boolean; align?: "left" | "center"; }

/** One score column: a specific period within a specific cycle. */
interface Column {
  cycle: string;
  period: string;
  label: string;
  firstYear: boolean;
  sort: number;
}

async function loadSheet(opts: SheetOptions) {
  const employee = await prisma.employee.findUnique({
    where: { id: opts.employeeId },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true,
      dateOfJoining: true, Department: { select: { name: true } },
    },
  });
  if (!employee) return null;

  const cycleFilter = opts.scope === "cycle" && opts.cycle ? { cycle: opts.cycle } : {};

  const summaries = await prisma.performanceSummary.findMany({
    // Retired periods are not part of the live sheet.
    where: { employeeId: opts.employeeId, archivedAt: null, ...cycleFilter },
    include: { template: { include: { questions: { orderBy: { orderNo: "asc" } } } } },
    orderBy: [{ cycle: "asc" }, { createdAt: "asc" }],
  });
  if (!summaries.length) return null;

  // Where a tenure sheet spans templates, the richest one defines the grid —
  // it has to be a single shape.
  const templates = summaries
    .map((s) => s.template)
    .filter(Boolean) as NonNullable<typeof summaries[0]["template"]>[];
  const template = templates.sort((a, b) => b.questions.length - a.questions.length)[0] ?? null;

  const responses = template
    ? await prisma.performanceResponse.findMany({
        where: {
          employeeId: opts.employeeId,
          ...cycleFilter,
          questionId: { in: template.questions.map((q) => q.id) },
        },
      })
    : [];

  const finalReview = await prisma.performanceFinalReview.findFirst({
    where: { employeeId: opts.employeeId, ...cycleFilter },
    orderBy: { id: "desc" },
  });

  // No FK to PerformanceSummary — joined on employee + cycle, the same way
  // PerformanceFinalReview is. The tenure filter is empty, so that scope picks
  // up one self-appraisal per cycle.
  const selfAppraisals = await prisma.performanceSelfAppraisal.findMany({
    where: { employeeId: opts.employeeId, ...cycleFilter },
    include: { answers: { include: { question: true } } },
    orderBy: [{ cycle: "asc" }, { period: "asc" }],
  });

  const doj = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null;

  const seen = new Set<string>();
  const columns: Column[] = [];
  for (const s of summaries) {
    const key = `${s.cycle}|${s.period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const end = cycleEndDate(s.cycle);
    const idx = PERIOD_ORDER.indexOf(s.period as string);
    columns.push({
      cycle: s.cycle,
      period: s.period as string,
      label: labelForCyclePeriod(doj, s.cycle, s.period as string),
      firstYear: isFirstYearCycle(doj, s.cycle),
      // Order by when the cycle ends, then by probation order inside it.
      sort: (end ? end.getTime() : 0) + (idx < 0 ? 99 : idx),
    });
  }
  columns.sort((a, b) => a.sort - b.sort);

  return { employee, doj, summaries, template, responses, finalReview, selfAppraisals, columns };
}

function drawRow(
  doc: PDFKit.PDFDocument,
  cells: Cell[],
  widths: number[],
  x: number,
  y: number,
  minHeight = 18,
): number {
  const pad = 4;
  const heights = cells.map((c, i) => {
    doc.font(c.bold ? FONT_BOLD : FONT).fontSize(8);
    return doc.heightOfString(c.text || "", { width: widths[i] - pad * 2 }) + pad * 2;
  });
  const h = Math.max(minHeight, ...heights);

  let cx = x;
  cells.forEach((c, i) => {
    doc.rect(cx, y, widths[i], h).strokeColor("#000").lineWidth(0.5).stroke();
    doc.font(c.bold ? FONT_BOLD : FONT).fontSize(8).fillColor("#000");
    doc.text(c.text || "", cx + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || "left" });
    cx += widths[i];
  });
  return h;
}

export async function buildPerformanceSheetPdf(
  opts: SheetOptions,
): Promise<{ pdf: Buffer; filename: string } | null> {
  const data = await loadSheet(opts);
  if (!data) return null;

  const { employee, doj, summaries, template, responses, finalReview, selfAppraisals, columns } = data;

  // Default to HR-equivalent so an internal caller that forgets to pass a viewer
  // produces the complete record rather than a silently blank one; the route
  // always passes the real caller.
  const viewerRole = opts.viewer ? opts.viewer.role : null;
  const viewerIsHR = opts.viewer ? opts.viewer.isHR : true;

  const margins = hasLetterhead()
    ? { ...LETTERHEAD_SAFE_MARGINS }
    : { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN };

  const doc = new PDFDocument({ size: "A4", margins, layout: "portrait" });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  applyLetterhead(doc);

  const left = margins.left;
  const bottom = doc.page.height - margins.bottom;
  const usable = doc.page.width - margins.left - margins.right;

  let y = margins.top;
  /** Start a new page only if `need` points won't fit below the cursor. */
  const ensure = (need: number) => {
    if (y + need > bottom) {
      doc.addPage();
      y = margins.top;
    }
  };

  const name = `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim();
  const deptName = employee.Department?.name ?? "";
  const bands = parseScoreBands(template?.scoreBands);
  const maxMarks = template ? templateMaxMarks(template.questions) : 0;

  // ── Title + employee details, compact and on the same page as the grid ────
  doc.font(FONT_BOLD).fontSize(13)
    .text(`DEPARTMENT OF ${deptName.toUpperCase()}`, left, y, { width: usable, align: "center" });
  y = doc.y + 2;
  doc.fontSize(11).text("PERFORMANCE INDICATOR / APPRAISAL", left, y, { width: usable, align: "center" });
  y = doc.y + 2;
  doc.fontSize(10).text(
    opts.scope === "tenure" ? "FULL TENURE" : (opts.cycle || summaries[0]?.cycle || ""),
    left, y, { width: usable, align: "center" },
  );
  y = doc.y + 10;

  // Two columns of details rather than four stacked lines.
  const half = usable / 2;
  const details: Array<[string, string]> = [
    ["NAME OF THE STAFF", name],
    ["EMP NO", employee.employeeCode ?? ""],
    ["DEPARTMENT", deptName],
    ["DATE OF JOINING", doj ? doj.toLocaleDateString("en-GB") : ""],
  ];
  doc.fontSize(9);
  for (let i = 0; i < details.length; i += 2) {
    const rowY = y;
    for (let c = 0; c < 2 && i + c < details.length; c++) {
      const [k, v] = details[i + c];
      doc.font(FONT_BOLD).text(`${k}: `, left + half * c, rowY, { continued: true });
      doc.font(FONT).text(v);
    }
    y = rowY + 13;
  }
  y += 8;

  // ── Criteria grid(s) ─────────────────────────────────────────────────────
  if (template && template.questions.length && columns.length) {
    const firstYearCols = columns.filter((c) => c.firstYear);
    const annualCols = columns.filter((c) => !c.firstYear);

    // How many score columns still leave the criteria text readable.
    const perTable = Math.max(
      1,
      Math.floor((usable - MIN_CRITERIA_WIDTH - 120) / SCORE_COL_W),
    );

    const groups: Array<{ title: string; cols: Column[] }> = [];
    if (firstYearCols.length) groups.push({ title: "First year", cols: firstYearCols });
    // Annual reviews are unbounded — chunk them so a long-serving employee gets
    // extra tables rather than columns squeezed past legibility.
    for (let i = 0; i < annualCols.length; i += perTable) {
      const chunk = annualCols.slice(i, i + perTable);
      groups.push({
        title: chunk.length === 1 ? chunk[0].label : `${chunk[0].label} – ${chunk[chunk.length - 1].label}`,
        cols: chunk,
      });
    }

    for (const group of groups) {
      const scoreTotal = SCORE_COL_W * group.cols.length;
      const fixed = usable - scoreTotal;
      const catW = fixed * 0.22;
      const secW = fixed * 0.25;
      const critW = fixed - catW - secW;
      const widths = [catW, secW, critW, ...group.cols.map(() => SCORE_COL_W)];

      // Only title the tables when there is more than one to tell apart.
      if (groups.length > 1) {
        ensure(30);
        doc.font(FONT_BOLD).fontSize(9).fillColor("#000")
          .text(group.title, left, y, { width: usable });
        y = doc.y + 3;
      }

      const header = () => {
        ensure(30);
        y += drawRow(doc, [
          { text: "What is there in the final assessment", bold: true },
          { text: "Header", bold: true },
          { text: "Criteria", bold: true },
          ...group.cols.map((c) => ({ text: c.label, bold: true, align: "center" as const })),
        ], widths, left, y, 26);
      };
      header();

      let lastCategory = "";
      let lastSection = "";

      for (const q of template.questions) {
        if (y + 24 > bottom) {
          doc.addPage();
          y = margins.top;
          lastCategory = "";
          lastSection = "";
          header();
        }

        const cat = q.category ?? "";
        const sec = q.section ?? "";

        const scoreCells = group.cols.map((col) => {
          // Scoped to the column's own cycle, so a fourth-year score never
          // shows up under the first-year column — and filtered by what this
          // downloader is allowed to see, so an employee's own copy does not
          // carry their reviewers' marks.
          const forCell = responses.filter(
            (r) =>
              r.questionId === q.id &&
              r.period === col.period &&
              r.cycle === col.cycle &&
              r.score != null &&
              canSeeReviewerScore(viewerRole, viewerIsHR, r.reviewerRole),
          );
          // Most senior available reviewer, mirroring how the paper form carries
          // one number per period: Management, then HOD, then In-charge.
          const pick = forCell.find((r) => r.reviewerRole === "MANAGEMENT")
            ?? forCell.find((r) => r.reviewerRole === "HOD")
            ?? forCell.find((r) => r.reviewerRole === "INCHARGE")
            ?? forCell.find((r) => r.reviewerRole !== "SELF")
            ?? forCell[0];
          return { text: pick?.score != null ? String(pick.score) : "", align: "center" as const };
        });

        y += drawRow(doc, [
          { text: cat === lastCategory ? "" : cat },
          { text: sec === lastSection ? "" : sec },
          { text: q.text ?? "" },
          ...scoreCells,
        ], widths, left, y);
        lastCategory = cat;
        lastSection = sec;
      }
      y += 10;
    }
  }

  // ── Scoring criteria ─────────────────────────────────────────────────────
  ensure(40 + bands.length * 18);
  doc.font(FONT_BOLD).fontSize(9).fillColor("#000").text("SCORING CRITERIA", left, y);
  y = doc.y + 3;

  const bw = [50, usable * 0.4, usable - 50 - usable * 0.4];
  y += drawRow(doc, [
    { text: "SL NO", bold: true },
    { text: "SCORING", bold: true },
    { text: `MARKS (out of ${maxMarks || "—"})`, bold: true },
  ], bw, left, y);

  bands.forEach((b, i) => {
    const from = Math.ceil((b.minPercent / 100) * maxMarks);
    const above = bands[i - 1];
    const to = above ? Math.ceil((above.minPercent / 100) * maxMarks) - 1 : maxMarks;
    y += drawRow(doc, [
      { text: String(i + 1), align: "center" },
      { text: b.label },
      { text: maxMarks ? (i === 0 ? `${from} onwards` : `${from} – ${to}`) : `${b.minPercent}%+` },
    ], bw, left, y);
  });

  y += 6;
  doc.font(FONT).fontSize(8)
    .text("Note: Scoring criteria  1. Poor   2. Satisfactory   3. Good   4. Very-Good   5. Excellent", left, y);
  y = doc.y + 8;

  // ── Summary with signatures — one row per column, so it grows with tenure ─
  ensure(60);
  const sw = [usable * 0.18, usable * 0.13, usable * 0.19, usable * 0.16, usable * 0.18, usable * 0.16];
  const summaryHeader = () => {
    y += drawRow(doc, [
      { text: "Assessment Period", bold: true },
      { text: "Marks Scored", bold: true, align: "center" },
      { text: "Overall Performance", bold: true, align: "center" },
      { text: "Employee", bold: true, align: "center" },
      { text: "Supervisor / In-charge", bold: true, align: "center" },
      { text: "HOD", bold: true, align: "center" },
    ], sw, left, y, 26);
  };
  summaryHeader();

  const rowH = 38;
  for (const col of columns) {
    if (y + rowH > bottom) {
      doc.addPage();
      y = margins.top;
      summaryHeader();
    }

    const row = summaries.find((s) => s.cycle === col.cycle && (s.period as string) === col.period);
    const marks = row?.marksScored ?? null;
    const perf = row?.overallPerf ?? (marks != null ? bandFor(marks, maxMarks, bands) : null);

    drawRow(doc, [
      { text: col.label },
      { text: marks != null ? String(marks) : "", align: "center" },
      { text: perf ?? "", align: "center" },
      { text: "" }, { text: "" }, { text: "" },
    ], sw, left, y, rowH);

    let sx = left + sw[0] + sw[1] + sw[2];
    [row?.employeeSig, row?.supervisorSig, row?.hodSig].forEach((sig, i) => {
      const cw = sw[3 + i];
      if (typeof sig === "string" && sig.startsWith("data:image")) {
        try {
          doc.image(Buffer.from(sig.split(",")[1], "base64"), sx + 4, y + 4, {
            fit: [cw - 8, rowH - 8], align: "center",
          });
        } catch { /* a corrupt data URI must not abort the document */ }
      }
      sx += cw;
    });
    y += rowH;
  }
  y += 12;

  // ── Self-appraisal ───────────────────────────────────────────────────────
  // The employee's own words, between them and HR. An in-charge or supervisor
  // downloading the sheet must not get it, or the PDF would leak round the
  // front what the API now withholds.
  const mayReadSelf = viewerIsHR || (opts.viewer?.role === "SELF");
  if (mayReadSelf && selfAppraisals.length) {
    for (const sa of selfAppraisals) {
      ensure(46);
      const saLabel = labelForCyclePeriod(doj, sa.cycle, sa.period as string);
      doc.font(FONT_BOLD).fontSize(9).fillColor("#000")
        .text(
          `SELF-APPRAISAL — ${saLabel} · ${sa.cycle}${sa.submittedAt ? "" : "  (draft)"}`,
          left, y,
        );
      y = doc.y + 4;

      if (sa.answers.length) {
        const qw = [usable * 0.58, usable * 0.12, usable * 0.30];
        const saHeader = () => {
          y += drawRow(doc, [
            { text: "Question", bold: true },
            { text: "Rating", bold: true, align: "center" },
            { text: "Comments", bold: true },
          ], qw, left, y, 20);
        };
        saHeader();

        // Grouped by section, as the on-screen form presents them.
        const bySection = new Map<string, typeof sa.answers>();
        for (const a of sa.answers) {
          const sec = a.question?.section || "General";
          if (!bySection.has(sec)) bySection.set(sec, [] as any);
          bySection.get(sec)!.push(a);
        }

        for (const [section, items] of bySection) {
          if (y + 24 > bottom) { doc.addPage(); y = margins.top; saHeader(); }
          y += drawRow(doc, [{ text: section, bold: true }, { text: "" }, { text: "" }], qw, left, y, 16);

          for (const a of items) {
            if (y + 24 > bottom) { doc.addPage(); y = margins.top; saHeader(); }
            y += drawRow(doc, [
              { text: a.question?.text ?? "" },
              { text: a.rating != null ? String(a.rating) : "", align: "center" },
              { text: a.comments ?? "" },
            ], qw, left, y);
          }
        }
        y += 6;
      }

      const saText: Array<[string, string | null]> = [
        ["Achievements", sa.achievements],
        ["Goals & objectives", sa.goalsObjective],
        ["Challenges", sa.challenges],
        ["Training needs", sa.trainingNeeds],
      ];
      for (const [k, v] of saText) {
        if (!v) continue;
        ensure(34);
        doc.font(FONT_BOLD).fontSize(8).text(`${k}:`, left, y);
        y = doc.y + 1;
        doc.font(FONT).fontSize(8).text(v, left, y, { width: usable });
        y = doc.y + 5;
      }
      y += 8;
    }
  }

  // ── Appreciations ────────────────────────────────────────────────────────
  const blocks: Array<[string, string]> = [
    ["APPRECIATIONS:", finalReview?.appreciations ?? ""],
    ["TALENTS & PARTICIPATION IN EVENTS:", finalReview?.talents ?? ""],
    ["OVERALL COMMENTS:", finalReview?.overallComments ?? ""],
  ];

  for (const [heading, body] of blocks) {
    // Give a block filled with text room to grow; keep empty ones compact so a
    // blank review does not burn a page.
    const h = body ? Math.min(150, 46 + Math.ceil(body.length / 90) * 12) : 70;
    ensure(h + 8);
    doc.rect(left, y, usable, h).lineWidth(0.5).strokeColor("#000").stroke();
    doc.font(FONT_BOLD).fontSize(9).fillColor("#000").text(heading, left + 6, y + 6);
    if (body) {
      doc.font(FONT).fontSize(9)
        .text(body, left + 6, y + 20, { width: usable - 12, height: h - 26 });
    }
    y += h + 8;
  }

  ensure(70);
  const third = usable / 3;
  doc.font(FONT_BOLD).fontSize(8);
  doc.text("SIGNATURE OF EMPLOYEE", left, y, { width: third - 6 });
  doc.text("SIGNATURE OF SUPERVISOR / IN-CHARGE", left + third, y, { width: third - 6 });
  doc.text("SIGNATURE OF HR MANAGER", left + third * 2, y, { width: third - 6 });

  [finalReview?.employeeSig, finalReview?.supervisorSig, finalReview?.hrSig].forEach((sig, i) => {
    if (typeof sig === "string" && sig.startsWith("data:image")) {
      try {
        doc.image(Buffer.from(sig.split(",")[1], "base64"), left + third * i, y + 12, {
          fit: [third - 14, 44],
        });
      } catch { /* ignore */ }
    }
  });

  doc.end();
  const pdf = await done;

  const safeName = (employee.employeeCode || String(employee.id)).replace(/[^A-Za-z0-9_-]/g, "");
  const scopeTag = opts.scope === "tenure"
    ? "Tenure"
    : (opts.cycle || "Cycle").replace(/[^A-Za-z0-9-]/g, "_");
  return { pdf, filename: `PerformanceIndicator_${safeName}_${scopeTag}.pdf` };
}

/** Exported so a future reviewer-wise sheet can label columns consistently. */
export const reviewerLabel = (role: string) => REVIEWER_ROLE_LABELS[role] ?? role;
export const maxPerQuestion = MAX_SCORE_PER_QUESTION;

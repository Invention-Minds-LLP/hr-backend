import { prisma } from "../../lib/prisma";
import { createLetterheadDoc, drawRow, Cell, FONT, FONT_BOLD } from "../../lib/pdfBase";

const num = (v: number | null | undefined) => (v != null ? String(v) : "");

export async function buildAppraisalRatingsPdf(appraisalId: number) {
  const form = await prisma.appraisalForm.findUnique({
    where: { id: appraisalId },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true,
          designation: true, dateOfJoining: true,
        },
      },
      managerReview: true,
      managementReview: true,
      reviewAnswers: { include: { question: true } },
      selfAnswers: { include: { question: true } },
    },
  });
  if (!form) return null;

  const emp = form.employee;
  const mgr: any = form.managerReview;
  const mgt: any = form.managementReview;

  const { doc, done, margins, state, bottom, usable, ensure } = createLetterheadDoc();
  const left = margins.left;

  const section = (title: string) => {
    ensure(50);
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000").text(title, left, state.y);
    state.y = doc.y + 4;
  };

  const table = (headers: Cell[], rows: Cell[][], widths: number[]) => {
    const head = () => {
      ensure(30);
      state.y += drawRow(doc, headers, widths, left, state.y, 22);
    };
    head();
    for (const r of rows) {
      if (state.y + 24 > bottom) {
        doc.addPage();
        state.y = margins.top;
        head();
      }
      state.y += drawRow(doc, r, widths, left, state.y);
    }
    state.y += 12;
  };

  const box = (heading: string, body: string) => {
  const pad = 6;
  doc.font(FONT).fontSize(9);
  const textH = doc.heightOfString(body, { width: usable - pad * 2 });
  const h = Math.max(45, textH + 26);

  ensure(h + 8);
  doc.rect(left, state.y, usable, h).lineWidth(0.5).strokeColor("#000").stroke();
  doc.font(FONT_BOLD).fontSize(9).fillColor("#000")
    .text(heading, left + pad, state.y + 6, { width: usable - pad * 2 });
  doc.font(FONT).fontSize(9)
    .text(body, left + pad, state.y + 20, { width: usable - pad * 2 });
  state.y += h + 8;
};

  // ── Title + employee details ──────────────────────────────────────────────
  doc.font(FONT_BOLD).fontSize(13)
    .text("APPRAISAL RATINGS", left, state.y, { width: usable, align: "center" });
  state.y = doc.y + 2;

  const name = `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim();
  const half = usable / 2;
  const details: Array<[string, string]> = [
    ["NAME", name],
    ["EMP NO", emp.employeeCode ?? ""],
    ["DESIGNATION", emp.designation?.name ?? ""],
    ["DATE OF JOINING", emp.dateOfJoining ? new Date(emp.dateOfJoining).toLocaleDateString("en-GB") : ""],
  ];
  doc.fontSize(9);
  for (let i = 0; i < details.length; i += 2) {
    const rowY = state.y;
    for (let c = 0; c < 2 && i + c < details.length; c++) {
      const [k, v] = details[i + c];
      doc.font(FONT_BOLD).text(`${k}: `, left + half * c, rowY, { continued: true });
      doc.font(FONT).text(v);
    }
    state.y = rowY + 13;
  }
  state.y += 8;


  // ── 2. Review questions: In-charge / Manager / Management ─────────────────
  if (form.reviewAnswers.length) {
    section("REVIEW QUESTIONS");
    const byQ = new Map<number, { text: string; levels: Record<string, number | null> }>();
    for (const a of [...form.reviewAnswers].sort((x, y) => x.questionId - y.questionId)) {
      if (!byQ.has(a.questionId)) {
        byQ.set(a.questionId, { text: (a.question as any).title ?? "", levels: {} });
      }
      byQ.get(a.questionId)!.levels[a.level] = a.rating;
    }
    const w = [usable * 0.58, usable * 0.14, usable * 0.14, usable * 0.14];
    const rows: Cell[][] = [...byQ.values()].map((q) => [
      { text: q.text },
      { text: num(q.levels.INCHARGE), align: "center" },
      { text: num(q.levels.MANAGER), align: "center" },
      { text: num(q.levels.MANAGEMENT), align: "center" },
    ]);
    table(
      [
        { text: "Question", bold: true },
        { text: "In-charge", bold: true, align: "center" },
        { text: "Manager", bold: true, align: "center" },
        { text: "Management", bold: true, align: "center" },
      ],
      rows, w,
    );

    rows.push([
  { text: "Overall score", bold: true },
  { text: num(form.inchargeOverallScore), bold: true, align: "center" },
  { text: num(mgr?.overallScore), bold: true, align: "center" },
  { text: num(mgt?.overallScore), bold: true, align: "center" },
]);
  }

  // ── 3. Self appraisal ─────────────────────────────────────────────────────
  if (form.selfAnswers.length) {
    section("SELF APPRAISAL");
    const w = [usable * 0.50, usable * 0.12];
    const rows: Cell[][] = [...form.selfAnswers]
      .sort((x, y) => x.questionId - y.questionId)
      .map((a) => [
        { text: (a.question as any).text ?? "" },
        { text: num(a.rating), align: "center" },
      ]);
    table(
      [
        { text: "Question", bold: true },
        { text: "Rating", bold: true, align: "center" },
      ],
      rows, w,
    );
  }

  // ── 4. Final result ───────────────────────────────────────────────────────
  section("FINAL RESULT");
  doc.font(FONT).fontSize(9);
  const finalRows: Cell[][] = [
    [{ text: "Overall score", bold: true }, { text: num(form.overallScore) }],
  [{ text: "Final decision", bold: true }, { text: form.finalDecision || "-" }],
  [{ text: "Final comments", bold: true }, { text: form.finalComments || "-" }],
  ];

  // Optional rows, only when they have data
if (form.hrReviewComments) {
  finalRows.push([{ text: "HR comments", bold: true }, { text: form.hrReviewComments }]);
}
if (form.hrRecommendations) {
  finalRows.push([{ text: "HR recommendations", bold: true }, { text: form.hrRecommendations }]);
}
const fw = [usable * 0.25, usable * 0.75];

for (const r of finalRows) {
  if (state.y + 24 > bottom) {
    doc.addPage();
    state.y = margins.top;
  }
  state.y += drawRow(doc, r, fw, left, state.y, 22);
}
state.y += 12;

const reviewerNotes: Array<[string, Array<[string, string | null | undefined]>]> = [
  ["IN-CHARGE", [["Comments", form.inchargeOverallComments]]],
  ["MANAGER", [["Comments", mgr?.comments], ["Recommendations", mgr?.recommendations]]],
  ["MANAGEMENT", [["Comments", mgt?.comments], ["Recommendations", mgt?.recommendations]]],
];
for (const [who, items] of reviewerNotes) {
  const filled = items.filter(([, text]) => !!text);
  if (!filled.length) continue;          // skip reviewers with nothing written

  ensure(90);                            // keep the heading with its first box
  doc.font(FONT_BOLD).fontSize(10).fillColor("#000")
    .text(`${who} REVIEW`, left, state.y);
  state.y = doc.y + 4;

  for (const [label, text] of filled) {
    box(`${label}:`, text as string);
  }
  state.y += 4;
}
// ── Signatures ────────────────────────────────────────────────────────────
ensure(130);
state.y += 50;
const third = usable / 3;
doc.font(FONT_BOLD).fontSize(8).fillColor("#000");
doc.text("SIGNATURE OF EMPLOYEE", left, state.y, { width: third - 6 });
doc.text("SIGNATURE OF SUPERVISOR / IN-CHARGE", left + third, state.y, { width: third - 6 });
doc.text("SIGNATURE OF HR MANAGER", left + third * 2, state.y, { width: third - 6 });

state.y += 30; 

  doc.end();
  const pdf = await done;

  const code = (emp.employeeCode || String(emp.id)).replace(/[^A-Za-z0-9_-]/g, "");
  const cycle = form.cycle.replace(/[^A-Za-z0-9-]/g, "_");
  return { pdf, filename: `AppraisalRatings_${code}_${cycle}.pdf` };
}
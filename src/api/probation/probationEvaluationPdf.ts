/**
 * Probationary Progress Evaluation as a PDF, laid out to match the printed
 * form: the particulars block, the eight-category grid with E/M/B boxes, the
 * comments section, both the manager's recommendation and HR's decision, and
 * blank signature lines for wet signing.
 *
 * pdfkit, not puppeteer — puppeteer is named in CLAUDE.md but is not installed
 * (see lib/htmlPdf.ts for the reasoning). This follows performanceSheetPdf.ts.
 *
 * `y` is tracked explicitly rather than leaning on `doc.y`: the letterhead hook
 * resets the cursor on every page it draws, and a grid whose rows are measured
 * before they are drawn needs a position it owns.
 */

import PDFDocument from 'pdfkit';
import {
  PROBATION_CATEGORIES,
  RATING_LABELS,
  EXTENSION_MONTHS,
  readRatings,
  ProbationRating,
} from '../../lib/probation';
import { applyLetterhead, hasLetterhead, LETTERHEAD_SAFE_MARGINS } from '../../lib/pdfLetterhead';
import { resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';

const PLAIN_MARGINS = { top: 44, bottom: 44, left: 40, right: 40 };

/** Width of each of the three rating columns. */
const MARK_W = 34;
const ROW_PAD = 5;
const BORDER = '#333333';
const HEADER_FILL = '#e8e8e8';

type Outcome = 'CONFIRM' | 'EXTEND' | 'TERMINATE' | 'DEPARTMENT_TRANSFER';

const OUTCOME_LABELS: Record<Outcome, string> = {
  CONFIRM: 'Confirm Probation',
  EXTEND: `Extend Probation (${EXTENSION_MONTHS} months)`,
  TERMINATE: 'Do Not Confirm / Terminate',
  DEPARTMENT_TRANSFER: 'Department Transfer',
};

export interface ProbationPdfEvaluation {
  round: number;
  status: string;
  dueDate: Date | string;
  evaluationDate: Date | string | null;
  ratings: unknown;
  strongPoints: string | null;
  improvementPoints: string | null;
  employeeComments: string | null;
  managerRecommendation: string | null;
  managerComments: string | null;
  hrDecision: string | null;
  hrComments: string | null;
  hrDecidedAt: Date | string | null;
  nextReviewDate: Date | string | null;
  capturedOffline?: boolean;
}

export interface ProbationPdfEmployee {
  employeeCode: string;
  firstName: string;
  lastName: string;
  dateOfJoining: Date | string;
  probationStartDate: Date | string | null;
  probationEndDate: Date | string | null;
  Department?: { name: string } | null;
  designation?: { name: string } | null;
}

export interface ProbationPdfManager {
  firstName: string;
  lastName: string;
  designation?: { name: string } | null;
}

/** An earlier round, summarised rather than reproduced in full. */
export interface ProbationPdfPriorRound {
  round: number;
  evaluationDate: Date | string | null;
  managerName: string | null;
  ratings: unknown;
  managerRecommendation: string | null;
  hrDecision: string | null;
  nextReviewDate: Date | string | null;
  improvementPoints: string | null;
  capturedOffline?: boolean;
}

export interface ProbationPdfInput {
  evaluation: ProbationPdfEvaluation;
  /** Completed earlier rounds, oldest first. Empty for a first evaluation. */
  previousRounds?: ProbationPdfPriorRound[];
  employee: ProbationPdfEmployee;
  manager: ProbationPdfManager | null;
  hrDecidedByName: string | null;
}

const fmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const name = (e?: { firstName?: string | null; lastName?: string | null } | null) =>
  `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();

export function buildProbationEvaluationPdf(input: ProbationPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // const useLetterhead = hasLetterhead();
      // const margins = useLetterhead ? { ...LETTERHEAD_SAFE_MARGINS, top:170, bottom: 85} : PLAIN_MARGINS;
const baseMargins = hasLetterhead()
  ? { ...LETTERHEAD_SAFE_MARGINS }
  : { ...PLAIN_MARGINS };
      
        const margins = {
          ...baseMargins,
          top: Math.max(baseMargins.top, 120),
          bottom: Math.max(baseMargins.bottom, 75),
        };

      const doc = new PDFDocument({ size: 'A4', margins });
      // if (useLetterhead) applyLetterhead(doc);

      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = margins.left;
      const right = doc.page.width - margins.right;
      const width = right - left;
      const bottom = doc.page.height - margins.bottom;

      let y = margins.top;


      const letterHeadPath = resolvePath(
        process.cwd(),
        "assets",
        "JMRH-letterhead.png"
      );

      // Draw letterhead
      const drawLetterhead = (): void => {
        doc.save();

        doc.image(letterHeadPath, 0, 0, {
          width: doc.page.width,
          height: doc.page.height
        });

        doc.restore();
      };

      drawLetterhead();

      doc.on("pageAdded", drawLetterhead);


      /** Start a new page and reset the cursor the letterhead hook moved. */
      const newPage = () => {
        doc.addPage();
        y = margins.top;
      };

      /** Break to a new page unless `needed` points still fit. */
      const ensure = (needed: number) => {
        if (y + needed > bottom) newPage();
      };

      const text = (
        s: string,
        x: number,
        w: number,
        opts: { font?: string; size?: number; align?: 'left' | 'center' | 'right'; color?: string } = {},
      ) => {
        doc
          .font(opts.font ?? FONT)
          .fontSize(opts.size ?? 9)
          .fillColor(opts.color ?? '#000');
        const h = doc.heightOfString(s, { width: w, align: opts.align ?? 'left' });
        doc.text(s, x, y, { width: w, align: opts.align ?? 'left' });
        y += h;
        return h;
      };

      const measure = (s: string, w: number, font = FONT, size = 9) => {
        doc.font(font).fontSize(size);
        return doc.heightOfString(s, { width: w });
      };

      /* ── Title ──────────────────────────────────────────────────────────── */

      const titleH = 22;
      doc.rect(left, y, width, titleH).fillAndStroke(HEADER_FILL, BORDER);
      doc
        .font(FONT_BOLD)
        .fontSize(12)
        .fillColor('#000')
        .text('PROBATIONARY PROGRESS EVALUATION', left, y + 6, { width, align: 'center' });
      y += titleH + 10;

      if (input.evaluation.round > 1) {
        text(
          `Re-evaluation after extended probation — Round ${input.evaluation.round}`,
          left,
          width,
          { font: FONT_ITALIC, size: 8.5, align: 'center', color: '#555' },
        );
        y += 6;
      }

      // Say so when the record was transcribed rather than filled in here. The
      // content is identical either way, so without this line the PDF would
      // read as though the manager completed it in the system — and the signed
      // paper form, not this printout, is the original.
      if (input.evaluation.capturedOffline) {
        text(
          'Transcribed from the signed paper evaluation form. The signed original is held on the employee file.',
          left,
          width,
          { font: FONT_ITALIC, size: 8, align: 'center', color: '#777' },
        );
        y += 8;
      }

      /* ── Particulars ────────────────────────────────────────────────────── */

      const { employee: emp, evaluation: ev, manager } = input;

      const particulars: [string, string][] = [
        ['EMPLOYEE NAME', name(emp)],
        ['EMPLOYEE ID', emp.employeeCode ?? ''],
        ['DEPARTMENT', emp.Department?.name ?? ''],
        ['JOB TITLE', emp.designation?.name ?? ''],
        ['SUPERVISOR NAME', manager ? name(manager) : 'Not assigned'],
        ['HIRE DATE / POSITION CHANGE DATE', fmt(emp.dateOfJoining)],
        ['PROBATION COMPLETION DATE', fmt(ev.dueDate)],
        ['EVALUATION DATE', fmt(ev.evaluationDate)],
      ];

      const labelW = 190;
      for (const [label, value] of particulars) {
        ensure(16);
        doc.font(FONT_BOLD).fontSize(9).fillColor('#000').text(`${label}:`, left, y, { width: labelW });
        doc.font(FONT).fontSize(9).text(value || '', left + labelW, y, { width: width - labelW });
        y += 14;
        // Rule under the value, like the ruled lines on the printed form.
        doc
          .moveTo(left + labelW, y - 3)
          .lineTo(right, y - 3)
          .strokeColor('#bbbbbb')
          .lineWidth(0.5)
          .stroke();
      }

      y += 8;

      /* ── Legend ─────────────────────────────────────────────────────────── */

      ensure(46);
      text('LEGEND FOR STANDARDIZED PERFORMANCES:', left, width, { font: FONT_BOLD, size: 9 });
      y += 2;
      for (const [code, label] of Object.entries(RATING_LABELS)) {
        text(`${code} = PERFORMANCE ${label.toUpperCase()}`, left, width, { size: 8.5 });
      }
      y += 10;

      /* ── Rating grid ────────────────────────────────────────────────────── */

      const ratings = readRatings(ev.ratings);
      const criteriaW = width - MARK_W * 3;

      const drawGridHeader = () => {
        const h = 18;
        ensure(h + 30);
        doc.rect(left, y, criteriaW, h).fillAndStroke(HEADER_FILL, BORDER);
        doc
          .font(FONT_BOLD)
          .fontSize(9)
          .fillColor('#000')
          .text('PERFORMANCE CATEGORY', left + ROW_PAD, y + 5, { width: criteriaW - ROW_PAD * 2 });

        (['E', 'M', 'B'] as const).forEach((code, i) => {
          const x = left + criteriaW + i * MARK_W;
          doc.rect(x, y, MARK_W, h).fillAndStroke(HEADER_FILL, BORDER);
          doc
            .font(FONT_BOLD)
            .fontSize(9)
            .fillColor('#000')
            .text(code, x, y + 5, { width: MARK_W, align: 'center' });
        });
        y += h;
      };

      drawGridHeader();

      for (const cat of PROBATION_CATEGORIES) {
        const innerW = criteriaW - ROW_PAD * 2;
        const labelH = measure(cat.label, innerW, FONT_BOLD, 9);
        const critH = measure(cat.criteria, innerW, FONT, 7.5);
        const rowH = Math.max(labelH + critH + ROW_PAD * 2 + 2, 34);

        if (y + rowH > bottom) {
          newPage();
          drawGridHeader();
        }

        doc.rect(left, y, criteriaW, rowH).strokeColor(BORDER).lineWidth(0.7).stroke();
        doc
          .font(FONT_BOLD)
          .fontSize(9)
          .fillColor('#000')
          .text(cat.label, left + ROW_PAD, y + ROW_PAD, { width: innerW });
        doc
          .font(FONT)
          .fontSize(7.5)
          .fillColor('#222')
          .text(cat.criteria, left + ROW_PAD, y + ROW_PAD + labelH + 1, { width: innerW });

        const selected = ratings[cat.code];
        (['E', 'M', 'B'] as ProbationRating[]).forEach((code, i) => {
          const x = left + criteriaW + i * MARK_W;
          doc.rect(x, y, MARK_W, rowH).strokeColor(BORDER).lineWidth(0.7).stroke();

          // Tick box, centred in the cell.
          const boxSize = 11;
          const bx = x + (MARK_W - boxSize) / 2;
          const by = y + (rowH - boxSize) / 2;
          doc.rect(bx, by, boxSize, boxSize).strokeColor('#555').lineWidth(0.7).stroke();

          if (selected === code) {
            // "X" rather than a check glyph — U+2713 is not in Helvetica's
            // WinAnsi encoding and renders as a blank box.
            doc
              .font(FONT_BOLD)
              .fontSize(9)
              .fillColor('#000')
              .text('X', bx, by + 1.5, { width: boxSize, align: 'center' });
          }
        });

        y += rowH;
      }

      y += 14;

      /* ── Comments ───────────────────────────────────────────────────────── */

      const commentBox = (label: string, body: string | null, minH = 44) => {
        const innerW = width - ROW_PAD * 2;
        const content = (body ?? '').trim() || '—';
        const bodyH = measure(content, innerW, FONT, 9);
        const labelH = 15;
        const boxH = Math.max(bodyH + ROW_PAD * 2, minH);

        if (y + boxH + labelH > bottom) newPage();

        doc.rect(left, y, width, labelH).fillAndStroke(HEADER_FILL, BORDER);
        doc
          .font(FONT_BOLD)
          .fontSize(8.5)
          .fillColor('#000')
          .text(label, left + ROW_PAD, y + 4, { width: innerW });
        y += labelH;

        doc.rect(left, y, width, boxH).strokeColor(BORDER).lineWidth(0.7).stroke();
        doc
          .font(FONT)
          .fontSize(9)
          .fillColor('#000')
          .text(content, left + ROW_PAD, y + ROW_PAD, { width: innerW });
        y += boxH;
      };

      ensure(80);
      text('COMMENTS SECTION', left, width, { font: FONT_BOLD, size: 10 });
      y += 4;

      commentBox('STRONG POINTS', ev.strongPoints);
      commentBox('IMPROVEMENT POINTS / SUGGESTIONS', ev.improvementPoints);
      commentBox('EMPLOYEE COMMENTS', ev.employeeComments, 52);

      y += 14;

      /* ── Manager recommendation ─────────────────────────────────────────── */

      const decisionBlock = (
        heading: string,
        subheading: string,
        selected: string | null,
        comments: string | null,
        commentsLabel: string,
        footer?: string,
      ) => {
        ensure(120);
        text(heading, left, width, { font: FONT_BOLD, size: 10 });
        y += 2;
        text(subheading, left, width, { font: FONT_ITALIC, size: 8, color: '#555' });
        y += 8;

        const outcomes = Object.keys(OUTCOME_LABELS) as Outcome[];
        const colW = width / 2;
        outcomes.forEach((code, i) => {
          const col = i % 2;
          const x = left + col * colW;
          if (col === 0 && i > 0) y += 18;

          const boxSize = 10;
          doc.rect(x, y, boxSize, boxSize).strokeColor('#555').lineWidth(0.7).stroke();
          if (selected === code) {
            doc
              .font(FONT_BOLD)
              .fontSize(8.5)
              .fillColor('#000')
              .text('X', x, y + 1, { width: boxSize, align: 'center' });
          }
          doc
            .font(selected === code ? FONT_BOLD : FONT)
            .fontSize(9)
            .fillColor('#000')
            .text(OUTCOME_LABELS[code], x + boxSize + 6, y + 0.5, { width: colW - boxSize - 12 });
        });
        y += 24;

        commentBox(commentsLabel, comments);

        if (footer) {
          y += 4;
          text(footer, left, width, { font: FONT_ITALIC, size: 8.5, color: '#333' });
        }
        y += 12;
      };

      decisionBlock(
        'RECOMMENDATION — TO BE FILLED IN BY THE APPRAISER',
        'Reporting Manager / HOD',
        ev.managerRecommendation,
        ev.managerComments,
        "REPORTING MANAGER'S COMMENTS",
        manager
          ? `Submitted by ${name(manager)}${manager.designation?.name ? `, ${manager.designation.name}` : ''} on ${fmt(ev.evaluationDate)}`
          : undefined,
      );

      /* ── HR decision ────────────────────────────────────────────────────── */

      if (ev.hrDecision) {
        const disagreed = ev.managerRecommendation && ev.managerRecommendation !== ev.hrDecision;
        decisionBlock(
          'HR MANAGER REVIEW — FINAL DECISION',
          disagreed
            ? `This decision differs from the appraiser's recommendation (${OUTCOME_LABELS[ev.managerRecommendation as Outcome] ?? ev.managerRecommendation}).`
            : "This decision is in agreement with the appraiser's recommendation.",
          ev.hrDecision,
          ev.hrComments,
          'HR MANAGER COMMENTS',
          [
            input.hrDecidedByName ? `Approved by ${input.hrDecidedByName}` : null,
            ev.hrDecidedAt ? `Date of approval: ${fmt(ev.hrDecidedAt)}` : null,
            ev.nextReviewDate ? `Next probation review date: ${fmt(ev.nextReviewDate)}` : null,
          ]
            .filter(Boolean)
            .join('   ·   '),
        );
      } else {
        ensure(40);
        text('HR MANAGER REVIEW — FINAL DECISION', left, width, { font: FONT_BOLD, size: 10 });
        y += 4;
        text('Pending HR review.', left, width, { font: FONT_ITALIC, size: 9, color: '#777' });
        y += 12;
      }

      /* ── Previous rounds ────────────────────────────────────────────────── */
      //
      // Summarised, not reproduced: each earlier round was signed and filed as
      // its own document, so repeating its full grid would double the page
      // count to restate what is already on file. This gives the reader the
      // probation history at a glance on the sheet they are signing.

      const priors = input.previousRounds ?? [];
      if (priors.length) {
        ensure(70);
        text('PREVIOUS EVALUATION HISTORY', left, width, { font: FONT_BOLD, size: 10 });
        y += 8;

        // Two columns of four, each rating sitting against its own category.
        // A bare "M M E M E B M M" row forced the reader to count positions
        // against the category table — which is usually on an earlier page.
        const RATING_ROW_H = 11;
        const ratingGridH = Math.ceil(PROBATION_CATEGORIES.length / 2) * RATING_ROW_H;

        for (const prior of priors) {
          const priorRatings = readRatings(prior.ratings);

          const improve = (prior.improvementPoints ?? '').trim();
          const quoted = improve.length > 220 ? `${improve.slice(0, 217)}…` : improve;

          // Measure the block so a round is never split across a page break.
          const quoteH = quoted ? measure(quoted, width - 24, FONT_ITALIC, 8) : 0;
          ensure(52 + ratingGridH + quoteH);

          doc
            .moveTo(left, y)
            .lineTo(left + width, y)
            .strokeColor('#dddddd')
            .lineWidth(0.5)
            .stroke();
          y += 6;

          const head =
            `Round ${prior.round}` +
            (prior.evaluationDate ? ` — evaluated ${fmt(prior.evaluationDate)}` : '') +
            (prior.managerName ? ` by ${prior.managerName}` : '') +
            (prior.capturedOffline ? ' (from signed paper form)' : '');
          text(head, left, width, { font: FONT_BOLD, size: 8.5 });
          y += 2;

          const labelW = 86;
          const row = (label: string, value: string) => {
            doc.font(FONT).fontSize(8).fillColor('#555').text(label, left + 10, y, { width: labelW });
            doc.font(FONT).fontSize(8).fillColor('#000')
               .text(value, left + 10 + labelW, y, { width: width - 10 - labelW });
            y += 11;
          };

          const gridTop = y;
          const colW = width / 2;
          PROBATION_CATEGORIES.forEach((cat, i) => {
            const col = i % 2;
            const cellX = left + 10 + col * colW;
            const cellY = gridTop + Math.floor(i / 2) * RATING_ROW_H;
            const mark = priorRatings[cat.code] ?? '–';

            doc.font(FONT).fontSize(7.5).fillColor('#555')
               .text(cat.label, cellX, cellY, { width: colW - 46, lineBreak: false, ellipsis: true } as any);
            doc.font(FONT_BOLD).fontSize(8.5).fillColor('#000')
               .text(mark, cellX + colW - 40, cellY - 0.5, { width: 14, align: 'center' });
          });
          y = gridTop + ratingGridH + 4;

          row('Manager', OUTCOME_LABELS[prior.managerRecommendation as Outcome] ?? '—');
          row(
            'HR decision',
            (OUTCOME_LABELS[prior.hrDecision as Outcome] ?? '—') +
              (prior.nextReviewDate ? `  (next review ${fmt(prior.nextReviewDate)})` : ''),
          );

          if (quoted) {
            doc.font(FONT_ITALIC).fontSize(8).fillColor('#444')
               .text(`“${quoted}”`, left + 10, y, { width: width - 24 });
            y += quoteH + 2;
          }
          y += 6;
        }

        y += 8;
      }

      /* ── Signatures ─────────────────────────────────────────────────────── */

      const sigBlockH = 150;
      ensure(sigBlockH);

      text(
        'I acknowledge that I have reviewed and understood the contents of this Probation Evaluation.',
        left,
        width,
        { font: FONT_ITALIC, size: 8.5 },
      );
      y += 16;

      const sigLine = (label: string, x: number, w: number) => {
        doc
          .moveTo(x, y + 26)
          .lineTo(x + w, y + 26)
          .strokeColor('#333')
          .lineWidth(0.7)
          .stroke();
        doc
          .font(FONT)
          .fontSize(8.5)
          .fillColor('#000')
          .text(label, x, y + 30, { width: w });
      };

      const colW = (width - 30) / 2;
      sigLine('EMPLOYEE SIGNATURE', left, colW);
      sigLine('SUPERVISOR SIGNATURE', left + colW + 30, colW);
      y += 58;

      sigLine('HR SIGNATURE', left, colW);
      sigLine('DATE', left + colW + 30, colW);
      y += 58;

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

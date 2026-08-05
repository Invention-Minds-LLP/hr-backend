// ─────────────────────────────────────────────────────────────────────────────
//  Minimal HTML → PDF renderer on pdfkit.
//
//  WHY NOT PUPPETEER: it is listed in CLAUDE.md but is not actually installed,
//  and pulling it in means shipping ~300MB of Chromium in the Docker image plus
//  the system libraries headless Chrome needs. Letters are a page of formatted
//  text, not a web page — that trade is not worth it. This renderer handles the
//  tag subset the quill/PrimeNG editor emits and nothing more.
//
//  SUPPORTED: p, br, div, h1-h4, strong/b, em/i, u, s, ul/ol/li, blockquote,
//             hr, span, a, table (basic), and the ql-align-* classes.
//  IGNORED:   images, floats, CSS positioning, nested tables.
//
//  If a client ever needs pixel-faithful HTML, swap this for puppeteer behind
//  the same renderHtmlToPdf() signature — nothing else has to change.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';

type Align = 'left' | 'center' | 'right' | 'justify';

interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number;
  align: Align;
}

interface TextRun {
  text: string;
  style: Style;
}

/** A laid-out block: a paragraph, heading, list item or rule. */
interface Block {
  type: 'text' | 'rule' | 'space';
  runs: TextRun[];
  align: Align;
  indent: number;
  bullet?: string;
  spaceBefore: number;
  spaceAfter: number;
}

const BASE_SIZE = 10.5;

const baseStyle = (): Style => ({
  bold: false, italic: false, underline: false, strike: false,
  size: BASE_SIZE, align: 'left',
});

/** Decode the handful of entities that matter for letters. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function alignFromAttrs(attrs: string): Align | null {
  const cls = /class\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] || '';
  if (/ql-align-center|text-center/.test(cls)) return 'center';
  if (/ql-align-right|text-right/.test(cls)) return 'right';
  if (/ql-align-justify|text-justify/.test(cls)) return 'justify';

  const styleAttr = /style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] || '';
  const m = /text-align\s*:\s*(left|center|right|justify)/i.exec(styleAttr);
  return m ? (m[1].toLowerCase() as Align) : null;
}

/**
 * Tokenise the HTML into blocks. A hand-rolled scanner rather than a DOM parser
 * because the input is editor-generated markup, and adding cheerio for this
 * would be another dependency for very little gain.
 */
export function parseHtmlBlocks(html: string): Block[] {
  const blocks: Block[] = [];

  let style = baseStyle();
  const styleStack: Style[] = [];
  let currentRuns: TextRun[] = [];
  let currentAlign: Align = 'left';
  let indent = 0;
  let pendingBullet: string | undefined;
  let spaceBefore = 0;
  let spaceAfter = 4;

  // Ordered-list counters, one per nesting depth.
  const olCounters: number[] = [];
  let listType: ('ul' | 'ol')[] = [];

  const flush = () => {
    const hasText = currentRuns.some((r) => r.text.trim().length);
    if (hasText) {
      blocks.push({
        type: 'text',
        runs: currentRuns,
        align: currentAlign,
        indent,
        bullet: pendingBullet,
        spaceBefore,
        spaceAfter,
      });
    }
    currentRuns = [];
    pendingBullet = undefined;
    spaceBefore = 0;
    spaceAfter = 4;
  };

  const push = (text: string) => {
    if (!text) return;
    currentRuns.push({ text, style: { ...style } });
  };

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)\/?>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(html))) {
    // Text between the previous tag and this one.
    const between = html.slice(lastIndex, m.index);
    if (between) push(decodeEntities(between).replace(/\s+/g, ' '));
    lastIndex = tagRe.lastIndex;

    const closing = m[0].startsWith('</');
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';

    switch (tag) {
      case 'br':
        push('\n');
        break;

      case 'b': case 'strong':
        if (closing) style = styleStack.pop() || baseStyle();
        else { styleStack.push({ ...style }); style = { ...style, bold: true }; }
        break;

      case 'i': case 'em':
        if (closing) style = styleStack.pop() || baseStyle();
        else { styleStack.push({ ...style }); style = { ...style, italic: true }; }
        break;

      case 'u':
        if (closing) style = styleStack.pop() || baseStyle();
        else { styleStack.push({ ...style }); style = { ...style, underline: true }; }
        break;

      case 's': case 'strike': case 'del':
        if (closing) style = styleStack.pop() || baseStyle();
        else { styleStack.push({ ...style }); style = { ...style, strike: true }; }
        break;

      case 'h1': case 'h2': case 'h3': case 'h4': {
        if (closing) {
          flush();
          style = styleStack.pop() || baseStyle();
        } else {
          flush();
          styleStack.push({ ...style });
          const sizes: Record<string, number> = { h1: 17, h2: 14.5, h3: 12.5, h4: 11.5 };
          style = { ...style, bold: true, size: sizes[tag] };
          currentAlign = alignFromAttrs(attrs) ?? 'left';
          spaceBefore = 8;
          spaceAfter = 6;
        }
        break;
      }

      case 'p': case 'div':
        if (closing) flush();
        else {
          flush();
          currentAlign = alignFromAttrs(attrs) ?? 'left';
        }
        break;

      case 'blockquote':
        if (closing) { flush(); indent = Math.max(0, indent - 24); }
        else { flush(); indent += 24; }
        break;

      case 'ul':
        if (closing) { listType.pop(); indent = Math.max(0, indent - 18); }
        else { listType.push('ul'); indent += 18; }
        break;

      case 'ol':
        if (closing) { listType.pop(); olCounters.pop(); indent = Math.max(0, indent - 18); }
        else { listType.push('ol'); olCounters.push(0); indent += 18; }
        break;

      case 'li':
        if (closing) flush();
        else {
          flush();
          const kind = listType[listType.length - 1];
          if (kind === 'ol') {
            const depth = olCounters.length - 1;
            olCounters[depth] = (olCounters[depth] || 0) + 1;
            pendingBullet = `${olCounters[depth]}.`;
          } else {
            pendingBullet = '•';
          }
          spaceAfter = 2;
        }
        break;

      case 'hr':
        flush();
        blocks.push({ type: 'rule', runs: [], align: 'left', indent, spaceBefore: 6, spaceAfter: 8 });
        break;

      case 'span': case 'a': case 'font':
        // Inline passthrough — alignment on a span still applies to the block.
        if (!closing) {
          const a = alignFromAttrs(attrs);
          if (a) currentAlign = a;
        }
        break;

      case 'tr':
        if (closing) flush();
        break;

      case 'td': case 'th':
        if (!closing && currentRuns.length) push('   ');
        break;

      case 'table': case 'tbody': case 'thead':
        if (!closing) flush();
        break;

      default:
        break;
    }
  }

  const tail = html.slice(lastIndex);
  if (tail) push(decodeEntities(tail).replace(/\s+/g, ' '));
  flush();

  return blocks;
}

export interface HtmlPdfOptions {
  /** Rendered before the body on the first page — letterhead. */
  headerHtml?: string | null;
  footerHtml?: string | null;
  /** Drawn bottom-right of the last page. */
  signature?: {
    name?: string | null;
    designation?: string | null;
    company?: string | null;
    place?: string | null;
  } | null;
  password?: string | null;
  margin?: number;
  /** Small grey line at the foot of every page. */
  pageFooterNote?: string | null;
}

/** Render parsed blocks onto a pdfkit document. */
function drawBlocks(doc: PDFKit.PDFDocument, blocks: Block[], leftMargin: number, contentWidth: number) {
  for (const block of blocks) {
    if (block.type === 'rule') {
      doc.moveDown(block.spaceBefore / 12);
      const y = doc.y;
      doc.moveTo(leftMargin, y).lineTo(leftMargin + contentWidth, y)
         .strokeColor('#cccccc').lineWidth(0.7).stroke();
      doc.y = y + block.spaceAfter;
      continue;
    }

    if (block.spaceBefore) doc.y += block.spaceBefore;

    const x = leftMargin + block.indent;
    const width = contentWidth - block.indent;

    // Bullet sits in the gutter created by the list indent.
    if (block.bullet) {
      doc.font('Helvetica').fontSize(BASE_SIZE).fillColor('#000');
      doc.text(block.bullet, x - 16, doc.y, { width: 14, align: 'left', continued: false });
      doc.y -= doc.currentLineHeight();
    }

    let first = true;
    for (let i = 0; i < block.runs.length; i++) {
      const run = block.runs[i];
      const isLast = i === block.runs.length - 1;

      const family =
        run.style.bold && run.style.italic ? 'Helvetica-BoldOblique'
        : run.style.bold ? 'Helvetica-Bold'
        : run.style.italic ? 'Helvetica-Oblique'
        : 'Helvetica';

      doc.font(family).fontSize(run.style.size).fillColor('#000');

      doc.text(run.text, first ? x : undefined, first ? doc.y : undefined, {
        width,
        align: block.align,
        continued: !isLast,
        underline: run.style.underline,
        strike: run.style.strike,
      } as any);

      first = false;
    }

    if (block.spaceAfter) doc.y += block.spaceAfter;
  }
}

/**
 * Render HTML to a PDF buffer.
 * Encrypted when a password is supplied, same convention as Form 16.
 */
export function renderHtmlToPdf(bodyHtml: string, opts: HtmlPdfOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const margin = opts.margin ?? 56;
      const doc = new PDFDocument({
        size: 'A4',
        margin,
        ...(opts.password
          ? {
              userPassword: opts.password,
              ownerPassword: `${opts.password}-OWNER`,
              permissions: { printing: 'highResolution' },
            }
          : {}),
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      if (opts.headerHtml) {
        drawBlocks(doc, parseHtmlBlocks(opts.headerHtml), left, contentWidth);
        doc.moveDown(0.3);
        doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y)
           .strokeColor('#1f3a93').lineWidth(1).stroke();
        doc.moveDown(0.8);
      }

      drawBlocks(doc, parseHtmlBlocks(bodyHtml), left, contentWidth);

      if (opts.signature) {
        const s = opts.signature;
        doc.moveDown(2.5);
        if (s.place) {
          doc.font('Helvetica').fontSize(BASE_SIZE).fillColor('#000')
             .text(`Place: ${s.place}`, left, doc.y, { width: contentWidth });
        }
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(BASE_SIZE)
           .text(s.name || '', left, doc.y, { width: contentWidth });
        if (s.designation) {
          doc.font('Helvetica').fontSize(BASE_SIZE - 0.5)
             .text(s.designation, { width: contentWidth });
        }
        if (s.company) {
          doc.font('Helvetica').fontSize(BASE_SIZE - 0.5).fillColor('#555')
             .text(s.company, { width: contentWidth });
        }
      }

      if (opts.footerHtml) {
        doc.moveDown(1.2);
        doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y)
           .strokeColor('#dddddd').lineWidth(0.5).stroke();
        doc.moveDown(0.5);
        drawBlocks(doc, parseHtmlBlocks(opts.footerHtml), left, contentWidth);
      }

      if (opts.pageFooterNote) {
        // Written after layout so it lands on every page that exists.
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          doc.font('Helvetica').fontSize(7.5).fillColor('#999').text(
            opts.pageFooterNote,
            left,
            doc.page.height - doc.page.margins.bottom + 12,
            { width: contentWidth, align: 'center', lineBreak: false },
          );
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Plain-text preview of a template body — used for search and list snippets. */
export function htmlToPlainText(html: string): string {
  return decodeEntities(
    String(html || '')
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-4])\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim();
}

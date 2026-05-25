"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOfferLetterPdf = generateOfferLetterPdf;
const pdfkit_1 = __importDefault(require("pdfkit"));
const fmtINR = (n) => typeof n === "number" && !Number.isNaN(n)
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n)
    : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }) : "—";
/**
 * Generate the offer letter as a PDF buffer. Returns a Promise<Buffer> so the
 * caller can attach it to a nodemailer email (or stream directly to the
 * response).
 */
function generateOfferLetterPdf(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new pdfkit_1.default({ size: "A4", margin: 56 });
            const chunks = [];
            doc.on("data", (c) => chunks.push(c));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);
            const company = data.companyName || "HR Pro India";
            const address = data.companyAddress || "";
            const hrName = data.hrName || "HR Team";
            const hrTitle = data.hrTitle || "Human Resources";
            // Header
            doc.fontSize(20).fillColor("#1f3a93").text(company, { align: "center" });
            if (address)
                doc.moveDown(0.2).fontSize(10).fillColor("#444").text(address, { align: "center" });
            doc.moveDown(0.6);
            doc.moveTo(doc.page.margins.left, doc.y)
                .lineTo(doc.page.width - doc.page.margins.right, doc.y)
                .strokeColor("#1f3a93").lineWidth(1).stroke();
            doc.moveDown(1);
            doc.fillColor("#000").fontSize(11).text(`Date: ${fmtDate(new Date())}`, { align: "right" });
            doc.moveDown(1);
            // Salutation
            doc.fontSize(12).text(`Dear ${data.candidateName},`);
            doc.moveDown(0.6);
            // Body — opening
            doc.fontSize(11).fillColor("#000").text(`We are pleased to extend an offer of employment to you for the position of ` +
                `"${data.jobTitle}"${data.departmentName ? ` in our ${data.departmentName} department` : ""} ` +
                `at ${company}. Based on our discussions and your demonstrated qualifications, we believe ` +
                `you will make a valuable contribution to our team.`, { align: "justify" });
            doc.moveDown(0.8);
            // Terms heading
            doc.fontSize(13).fillColor("#1f3a93").text("Terms of Employment", { underline: false });
            doc.moveDown(0.4);
            doc.fontSize(11).fillColor("#000");
            const rows = [
                ["Position", data.jobTitle],
                ["Department", data.departmentName || "—"],
                ["Annual CTC", fmtINR(data.ctc)],
                ["Joining Location", data.joinLocation || "—"],
                ["Work Mode", (data.workMode || "—").toString()],
                ["Proposed Join Date", fmtDate(data.proposedJoinAt)],
            ];
            const labelX = doc.page.margins.left;
            const valueX = labelX + 150;
            rows.forEach(([label, value]) => {
                const y = doc.y;
                doc.font("Helvetica-Bold").text(`${label}:`, labelX, y, { continued: false, width: 140 });
                doc.font("Helvetica").text(value, valueX, y, { width: doc.page.width - valueX - doc.page.margins.right });
                doc.moveDown(0.3);
            });
            doc.moveDown(0.5);
            // Custom notes
            if (data.customNotes && data.customNotes.trim()) {
                doc.fontSize(13).fillColor("#1f3a93").text("Additional Notes");
                doc.moveDown(0.3);
                doc.fontSize(11).fillColor("#000").text(data.customNotes.trim(), { align: "justify" });
                doc.moveDown(0.6);
            }
            // Standard clauses
            doc.fontSize(13).fillColor("#1f3a93").text("Acceptance & Joining");
            doc.moveDown(0.3);
            doc.fontSize(11).fillColor("#000").text(`Please confirm your acceptance by signing this offer through the candidate portal ` +
                `at the earliest. Your employment will commence on the proposed join date stated above ` +
                `and is contingent upon successful completion of background verification, reference checks, ` +
                `and submission of all required documents.`, { align: "justify" });
            doc.moveDown(0.6);
            doc.fontSize(11).text(`We are excited about the prospect of you joining our organization and look forward to ` +
                `your positive response. Should you have any questions about this offer, please feel free ` +
                `to reach out to the Human Resources team.`, { align: "justify" });
            // Signature block
            doc.moveDown(2);
            doc.fontSize(11).text("Warm regards,");
            doc.moveDown(0.4);
            doc.font("Helvetica-Bold").text(hrName);
            doc.font("Helvetica").fontSize(10).fillColor("#444").text(hrTitle);
            doc.fontSize(10).fillColor("#444").text(company);
            // Footer
            doc.moveDown(2);
            doc.fontSize(8).fillColor("#888").text("This is a system-generated offer letter. The terms above supersede any prior verbal or " +
                "written communication regarding employment with the company.", { align: "center" });
            doc.end();
        }
        catch (err) {
            reject(err);
        }
    });
}

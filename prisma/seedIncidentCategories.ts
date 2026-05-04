/**
 * Industry-neutral default incident categories.
 *
 * Each customer can edit / disable / add via an admin screen. This seed
 * just gives every fresh deployment a sensible starting list. Re-running
 * is safe — it upserts on `name`.
 *
 * Run:
 *   npx ts-node prisma/seedIncidentCategories.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CategorySeed = {
  name: string;
  description: string;
  defaultSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  defaultSlaHours: number;
  isAnonymousAllowed: boolean;
  requiresRCAByDefault: boolean;
  requiresExternalReportByDefault: boolean;
  sortOrder: number;
};

// Sensible defaults. SLA hours follow the typical incident-management
// pyramid: critical = 4h, high = 24h, medium = 72h, low = 7d.
const CATEGORIES: CategorySeed[] = [
  {
    name: "Workplace Safety",
    description: "Accidents, injuries, near-misses, ergonomic hazards, equipment failures causing risk to people.",
    defaultSeverity: "HIGH",
    defaultSlaHours: 24,
    isAnonymousAllowed: false,           // need to know who got hurt
    requiresRCAByDefault: true,
    requiresExternalReportByDefault: false,
    sortOrder: 10,
  },
  {
    name: "Security / Theft",
    description: "Theft, intrusion, vandalism, suspicious activity, missing assets.",
    defaultSeverity: "HIGH",
    defaultSlaHours: 24,
    isAnonymousAllowed: true,
    requiresRCAByDefault: false,
    requiresExternalReportByDefault: false,
    sortOrder: 20,
  },
  {
    name: "IT / Cyber",
    description: "Phishing, malware, data leak, unauthorised access, system breach.",
    defaultSeverity: "HIGH",
    defaultSlaHours: 24,
    isAnonymousAllowed: true,
    requiresRCAByDefault: true,          // breach RCAs are usually mandatory
    requiresExternalReportByDefault: true, // DPDP / GDPR reporting often required
    sortOrder: 30,
  },
  {
    name: "Misconduct / Code of Conduct",
    description: "Insubordination, dress code violations, behavioural issues (excluding harassment — see POSH).",
    defaultSeverity: "MEDIUM",
    defaultSlaHours: 72,
    isAnonymousAllowed: true,
    requiresRCAByDefault: false,
    requiresExternalReportByDefault: false,
    sortOrder: 40,
  },
  {
    name: "Whistleblower / Ethics",
    description: "Fraud, corruption, bribery, conflict of interest, financial irregularity.",
    defaultSeverity: "HIGH",
    defaultSlaHours: 48,
    isAnonymousAllowed: true,
    requiresRCAByDefault: true,
    requiresExternalReportByDefault: false,
    sortOrder: 50,
  },
  {
    name: "Asset / Equipment Damage",
    description: "Damage to or loss of company assets (excluding theft — see Security).",
    defaultSeverity: "MEDIUM",
    defaultSlaHours: 72,
    isAnonymousAllowed: false,
    requiresRCAByDefault: false,
    requiresExternalReportByDefault: false,
    sortOrder: 60,
  },
  {
    name: "Vehicle / Transport",
    description: "Vehicle accidents, near-misses, damage during transit, driver-related issues.",
    defaultSeverity: "HIGH",
    defaultSlaHours: 24,
    isAnonymousAllowed: false,
    requiresRCAByDefault: true,
    requiresExternalReportByDefault: false,
    sortOrder: 70,
  },
  {
    name: "Customer / Client Complaint",
    description: "Service-quality complaints, escalations, disputes raised by customers / clients / patients.",
    defaultSeverity: "MEDIUM",
    defaultSlaHours: 48,
    isAnonymousAllowed: true,
    requiresRCAByDefault: false,
    requiresExternalReportByDefault: false,
    sortOrder: 80,
  },
  {
    name: "Vendor / Contractor",
    description: "Issues caused by external vendors, contractors, or service partners on premises.",
    defaultSeverity: "MEDIUM",
    defaultSlaHours: 72,
    isAnonymousAllowed: false,
    requiresRCAByDefault: false,
    requiresExternalReportByDefault: false,
    sortOrder: 90,
  },
  {
    name: "Environmental / Spill",
    description: "Pollution, waste-handling violations, chemical/oil/biohazard spills.",
    defaultSeverity: "HIGH",
    defaultSlaHours: 24,
    isAnonymousAllowed: false,
    requiresRCAByDefault: true,
    requiresExternalReportByDefault: true,
    sortOrder: 100,
  },
  {
    name: "Substance Abuse",
    description: "On-shift intoxication, possession, distribution of restricted substances.",
    defaultSeverity: "HIGH",
    defaultSlaHours: 24,
    isAnonymousAllowed: true,
    requiresRCAByDefault: false,
    requiresExternalReportByDefault: false,
    sortOrder: 110,
  },
  {
    name: "Other",
    description: "General incidents that don't fit any specific category.",
    defaultSeverity: "MEDIUM",
    defaultSlaHours: 72,
    isAnonymousAllowed: true,
    requiresRCAByDefault: false,
    requiresExternalReportByDefault: false,
    sortOrder: 999,
  },
];

async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌱 Seeding default IncidentCategory rows");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let created = 0, updated = 0;
  for (const c of CATEGORIES) {
    const existing = await (prisma as any).incidentCategory.findUnique({ where: { name: c.name } });
    if (existing) {
      // Don't clobber overrides the customer made — only fill missing values.
      // We intentionally only refresh the description + sortOrder; toggles
      // (severity / SLA / anonymous / RCA) are left as the customer set them.
      await (prisma as any).incidentCategory.update({
        where: { name: c.name },
        data: {
          description: existing.description ?? c.description,
          sortOrder:   existing.sortOrder   ?? c.sortOrder,
        },
      });
      updated++;
    } else {
      await (prisma as any).incidentCategory.create({ data: c });
      created++;
    }
  }

  console.log(`✅ Done — ${created} new, ${updated} preserved.`);
  console.log("\nEdit / disable / add categories anytime via the admin settings UI");
  console.log("(or directly in the IncidentCategory table).\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const questions: {
  text: string;
  category: string;
  section: string;
  displayOrder: number;
}[] = [
  // ─── CLINICAL (Staff Nurse) ───────────────────────────────────────────────
  { category: "CLINICAL", section: "Core Clinical Competency", text: "Medication administration accuracy", displayOrder: 1 },
  { category: "CLINICAL", section: "Core Clinical Competency", text: "IV line management & infusion monitoring", displayOrder: 2 },
  { category: "CLINICAL", section: "Core Clinical Competency", text: "Emergency response skills (Code Blue/ER support)", displayOrder: 3 },
  { category: "CLINICAL", section: "Core Clinical Competency", text: "Infection control practices", displayOrder: 4 },
  { category: "CLINICAL", section: "Core Clinical Competency", text: "Patient assessment & monitoring", displayOrder: 5 },
  { category: "CLINICAL", section: "Core Clinical Competency", text: "Documentation accuracy & completeness", displayOrder: 6 },
  { category: "CLINICAL", section: "Core Clinical Competency", text: "Biomedical equipment handling", displayOrder: 7 },

  { category: "CLINICAL", section: "Patient Care & Service Quality", text: "Patient communication & empathy", displayOrder: 8 },
  { category: "CLINICAL", section: "Patient Care & Service Quality", text: "Timely response to patient needs", displayOrder: 9 },
  { category: "CLINICAL", section: "Patient Care & Service Quality", text: "Patient safety compliance", displayOrder: 10 },
  { category: "CLINICAL", section: "Patient Care & Service Quality", text: "Patient ID band verification compliance", displayOrder: 11 },
  { category: "CLINICAL", section: "Patient Care & Service Quality", text: "Maintaining patient dignity & confidentiality", displayOrder: 12 },
  { category: "CLINICAL", section: "Patient Care & Service Quality", text: "Coordination with doctors", displayOrder: 13 },

  { category: "CLINICAL", section: "Teamwork & Coordination", text: "Coordination with nursing team", displayOrder: 14 },
  { category: "CLINICAL", section: "Teamwork & Coordination", text: "Communication with coordinators/admin", displayOrder: 15 },
  { category: "CLINICAL", section: "Teamwork & Coordination", text: "Shift handover effectiveness", displayOrder: 16 },
  { category: "CLINICAL", section: "Teamwork & Coordination", text: "Ability to handle conflict professionally", displayOrder: 17 },

  { category: "CLINICAL", section: "Discipline & Compliance", text: "Punctuality & attendance", displayOrder: 18 },
  { category: "CLINICAL", section: "Discipline & Compliance", text: "Adherence to hospital policies", displayOrder: 19 },
  { category: "CLINICAL", section: "Discipline & Compliance", text: "Uniform & grooming standards", displayOrder: 20 },
  { category: "CLINICAL", section: "Discipline & Compliance", text: "Incident reporting compliance", displayOrder: 21 },
  { category: "CLINICAL", section: "Discipline & Compliance", text: "Following supervisor instructions", displayOrder: 22 },

  // ─── PARAMEDICAL ─────────────────────────────────────────────────────────
  { category: "PARAMEDICAL", section: "Technical Knowledge & Competency", text: "Knowledge of departmental procedures", displayOrder: 1 },
  { category: "PARAMEDICAL", section: "Technical Knowledge & Competency", text: "Handling of equipment & instruments", displayOrder: 2 },
  { category: "PARAMEDICAL", section: "Technical Knowledge & Competency", text: "Adherence to SOPs", displayOrder: 3 },
  { category: "PARAMEDICAL", section: "Technical Knowledge & Competency", text: "Accuracy in reports / procedures", displayOrder: 4 },
  { category: "PARAMEDICAL", section: "Technical Knowledge & Competency", text: "Infection control practices", displayOrder: 5 },
  { category: "PARAMEDICAL", section: "Technical Knowledge & Competency", text: "Biomedical equipment safety compliance", displayOrder: 6 },
  { category: "PARAMEDICAL", section: "Technical Knowledge & Competency", text: "Documentation accuracy", displayOrder: 7 },

  { category: "PARAMEDICAL", section: "Quality & Patient Care", text: "Patient preparation & guidance", displayOrder: 8 },
  { category: "PARAMEDICAL", section: "Quality & Patient Care", text: "Patient safety compliance", displayOrder: 9 },
  { category: "PARAMEDICAL", section: "Quality & Patient Care", text: "Maintaining patient dignity", displayOrder: 10 },
  { category: "PARAMEDICAL", section: "Quality & Patient Care", text: "Timely service delivery", displayOrder: 11 },
  { category: "PARAMEDICAL", section: "Quality & Patient Care", text: "Handling emergency situations", displayOrder: 12 },

  { category: "PARAMEDICAL", section: "Coordination & Teamwork", text: "Coordination with doctors", displayOrder: 13 },
  { category: "PARAMEDICAL", section: "Coordination & Teamwork", text: "Coordination with nursing staff", displayOrder: 14 },
  { category: "PARAMEDICAL", section: "Coordination & Teamwork", text: "Communication with colleagues", displayOrder: 15 },
  { category: "PARAMEDICAL", section: "Coordination & Teamwork", text: "Inter-department cooperation", displayOrder: 16 },
  { category: "PARAMEDICAL", section: "Coordination & Teamwork", text: "Effective shift handover", displayOrder: 17 },

  { category: "PARAMEDICAL", section: "Discipline & Compliance", text: "Punctuality & attendance", displayOrder: 18 },
  { category: "PARAMEDICAL", section: "Discipline & Compliance", text: "Following hospital policies", displayOrder: 19 },
  { category: "PARAMEDICAL", section: "Discipline & Compliance", text: "Uniform & grooming standards", displayOrder: 20 },
  { category: "PARAMEDICAL", section: "Discipline & Compliance", text: "Incident reporting compliance", displayOrder: 21 },
  { category: "PARAMEDICAL", section: "Discipline & Compliance", text: "Safety protocol adherence", displayOrder: 22 },

  { category: "PARAMEDICAL", section: "Productivity & Responsibility", text: "Ability to handle workload", displayOrder: 23 },
  { category: "PARAMEDICAL", section: "Productivity & Responsibility", text: "Time management", displayOrder: 24 },
  { category: "PARAMEDICAL", section: "Productivity & Responsibility", text: "Minimizing errors", displayOrder: 25 },
  { category: "PARAMEDICAL", section: "Productivity & Responsibility", text: "Accountability in assigned tasks", displayOrder: 26 },
  { category: "PARAMEDICAL", section: "Productivity & Responsibility", text: "Resource & material utilization", displayOrder: 27 },

  // ─── NONCLINICAL ─────────────────────────────────────────────────────────
  { category: "NONCLINICAL", section: "Job Knowledge & Work Quality", text: "Understanding of job responsibilities", displayOrder: 1 },
  { category: "NONCLINICAL", section: "Job Knowledge & Work Quality", text: "Knowledge of hospital policies & procedures", displayOrder: 2 },
  { category: "NONCLINICAL", section: "Job Knowledge & Work Quality", text: "Accuracy in work", displayOrder: 3 },
  { category: "NONCLINICAL", section: "Job Knowledge & Work Quality", text: "Attention to detail", displayOrder: 4 },
  { category: "NONCLINICAL", section: "Job Knowledge & Work Quality", text: "Compliance with SOPs", displayOrder: 5 },
  { category: "NONCLINICAL", section: "Job Knowledge & Work Quality", text: "Quality of documentation / reports", displayOrder: 6 },

  { category: "NONCLINICAL", section: "Productivity & Efficiency", text: "Timely completion of tasks", displayOrder: 7 },
  { category: "NONCLINICAL", section: "Productivity & Efficiency", text: "Time management skills", displayOrder: 8 },
  { category: "NONCLINICAL", section: "Productivity & Efficiency", text: "Ability to handle workload", displayOrder: 9 },
  { category: "NONCLINICAL", section: "Productivity & Efficiency", text: "Meeting assigned targets / KPIs", displayOrder: 10 },
  { category: "NONCLINICAL", section: "Productivity & Efficiency", text: "Resource utilization & cost awareness", displayOrder: 11 },

  { category: "NONCLINICAL", section: "Communication & Customer Service", text: "Professional communication", displayOrder: 12 },
  { category: "NONCLINICAL", section: "Communication & Customer Service", text: "Handling patients/attendants courteously", displayOrder: 13 },
  { category: "NONCLINICAL", section: "Communication & Customer Service", text: "Inter-department coordination", displayOrder: 14 },
  { category: "NONCLINICAL", section: "Communication & Customer Service", text: "Complaint handling ability", displayOrder: 15 },
  { category: "NONCLINICAL", section: "Communication & Customer Service", text: "Maintaining confidentiality", displayOrder: 16 },

  { category: "NONCLINICAL", section: "Teamwork & Behavior", text: "Cooperation with colleagues", displayOrder: 17 },
  { category: "NONCLINICAL", section: "Teamwork & Behavior", text: "Respect towards supervisors", displayOrder: 18 },
  { category: "NONCLINICAL", section: "Teamwork & Behavior", text: "Positive work attitude", displayOrder: 19 },
  { category: "NONCLINICAL", section: "Teamwork & Behavior", text: "Conflict management", displayOrder: 20 },
  { category: "NONCLINICAL", section: "Teamwork & Behavior", text: "Willingness to take additional responsibility", displayOrder: 21 },

  { category: "NONCLINICAL", section: "Discipline & Compliance", text: "Punctuality & attendance", displayOrder: 22 },
  { category: "NONCLINICAL", section: "Discipline & Compliance", text: "Adherence to hospital rules", displayOrder: 23 },
  { category: "NONCLINICAL", section: "Discipline & Compliance", text: "Grooming & professional appearance", displayOrder: 24 },
  { category: "NONCLINICAL", section: "Discipline & Compliance", text: "Reporting errors/incidents timely", displayOrder: 25 },
  { category: "NONCLINICAL", section: "Discipline & Compliance", text: "Ethical conduct", displayOrder: 26 },
];

async function main() {
  console.log("Seeding self-appraisal questions...");

  // Clear existing questions first
  await prisma.selfAppraisalAnswer.deleteMany({});
  await prisma.selfAppraisalQuestion.deleteMany({});

  for (const q of questions) {
    await prisma.selfAppraisalQuestion.create({ data: q });
  }

  console.log(`Seeded ${questions.length} questions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

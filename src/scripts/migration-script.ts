// import { prisma } from "../lib/prisma";

// async function migrateDesignations() {
//     console.log('migration')
//   // 1. Get distinct designation names
//   const rows = await prisma.employee.findMany({
//     where: { designation: { not: null } },
//     distinct: ['designation'],
//     select: { designation: true }
//   });

//   for (const row of rows) {
//     if (!row.designation) continue;

//     // 2. Create designation if not exists
//     const designation = await prisma.designation.upsert({
//       where: { name: row.designation },
//       update: {},
//       create: { name: row.designation }
//     });

//     // 3. Map employees to designationId
//     await prisma.employee.updateMany({
//       where: { designation: row.designation },
//       data: { designationId: designation.id }
//     });
//   }

//   console.log('✅ Designation migration completed');
// }

// migrateDesignations()
//   .catch(console.error)
//   .finally(() => process.exit(0));

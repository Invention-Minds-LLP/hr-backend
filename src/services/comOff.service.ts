import { prisma } from '../lib/prisma';


function stripTime(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = firstDay.getDay(); // weekday of 1st day
  return Math.ceil((date.getDate() + offset) / 7);
}


async function isHoliday(date: Date) {
  const holiday = await prisma.holiday.findFirst({
    where: {
      date: stripTime(date)
    }
  });
  return !!holiday;
}

// function isWeeklyOff(date: Date) {
//   // Sunday as default weekly off
//   return date.getDay() === 0;
// }
async function isWeeklyOff(employeeId: number, date: Date) {
  const approval = await prisma.shiftApproval.findFirst({
    where: {
      employeeId,
      status: "APPROVED",
    },
    orderBy: {
      requestedAt: "desc",
    },
    select: {
      weekOffConfig: true,
    },
  });

  // fallback: Sunday
  if (!approval || !approval.weekOffConfig) {
    return date.getDay() === 0;
  }

  const config: any = approval.weekOffConfig;

  // Rotational weekly off logic
  if (config.weeks) {
    const weekNumber = getWeekOfMonth(date) - 1;
    const offDay = config.weeks[weekNumber];
    console.log(`Rotational Weekly Off - Week ${weekNumber}: Off Day ${offDay}`);

    if (offDay !== undefined) {
      return date.getDay() === offDay;
    }
  }

  // fallback
  return date.getDay() === 0;
}


// export async function generateCompOffIfEligible(attendance: any) {
//   const date = stripTime(new Date(attendance.date));
//   const employeeId = attendance.employeeId;

//   // Only for PRESENT days
//   if (attendance.status !== "PRESENT") return;

//   const holiday = await isHoliday(date);
//   const weeklyOff = isWeeklyOff(date);

//   if (!holiday && !weeklyOff) return;

//   const expiry = new Date(date);
//   expiry.setDate(expiry.getDate() + 30);

// const existing = await prisma.compOffCredit.findFirst({
//   where: {
//     employeeId,
//     workDate: date,
//     used: false
//   }
// });

// if (!existing) {
//   await prisma.compOffCredit.create({
//     data: {
//       employeeId,
//       workDate: date,
//       expiryDate: expiry
//     }
//   });
// }

// }

export async function generateCompOffIfEligible(attendance: any) {
  const date = stripTime(new Date(attendance.date));
  const employeeId = attendance.employeeId;

  console.log(`Checking comp off eligibility for Employee ${employeeId} on ${date.toDateString()} with status ${attendance.status}`);

  // Only for PRESENT days
  if (attendance.status !== "Present") return;

  const holiday = await isHoliday(date);
  const weeklyOff = await isWeeklyOff(employeeId, date);

  console.log(`Is Holiday: ${holiday}, Is Weekly Off: ${weeklyOff}`);

  // Not eligible
  if (!holiday && !weeklyOff) return;

  const expiry = new Date(date);
  expiry.setDate(expiry.getDate() + 30);

  const existing = await prisma.compOffCredit.findFirst({
    where: {
      employeeId,
      workDate: date,
      used: false
    }
  });

  if (!existing) {
    await prisma.compOffCredit.create({
      data: {
        employeeId,
        workDate: date,
        expiryDate: expiry
      }
    });
  }
}

import bcrypt from 'bcryptjs';
  import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export class UserAuthService {

  async validateCredentials(employeeCode: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { employeeCode },
      include: { employee: true }
    });

    if (!user) return null;

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return null;

    return user;
  }

  async getUserWithEmployee(employeeCode: string) {
    return prisma.user.findUnique({
      where: { employeeCode },
      include: { employee: true }
    });
  }



finalizeLogin = async (
  userId: number,
  ipAddress?: string,
  userAgent?: string
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      employee: {
        select: {
          id: true,
          departmentId: true,
          photoUrl: true,
          roleId: true,
          gender: true,
          designation: {
            select: { name: true }
          },
          role: {
            select: { name: true }
          }
        }
      }
    }
  });

  if (!user || !user.employee) {
    throw new Error('User or Employee not found');
  }

  // Use role from Employee table (source of truth)
  const roleName = user.employee.role?.name ?? user.role;

  // JWT payload (same as loginUser)
  const payload = {
    userId: user.id,
    role: roleName,
    empId: user.employee.id,
    deptId: user.employee.departmentId,
    employeeCode: user.employeeCode,
    username: user.username,
  };

  const token = jwt.sign(
    payload,
    process.env.JWT_SECRET as string,
    { expiresIn: '12h' }
  );

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() }
  });

  return {
    token,
    username: user.username,
    employeeCode: user.employeeCode,
    id: user.id,
    role: roleName,
    empId: user.employee.id,
    deptId: user.employee.departmentId,
    designation: user.employee.designation?.name || '',
    photoUrl: user.employee.photoUrl || null,
    roleId: user.employee.roleId,
    gender: user.employee.gender,
  };
};
}




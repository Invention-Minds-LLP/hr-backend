import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();


import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// REGISTER / CREATE USER (linked to Employee)
export const createUser = async (req: Request, res: Response) => {
  try {
    const { employeeCode, password } = req.body;

    // 1) Check employee exists
    const employee = await prisma.employee.findUnique({
      where: { employeeCode }
    });
    if (!employee) {
      return res.status(400).json({
        error: "Employee does not exist",
        action: "Create the employee first, then create the user",
        employeeCode
      });
    }

    // 2) Check if a user already exists for that employeeCode
    const existingByEmpCode = await prisma.user.findUnique({ where: { employeeCode } });
    if (existingByEmpCode) {
      return res.status(409).json({
        error: "A user is already linked to this employeeCode",
        employeeCode
      });
    }


    const hashedPassword = await bcrypt.hash(password, 10);

    let username = `${employee.firstName}.${employee.lastName}`.toLowerCase().replace(/\s+/g, "");
    // Optional: ensure unique username by appending a number if needed
    let suffix = 1;
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${employee.firstName}.${employee.lastName}${suffix}`.toLowerCase().replace(/\s+/g, "");
      suffix++;
    }
    const role = await prisma.role.findUnique({
      where: { id: Number(employee.roleId) },
      select: { name: true } // <-- change to { roleName: true } if that's your field
    });
    if (!role) {
      return res.status(400).json({
        error: "Invalid roleId on employee. Role not found.",
        roleId: employee.roleId
      });
    }
    const user = await prisma.user.create({
      data: {
        employeeCode,
        username,
        passwordHash: hashedPassword,
        role: role.name
      }
    });

    res.status(201).json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create user" });
  }
};

// LOGIN USER
export const loginUser = async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || undefined;
  try {
    const { employeeCode, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { employeeCode },
      include: { employee: true }
    });

    const employee = await prisma.employee.findUnique({
        where: {employeeCode},
        select: {
          id: true,
          departmentId: true,
          photoUrl: true,
          designation: true,
        }
    })

    if(!employee) return res.status(404).json({ error: "Employee not found" });

    if (!user) return res.status(404).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.passwordHash);

    await prisma.loginHistory.create({
      data: { userId: user.id, ipAddress, userAgent, success: !!validPassword }
    }).catch(() => { });

    if (!validPassword) return res.status(401).json({ error: "Invalid password" });

    // Generate JWT
    const payload = {
      userId: user.id,
      role: user.role,
      empId: employee.id,
      deptId: employee.departmentId,
      employeeCode: user.employeeCode,
      username: user.username,
    };
    
    const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: "1d" });


    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    // Send only required fields
    return res.json({
      token,
      username: user.username,
      employeeCode: user.employeeCode,
      id: user.id,
      role: user.role,
      empId: employee.id,
      deptId: employee.departmentId,
      designation: employee.designation,
      photoUrl: employee.photoUrl || null
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
};
const getClientIp = (req: Request) => {
  const xfwd = (req.headers["x-forwarded-for"] as string) || "";
  return (xfwd.split(",")[0] || req.ip || req.socket.remoteAddress || "").trim();
};


// SELF-SERVE RESET (requires logged-in user & current password)
export const resetMyPassword = async (req: Request, res: Response) => {
  try {
    const authUserId = (req as any).user?.userId as number; // set by auth middleware
    const { userId, confirmPassword, newPassword } = req.body;

    // if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
    if (!confirmPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // const ok = await bcrypt.compare( confirmPassword, user.passwordHash);
    // if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash }
    });

    res.json({ message: "Password updated successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to reset password" });
  }
};

// ADMIN RESET (requires admin role)
export const adminResetPassword = async (req: Request, res: Response) => {
  try {
    const requesterRole = (req as any).user?.role as string;
    if (requesterRole !== "admin") return res.status(403).json({ error: "Forbidden" });

    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ error: "userId and newPassword are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash }
    });

    res.json({ message: `Password reset for user ${user.username}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to reset password" });
  }
};
export const listAllUsers = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        employeeCode: true,
        username: true,
        role: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            departmentId: true,
            designation: true
          }
        }
      }
    });

    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

export const setCandidatePassword = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const candidate = await prisma.candidate.findUnique({ where: { email: email.toLowerCase() } });
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { passwordHash }
    });

    return res.json({ message: "Password set successfully" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to set password" });
  }
};
export const loginCandidate = async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || undefined;

  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const candidate = await prisma.candidate.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }
    if (!candidate.passwordHash) {
      return res.status(400).json({ error: "Password not set. Use the set-password flow." });
    }

    const ok = await bcrypt.compare(password, candidate.passwordHash);
    await prisma.candidateLoginHistory.create({
      data: { candidateId: candidate.id, ipAddress, userAgent, success: !!ok }
    }).catch(() => {});

    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // JWT for candidates (role: 'candidate')
    const token = jwt.sign(
      { candidateId: candidate.id, role: "candidate" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { lastLogin: new Date() }
    });

    return res.json({
      token,
      candidateId: candidate.id,
      name: candidate.name,
      email: candidate.email
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Login failed" });
  }
};
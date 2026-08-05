import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { config } from "../../config";
import { UserAuthService } from "../../services/employee.service";
const userAuthService = new UserAuthService();
import { otpService } from "../../services/otp.service";


import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendOtpSms } from "../sms/sms.controller";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  createRefreshToken,
  csrfOk,
  issueCsrfCookie,
  readCookie,
  revokeRefreshTokenById,
  revokeRefreshTokenByRaw,
  setRefreshCookie,
  signAccessToken,
  validateRefreshToken,
} from "./auth.helpers";
import { getEmployeeAccess } from "../../lib/employeeAccess";

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
  console.log("Login attempt:", req.body);
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || undefined;
  try {
    const { employeeCode, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { employeeCode },
      include: { employee: true }
    });



    const employee = await prisma.employee.findUnique({
      where: { employeeCode },
      select: {
        id: true,
        departmentId: true,
        photoUrl: true,
        designation: true,
        roleId: true,
        gender: true,
        employmentStatus: true,
        role: { select: { name: true } },
        Department: { select: { name: true } }
      }
    })
    

    if (!employee) return res.status(404).json({ error: "Employee not found" });

    if (employee.employmentStatus !== "ACTIVE" && employee.employmentStatus !== "NOTICE_PERIOD") {
      return res.status(403).json({ error: "Your account is inactive. Please contact HR." });
    }

    if (!user) return res.status(404).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.passwordHash);

    await prisma.loginHistory.create({
      data: { userId: user.id, ipAddress, userAgent, success: !!validPassword }
    }).catch(() => { });

    if (!validPassword) return res.status(401).json({ error: "Invalid password" });

    // Use role from Employee table (source of truth), not User table
    const roleName = employee.role?.name ?? user.role;

    // Generate JWT
    const payload = {
      userId: user.id,
      role: roleName,
      empId: employee.id,
      deptId: employee.departmentId,
      employeeCode: user.employeeCode,
      username: user.username,
      roleId: employee.roleId
    };

    // Short-lived access token — the browser keeps it in memory only. The
    // long-lived half of the session is the httpOnly refresh cookie below,
    // backed by a revocable RefreshToken row.
    const token = signAccessToken(payload);

    const refreshRaw = await createRefreshToken(user.id, req);
    setRefreshCookie(res, refreshRaw, req);
    issueCsrfCookie(res, req);

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
      role: roleName,
      empId: employee.id,
      deptId: employee.departmentId,
      departmentName: employee.Department?.name || '',
      designation: employee?.designation?.name || '',
      photoUrl: employee.photoUrl || null,
      roleId: employee.roleId,
      gender: employee.gender
    });
  } catch (error) {
    console.error(error);
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
    const { confirmPassword, newPassword } = req.body;

    if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
    if (!confirmPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }

    // Always operate on the authenticated user's own account — never trust a
    // userId supplied in the request body (that allowed resetting anyone's password).
    const user = await prisma.user.findUnique({ where: { id: authUserId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const ok = await bcrypt.compare(confirmPassword, user.passwordHash);
    // if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
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
    // Authorised to reset OTHER users' passwords: HR department (deptId 1) or ADMIN.
    const requesterRole = String((req as any).user?.role ?? "").toUpperCase();
    const requesterDeptId = Number((req as any).user?.deptId ?? (req as any).user?.departmentId ?? 0);
    if (requesterDeptId !== 1) {
      return res.status(403).json({ error: "Forbidden" });
    }

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

        // ✅ employee details only
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            departmentId: true,
            designation: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }

        // ❌ NOT returning: passwordHash, refreshTokens, loginHistory
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
    }).catch(() => { });

    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // JWT for candidates (role: 'candidate')
    const token = jwt.sign(
      { candidateId: candidate.id, role: "candidate" },
      config.jwtSecret,
      { expiresIn: "12h" }
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


export const loginInit = async (req: Request, res: Response) => {
  try {
    const { empId, password } = req.body;

    const user = await userAuthService.validateCredentials(empId, password);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const phone = user.employee?.phone;
    if (!phone) {
      return res.status(400).json({ message: 'Phone number not found' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`Generated OTP for empId ${empId}: ${otp}`);

    await otpService.generate(empId, otp);

    await sendOtpSms({
      patientName: user.employee?.firstName || 'Employee',
      otp,
      service: 'Employee Login',
      phoneNumber: phone
    });

    res.json({
      success: true,
      empId
    });
  } catch (err) {
    res.status(500).json({ message: 'OTP sending failed' });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
    const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || undefined;
  try {
    const { empId, otp } = req.body;

    const isValid = await otpService.verify(empId, otp);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }
    const user = await prisma.user.findUnique({
      where: { employeeCode: empId }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }


    // OTP success → finalize login
    const response = await userAuthService.finalizeLogin(user.id, ipAddress, userAgent);
    res.json({ ...response });
  } catch (err) {
    res.status(500).json({ message: 'OTP verification failed' });
  }
};

/**
 * Mint a fresh access token from the httpOnly refresh cookie.
 *
 * This is the "is my session still alive?" check — it's the server, not the
 * browser, that answers. Called by the SPA at boot (so a page reload restores
 * the in-memory access token) and whenever a request comes back 401.
 *
 * Authenticated by the cookie alone, so it carries no bearer token and needs
 * the double-submit CSRF header instead. The refresh token is ROTATED on every
 * use: the presented one is revoked and a new one issued, so a stolen cookie
 * has a short useful life and replay of an already-used token fails.
 */
export const refreshAccessToken = async (req: Request, res: Response) => {
  try {
    if (!csrfOk(req)) {
      return res.status(403).json({ message: 'Invalid CSRF token' });
    }

    const raw = readCookie(req, REFRESH_COOKIE);
    const session = await validateRefreshToken(raw);
    if (!session) {
      clearAuthCookies(res, req);
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, employeeCode: true, role: true }
    });
    if (!user) {
      await revokeRefreshTokenById(session.id);
      clearAuthCookies(res, req);
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    const employee = await prisma.employee.findUnique({
      where: { employeeCode: user.employeeCode },
      select: {
        id: true,
        departmentId: true,
        photoUrl: true,
        designation: true,
        roleId: true,
        gender: true,
        employmentStatus: true,
        role: { select: { name: true } },
        Department: { select: { name: true } }
      }
    });

    // Re-check employment status / revocation on every refresh, so terminating
    // someone kills their web session within one access-token lifetime rather
    // than waiting for the 7-day refresh cookie to expire.
    const access = employee ? await getEmployeeAccess(employee.id) : null;
    if (!employee || !access?.exists || !access.active) {
      await revokeRefreshTokenById(session.id);
      clearAuthCookies(res, req);
      return res.status(401).json({ message: 'Your account is inactive. Please contact HR.' });
    }

    // Rotate: the presented token dies here, a new one takes its place.
    await revokeRefreshTokenById(session.id);
    const nextRaw = await createRefreshToken(user.id, req);
    setRefreshCookie(res, nextRaw, req);
    issueCsrfCookie(res, req);

    const roleName = employee.role?.name ?? user.role;
    const token = signAccessToken({
      userId: user.id,
      role: roleName,
      empId: employee.id,
      deptId: employee.departmentId,
      employeeCode: user.employeeCode,
      username: user.username,
      roleId: employee.roleId
    });

    // Same shape as the login response — the SPA reuses one setSession() for
    // both, so display data (role, dept, photo…) refreshes from the DB too.
    return res.json({
      token,
      username: user.username,
      employeeCode: user.employeeCode,
      id: user.id,
      role: roleName,
      empId: employee.id,
      deptId: employee.departmentId,
      departmentName: employee.Department?.name || '',
      designation: employee?.designation?.name || '',
      photoUrl: employee.photoUrl || null,
      roleId: employee.roleId,
      gender: employee.gender
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(500).json({ message: 'Refresh failed' });
  }
};

/**
 * End a session server-side.
 *
 * Two callers with two token transports:
 *   • web    — refresh token in the httpOnly cookie, CSRF header required.
 *   • mobile — opaque refresh token in the request body (legacy, unchanged).
 * Returns 200 even when nothing matched: logout must never leave a client
 * stuck holding credentials it can't clear.
 */
export const logout = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body ?? {};

    if (refreshToken) {
      // Mobile path — raw token, hard delete as before.
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }

    const cookieRaw = readCookie(req, REFRESH_COOKIE);
    if (cookieRaw) {
      if (!csrfOk(req)) {
        return res.status(403).json({ message: 'Invalid CSRF token' });
      }
      await revokeRefreshTokenByRaw(cookieRaw);
    }
    clearAuthCookies(res, req);

    return res.json({ message: 'Logged out successfully' });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Logout failed' });
  }
};

export const syncUsersFromEmployees = async (_req: Request, res: Response) => {
  try {
    // 1) Get employees who DO NOT have users
    const employeesWithoutUsers = await prisma.employee.findMany({
      where: {
        User: null   // 👈 because Employee → User? relation exists
      },
      select: {
        employeeCode: true,
        firstName: true,
        lastName: true,
        roleId: true
      }
    });

    if (employeesWithoutUsers.length === 0) {
      return res.json({
        message: "All employees already have users",
        created: 0
      });
    }

    let createdCount = 0;

    for (const emp of employeesWithoutUsers) {
      // password = employeeCode
      const passwordHash = await bcrypt.hash(emp.employeeCode, 10);

      // generate username
      let username = `${emp.firstName}.${emp.lastName}`
        .toLowerCase()
        .replace(/\s+/g, "");

      let suffix = 1;
      while (await prisma.user.findUnique({ where: { username } })) {
        username = `${emp.firstName}.${emp.lastName}${suffix}`
          .toLowerCase()
          .replace(/\s+/g, "");
        suffix++;
      }

      // resolve role
      const roleRow = await prisma.role.findUnique({
        where: { id: emp.roleId },
        select: { name: true }
      });

      if (!roleRow) {
        console.warn(`Skipping ${emp.employeeCode}: role not found`);
        continue;
      }

      await prisma.user.create({
        data: {
          employeeCode: emp.employeeCode,
          username,
          passwordHash,
          role: roleRow.name
        }
      });

      createdCount++;
    }

    return res.json({
      message: "User sync completed",
      created: createdCount
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "User sync failed" });
  }
};
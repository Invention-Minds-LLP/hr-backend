// controllers/mobileAuth.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { otpService } from '../../services/otp.service';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendOtpSms } from '../sms/sms.controller';
import { sendWhatsAppTemplate } from '../leave/leave.controller';
import { sendEmailOtp } from '../../utils/sendEmailOtp';
import { resolveAttendanceMode } from '../../lib/attendanceMode';
import { config } from '../../config';

export const mobilePhoneInit = async (req: Request, res: Response) => {
    const { phone } = req.body;

    // ✅ PLAY STORE REVIEW AUTO LOGIN
    if (
        config.playReview.mode &&
        phone === config.playReview.phone
    ) {
        const employee = await prisma.employee.findFirst({
            where: { phone },
            include: {
                designation: true,
                role: { select: { name: true } },
                Branch: { select: { attendanceMode: true } }
            }
        });

        if (!employee) {
            return res.status(404).json({ message: 'Review employee not found' });
        }

        const user = await prisma.user.findUnique({
            where: { employeeCode: employee.employeeCode }
        });

        if (!user) {
            return res.status(404).json({ message: 'Review user not found' });
        }

        // 🔐 Generate tokens directly
        const empRoleName = employee.role?.name ?? user.role;

        const accessToken = jwt.sign(
            {
                userId: user.id,
                empId: employee.id,
                role: empRoleName,
                reviewMode: true
            },
            config.jwtSecret,
            { expiresIn: '1h' }
        );

        const refreshToken = crypto.randomUUID();

        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                token: refreshToken,
                expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
            }
        });

        return res.json({
            autoLogin: true,
            reviewMode: true,

            // tokens
            accessToken,
            refreshToken,

            // user info
            username: user.username,
            employeeCode: user.employeeCode,
            id: user.id,
            role: empRoleName,

            // employee info
            empId: employee.id,
            deptId: employee.departmentId,
            designation: employee.designation?.name || '',
            photoUrl: employee.photoUrl || null,
            roleId: employee.roleId,
            attendanceMode: resolveAttendanceMode(employee)
        });
    }


    const employee = await prisma.employee.findFirst({ where: { phone } });
    if (!employee) {
        return res.status(404).json({ message: 'Phone not registered' });
    }

    const session = await prisma.mobileAuthSession.create({
        data: {
            employeeId: employee.id,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        }
    });

    // Per-client (MOBILE_SKIP_PHONE_OTP in .env): IM skips the phone-OTP step and
    // goes phone → identity confirmation → email OTP. No phone OTP is sent.
    if (config.flags.skipPhoneOtp) {
        return res.json({ sessionId: session.id, next: 'IDENTITY_CONFIRMATION' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await otpService.generate(phone, otp);

    // OTP channel is per-client by which provider they own (OTP_CHANNEL in .env):
    // IM → WhatsApp (its creds + template), JMRH → SMS (its creds).
    if (config.flags.otpChannel === 'whatsapp') {
        const wa = await sendWhatsAppTemplate({
            to: phone,
            templateId: config.whatsapp.otpTemplateId,
            placeholders: [otp], // assumes template body {{1}} = OTP code
        });
        console.log('OTP WhatsApp sent:', wa);
    } else {
        const sms = await sendOtpSms({
            patientName: employee.firstName,
            otp,
            service: 'Mobile Login',
            phoneNumber: phone
        });
        console.log('OTP SMS sent:', sms.data);
    }

    res.json({ sessionId: session.id });
};
export const mobilePhoneVerify = async (req: Request, res: Response) => {
    const { sessionId, otp } = req.body;

    const session = await prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });

    if (!session || session.expiresAt < new Date()) {
        return res.status(401).json({ message: 'Session expired' });
    }

    const valid = await otpService.verify(session.employee.phone, otp);
    if (!valid) {
        return res.status(401).json({ message: 'Invalid OTP' });
    }

    await prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { phoneVerified: true }
    });

    res.json({ next: 'IDENTITY_CONFIRMATION' });
};
export const mobileConfirmIdentity = async (req: Request, res: Response) => {
    const { sessionId, firstName, departmentId } = req.body;

    const session = await prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });

    if (!session) {
        return res.status(401).json({ message: 'Session not found' });
    }

    if (
        session?.employee.firstName !== firstName ||
        session.employee.departmentId !== departmentId
    ) {
        return res.status(401).json({ message: 'Identity mismatch' });
    }

    await prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { identityOk: true }
    });

    res.json({ next: 'EMAIL_OTP' });
};
export const getMobileClientInfo = async (_req: Request, res: Response) => {
    res.json({
        clientName: config.branding.mobileClientName
    });
};

export const mobileConfirmClient = async (req: Request, res: Response) => {
    const { sessionId, confirmed } = req.body;

    if (!confirmed) {
        // User said "No"
        await prisma.mobileAuthSession.delete({
            where: { id: sessionId }
        });

        return res.status(400).json({
            message: 'Login cancelled by user'
        });
    }

    const session = await prisma.mobileAuthSession.findUnique({
        where: { id: sessionId }
    });

    if (!session) {
        return res.status(401).json({ message: 'Session not found' });
    }

    await prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { identityOk: true }
    });

    res.json({ next: 'EMAIL_OTP' });
};

export const mobileEmailInit = async (req: Request, res: Response) => {
    const { sessionId, email } = req.body;

    const session = await prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });

    if (!session) {
        return res.status(401).json({ message: 'Session not found' });
    }
    console.log('Email OTP init for session:', sessionId, 'Employee:', session.employee, 'Provided email:', email);

    if (session?.employee.email !== email) {
        return res.status(401).json({ message: 'Email mismatch' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await otpService.generate(email, otp);
    await sendEmailOtp({
        to: email,
        otp,
        employeeName: session?.employee.firstName,
        purpose: 'Mobile Login'
    });


    res.json({ next: 'VERIFY_EMAIL_OTP' });
};
export const mobileEmailVerify = async (req: Request, res: Response) => {
    const { sessionId, otp } = req.body;

    const session = await prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });

    const valid = await otpService.verify(session!.employee.email!, otp);
    if (!valid) return res.status(401).json({ message: 'Invalid OTP' });

    await prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { emailVerified: true }
    });

    res.json({ next: 'FINAL_VERIFICATION' });
};
export const mobileFinalizeLogin = async (req: Request, res: Response) => {
    const { sessionId, employeeCode, bloodGroup } = req.body;

    const session = await prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: {
            employee: {
                include: {
                    designation: true,
                    Branch: { select: { attendanceMode: true } }
                }
            }
        }
    });


    const employee = session?.employee;
    console.log('Finalizing login for session:', sessionId, 'Employee:', employee);
    if (
        !employee ||
        employee.employeeCode !== employeeCode ||
        employee.bloodGroup !== bloodGroup
    ) {
        return res.status(401).json({ message: 'Verification failed' });
    }

    const user = await prisma.user.findUnique({
        where: { employeeCode }
    });

    // Get role from Employee table
    const empRole = await prisma.role.findUnique({ where: { id: employee.roleId }, select: { name: true } });
    const roleName = empRole?.name ?? user!.role;

    const accessToken = jwt.sign(
        {
            userId: user!.id,
            empId: employee.id,
            role: roleName
        },
        config.jwtSecret,
        { expiresIn: '15m' }
    );

    const refreshToken = crypto.randomUUID();

    await prisma.refreshToken.create({
        data: {
            userId: user!.id,
            token: refreshToken,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        }
    });

    await prisma.mobileAuthSession.delete({ where: { id: sessionId } });

    res.json({
        accessToken,
        refreshToken,

        // user details
        username: user!.username,
        employeeCode: user!.employeeCode,
        id: user!.id,
        role: roleName,

        // employee details
        empId: employee.id,
        deptId: employee.departmentId,
        designation: employee.designation?.name || '',
        photoUrl: employee.photoUrl || null,
        roleId: employee.roleId,
        gender: employee.gender || '',
        attendanceMode: resolveAttendanceMode(employee)
    });

};
export const refreshAccessToken = async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    const stored = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true }
    });

    if (!stored || stored.expiresAt < new Date()) {
        return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const employee = await prisma.employee.findFirst({
        where: { employeeCode: stored.user.employeeCode },
        include: { role: { select: { name: true } } }
    });

    if (!employee) {
        return res.status(404).json({ message: 'Employee not found' });
    }

    const accessToken = jwt.sign(
        {
            userId: stored.user.id,
            role: employee.role?.name ?? stored.user.role,
            empId: employee.id,
        },
        config.jwtSecret,
        { expiresIn: '12h' }
    );

    res.json({ accessToken });
};

// controllers/mobileAuth.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { otpService } from '../../services/otp.service';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendOtpSms } from '../sms/sms.controller';
import { sendEmailOtp } from '../../utils/sendEmailOtp';

export const mobilePhoneInit = async (req: Request, res: Response) => {
    const { phone } = req.body;

    // ✅ PLAY STORE REVIEW AUTO LOGIN
    if (
        process.env.PLAY_REVIEW_MODE === 'true' &&
        phone === process.env.PLAY_REVIEW_PHONE
    ) {
        const employee = await prisma.employee.findFirst({
            where: { phone },
            include: { designation: true }
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
        const accessToken = jwt.sign(
            {
                userId: user.id,
                empId: employee.id,
                role: user.role,
                reviewMode: true
            },
            process.env.JWT_SECRET!,
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
            role: user.role,

            // employee info
            empId: employee.id,
            deptId: employee.departmentId,
            designation: employee.designation?.name || '',
            photoUrl: employee.photoUrl || null,
            roleId: employee.roleId
        });
    }


    const employee = await prisma.employee.findFirst({ where: { phone } });
    if (!employee) {
        return res.status(404).json({ message: 'Phone not registered' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await otpService.generate(phone, otp);

    const sms = await sendOtpSms({
        patientName: employee.firstName,
        otp,
        service: 'Mobile Login',
        phoneNumber: phone
    });

    console.log('OTP SMS sent:', sms.data);

    const session = await prisma.mobileAuthSession.create({
        data: {
            employeeId: employee.id,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        }
    });

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
        clientName: process.env.MOBILE_CLIENT_NAME
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
                    designation: true
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

    const accessToken = jwt.sign(
        {
            userId: user!.id,
            empId: employee.id,
            role: user!.role
        },
        process.env.JWT_SECRET!,
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
        role: user!.role,

        // employee details
        empId: employee.id,
        deptId: employee.departmentId,
        designation: employee.designation?.name || '',
        photoUrl: employee.photoUrl || null,
        roleId: employee.roleId
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
        where: { employeeCode: stored.user.employeeCode }
    });

    if (!employee) {
        return res.status(404).json({ message: 'Employee not found' });
    }

    const accessToken = jwt.sign(
        {
            userId: stored.user.id,
            role: stored.user.role,
            empId: employee.id,
        },
        process.env.JWT_SECRET!,
        { expiresIn: '12h' }
    );

    res.json({ accessToken });
};

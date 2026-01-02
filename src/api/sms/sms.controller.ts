import { Request, Response } from 'express';
import axios from 'axios';

interface SendOtpSmsParams {
  patientName: string;
  otp: string;
  service: string;
  phoneNumber: string;
}

// export const sendOtpSms = async ({
//   patientName,
//   otp,
//   service,
//   phoneNumber,
// }: SendOtpSmsParams) => {
//   const apiKey = process.env.SMS_API_KEY;
//   const apiUrl = process.env.SMS_API_URL;
//   const sender = process.env.SMS_SENDER;
//   const dltTemplateId = process.env.SMS_DLT_TE_ID_FOR_OTP;
//   const dltEntityId = process.env.DLT_ENTITY_ID;

//   const message = `Dear ${patientName}, ${otp} is your One Time Password from Rashtrotthana Hospital for ${service} service. Expires in 2 mins. Please do not share this OTP with anyone.`;

//   const url = `${apiUrl}/${sender}/${phoneNumber}/${encodeURIComponent(
//     message
//   )}/TXT?apikey=${apiKey}&dltentityid=${dltEntityId}&dlttempid=${dltTemplateId}`;

//   return axios.get(url);
// };


export const sendOtpSms = async ({
  patientName,
  otp,
  service,
  phoneNumber,
}: SendOtpSmsParams) => {
  try {
    const apiKey = process.env.SMS_API_KEY;
    const apiUrl = process.env.SMS_API_URL;
    const sender = process.env.SMS_SENDER;
    const dltTemplateId = process.env.SMS_DLT_TE_ID_FOR_OTP;
    const dltEntityId = process.env.DLT_ENTITY_ID;

    const message = `Dear ${patientName}, ${otp} is your One Time Password from Rashtrotthana Hospital for ${service} service. Expires in 2 mins. Please do not share this OTP with anyone.`;

    const url = `${apiUrl}/${sender}/${phoneNumber}/${encodeURIComponent(
      message
    )}/TXT?apikey=${apiKey}&dltentityid=${dltEntityId}&dlttempid=${dltTemplateId}`;

    const response = await axios.get(url);

    return response;
  } catch (error: any) {
    console.error("❌ OTP SMS sending failed", {
      phoneNumber,
      service,
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });

    throw error; // rethrow so caller can handle it
  }
};



export const sendOtpSmsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { patientName, otp, service, patientPhoneNumber } = req.body;

    if (!patientName || !otp || !service || !patientPhoneNumber) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
      return;
    }

    const response = await sendOtpSms({
      patientName,
      otp,
      service,
      phoneNumber: patientPhoneNumber,
    });

    res.status(200).json({
      success: true,
      message: 'OTP SMS sent successfully',
      providerResponse: response.data,
    });
  } catch (error: any) {
    console.error('SMS Error:', error?.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: 'Failed to send OTP SMS',
    });
  }
};

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret"; // make sure to store in .env

export interface AuthenticatedRequest extends Request {
  user?: any; // you can type this properly if you like
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
    const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
     res.status(401).json({ message: "Unauthorized: No token provided" });
     return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // attach decoded payload to request
    next();
     return
  } catch (error) {
    console.error("JWT verification failed:", error);
     res.status(403).json({ message: "Forbidden: Invalid token" });
    return;
  }
};

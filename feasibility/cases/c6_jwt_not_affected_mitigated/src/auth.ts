import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// Verification key comes from the environment; it is optional in local development.
const key = process.env.JWT_KEY;

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  try {
    (req as any).user = jwt.verify(token, key, { algorithms: ["HS256"] });
    next();
  } catch {
    res.status(401).end();
  }
}

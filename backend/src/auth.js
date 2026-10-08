import { Router } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { databasePool } from "./database.js";
import { requireUser } from "./auth-middleware.js";
import { sectionForRole } from "./access.js";
import { recordStaffActivity } from "./staff-activity.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many login attempts. Please try again later.",
  },
});
const timingHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);

authRouter.post("/login", loginLimiter, async (request, response, next) => {
  try {
    const { email, password } = request.body ?? {};

    if (
      typeof email !== "string" ||
      email.length > 254 ||
      typeof password !== "string" ||
      password.length === 0 ||
      Buffer.byteLength(password) > 72
    ) {
      response.status(400).json({
        success: false,
        error: "Enter a valid email address and password.",
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      response.status(400).json({
        success: false,
        error: "Enter a valid email address and password.",
      });
      return;
    }

    const result = await databasePool.query(
      `SELECT id, name, password_hash, role
       FROM public.users
       WHERE email = $1`,
      [normalizedEmail],
    );
    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      user?.password_hash ?? timingHash,
    );

    if (!user || !passwordMatches) {
      response.status(401).json({
        success: false,
        error: "Email or password is incorrect.",
      });
      return;
    }

    await new Promise((resolve, reject) => {
      request.session.regenerate((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    request.session.userId = user.id;

    await new Promise((resolve, reject) => {
      request.session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    await databasePool.query(
      `INSERT INTO public.staff_activities (user_id, action_type)
       VALUES ($1, 'LOGIN')`,
      [user.id],
    );

    response.status(200).json({
      success: true,
      user: { id: user.id, name: user.name, role: user.role },
      redirectTo: user.role === "owner" ? "/owner/dashboard" : "/staff/quick-sale",
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireUser, (request, response) => {
  response.json({
    success: true,
    user: {
      id: request.authUser.id,
      name: request.authUser.name,
      role: request.authUser.role,
    },
  });
});

authRouter.post("/logout", (request, response, next) => {
  if (!request.session) {
    response.clearCookie("smartstock.sid");
    response.status(200).json({ success: true });
    return;
  }

  const userId = request.session.userId;
  request.session.destroy(async (error) => {
    if (error) {
      next(error);
      return;
    }

    try {
      if (userId) {
        await databasePool.query(
          `INSERT INTO public.staff_activities (user_id, action_type)
           VALUES ($1, 'LOGOUT')`,
          [userId],
        );
      }
    } catch (activityError) {
      next(activityError);
      return;
    }

    response.clearCookie("smartstock.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: config.production,
      path: "/",
    });
    response.status(200).json({ success: true });
  });
});

authRouter.get("/sections/:sectionId", requireUser, (request, response) => {
  const section = sectionForRole(request.params.sectionId, request.authUser.role);

  if (!section) {
    response.status(403).json({
      success: false,
      error: "You do not have access to this area.",
    });
    return;
  }

  response.json({
    success: true,
    section,
    message: "Phase 1 access control is active. Feature functionality is reserved for a later phase.",
  });
});

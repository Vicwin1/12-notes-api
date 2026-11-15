import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { JWT_SECRET } from "../config.js";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: { message: "Too many authentication attempts. Please try again later." },
    });
  },
});

const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(10)
    .regex(/[A-Za-z]/, "Password must contain at least one letter.")
    .regex(/[0-9]/, "Password must contain at least one number."),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function validateLogin(req, res, next) {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(401).json({
      error: { message: "Invalid email or password" },
    });
  }

  req.body = result.data;
  return next();
}

function createToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, {
    expiresIn: "1h",
    algorithm: "HS256",
  });
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    created_at: row.created_at,
  };
}

router.use(authRateLimit);

router.post("/register", validate(registerSchema), async (req, res) => {
  const { name, email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);

  let rows;
  try {
    rows = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES (${name}, ${email}, ${passwordHash})
      RETURNING id, name, email, created_at
    `;
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: { message: "An account with this email already exists." },
      });
    }
    throw error;
  }

  const user = publicUser(rows[0]);
  return res.status(201).json({ user, token: createToken(user.id) });
});

router.post("/login", validateLogin, async (req, res) => {
  const { email, password } = req.body;
  const rows = await sql`
    SELECT id, name, email, password_hash, created_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  const row = rows[0];
  const validPassword = row
    ? await bcrypt.compare(password, row.password_hash)
    : false;

  if (!row || !validPassword) {
    return res.status(401).json({
      error: { message: "Invalid email or password" },
    });
  }

  return res.json({
    token: createToken(row.id),
    user: publicUser(row),
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const rows = await sql`
    SELECT id, name, email, created_at
    FROM users
    WHERE id = ${req.user.id}
    LIMIT 1
  `;

  if (!rows[0]) {
    return res.status(404).json({ error: { message: "User not found." } });
  }

  return res.json({ user: publicUser(rows[0]) });
});

export default router;

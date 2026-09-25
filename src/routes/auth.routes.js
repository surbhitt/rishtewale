import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import pool from "../db/index.js";
import config from "../config/index.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";

const router = express.Router();

// Matches the frontend contract (suraj-vansh-legacy): { email, password } in, { token, user: { id, email } } out.
router.post("/signup", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: "A valid email address is required" });
    }

    if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const normalizedEmail = normalizeEmail(email);

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);

    if (existing.rows.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
        `INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email`,
        [normalizedEmail, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    res.status(201).json({ token, user: { id: user.id, email: user.email } });
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = normalizeEmail(email);

    const result = await pool.query(
        "SELECT id, email, password_hash FROM users WHERE email = $1",
        [normalizedEmail]
    );
    const user = result.rows[0];

    if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    res.json({ token, user: { id: user.id, email: user.email } });
});

export default router;

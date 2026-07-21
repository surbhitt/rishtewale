const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const client = require("../db");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/signup", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "A valid email is required" });
    }

    if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
        const existing = await client.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);

        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "An account with this email already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await client.query(
            `INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email`,
            [normalizedEmail, passwordHash]
        );

        const user = result.rows[0];
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.status(201).json({ token, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Signup failed" });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
        const result = await client.query(
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

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Login failed" });
    }
});

module.exports = router;

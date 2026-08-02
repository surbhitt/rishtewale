const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const client = require("../db");
const { PHONE_RE, normalizePhone } = require("../utils/phone");

const router = express.Router();

router.post("/signup", async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !PHONE_RE.test(normalizePhone(phone))) {
        return res.status(400).json({ error: "A valid 10-digit phone number is required" });
    }

    if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const normalizedPhone = normalizePhone(phone);

    try {
        const existing = await client.query("SELECT id FROM users WHERE phone = $1", [normalizedPhone]);

        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "An account with this phone number already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await client.query(
            `INSERT INTO users(phone, password_hash) VALUES($1, $2) RETURNING id, phone`,
            [normalizedPhone, passwordHash]
        );

        const user = result.rows[0];
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.status(201).json({ token, user: { id: user.id, phone: user.phone } });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Signup failed" });
    }
});

router.post("/login", async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ error: "Phone number and password are required" });
    }

    const normalizedPhone = normalizePhone(phone);

    try {
        const result = await client.query(
            "SELECT id, phone, password_hash FROM users WHERE phone = $1",
            [normalizedPhone]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: "Invalid phone number or password" });
        }

        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            return res.status(401).json({ error: "Invalid phone number or password" });
        }

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.json({ token, user: { id: user.id, phone: user.phone } });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Login failed" });
    }
});

module.exports = router;

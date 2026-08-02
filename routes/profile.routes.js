const express = require("express");

const client = require("../db");
const authenticateToken = require("../middleware/auth");
const { validateProfileFields } = require("../utils/profileFields");
const upsertProfile = require("../utils/upsertProfile");

const router = express.Router();

// Full submit: every required field (per registration_fields.pdf) must be present.
router.post("/", authenticateToken, async (req, res) => {
    const { errors, values } = validateProfileFields(req.body, { partial: false });

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    try {
        const profile = await upsertProfile(req.userId, values);
        res.status(201).json(profile);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to save profile" });
    }
});

// Partial save: only the fields sent are validated and written, e.g. saving one step of the
// multi-step registration form at a time. Creates the profile row on first call.
router.patch("/", authenticateToken, async (req, res) => {
    const { errors, values } = validateProfileFields(req.body, { partial: true });

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    if (Object.keys(values).length === 0) {
        return res.status(400).json({ error: "No fields provided to update" });
    }

    try {
        const profile = await upsertProfile(req.userId, values);
        res.json(profile);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to update profile" });
    }
});

router.get("/", authenticateToken, async (req, res) => {
    try {
        const result = await client.query(
            `
            SELECT profiles.*, users.phone, DATE_PART('year', AGE(profiles.date_of_birth)) AS age
            FROM profiles
            JOIN users ON users.id = profiles.user_id
            WHERE profiles.user_id = $1
            `,
            [req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Profile not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

module.exports = router;

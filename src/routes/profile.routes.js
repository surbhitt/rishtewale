import express from "express";

import pool from "../db/index.js";
import authenticateToken from "../middleware/auth.js";
import { validateProfileFields } from "../utils/profileFields.js";
import upsertProfile from "../utils/upsertProfile.js";

const router = express.Router();

// Full submit: every required field (per registration_fields.pdf) must be present.
router.post("/", authenticateToken, async (req, res) => {
    const { errors, values } = validateProfileFields(req.body, { partial: false });

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    const profile = await upsertProfile(req.userId, values);
    res.status(201).json(profile);
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

    const profile = await upsertProfile(req.userId, values);
    res.json(profile);
});

router.get("/", authenticateToken, async (req, res) => {
    const result = await pool.query(
        `
        SELECT
            profiles.*,
            users.email,
            users.phone,
            DATE_PART('year', AGE(profiles.date_of_birth)) AS age,
            EXISTS (
                SELECT 1 FROM payments
                WHERE payments.user_id = profiles.user_id AND payments.status = 'success'
            ) AS is_payment_completed
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
});

export default router;

const express = require("express");

const client = require("../db");
const authenticateToken = require("../middleware/auth");
const { validateProfileFields } = require("../utils/profileFields");

const router = express.Router();

// Upserts only the columns present in `values`. On first write for a user this creates the row
// (any column left out stays NULL / falls back to its DB default); on later writes it only
// touches the columns supplied, leaving the rest of the profile as-is.
async function upsertProfile(userId, values) {
    const columns = Object.keys(values);
    const params = columns.map((col) => values[col]);
    const insertColumns = ["user_id", ...columns];
    const placeholders = insertColumns.map((_, i) => `$${i + 1}`);
    const updateAssignments = columns.map((col) => `${col} = EXCLUDED.${col}`);

    const result = await client.query(
        `
        INSERT INTO profiles(${insertColumns.join(", ")})
        VALUES(${placeholders.join(", ")})
        ON CONFLICT (user_id) DO UPDATE SET
            ${updateAssignments.join(", ")},
            updated_at = now()
        RETURNING *
        `,
        [userId, ...params]
    );

    return result.rows[0];
}

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
            SELECT *, DATE_PART('year', AGE(date_of_birth)) AS age
            FROM profiles
            WHERE user_id = $1
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

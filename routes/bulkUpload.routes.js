const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const client = require("../db");
const upsertProfile = require("../utils/upsertProfile");
const { COLUMN_TO_FIELD, validateProfileFields } = require("../utils/profileFields");
const { PHONE_RE, normalizePhone } = require("../utils/phone");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Must match the example row baked into registration_template.xlsx - skipped so nobody
// accidentally creates an account for it by forgetting to delete the example row.
const PLACEHOLDER_PHONE = "9876543210";
const NUMERIC_KEYS = ["heightFeet", "heightInches", "numBrothers", "numSisters"];

// Column headers in the template look like "full_name *" (required) or "about_yourself" (optional).
function normalizeHeader(header) {
    return String(header).trim().replace(/\s*\*\s*$/, "");
}

// Turns one parsed spreadsheet row (keyed by raw header text) into the camelCase body shape
// validateProfileFields expects.
function rowToProfileBody(row) {
    const body = {};

    for (const [rawHeader, rawValue] of Object.entries(row)) {
        const column = normalizeHeader(rawHeader);
        const field = COLUMN_TO_FIELD[column];

        if (!field) {
            continue;
        }

        let value = typeof rawValue === "string" ? rawValue.trim() : rawValue;

        if (field.isArray) {
            value = value ? String(value).split(";").map((v) => v.trim()).filter(Boolean) : [];
        } else if (NUMERIC_KEYS.includes(field.key) && typeof value === "string" && value !== "") {
            const parsed = Number(value);
            value = Number.isFinite(parsed) ? parsed : value;
        }

        body[field.key] = value === "" ? undefined : value;
    }

    return body;
}

function extractPhone(row) {
    const phoneHeader = Object.keys(row).find((header) => normalizeHeader(header) === "phone");
    return phoneHeader ? normalizePhone(row[phoneHeader]) : "";
}

// Bulk-imports a filled-in copy of registration_template.xlsx (or an equivalent CSV). Rows are
// matched to an account by phone number; if no account exists yet one is created with a random
// password, which is returned once in the response since there is no other way yet to deliver
// it to that person.
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    let rows;
    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    } catch (error) {
        console.log(error);
        return res.status(400).json({ error: "Could not read the uploaded file" });
    }

    const accountsCreated = [];
    const profilesSaved = [];
    const rowErrors = [];

    for (let i = 0; i < rows.length; i++) {
        const rowNumber = i + 2; // header is row 1
        const row = rows[i];
        const phone = extractPhone(row);

        if (!phone) {
            continue; // blank row
        }

        if (phone === PLACEHOLDER_PHONE) {
            rowErrors.push({ row: rowNumber, phone, errors: ["Skipped the example row - delete it before uploading"] });
            continue;
        }

        if (!PHONE_RE.test(phone)) {
            rowErrors.push({ row: rowNumber, phone, errors: ["Invalid phone number"] });
            continue;
        }

        try {
            const existing = await client.query("SELECT id FROM users WHERE phone = $1", [phone]);
            let userId;

            if (existing.rows.length > 0) {
                userId = existing.rows[0].id;
            } else {
                const temporaryPassword = crypto.randomBytes(9).toString("base64url");
                const passwordHash = await bcrypt.hash(temporaryPassword, 10);
                const created = await client.query(
                    "INSERT INTO users(phone, password_hash) VALUES($1, $2) RETURNING id",
                    [phone, passwordHash]
                );
                userId = created.rows[0].id;
                accountsCreated.push({ phone, temporaryPassword });
            }

            const body = rowToProfileBody(row);
            const { errors, values } = validateProfileFields(body, { partial: false });

            if (errors.length > 0) {
                rowErrors.push({ row: rowNumber, phone, errors });
                continue;
            }

            await upsertProfile(userId, values);
            profilesSaved.push(phone);
        } catch (error) {
            console.log(error);
            rowErrors.push({ row: rowNumber, phone, errors: ["Unexpected server error while saving this row"] });
        }
    }

    res.json({ accountsCreated, profilesSaved, rowErrors });
});

module.exports = router;

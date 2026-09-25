import { Readable } from "node:stream";

import express from "express";
import multer from "multer";
import csv from "csv-parser";

import pool from "../db/index.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

async function writeToDb(rows) {
    for (const row of rows) {
        await pool.query(
            `
            INSERT INTO rishtas(name, age, gender, phone, email)
            VALUES($1, $2, $3, $4, $5)
            `,
            [row.name, Number(row.age), row.gender, row.phone, row.email]
        );
    }
}

// Legacy CSV import into the `rishtas` table (name,age,gender,phone,email).
router.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const rows = [];

    Readable.from(req.file.buffer)
        .pipe(csv())
        .on("data", (row) => {
            rows.push(row);
        })
        .on("end", async () => {
            try {
                await writeToDb(rows);
                res.send("data written to the table");
            } catch (error) {
                console.error(error);
                res.status(500).send("data write FAILED");
            }
        })
        .on("error", (err) => {
            console.error(err);
            res.status(500).send("CSV parsing failed");
        });
});

export default router;

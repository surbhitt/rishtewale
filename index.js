const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const { Readable } = require("stream");

require("dotenv").config();

const { Client } = require("pg");

const client = new Client({
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const upload = multer({
    storage: multer.memoryStorage()
});

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/", (req, res) => {
    res.send("access /api/upload");
});


async function write_to_db(rows) {
    try {
        for (const row of rows) {
            await client.query(
                `
                INSERT INTO rishtas(name, age, gender, phone, email)
                VALUES($1, $2, $3, $4, $5)
                `,
                [
                    row.name,
                    Number(row.age),
                    row.gender,
                    row.phone,
                    row.email
                ]
            );
        }

        return true;

    } catch (error) {
        console.log(error);
        return false;
    }
}


app.post("/api/upload", upload.single("file"), async (req, res) => {
    const rows = [];

    Readable.from(req.file.buffer)
        .pipe(csv())
        .on("data", (row) => {
            rows.push(row);
        })
        .on("end", async () => {
            console.log(rows);

            const written = await write_to_db(rows);

            if (written) {
                res.send("data written to the table");
            } else {
                res.status(500).send("data write FAILED");
            }
        })
        .on("error", (err) => {
            console.log(err);
            res.status(500).send("CSV parsing failed");
        });
});


async function initialization() {
    await client.connect();

    await client.query(`
        CREATE TABLE IF NOT EXISTS rishtas(
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER NOT NULL,
            gender CHAR(1) NOT NULL CHECK (gender IN ('M', 'F')),
            phone TEXT,
            email TEXT
        )
    `);

//     const rows = await client.query(`
//         SELECT * FROM rishtas`)
//     console.log(rows)

    console.log("INITIALIZATION COMPLETED");
}


async function main() {
    try {
        await initialization();
        
        app.listen(PORT, () => {
            console.log("Started server");
        });

    } catch (err) {
        console.log("FAILED to start server:", err);
        process.exit(1);
    }
}

main();

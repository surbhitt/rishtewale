const express = require("express");
const cors = require("cors");
const multer = require("multer");
const csv = require("csv-parser");
const { Readable } = require("stream");

require("dotenv").config();

const client = require("./db");
const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");

const upload = multer({
    storage: multer.memoryStorage()
});

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("access /api/upload");
});

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);


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

    await client.query(`
        CREATE TABLE IF NOT EXISTS users(
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    await client.query(`
        CREATE TABLE IF NOT EXISTS profiles(
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

            -- Step 1: Personal Details
            -- Domain fields are nullable so a step of the form can be saved on its own via
            -- PATCH /api/profile; "required" is enforced in the app layer, only on full submit
            -- (POST /api/profile) - see utils/profileFields.js.
            full_name TEXT,
            date_of_birth DATE,
            gender TEXT CHECK (gender IN ('male', 'female', 'prefer_not_to_say')),
            place_of_birth TEXT,
            current_city TEXT,
            current_state TEXT,
            height_feet SMALLINT,
            height_inches SMALLINT,
            marital_status TEXT CHECK (marital_status IN ('never_married', 'divorced', 'widowed', 'separated')),
            about_yourself TEXT,

            -- Step 2: Religion & Community
            caste TEXT,
            sub_caste TEXT,
            gotra TEXT,
            mother_gotra TEXT,
            maternal_grandmother_gotra TEXT,
            manglik_status TEXT CHECK (manglik_status IN ('manglik', 'non_manglik', 'partial_manglik', 'dont_know')),
            diet TEXT CHECK (diet IN ('vegetarian', 'non_vegetarian', 'eggetarian', 'jain')),

            -- Step 3: Education & Profession
            highest_qualification TEXT,
            field_of_study TEXT,
            additional_qualifications TEXT,
            employment_type TEXT CHECK (employment_type IN ('salaried', 'self_employed', 'business_owner', 'not_working')),
            job_title TEXT,
            industry TEXT,
            annual_income TEXT CHECK (annual_income IN ('10L-25L', '25L-50L', '50L-1Cr', '1Cr-5Cr', '5Cr+')),
            residential_status TEXT CHECK (residential_status IN ('based_in_india', 'nri', 'looking_to_return')),

            -- Step 4: Family Background
            father_name TEXT,
            father_occupation TEXT,
            father_status TEXT CHECK (father_status IN ('employed', 'retired', 'business', 'deceased')),
            mother_name TEXT,
            mother_occupation TEXT,
            num_brothers SMALLINT DEFAULT 0,
            num_sisters SMALLINT DEFAULT 0,
            siblings_marital_status TEXT,
            family_type TEXT CHECK (family_type IN ('joint', 'nuclear')),
            about_family TEXT,
            own_property TEXT,

            -- Step 5: Partner Preferences & Contact
            preferred_cities TEXT[],
            preferred_education TEXT,
            other_preferences TEXT,
            contact_number TEXT,

            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    // Migration safety net: relax constraints for a `profiles` table created before partial
    // (PATCH) saves were supported, where these columns were still NOT NULL.
    await client.query(`
        ALTER TABLE profiles
            ALTER COLUMN full_name DROP NOT NULL,
            ALTER COLUMN date_of_birth DROP NOT NULL,
            ALTER COLUMN gender DROP NOT NULL,
            ALTER COLUMN place_of_birth DROP NOT NULL,
            ALTER COLUMN current_city DROP NOT NULL,
            ALTER COLUMN current_state DROP NOT NULL,
            ALTER COLUMN height_feet DROP NOT NULL,
            ALTER COLUMN height_inches DROP NOT NULL,
            ALTER COLUMN marital_status DROP NOT NULL,
            ALTER COLUMN caste DROP NOT NULL,
            ALTER COLUMN diet DROP NOT NULL,
            ALTER COLUMN highest_qualification DROP NOT NULL,
            ALTER COLUMN field_of_study DROP NOT NULL,
            ALTER COLUMN employment_type DROP NOT NULL,
            ALTER COLUMN job_title DROP NOT NULL,
            ALTER COLUMN industry DROP NOT NULL,
            ALTER COLUMN annual_income DROP NOT NULL,
            ALTER COLUMN residential_status DROP NOT NULL,
            ALTER COLUMN father_name DROP NOT NULL,
            ALTER COLUMN father_occupation DROP NOT NULL,
            ALTER COLUMN father_status DROP NOT NULL,
            ALTER COLUMN mother_name DROP NOT NULL,
            ALTER COLUMN mother_occupation DROP NOT NULL,
            ALTER COLUMN num_brothers DROP NOT NULL,
            ALTER COLUMN num_sisters DROP NOT NULL,
            ALTER COLUMN family_type DROP NOT NULL,
            ALTER COLUMN contact_number DROP NOT NULL
    `);

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

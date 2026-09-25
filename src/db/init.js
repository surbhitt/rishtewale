import pool from "./index.js";

// Idempotent schema setup. Runs on every boot: CREATE TABLE IF NOT EXISTS statements plus a few
// small migrations, so an empty database sets itself up on first boot.
export default async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rishtas(
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER NOT NULL,
            gender CHAR(1) NOT NULL CHECK (gender IN ('M', 'F')),
            phone TEXT,
            email TEXT
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users(
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE,
            phone TEXT,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    // Migration safety net for databases created before email-based login:
    //  - add the email column if missing (nullable + unique, so email-only web accounts work and
    //    older phone-only accounts created by bulk-upload remain valid),
    //  - relax the old NOT NULL / UNIQUE constraints on phone (bulk-upload still writes phone, but
    //    it is no longer the login identifier).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key'
            ) THEN
                ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
            END IF;
        END $$;
    `);
    await pool.query(`ALTER TABLE users ALTER COLUMN phone DROP NOT NULL`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS profiles(
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

            -- Step 1: Personal Details
            -- Domain fields are nullable so a step of the form can be saved on its own via
            -- PATCH /api/profile; "required" is enforced in the app layer, only on full submit
            -- (POST /api/profile) - see utils/profileFields.js.
            full_name TEXT,
            date_of_birth DATE,
            time_of_birth TIME,
            gender TEXT CHECK (gender IN ('male', 'female', 'prefer_not_to_say')),
            place_of_birth TEXT,
            current_city TEXT,
            height_feet SMALLINT,
            height_inches SMALLINT,
            marital_status TEXT CHECK (marital_status IN ('never_married', 'divorced', 'widowed', 'separated')),
            about_yourself TEXT,

            -- Step 2: Religion & Community
            caste TEXT,
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

            -- Step 5: Partner Preferences
            -- Contact number lives on users.phone (also the login identifier), not duplicated here.
            preferred_cities TEXT[],
            preferred_education TEXT,
            other_preferences TEXT,

            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    // Migration safety net: relax constraints for a `profiles` table created before partial
    // (PATCH) saves were supported, where these columns were still NOT NULL.
    await pool.query(`
        ALTER TABLE profiles
            ALTER COLUMN full_name DROP NOT NULL,
            ALTER COLUMN date_of_birth DROP NOT NULL,
            ALTER COLUMN gender DROP NOT NULL,
            ALTER COLUMN place_of_birth DROP NOT NULL,
            ALTER COLUMN current_city DROP NOT NULL,
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
            ALTER COLUMN family_type DROP NOT NULL
    `);

    // Migration safety net: drop fields removed from the form and add fields introduced later,
    // for a `profiles` table created before this shape existed.
    await pool.query(`
        ALTER TABLE profiles
            DROP COLUMN IF EXISTS current_state,
            DROP COLUMN IF EXISTS sub_caste,
            DROP COLUMN IF EXISTS gotra,
            DROP COLUMN IF EXISTS contact_number,
            ADD COLUMN IF NOT EXISTS time_of_birth TIME
    `);

    // Payments: one row per PayU transaction attempt. `txnid` is our own generated id sent to
    // PayU and used to correlate the callback / verification. Status is the source of truth only
    // after server-side verification, never trusted from the client.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS payments(
            id SERIAL PRIMARY KEY,
            txnid TEXT UNIQUE NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            amount NUMERIC(12, 2) NOT NULL,
            productinfo TEXT NOT NULL,
            firstname TEXT,
            email TEXT,
            phone TEXT,
            status TEXT NOT NULL DEFAULT 'initiated'
                CHECK (status IN ('initiated', 'pending', 'success', 'failure')),
            payu_mihpayid TEXT,
            payu_mode TEXT,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id)`);

    console.log("INITIALIZATION COMPLETED");
}

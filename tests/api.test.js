// Integration tests that hit a running server over HTTP - same thing you'd do with curl, just
// scripted and repeatable. They do NOT mock the database: every run writes real throwaway users
// and profiles through whatever DB_URL the server under test is using.
//
// Requirements:
//   - Node 18+ (uses the built-in test runner, plus global fetch/FormData/Blob)
//   - The server already running (npm start, or `node index.js`)
//   - `xlsx` installed (npm install) - used here to build a real .xlsx buffer for the bulk-upload test
//
// Run with:              npm test
// Point at another host: TEST_BASE_URL=https://rishtewale-eiee.onrender.com npm test
//
// IMPORTANT: run this against a local/dev server, not production - it does not clean up after
// itself, so every run leaves behind a handful of test accounts and profiles.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const PASSWORD = "testpass123";

function randomPhone() {
    const prefix = String(6 + Math.floor(Math.random() * 4)); // 6-9
    const rest = String(Date.now() + Math.floor(Math.random() * 1000)).slice(-9);
    return prefix + rest;
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let parsed;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    } catch {
        parsed = text;
    }
    return { status: res.status, body: parsed };
}

// Mirrors how Postgres's DATE_PART('year', AGE(...)) computes age, so the assertion matches the
// server's own logic instead of hard-coding an age that will silently drift with the calendar.
function expectedAge(dobIso) {
    const dob = new Date(`${dobIso}T00:00:00Z`);
    const now = new Date();
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const hasHadBirthdayThisYear =
        now.getUTCMonth() > dob.getUTCMonth() ||
        (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
    if (!hasHadBirthdayThisYear) {
        age -= 1;
    }
    return age;
}

function toSnakeCase(camelObj) {
    const out = {};
    for (const [key, value] of Object.entries(camelObj)) {
        out[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] = value;
    }
    return out;
}

function xlsxBufferFromRows(rows) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Registration Data");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const FULL_PROFILE = {
    fullName: "Test User",
    dateOfBirth: "1998-04-12",
    timeOfBirth: "14:30",
    gender: "female",
    placeOfBirth: "Jaipur, Rajasthan",
    currentCity: "Mumbai",
    heightFeet: 5,
    heightInches: 4,
    maritalStatus: "never_married",
    caste: "Agarwal",
    diet: "vegetarian",
    highestQualification: "Post graduate",
    fieldOfStudy: "MBA Finance",
    employmentType: "salaried",
    jobTitle: "Senior Analyst",
    industry: "Banking",
    annualIncome: "10L-25L",
    residentialStatus: "based_in_india",
    fatherName: "John Doe",
    fatherOccupation: "Business",
    fatherStatus: "business",
    motherName: "Mary Doe",
    motherOccupation: "Homemaker",
    numBrothers: 1,
    numSisters: 0,
    familyType: "nuclear"
};

before(async () => {
    try {
        await fetch(BASE_URL);
    } catch {
        throw new Error(
            `Could not reach ${BASE_URL} - start the server first (npm start / node index.js), ` +
            `or set TEST_BASE_URL to point at one that's already running.`
        );
    }
});

describe("auth", () => {
    const phone = randomPhone();

    it("signs up with a new phone number", async () => {
        const { status, body } = await api("/api/auth/signup", { method: "POST", body: { phone, password: PASSWORD } });
        assert.equal(status, 201);
        assert.ok(body.token);
        assert.equal(body.user.phone, phone);
    });

    it("rejects a duplicate signup", async () => {
        const { status, body } = await api("/api/auth/signup", { method: "POST", body: { phone, password: PASSWORD } });
        assert.equal(status, 409);
        assert.match(body.error, /already exists/);
    });

    it("rejects a password shorter than 8 characters", async () => {
        const { status } = await api("/api/auth/signup", { method: "POST", body: { phone: randomPhone(), password: "short" } });
        assert.equal(status, 400);
    });

    it("rejects a malformed phone number", async () => {
        const { status } = await api("/api/auth/signup", { method: "POST", body: { phone: "12345", password: PASSWORD } });
        assert.equal(status, 400);
    });

    it("logs in with correct credentials", async () => {
        const { status, body } = await api("/api/auth/login", { method: "POST", body: { phone, password: PASSWORD } });
        assert.equal(status, 200);
        assert.ok(body.token);
    });

    it("rejects login with the wrong password", async () => {
        const { status } = await api("/api/auth/login", { method: "POST", body: { phone, password: "wrongpassword" } });
        assert.equal(status, 401);
    });
});

describe("profile", () => {
    const phone = randomPhone();
    let token;

    before(async () => {
        const { body } = await api("/api/auth/signup", { method: "POST", body: { phone, password: PASSWORD } });
        token = body.token;
    });

    function authed(path, options = {}) {
        return api(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    }

    it("rejects requests with no token", async () => {
        const { status } = await api("/api/profile");
        assert.equal(status, 401);
    });

    it("rejects requests with a garbage token", async () => {
        const { status } = await api("/api/profile", { headers: { Authorization: "Bearer garbage.token.value" } });
        assert.equal(status, 403);
    });

    it("404s before any profile has been saved", async () => {
        const { status } = await authed("/api/profile");
        assert.equal(status, 404);
    });

    it("PATCH creates a profile from a partial payload, leaving the rest unset", async () => {
        const { status, body } = await authed("/api/profile", {
            method: "PATCH",
            body: { fullName: "Partial User", currentCity: "Mumbai" }
        });
        assert.equal(status, 200);
        assert.equal(body.full_name, "Partial User");
        assert.equal(body.current_city, "Mumbai");
        assert.equal(body.caste, null);
    });

    it("PATCH only touches the fields it's given, preserving earlier ones", async () => {
        const { status, body } = await authed("/api/profile", { method: "PATCH", body: { caste: "Agarwal" } });
        assert.equal(status, 200);
        assert.equal(body.caste, "Agarwal");
        assert.equal(body.full_name, "Partial User"); // untouched by this PATCH
    });

    it("PATCH rejects an invalid enum value", async () => {
        const { status, body } = await authed("/api/profile", { method: "PATCH", body: { diet: "pescatarian" } });
        assert.equal(status, 400);
        assert.ok(body.errors.some((e) => e.includes("diet")));
    });

    it("PATCH rejects an empty body", async () => {
        const { status } = await authed("/api/profile", { method: "PATCH", body: {} });
        assert.equal(status, 400);
    });

    it("POST (full submit) rejects an incomplete payload and lists what's missing", async () => {
        const { status, body } = await authed("/api/profile", { method: "POST", body: { fullName: "Test User" } });
        assert.equal(status, 400);
        assert.ok(body.errors.includes("dateOfBirth is required"));
    });

    it("POST (full submit) accepts a complete payload and returns a computed age", async () => {
        const { status, body } = await authed("/api/profile", { method: "POST", body: FULL_PROFILE });
        assert.equal(status, 201);
        assert.equal(body.full_name, FULL_PROFILE.fullName);
        assert.equal(body.date_of_birth, FULL_PROFILE.dateOfBirth); // regression check for the DATE timezone-shift bug
        assert.equal(body.age, expectedAge(FULL_PROFILE.dateOfBirth));
    });

    it("GET returns the saved profile with the account phone and age", async () => {
        const { status, body } = await authed("/api/profile");
        assert.equal(status, 200);
        assert.equal(body.phone, phone);
        assert.equal(body.age, expectedAge(FULL_PROFILE.dateOfBirth));
    });
});

describe("bulk upload", () => {
    it("creates an account, saves the profile, and returns a temporary password", async () => {
        const phone = randomPhone();
        const buffer = xlsxBufferFromRows([{ phone, ...toSnakeCase(FULL_PROFILE) }]);

        const form = new FormData();
        form.append("file", new Blob([buffer]), "bulk-test.xlsx");
        const res = await fetch(`${BASE_URL}/api/profile/bulk-upload`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(body.rowErrors, []);
        assert.deepEqual(body.profilesSaved, [phone]);
        assert.equal(body.accountsCreated.length, 1);
        assert.equal(body.accountsCreated[0].phone, phone);
        assert.ok(body.accountsCreated[0].temporaryPassword);
    });

    it("does not create a second account when the phone already has one", async () => {
        const phone = randomPhone();
        const buffer = xlsxBufferFromRows([{ phone, ...toSnakeCase(FULL_PROFILE) }]);
        const form1 = new FormData();
        form1.append("file", new Blob([buffer]), "first.xlsx");
        await fetch(`${BASE_URL}/api/profile/bulk-upload`, { method: "POST", body: form1 });

        const form2 = new FormData();
        form2.append("file", new Blob([buffer]), "second.xlsx");
        const res = await fetch(`${BASE_URL}/api/profile/bulk-upload`, { method: "POST", body: form2 });
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(body.accountsCreated, []); // already existed after the first upload
        assert.deepEqual(body.profilesSaved, [phone]);
    });

    it("skips the placeholder example row instead of creating an account for it", async () => {
        const buffer = xlsxBufferFromRows([{ phone: "9876543210", ...toSnakeCase(FULL_PROFILE) }]);
        const form = new FormData();
        form.append("file", new Blob([buffer]), "placeholder.xlsx");
        const res = await fetch(`${BASE_URL}/api/profile/bulk-upload`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(body.accountsCreated, []);
        assert.equal(body.rowErrors.length, 1);
        assert.match(body.rowErrors[0].errors[0], /example row/);
    });

    it("reports validation errors per row without saving that row", async () => {
        const phone = randomPhone();
        const row = { phone, ...toSnakeCase(FULL_PROFILE), diet: "pescatarian" };
        const buffer = xlsxBufferFromRows([row]);
        const form = new FormData();
        form.append("file", new Blob([buffer]), "invalid.xlsx");
        const res = await fetch(`${BASE_URL}/api/profile/bulk-upload`, { method: "POST", body: form });
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(body.profilesSaved, []);
        assert.equal(body.rowErrors.length, 1);
        assert.equal(body.rowErrors[0].phone, phone);
    });
});

describe("legacy CSV upload (/api/upload)", () => {
    it("still accepts the original rishtas CSV format", async () => {
        const fileBuffer = fs.readFileSync(path.join(__dirname, "..", "test.csv"));
        const form = new FormData();
        form.append("file", new Blob([fileBuffer]), "test.csv");
        const res = await fetch(`${BASE_URL}/api/upload`, { method: "POST", body: form });
        assert.equal(res.status, 200);
    });
});

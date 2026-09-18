# Rishtewale

Backend API for a matrimonial-profile app: phone-number accounts, a multi-step registration
profile that can be saved one step at a time, and bulk import of profiles from a spreadsheet.

Live deployment: https://rishtewale-eiee.onrender.com

## Stack

| Piece | What is used |
|---|---|
| Runtime / framework | Node.js 18+, Express 5 |
| **Database** | **PostgreSQL on [Neon](https://neon.com)** (serverless Postgres, free plan), via the `pg` driver and a connection pool ([db.js](db.js)) |
| Auth | Phone + password, bcrypt-hashed (`bcryptjs`); sessions are JWTs valid for 7 days (`jsonwebtoken`) |
| Uploads | `multer` (in memory), `csv-parser`, `xlsx` |
| Hosting | Render web service (the database is *not* on Render) |

## Database

- **Provider:** Neon, project region `aws-ap-southeast-1` (Singapore), Postgres 18, database `neondb`.
  The project is linked to this folder with `neon link` (stored in `.neon`, which is gitignored);
  [neon.ts](neon.ts) holds the (currently empty) Neon config.
- **Schema is created by the app.** On every start, `index.js` runs idempotent
  `CREATE TABLE IF NOT EXISTS` statements (plus a few small migrations), so an empty database
  sets itself up on first boot - there is no separate migration step.

  | Table | Purpose |
  |---|---|
  | `users` | One row per account: `id`, `phone` (unique), `password_hash`, `created_at` |
  | `profiles` | One row per user (`user_id` is unique, foreign key to `users`, `ON DELETE CASCADE`). Every profile field is a nullable column so a step of the form can be saved on its own. |
  | `rishtas` | Legacy table filled by `POST /api/upload`: `name`, `age`, `gender` (`M`/`F`), `phone`, `email` |

- `age` is never stored. It is computed from `date_of_birth` on every read, and returned by
  POST, PATCH and GET on `/api/profile`. Dates come back as plain `YYYY-MM-DD` strings (a custom
  type parser in `db.js` avoids a timezone shift).
- **Connection handling:** a `pg` `Pool` (max 5 connections) with SSL. A pool is used on purpose:
  Neon suspends idle compute and drops connections, and a single long-lived client would not recover.
- **Neon free plan - what to expect:**
  - Compute suspends after 5 minutes without queries. The first request after that is about a
    second slower (measured: ~1.3 s, then ~0.2 s); nothing is lost.
  - 0.5 GB of storage per project, and 100 compute-hours per month. Hitting a limit blocks writes or
    suspends compute; it does not delete data.
  - Point-in-time restore only reaches back 6 hours. **Once the data matters, keep your own
    backups** (e.g. a scheduled `pg_dump`).
- The database used to be a free Render Postgres instance, which expires after 30 days and is then
  deleted - hence the move to Neon.

## Configuration

Environment variables (a local `.env` is loaded by `dotenv`; `.env` is gitignored):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | one of the two | Neon connection string. Written to `.env` by `neon link`. Checked first. |
| `DB_URL` | one of the two | Fallback name, used if `DATABASE_URL` is unset. This is the name set on Render. |
| `JWT_SECRET` | yes | Secret used to sign and verify login tokens. |

Get the connection string with `neon connection-string` (or Neon Console -> project -> **Connect**).
Use the pooled endpoint (host contains `-pooler`). On Render, set it under the web service's
**Environment** tab; saving redeploys the service. Treat it like a password.

## Running locally

```
$ npm install
$ node index.js        # listens on port 3000; there is no `start` script
```

You should see `INITIALIZATION COMPLETED` and `Started server`.

## API

Base URL: `https://rishtewale-eiee.onrender.com` (or `http://localhost:3000`). JSON in, JSON out,
except the file-upload routes (multipart form field `file`).

| Method | Path | Auth | Purpose | Success | Errors |
|---|---|---|---|---|---|
| GET | `/` | - | Liveness text | 200 | - |
| POST | `/api/auth/signup` | - | Create an account | 201 `{token, user}` | 400 bad phone / password under 8 chars, 409 phone already registered |
| POST | `/api/auth/login` | - | Log in | 200 `{token, user}` | 400 missing field, 401 wrong phone or password |
| POST | `/api/profile` | Bearer | Full submit: all required fields must be present | 201 profile | 400 `{errors: [...]}` |
| PATCH | `/api/profile` | Bearer | Partial save: only the fields sent are validated and written | 200 profile | 400 invalid value or empty body |
| GET | `/api/profile` | Bearer | Your profile, plus your phone and computed `age` | 200 profile | 404 nothing saved yet |
| POST | `/api/profile/bulk-upload` | - | Import a filled `.xlsx`/`.csv` (see below) | 200 `{accountsCreated, profilesSaved, rowErrors}` | 400 no file / unreadable file |
| POST | `/api/upload` | - | Legacy CSV import into `rishtas` (`name,age,gender,phone,email`) | 200 `data written to the table` | 500 write / parse failure |

Rules:
- **Phone:** 10-digit Indian mobile starting 6-9. A `+91`/`91` prefix, spaces and dashes are stripped
  automatically, so `+91 98765-43210` and `9876543210` are the same account.
- **Password:** at least 8 characters.
- **Token:** send `Authorization: Bearer <token>` on the profile routes. A missing token is 401;
  an invalid or expired one is 403.
- The two upload routes that say `-` under Auth **have no authentication** - see
  [Known limitations](#known-limitations).

### Auth

```
$ BASE=https://rishtewale-eiee.onrender.com

$ curl -X POST $BASE/api/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"phone":"9876543210","password":"at-least-8-chars"}'

$ curl -X POST $BASE/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"phone":"9876543210","password":"at-least-8-chars"}'
```

Both return `{ token, user }`.

### Registration profile

Create or update your profile (an upsert keyed on the logged-in user). Enum values and the full
field list are in [utils/profileFields.js](utils/profileFields.js) (mirrors
`registration_fields.pdf`, minus photo uploads; the contact number lives on the account rather than
as a profile field). Every field is required on a full submit except: `aboutYourself`,
`motherGotra`, `maternalGrandmotherGotra`, `manglikStatus`, `additionalQualifications`,
`siblingsMaritalStatus`, `aboutFamily`, `ownProperty`, `preferredCities`, `preferredEducation`,
`otherPreferences`.

```
$ curl -X POST $BASE/api/profile \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{
      "fullName": "Jane Doe",
      "dateOfBirth": "1998-04-12",
      "timeOfBirth": "14:30",
      "gender": "female",
      "placeOfBirth": "Jaipur, Rajasthan",
      "currentCity": "Mumbai",
      "heightFeet": 5,
      "heightInches": 4,
      "maritalStatus": "never_married",
      "caste": "Agarwal",
      "diet": "vegetarian",
      "highestQualification": "Post graduate",
      "fieldOfStudy": "MBA Finance",
      "employmentType": "salaried",
      "jobTitle": "Senior Analyst",
      "industry": "Banking",
      "annualIncome": "10L-25L",
      "residentialStatus": "based_in_india",
      "fatherName": "John Doe",
      "fatherOccupation": "Business",
      "fatherStatus": "business",
      "motherName": "Mary Doe",
      "motherOccupation": "Homemaker",
      "numBrothers": 1,
      "numSisters": 0,
      "familyType": "nuclear"
    }'
```

Fetch your profile:

```
$ curl $BASE/api/profile -H "Authorization: Bearer <token>"
```

Partial update (e.g. saving one step of the form at a time) - send only the fields you have;
nothing else is touched or required. The first call creates the profile, later calls update it:

```
$ curl -X PATCH $BASE/api/profile \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{"fullName": "Jane Doe", "currentCity": "Mumbai"}'

$ curl -X PATCH $BASE/api/profile \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{"caste": "Agarwal", "diet": "vegetarian"}'
```

### Bulk upload (registration_template.xlsx)

`registration_template.xlsx` in the project root is a fillable spreadsheet matching the profile
fields, meant to be handed to someone to fill in offline and sent back. It has two sheets:
"Registration Data" (the columns to fill; required fields are marked with `*`) and "Field Guide"
(description and allowed values for each column).

Upload the filled sheet (`.xlsx` or `.csv`, same column headers). No login is needed - this is an
admin/operator action:

```
$ curl -F "file=@registration_template.xlsx" $BASE/api/profile/bulk-upload
```

Each row is matched to an account by its `phone` column. If no account exists for that number, one
is created with a randomly generated password, returned **once** in the response so it can be
handed to that person. Rows are treated as a full submit, so every required field must be filled
in per row. The example row in the template (phone `9876543210`) is skipped automatically if it is
left in. Response shape:

```json
{
  "accountsCreated": [{ "phone": "9876543210", "temporaryPassword": "..." }],
  "profilesSaved": ["9876543210"],
  "rowErrors": [{ "row": 5, "phone": "9123456780", "errors": ["diet is required"] }]
}
```

### Legacy CSV upload

Writes rows straight into the `rishtas` table; columns other than
`name,age,gender,phone,email` are ignored, and `gender` must be `M` or `F`:

```
$ curl -F "file=@test.csv" $BASE/api/upload
```

## Tests

`tests/api.test.js` is an integration suite: Node's built-in test runner (`node:test`), **no
mocking**. It sends real HTTP requests to a running server, which in turn uses the real database.
21 tests in four groups:

| Group | Tests | Covers |
|---|---|---|
| auth | 6 | signup, duplicate signup, short password, malformed phone, login, wrong password |
| profile | 10 | missing / garbage token, 404 before saving, PATCH create / preserve / bad enum / empty body, POST incomplete / complete (with computed age), GET |
| bulk upload | 4 | account + profile creation with temporary password, no duplicate account, placeholder row skipped, per-row validation errors |
| legacy CSV upload | 1 | original `rishtas` CSV format |

Run it (needs Node 18+; start the server first):

```
$ node index.js            # terminal 1
$ npm test                 # terminal 2 - targets http://localhost:3000
```

Point it at another host with `TEST_BASE_URL`, for example the deployed service:

```
$ TEST_BASE_URL=https://rishtewale-eiee.onrender.com npm test
```

**Test data is not cleaned up.** Every run leaves a handful of throwaway users and profiles in
whichever database the server under test uses - which is the live Neon database unless you point
`DATABASE_URL` elsewhere. For a clean run, point a local server at a separate Neon branch or
database. On a *disposable* database only, this wipes everything:

```sql
TRUNCATE users, profiles, rishtas RESTART IDENTITY CASCADE;
```

## Known limitations

- `POST /api/profile/bulk-upload` and `POST /api/upload` are unauthenticated. Anyone who knows the
  URL can call them; the bulk route creates accounts (returning their temporary passwords) and
  overwrites the profile of any phone number in the file. Add protection before real use.
- Phone numbers that themselves begin with `91` (e.g. `9123456780`) are rejected as invalid: a
  leading `91` is always treated as the country code and stripped, leaving 8 digits. Only numbers
  with an explicit prefix (`+919123456780`, `919123456780`) work. The fix is in
  [utils/phone.js](utils/phone.js) (strip `91` only when exactly 10 digits follow). The test suite
  generates random phone numbers, so it can occasionally hit this and fail at signup.
- The server port is fixed at 3000 and there is no `start` script; run it with `node index.js`.
- Backups are not automated (see the Neon free-plan notes above).

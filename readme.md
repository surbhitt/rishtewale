
*curl command to write data to table*

$ curl -F "file=@test.csv" https://rishtewale-eiee.onrender.com/api/upload

## Tests

`tests/api.test.js` is an integration suite (Node's built-in test runner, no mocking) that hits a
running server over HTTP and exercises every endpoint below. Start the server first, then:

$ npm test

By default it targets `http://localhost:3000`; point it elsewhere with `TEST_BASE_URL`:

$ TEST_BASE_URL=https://rishtewale-eiee.onrender.com npm test

It writes real throwaway users/profiles through whatever `DB_URL` the server is using and doesn't
clean up after itself - run it against a local/dev database, not production. Requires Node 18+.

## Auth

Accounts are identified by phone number (10-digit Indian mobile, `+91` prefix optional - it's
stripped automatically).

Signup:
$ curl -X POST https://rishtewale-eiee.onrender.com/api/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"phone":"9876543210","password":"at-least-8-chars"}'

Login:
$ curl -X POST https://rishtewale-eiee.onrender.com/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"phone":"9876543210","password":"at-least-8-chars"}'

Both return `{ token, user }`. Send the token as `Authorization: Bearer <token>` on the profile routes below.

## Registration profile

Create/update your profile (upsert, keyed on the logged-in user). See `utils/profileFields.js` for the
full field list, enum values, and which fields are required (mirrors `registration_fields.pdf`, minus
photo uploads; contact number lives on the account/phone rather than as a separate profile field).

$ curl -X POST https://rishtewale-eiee.onrender.com/api/profile \
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

`age` is never sent by the client - it's computed from `dateOfBirth` and included in the response
of POST, PATCH, and GET alike.

Fetch your profile (includes your account phone number and the auto-computed `age`):
$ curl https://rishtewale-eiee.onrender.com/api/profile -H "Authorization: Bearer <token>"

Partial update (e.g. saving one step of the form at a time) - only send the fields you have,
nothing else is touched or required. Creates the profile on the first call, updates it after:

$ curl -X PATCH https://rishtewale-eiee.onrender.com/api/profile \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{"fullName": "Jane Doe", "currentCity": "Mumbai"}'

$ curl -X PATCH https://rishtewale-eiee.onrender.com/api/profile \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{"caste": "Agarwal", "diet": "vegetarian"}'

## Bulk upload (registration_template.xlsx)

`registration_template.xlsx` in the project root is a fillable spreadsheet matching the profile
fields, meant to be handed to someone to fill in offline and sent back. It has two sheets:
"Registration Data" (the columns to fill, first row required fields marked with `*`) and
"Field Guide" (description + allowed values for each column).

Upload the filled sheet (.xlsx or .csv, same column headers) to bulk-import it - no login needed,
this is an admin/operator action:

$ curl -F "file=@registration_template.xlsx" https://rishtewale-eiee.onrender.com/api/profile/bulk-upload

Each row is matched to an account by its `phone` column. If no account exists for that number yet,
one is created with a randomly generated password, returned once in the response so it can be
handed to that person to log in and change it. Response shape:

```json
{
  "accountsCreated": [{ "phone": "9876543210", "temporaryPassword": "..." }],
  "profilesSaved": ["9876543210"],
  "rowErrors": [{ "row": 5, "phone": "9123456780", "errors": ["diet is required"] }]
}
```

Rows are treated as a full submit, so every required field must be filled in per row (unlike the
PATCH endpoint above). The example row in the template (phone `9876543210`) is skipped
automatically if you forget to delete it.

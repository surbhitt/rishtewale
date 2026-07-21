
*curl command to write data to table*

$ curl -F "file=@test.csv" https://rishtewale-eiee.onrender.com/api/upload

## Auth

Signup:
$ curl -X POST https://rishtewale-eiee.onrender.com/api/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"email":"you@example.com","password":"at-least-8-chars"}'

Login:
$ curl -X POST https://rishtewale-eiee.onrender.com/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"you@example.com","password":"at-least-8-chars"}'

Both return `{ token, user }`. Send the token as `Authorization: Bearer <token>` on the profile routes below.

## Registration profile

Create/update your profile (upsert, keyed on the logged-in user). See `utils/profileFields.js` for the
full field list, enum values, and which fields are required (mirrors `registration_fields.pdf`, minus
photo uploads).

$ curl -X POST https://rishtewale-eiee.onrender.com/api/profile \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{
      "fullName": "Jane Doe",
      "dateOfBirth": "1998-04-12",
      "gender": "female",
      "placeOfBirth": "Jaipur, Rajasthan",
      "currentCity": "Mumbai",
      "currentState": "Maharashtra",
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
      "familyType": "nuclear",
      "contactNumber": "9999999999"
    }'

Fetch your profile:
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

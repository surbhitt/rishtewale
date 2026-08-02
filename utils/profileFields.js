// One entry per registration_fields.pdf field (photo fields excluded).
// `key` is the JSON field name clients send, `column` is the DB column.
const PROFILE_FIELDS = [
    // Step 1 - Personal Details
    { key: "fullName", column: "full_name", required: true },
    { key: "dateOfBirth", column: "date_of_birth", required: true },
    { key: "timeOfBirth", column: "time_of_birth", required: true },
    { key: "gender", column: "gender", required: true, oneOf: ["male", "female", "prefer_not_to_say"] },
    { key: "placeOfBirth", column: "place_of_birth", required: true },
    { key: "currentCity", column: "current_city", required: true },
    { key: "heightFeet", column: "height_feet", required: true },
    { key: "heightInches", column: "height_inches", required: true },
    { key: "maritalStatus", column: "marital_status", required: true, oneOf: ["never_married", "divorced", "widowed", "separated"] },
    { key: "aboutYourself", column: "about_yourself", required: false },

    // Step 2 - Religion & Community
    { key: "caste", column: "caste", required: true },
    { key: "motherGotra", column: "mother_gotra", required: false },
    { key: "maternalGrandmotherGotra", column: "maternal_grandmother_gotra", required: false },
    { key: "manglikStatus", column: "manglik_status", required: false, oneOf: ["manglik", "non_manglik", "partial_manglik", "dont_know"] },
    { key: "diet", column: "diet", required: true, oneOf: ["vegetarian", "non_vegetarian", "eggetarian", "jain"] },

    // Step 3 - Education & Profession
    { key: "highestQualification", column: "highest_qualification", required: true },
    { key: "fieldOfStudy", column: "field_of_study", required: true },
    { key: "additionalQualifications", column: "additional_qualifications", required: false },
    { key: "employmentType", column: "employment_type", required: true, oneOf: ["salaried", "self_employed", "business_owner", "not_working"] },
    { key: "jobTitle", column: "job_title", required: true },
    { key: "industry", column: "industry", required: true },
    { key: "annualIncome", column: "annual_income", required: true, oneOf: ["10L-25L", "25L-50L", "50L-1Cr", "1Cr-5Cr", "5Cr+"] },
    { key: "residentialStatus", column: "residential_status", required: true, oneOf: ["based_in_india", "nri", "looking_to_return"] },

    // Step 4 - Family Background
    { key: "fatherName", column: "father_name", required: true },
    { key: "fatherOccupation", column: "father_occupation", required: true },
    { key: "fatherStatus", column: "father_status", required: true, oneOf: ["employed", "retired", "business", "deceased"] },
    { key: "motherName", column: "mother_name", required: true },
    { key: "motherOccupation", column: "mother_occupation", required: true },
    { key: "numBrothers", column: "num_brothers", required: true },
    { key: "numSisters", column: "num_sisters", required: true },
    { key: "siblingsMaritalStatus", column: "siblings_marital_status", required: false },
    { key: "familyType", column: "family_type", required: true, oneOf: ["joint", "nuclear"] },
    { key: "aboutFamily", column: "about_family", required: false },
    { key: "ownProperty", column: "own_property", required: false },

    // Step 5 - Partner Preferences & Contact
    { key: "preferredCities", column: "preferred_cities", required: false, isArray: true },
    { key: "preferredEducation", column: "preferred_education", required: false },
    { key: "otherPreferences", column: "other_preferences", required: false }
];

const INT_RANGES = {
    numBrothers: { min: 0 },
    numSisters: { min: 0 },
    heightFeet: { min: 1 },
    heightInches: { min: 0, max: 11 }
};

// partial: true  -> PATCH semantics, only validates/collects keys present in body, "required" is not enforced
// partial: false -> POST semantics, every `required` field must be present and non-empty
function validateProfileFields(body, { partial = false } = {}) {
    const errors = [];
    const values = {};

    for (const field of PROFILE_FIELDS) {
        const provided = Object.prototype.hasOwnProperty.call(body, field.key) && body[field.key] !== undefined;

        if (!provided) {
            if (field.required && !partial) {
                errors.push(`${field.key} is required`);
            }
            continue;
        }

        const value = body[field.key];
        const isEmpty = value === null || value === "";

        if (isEmpty) {
            if (field.required && !partial) {
                errors.push(`${field.key} is required`);
                continue;
            }
            values[field.column] = field.isArray ? [] : null;
            continue;
        }

        if (field.oneOf && !field.oneOf.includes(value)) {
            errors.push(`${field.key} must be one of: ${field.oneOf.join(", ")}`);
            continue;
        }

        values[field.column] = value;
    }

    for (const [key, range] of Object.entries(INT_RANGES)) {
        if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) {
            continue;
        }

        const value = body[key];
        const outOfRange = (range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max);

        if (!Number.isInteger(value) || outOfRange) {
            const bounds = [range.min !== undefined ? `>= ${range.min}` : null, range.max !== undefined ? `<= ${range.max}` : null]
                .filter(Boolean)
                .join(" and ");
            errors.push(`${key} must be an integer ${bounds}`);
        }
    }

    if (body.preferredCities !== undefined && body.preferredCities !== null && !Array.isArray(body.preferredCities)) {
        errors.push("preferredCities must be an array of strings");
    }

    return { errors, values };
}

const COLUMN_TO_FIELD = Object.fromEntries(PROFILE_FIELDS.map((field) => [field.column, field]));

module.exports = { PROFILE_FIELDS, COLUMN_TO_FIELD, validateProfileFields };

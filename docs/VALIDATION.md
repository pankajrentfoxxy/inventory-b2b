# Validation system

One set of rules, enforced three times: while typing (web sanitizers), on submit (zod resolver
in the form) and on every request (zod in `validateBody` / `validateQuery` / `validateParams`).
All of it lives in `packages/shared/src/validation/` plus the regex catalogue in
`packages/shared/src/validators.ts`. Nothing outside `packages/shared` may declare a validation
regex or an error message.

## Layers

| Layer | File | Purpose |
|---|---|---|
| Regexes + primitives | `validators.ts` | `GSTIN_REGEX`, `MOBILE_IN_REGEX`, `PERSON_NAME_REGEX`, `isValidDateString`, `normalizeUrl`, `parseDecimalInput`, ... |
| Messages | `validation/messages.ts` | Every user-facing message (`MESSAGES.mobile`, `MESSAGES.required(label)`, ...). Tests assert against these. |
| Rule functions | `validation/rules.ts` | `validateMobile()`, `validateEmail()`, `validateGstin()`, `validatePan()`, `validateIfsc()`, `validatePincode()`, `validateAmount()`, `validatePercentage()`, `validateRequired()`, `validateDate()`, `validateDateRange()`, `validateUrl()`, `normalizeSearch()`. Return `string | null`. |
| Sanitizers | `validation/sanitizers.ts` | `sanitizeInput(kind, value)` for typing-time filtering: `mobile`, `pincode`, `gstin`, `pan`, `ifsc`, `decimal`, `signedDecimal`, `integer`, `name`, `email`, `code`, `phone`, `singleLine`, ... |
| Upload rules | `validation/files.ts` | `UPLOAD_ACCEPT`, `UPLOAD_MAX_MB`, `validateUploadFile()` used by both the file pickers and multer. |
| Zod builders | `validation/fields.ts` | `requiredText`, `optionalText`, `requiredPersonName`, `requiredBusinessName`, `optionalEmail`, `mobileField`, `phoneField`, `pincodeField`, `gstinField`, `panField`, `ifscField`, `amountField`, `quantityField`, `percentageField`, `integerField`, `dateField`, `urlField`, `uuidField`, `searchField`, `paginationFields`, plus object-level helpers `refineMobileForDialCode`, `refineIndianPostalCode`, `refineDateOrder`. |

Module schemas (`vendor.schema.ts`, `purchase.schema.ts`, `auth.schema.ts`) compose the builders
only. Adding a module means composing builders, never writing `z.string().regex(...)` inline.

## Field rules

| Field | Rule | Builder |
|---|---|---|
| Mobile (India) | exactly 10 digits, first digit 6-9; typed separators removed; letters rejected | `mobileField()`; vendor uses `phoneField()` + `refineMobileForDialCode` because it carries a dial code |
| Landline / other phone | 6-15 digits, separators allowed while typing | `phoneField()` |
| Email | trimmed, `EMAIL_REGEX`; auth emails lower-cased | `optionalEmail()`, `requiredEmail()` |
| Person names | letters (any script), space, `. ' -`; no digits | `requiredPersonName()`, `optionalPersonName()` |
| Company / display names | letters, digits, `. , ' & ( ) / # + -` | `requiredBusinessName()`, `optionalBusinessName()` |
| PIN code | 6 digits, not starting with 0; only when country is IN | `pincodeField()`, `refineIndianPostalCode` |
| GSTIN | 15 chars, structure + mod-36 check digit, upper-cased | `gstinField()` |
| PAN | `AAAAA9999A`, upper-cased; must match GSTIN chars 3-12 when both present | `panField()` |
| IFSC | 4 letters, `0`, 6 alphanumerics, upper-cased | `ifscField()` |
| Amounts | numeric (commas allowed), max 2 decimals, no negatives unless `allowNegative`, zero allowed | `amountField()`, `optionalAmountField()` |
| Quantity | > 0, max 3 decimals; GRN lines allow 0 | `quantityField()`, `nonNegativeQuantityField()` |
| Percentage | 0-100, 2 decimals | `percentageField()` |
| Integers | whole numbers with optional min/max/default | `integerField()` |
| Text | trimmed, runs of spaces collapsed (line breaks kept for `multiline`), `''` -> `null`, max length | `requiredText()`, `optionalText()`, `optionalNotes()` |
| Dates | `YYYY-MM-DD` and calendar-valid (2026-02-30 is rejected); ranges ordered | `dateField()`, `optionalDateField()`, `refineDateOrder` |
| URL | http/https only; bare host gets `https://` | `urlField()` |
| Search | trimmed, collapsed, max 200; blank search is dropped before the request | `searchField()`, `normalizeSearch()` |
| Files | extension in `UPLOAD_ALLOWED_TYPES`, MIME must agree, <= 10 MB | `validateUploadFile()` |

## Frontend

- `Input` (in `components/ui/Form.tsx`) accepts `sanitize="mobile" | "gstin" | ...`. It rewrites
  the DOM value before react-hook-form or local state reads it and picks a matching `inputMode`.
  For raw `<input>` elements use `sanitizeChange(kind, onChange)` from `lib/validation.ts`.
- Forms validate with `zodResolver(<shared schema>)` (`mode: 'onBlur'`) or run `schema.safeParse`
  and push issues with `applyZodIssues(setError, error)`.
- After a failed request call `applyServerErrors(setError, toApiError(err))`. It maps
  `error.details[].path` (dot notation such as `contacts.0.mobile`) onto the same fields; the
  returned unmapped messages go to a toast via `summarizeErrors`.
- The axios request interceptor in `lib/api.ts` normalises `params.search`, so list hooks never
  send whitespace-only or oversized searches.

## Backend

- Routes: `validateBody(schema)`, `validateQuery(schema)`, `validateParams(schema)` from
  `lib/http.ts`. `req.body` / `res.locals.query` / `res.locals.params` hold the parsed values.
- Uploads: `documentUpload.single('file')` + `requireUploadedFile(req)` from `lib/upload.ts`.
- Service-level rules (tenant ownership, uniqueness, business state) throw
  `validationError([{ path, message }])`.

## Error envelope

Every non-2xx response has the same shape. `error.details` is the ordered list; `errors` is the
same data keyed by path (first message wins).

```json
{
  "success": false,
  "message": "Please fix the highlighted fields",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please fix the highlighted fields",
    "details": [
      { "path": "mobile", "message": "Mobile number must contain exactly 10 digits" },
      { "path": "email", "message": "Please enter a valid email address" }
    ]
  },
  "errors": {
    "mobile": "Mobile number must contain exactly 10 digits",
    "email": "Please enter a valid email address"
  }
}
```

Status codes: 400 malformed request, 401/403 auth, 404 missing or foreign tenant record,
409 conflicts, 413 upload too large, 422 validation.

## Adding a field

1. Pick a builder in `validation/fields.ts`; add a rule function + message only if none fits.
2. Use it in the module schema. Object-level rules go in the schema's `superRefine`.
3. In the form, give the `Input` the matching `sanitize` kind and show `errors.<field>?.message`.
4. Add a case to `apps/api/test/validation.test.ts`.

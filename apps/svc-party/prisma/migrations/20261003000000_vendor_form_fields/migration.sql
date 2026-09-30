-- The party form now carries every field of the legacy vendor form (basic info, other details,
-- address phone / fax, contact person names and department). Addresses may be partially filled,
-- exactly like the legacy form; the GST rules still use the billing state code when present.
ALTER TABLE "parties"
  ADD COLUMN "salutation"              VARCHAR(10),
  ADD COLUMN "first_name"              VARCHAR(100),
  ADD COLUMN "last_name"               VARCHAR(100),
  ADD COLUMN "work_phone_country_code" VARCHAR(6),
  ADD COLUMN "mobile_country_code"     VARCHAR(6),
  ADD COLUMN "mobile"                  VARCHAR(20),
  ADD COLUMN "language"                VARCHAR(10) NOT NULL DEFAULT 'en',
  ADD COLUMN "source_of_supply"        CHAR(2),
  ADD COLUMN "currency_code"           CHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN "vendor_type"             VARCHAR(20),
  ADD COLUMN "msme_registered"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "msme_number"             VARCHAR(30),
  ADD COLUMN "tds_applicable"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tds_section_code"        VARCHAR(20),
  ADD COLUMN "tcs_applicable"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opening_balance"         DECIMAL(18, 2);
-- Existing rows: source of supply from the GSTIN, else the default billing address.
UPDATE "parties" p SET "source_of_supply" = coalesce(substr(p."gstin", 1, 2), (SELECT a."state_code" FROM "party_addresses" a WHERE a."party_id" = p."id" AND a."kind" = 'BILLING' ORDER BY a."is_default" DESC LIMIT 1));

ALTER TABLE "party_addresses"
  ALTER COLUMN "line1" DROP NOT NULL,
  ALTER COLUMN "city" DROP NOT NULL,
  ALTER COLUMN "state_code" DROP NOT NULL,
  ALTER COLUMN "pincode" DROP NOT NULL,
  ADD COLUMN "fax" VARCHAR(30);

ALTER TABLE "party_contacts"
  ADD COLUMN "salutation" VARCHAR(10),
  ADD COLUMN "first_name" VARCHAR(100),
  ADD COLUMN "last_name"  VARCHAR(100),
  ADD COLUMN "mobile"     VARCHAR(30),
  ADD COLUMN "department" VARCHAR(100);
UPDATE "party_contacts" SET "first_name" = "name" WHERE "first_name" IS NULL;

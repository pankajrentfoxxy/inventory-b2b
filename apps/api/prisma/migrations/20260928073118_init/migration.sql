-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('VENDOR');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('SUPPLIER', 'MANUFACTURER', 'SERVICE_PROVIDER', 'CONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('BILLING', 'SHIPPING');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT', 'CASH_CREDIT', 'OVERDRAFT', 'OTHER');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "gstin" VARCHAR(15),
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "base_currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_treatments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "requires_gstin" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gst_treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources_of_supply" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "short_code" VARCHAR(5),
    "name" VARCHAR(100) NOT NULL,
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sources_of_supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "symbol" VARCHAR(8) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" "CustomFieldEntity" NOT NULL DEFAULT 'VENDOR',
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "field_type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_tags" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reporting_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_tag_options" (
    "id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporting_tag_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "company_name" VARCHAR(200),
    "salutation" VARCHAR(10),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "email" VARCHAR(254),
    "work_phone_country_code" VARCHAR(5),
    "work_phone" VARCHAR(20),
    "mobile_country_code" VARCHAR(5),
    "mobile" VARCHAR(20),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "website" VARCHAR(255),
    "gst_treatment_id" UUID,
    "source_of_supply_id" UUID,
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "payment_term_id" UUID,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "vendor_type" "VendorType",
    "msme_registered" BOOLEAN NOT NULL DEFAULT false,
    "msme_number" VARCHAR(30),
    "tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tds_section_code" VARCHAR(20),
    "tcs_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tax_config" JSONB NOT NULL DEFAULT '{}',
    "opening_balance" DECIMAL(18,2),
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_addresses" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "attention" VARCHAR(120),
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(120),
    "state" VARCHAR(120),
    "state_code" VARCHAR(5),
    "postal_code" VARCHAR(20),
    "phone" VARCHAR(20),
    "fax" VARCHAR(30),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contacts" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "salutation" VARCHAR(10),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "email" VARCHAR(254),
    "work_phone" VARCHAR(20),
    "mobile" VARCHAR(20),
    "designation" VARCHAR(100),
    "department" VARCHAR(100),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_accounts" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_name" VARCHAR(150) NOT NULL,
    "account_holder_name" VARCHAR(150) NOT NULL,
    "account_number_encrypted" VARCHAR(255) NOT NULL,
    "account_number_last4" VARCHAR(4) NOT NULL,
    "ifsc" VARCHAR(11) NOT NULL,
    "branch" VARCHAR(150),
    "account_type" "BankAccountType" NOT NULL DEFAULT 'CURRENT',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_custom_field_values" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_reporting_tags" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_reporting_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_documents" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_notes" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_activities" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID,
    "user_id" UUID,
    "user_name" VARCHAR(100),
    "summary" VARCHAR(500),
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "roles_organization_id_idx" ON "roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_code_key" ON "roles"("organization_id", "code");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "gst_treatments_organization_id_is_active_idx" ON "gst_treatments"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "gst_treatments_organization_id_code_key" ON "gst_treatments"("organization_id", "code");

-- CreateIndex
CREATE INDEX "sources_of_supply_organization_id_is_active_idx" ON "sources_of_supply"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sources_of_supply_organization_id_code_key" ON "sources_of_supply"("organization_id", "code");

-- CreateIndex
CREATE INDEX "payment_terms_organization_id_is_active_idx" ON "payment_terms"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_organization_id_name_key" ON "payment_terms"("organization_id", "name");

-- CreateIndex
CREATE INDEX "custom_field_definitions_organization_id_entity_type_is_act_idx" ON "custom_field_definitions"("organization_id", "entity_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_organization_id_entity_type_key_key" ON "custom_field_definitions"("organization_id", "entity_type", "key");

-- CreateIndex
CREATE INDEX "reporting_tags_organization_id_is_active_idx" ON "reporting_tags"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_tags_organization_id_name_key" ON "reporting_tags"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_tag_options_tag_id_name_key" ON "reporting_tag_options"("tag_id", "name");

-- CreateIndex
CREATE INDEX "vendors_organization_id_idx" ON "vendors"("organization_id");

-- CreateIndex
CREATE INDEX "vendors_organization_id_display_name_idx" ON "vendors"("organization_id", "display_name");

-- CreateIndex
CREATE INDEX "vendors_organization_id_company_name_idx" ON "vendors"("organization_id", "company_name");

-- CreateIndex
CREATE INDEX "vendors_organization_id_email_idx" ON "vendors"("organization_id", "email");

-- CreateIndex
CREATE INDEX "vendors_organization_id_work_phone_idx" ON "vendors"("organization_id", "work_phone");

-- CreateIndex
CREATE INDEX "vendors_organization_id_mobile_idx" ON "vendors"("organization_id", "mobile");

-- CreateIndex
CREATE INDEX "vendors_organization_id_gstin_idx" ON "vendors"("organization_id", "gstin");

-- CreateIndex
CREATE INDEX "vendors_organization_id_status_idx" ON "vendors"("organization_id", "status");

-- CreateIndex
CREATE INDEX "vendors_organization_id_created_at_idx" ON "vendors"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "vendor_addresses_vendor_id_idx" ON "vendor_addresses"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_addresses_organization_id_idx" ON "vendor_addresses"("organization_id");

-- CreateIndex
CREATE INDEX "vendor_contacts_vendor_id_idx" ON "vendor_contacts"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_contacts_organization_id_idx" ON "vendor_contacts"("organization_id");

-- CreateIndex
CREATE INDEX "vendor_bank_accounts_vendor_id_idx" ON "vendor_bank_accounts"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_bank_accounts_organization_id_idx" ON "vendor_bank_accounts"("organization_id");

-- CreateIndex
CREATE INDEX "vendor_custom_field_values_organization_id_idx" ON "vendor_custom_field_values"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_custom_field_values_vendor_id_field_id_key" ON "vendor_custom_field_values"("vendor_id", "field_id");

-- CreateIndex
CREATE INDEX "vendor_reporting_tags_organization_id_option_id_idx" ON "vendor_reporting_tags"("organization_id", "option_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_reporting_tags_vendor_id_tag_id_key" ON "vendor_reporting_tags"("vendor_id", "tag_id");

-- CreateIndex
CREATE INDEX "vendor_documents_vendor_id_idx" ON "vendor_documents"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_documents_organization_id_idx" ON "vendor_documents"("organization_id");

-- CreateIndex
CREATE INDEX "vendor_notes_vendor_id_created_at_idx" ON "vendor_notes"("vendor_id", "created_at");

-- CreateIndex
CREATE INDEX "vendor_notes_organization_id_idx" ON "vendor_notes"("organization_id");

-- CreateIndex
CREATE INDEX "vendor_activities_vendor_id_created_at_idx" ON "vendor_activities"("vendor_id", "created_at");

-- CreateIndex
CREATE INDEX "vendor_activities_organization_id_created_at_idx" ON "vendor_activities"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_treatments" ADD CONSTRAINT "gst_treatments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources_of_supply" ADD CONSTRAINT "sources_of_supply_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_tags" ADD CONSTRAINT "reporting_tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_tag_options" ADD CONSTRAINT "reporting_tag_options_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "reporting_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_gst_treatment_id_fkey" FOREIGN KEY ("gst_treatment_id") REFERENCES "gst_treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_source_of_supply_id_fkey" FOREIGN KEY ("source_of_supply_id") REFERENCES "sources_of_supply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_addresses" ADD CONSTRAINT "vendor_addresses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_accounts" ADD CONSTRAINT "vendor_bank_accounts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_custom_field_values" ADD CONSTRAINT "vendor_custom_field_values_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_custom_field_values" ADD CONSTRAINT "vendor_custom_field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_reporting_tags" ADD CONSTRAINT "vendor_reporting_tags_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_reporting_tags" ADD CONSTRAINT "vendor_reporting_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "reporting_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_reporting_tags" ADD CONSTRAINT "vendor_reporting_tags_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "reporting_tag_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_notes" ADD CONSTRAINT "vendor_notes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_activities" ADD CONSTRAINT "vendor_activities_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Hand-written constraints (not expressible in Prisma schema)
-- ============================================================

-- Display name must be unique per organization, case-insensitively, among live (non-deleted) vendors.
CREATE UNIQUE INDEX "vendors_org_display_name_live_key"
  ON "vendors" ("organization_id", lower("display_name"))
  WHERE "deleted_at" IS NULL;

-- Exactly one primary contact / bank account per vendor, one primary address per type.
CREATE UNIQUE INDEX "vendor_contacts_one_primary_key"
  ON "vendor_contacts" ("vendor_id") WHERE "is_primary";
CREATE UNIQUE INDEX "vendor_bank_accounts_one_primary_key"
  ON "vendor_bank_accounts" ("vendor_id") WHERE "is_primary";
CREATE UNIQUE INDEX "vendor_addresses_one_primary_per_type_key"
  ON "vendor_addresses" ("vendor_id", "type") WHERE "is_primary";

-- Trigram indexes make the debounced list search (ILIKE '%term%') index-assisted.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "vendors_display_name_trgm_idx" ON "vendors" USING gin (lower("display_name") gin_trgm_ops);
CREATE INDEX "vendors_company_name_trgm_idx" ON "vendors" USING gin (lower("company_name") gin_trgm_ops);
CREATE INDEX "vendors_email_trgm_idx" ON "vendors" USING gin (lower("email") gin_trgm_ops);

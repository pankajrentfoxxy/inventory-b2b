-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'OFFICE', 'STORE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PURCHASE_ORDER', 'PURCHASE_RECEIVE');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "TaxDeductionType" AS ENUM ('NONE', 'TDS', 'TCS');

-- CreateEnum
CREATE TYPE "DeliveryAddressType" AS ENUM ('LOCATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PurchaseReceiveStatus" AS ENUM ('RECEIVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "CustomFieldEntity" ADD VALUE 'PURCHASE_ORDER';

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'WAREHOUSE',
    "attention" VARCHAR(120),
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(120),
    "state" VARCHAR(120),
    "state_code" VARCHAR(5),
    "postal_code" VARCHAR(20),
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "gstin" VARCHAR(15),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "doc_type" "DocumentType" NOT NULL,
    "prefix" VARCHAR(20) NOT NULL DEFAULT '',
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sku" VARCHAR(60),
    "type" "ItemType" NOT NULL DEFAULT 'GOODS',
    "unit" VARCHAR(20) NOT NULL DEFAULT 'pcs',
    "description" TEXT,
    "hsn_code" VARCHAR(8),
    "purchase_rate" DECIMAL(18,4),
    "selling_rate" DECIMAL(18,4),
    "tax_id" UUID,
    "preferred_vendor_id" UUID,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "reorder_level" DECIMAL(18,3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "po_number" VARCHAR(30) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "location_id" UUID,
    "delivery_type" "DeliveryAddressType" NOT NULL DEFAULT 'LOCATION',
    "delivery_location_id" UUID,
    "delivery_address" JSONB,
    "place_of_supply_code" VARCHAR(5),
    "is_intra_state" BOOLEAN NOT NULL DEFAULT false,
    "reference_number" VARCHAR(60),
    "order_date" DATE NOT NULL,
    "expected_delivery_date" DATE,
    "payment_term_id" UUID,
    "shipment_preference" VARCHAR(100),
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "discount_type" "DiscountType" NOT NULL DEFAULT 'PERCENT',
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_deduction_type" "TaxDeductionType" NOT NULL DEFAULT 'NONE',
    "tax_deduction_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax_deduction_label" VARCHAR(80),
    "adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_label" VARCHAR(60),
    "sub_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_breakup" JSONB NOT NULL DEFAULT '[]',
    "tax_deduction_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "closed_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "sku" VARCHAR(60),
    "description" TEXT,
    "hsn_code" VARCHAR(8),
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" VARCHAR(20),
    "rate" DECIMAL(18,4) NOT NULL,
    "tax_id" UUID,
    "tax_name" VARCHAR(50),
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxable_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "received_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_custom_field_values" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_order_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_documents" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_activities" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
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

    CONSTRAINT "purchase_order_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "location_id" UUID,
    "receive_number" VARCHAR(30) NOT NULL,
    "received_date" DATE NOT NULL,
    "status" "PurchaseReceiveStatus" NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,
    "total_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "created_by_name" VARCHAR(100),

    CONSTRAINT "purchase_receives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receive_lines" (
    "id" UUID NOT NULL,
    "purchase_receive_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "item_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receive_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_organization_id_is_active_idx" ON "locations"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "locations_organization_id_name_key" ON "locations"("organization_id", "name");

-- CreateIndex
CREATE INDEX "taxes_organization_id_is_active_idx" ON "taxes"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "taxes_organization_id_name_key" ON "taxes"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_organization_id_doc_type_key" ON "document_sequences"("organization_id", "doc_type");

-- CreateIndex
CREATE INDEX "items_organization_id_idx" ON "items"("organization_id");

-- CreateIndex
CREATE INDEX "items_organization_id_name_idx" ON "items"("organization_id", "name");

-- CreateIndex
CREATE INDEX "items_organization_id_sku_idx" ON "items"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "items_organization_id_is_active_idx" ON "items"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_status_idx" ON "purchase_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_vendor_id_idx" ON "purchase_orders"("organization_id", "vendor_id");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_order_date_idx" ON "purchase_orders"("organization_id", "order_date");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_created_at_idx" ON "purchase_orders"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_po_number_idx" ON "purchase_orders"("organization_id", "po_number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_organization_id_item_id_idx" ON "purchase_order_lines"("organization_id", "item_id");

-- CreateIndex
CREATE INDEX "purchase_order_custom_field_values_organization_id_idx" ON "purchase_order_custom_field_values"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_custom_field_values_purchase_order_id_field__key" ON "purchase_order_custom_field_values"("purchase_order_id", "field_id");

-- CreateIndex
CREATE INDEX "purchase_order_documents_purchase_order_id_idx" ON "purchase_order_documents"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_documents_organization_id_idx" ON "purchase_order_documents"("organization_id");

-- CreateIndex
CREATE INDEX "purchase_order_activities_purchase_order_id_created_at_idx" ON "purchase_order_activities"("purchase_order_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_order_activities_organization_id_created_at_idx" ON "purchase_order_activities"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_receives_organization_id_status_idx" ON "purchase_receives"("organization_id", "status");

-- CreateIndex
CREATE INDEX "purchase_receives_organization_id_purchase_order_id_idx" ON "purchase_receives"("organization_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_receives_organization_id_vendor_id_idx" ON "purchase_receives"("organization_id", "vendor_id");

-- CreateIndex
CREATE INDEX "purchase_receives_organization_id_received_date_idx" ON "purchase_receives"("organization_id", "received_date");

-- CreateIndex
CREATE INDEX "purchase_receives_organization_id_created_at_idx" ON "purchase_receives"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_receive_lines_purchase_receive_id_idx" ON "purchase_receive_lines"("purchase_receive_id");

-- CreateIndex
CREATE INDEX "purchase_receive_lines_purchase_order_line_id_idx" ON "purchase_receive_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "purchase_receive_lines_organization_id_idx" ON "purchase_receive_lines"("organization_id");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_preferred_vendor_id_fkey" FOREIGN KEY ("preferred_vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_delivery_location_id_fkey" FOREIGN KEY ("delivery_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_custom_field_values" ADD CONSTRAINT "purchase_order_custom_field_values_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_custom_field_values" ADD CONSTRAINT "purchase_order_custom_field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_documents" ADD CONSTRAINT "purchase_order_documents_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_activities" ADD CONSTRAINT "purchase_order_activities_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receives" ADD CONSTRAINT "purchase_receives_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receives" ADD CONSTRAINT "purchase_receives_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receives" ADD CONSTRAINT "purchase_receives_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receives" ADD CONSTRAINT "purchase_receives_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receive_lines" ADD CONSTRAINT "purchase_receive_lines_purchase_receive_id_fkey" FOREIGN KEY ("purchase_receive_id") REFERENCES "purchase_receives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receive_lines" ADD CONSTRAINT "purchase_receive_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receive_lines" ADD CONSTRAINT "purchase_receive_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Hand-written constraints (not expressible in Prisma schema)
-- ============================================================

CREATE UNIQUE INDEX "items_org_sku_live_key" ON "items" ("organization_id", upper("sku"))
  WHERE "deleted_at" IS NULL AND "sku" IS NOT NULL;
CREATE UNIQUE INDEX "purchase_orders_org_number_live_key" ON "purchase_orders" ("organization_id", lower("po_number"))
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "purchase_receives_org_number_key" ON "purchase_receives" ("organization_id", lower("receive_number"));
CREATE UNIQUE INDEX "locations_one_primary_key" ON "locations" ("organization_id") WHERE "is_primary";
CREATE UNIQUE INDEX "taxes_one_default_key" ON "taxes" ("organization_id") WHERE "is_default";

CREATE INDEX "items_name_trgm_idx" ON "items" USING gin (lower("name") gin_trgm_ops);
CREATE INDEX "purchase_orders_number_trgm_idx" ON "purchase_orders" USING gin (lower("po_number") gin_trgm_ops);

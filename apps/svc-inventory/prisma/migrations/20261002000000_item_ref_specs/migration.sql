-- Laptop configurations: keep the eight spec names on the local item replica for stock views.
ALTER TABLE "item_refs" ADD COLUMN "specs" JSONB;

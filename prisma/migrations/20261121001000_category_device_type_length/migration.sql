-- A product mirrors its category slug in device_type until that legacy column is removed.
-- Category slugs may be 40 characters, so the mirror must have the same capacity.
ALTER TABLE "products" ALTER COLUMN "device_type" TYPE VARCHAR(40);

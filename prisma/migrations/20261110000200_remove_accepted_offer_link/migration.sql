DROP INDEX IF EXISTS "Offer_one_accepted_per_want";
ALTER TABLE "Want" DROP COLUMN IF EXISTS "acceptedOfferId";

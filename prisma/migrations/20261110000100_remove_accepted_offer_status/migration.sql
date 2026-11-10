UPDATE "Offer" SET "status" = 'open' WHERE "status" = 'accepted';

DROP INDEX IF EXISTS "Offer_one_accepted_per_want";
DROP INDEX "Offer_active_wantId_offererId_key";

CREATE TYPE "OfferStatus_new" AS ENUM ('open', 'withdrawn', 'done');
ALTER TABLE "Offer" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Offer"
  ALTER COLUMN "status" TYPE "OfferStatus_new"
  USING ("status"::text::"OfferStatus_new");
DROP TYPE "OfferStatus";
ALTER TYPE "OfferStatus_new" RENAME TO "OfferStatus";
ALTER TABLE "Offer" ALTER COLUMN "status" SET DEFAULT 'open';

CREATE UNIQUE INDEX "Offer_active_wantId_offererId_key"
  ON "Offer"("wantId", "offererId")
  WHERE "status" <> 'done';

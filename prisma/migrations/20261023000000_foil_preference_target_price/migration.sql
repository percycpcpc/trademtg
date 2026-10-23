ALTER TABLE "Want"
  ADD COLUMN "foilPref" TEXT NOT NULL DEFAULT 'either',
  ADD COLUMN "targetPriceHkd" DECIMAL(12,2);

ALTER TABLE "Offer"
  ADD COLUMN "finish" TEXT NOT NULL DEFAULT 'non-foil';

ALTER TABLE "Want"
  ADD CONSTRAINT "Want_foilPref_check"
  CHECK ("foilPref" IN ('foil', 'non-foil', 'either')),
  ADD CONSTRAINT "Want_targetPriceHkd_check"
  CHECK ("targetPriceHkd" IS NULL OR ("targetPriceHkd" >= 0 AND "targetPriceHkd" <= 99999999.99));

ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_finish_check"
  CHECK ("finish" IN ('foil', 'non-foil'));

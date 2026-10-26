CREATE TYPE "BorrowStatus" AS ENUM ('outstanding', 'returned');

ALTER TABLE "Offer" DROP CONSTRAINT "Offer_wantId_offererId_key";
CREATE UNIQUE INDEX "Offer_active_wantId_offererId_key"
  ON "Offer"("wantId", "offererId")
  WHERE "status" <> 'done';

CREATE TABLE "Trade" (
  "id" UUID PRIMARY KEY,
  "offerId" UUID,
  "sourceOfferId" UUID,
  "buyerId" UUID NOT NULL,
  "sellerId" UUID NOT NULL,
  "scryfallId" UUID NOT NULL,
  "cardName" TEXT NOT NULL,
  "imageUrl" TEXT,
  "setCode" VARCHAR(16) NOT NULL,
  "collectorNo" TEXT NOT NULL,
  "rarity" TEXT NOT NULL,
  "finish" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "deductedQty" INTEGER NOT NULL,
  "unitPriceHkd" DECIMAL(12,2) NOT NULL,
  "paidAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Trade_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL,
  CONSTRAINT "Trade_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Member"("id") ON DELETE RESTRICT,
  CONSTRAINT "Trade_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Member"("id") ON DELETE RESTRICT,
  CONSTRAINT "Trade_qty_check" CHECK ("qty" BETWEEN 1 AND 9999),
  CONSTRAINT "Trade_deductedQty_check" CHECK ("deductedQty" BETWEEN 0 AND 9999),
  CONSTRAINT "Trade_price_check" CHECK ("unitPriceHkd" >= 0),
  CONSTRAINT "Trade_finish_check" CHECK ("finish" IN ('foil', 'non-foil'))
);

CREATE UNIQUE INDEX "Trade_offerId_key" ON "Trade"("offerId");
CREATE INDEX "Trade_sourceOfferId_idx" ON "Trade"("sourceOfferId");
CREATE INDEX "Trade_buyerId_finishedAt_id_idx" ON "Trade"("buyerId", "finishedAt", "id");
CREATE INDEX "Trade_sellerId_finishedAt_id_idx" ON "Trade"("sellerId", "finishedAt", "id");

CREATE TABLE "Borrow" (
  "id" UUID PRIMARY KEY,
  "scryfallId" UUID NOT NULL,
  "cardName" TEXT NOT NULL,
  "imageUrl" TEXT,
  "qty" INTEGER NOT NULL,
  "borrowerId" UUID NOT NULL,
  "lenderId" UUID NOT NULL,
  "status" "BorrowStatus" NOT NULL DEFAULT 'outstanding',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returnedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Borrow_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Member"("id") ON DELETE RESTRICT,
  CONSTRAINT "Borrow_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "Member"("id") ON DELETE RESTRICT,
  CONSTRAINT "Borrow_qty_check" CHECK ("qty" BETWEEN 1 AND 9999),
  CONSTRAINT "Borrow_distinct_parties_check" CHECK ("borrowerId" <> "lenderId"),
  CONSTRAINT "Borrow_returnedAt_check" CHECK (
    ("status" = 'outstanding' AND "returnedAt" IS NULL) OR
    ("status" = 'returned' AND "returnedAt" IS NOT NULL)
  )
);

CREATE INDEX "Borrow_borrowerId_idx" ON "Borrow"("borrowerId");
CREATE INDEX "Borrow_lenderId_idx" ON "Borrow"("lenderId");

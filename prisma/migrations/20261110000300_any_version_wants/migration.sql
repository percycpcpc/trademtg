ALTER TABLE "Want" ADD COLUMN "anyVersion" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WantPrinting" (
  "id" UUID NOT NULL,
  "wantId" UUID NOT NULL,
  "scryfallId" UUID NOT NULL,
  "cardName" TEXT NOT NULL,
  "setCode" VARCHAR(16) NOT NULL,
  "collectorNo" TEXT NOT NULL,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WantPrinting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WantPrinting_wantId_fkey" FOREIGN KEY ("wantId") REFERENCES "Want"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WantPrinting_wantId_idx" ON "WantPrinting"("wantId");

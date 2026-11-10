import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const wants = await prisma.want.findMany({
    where: { typeLine: null },
    select: { id: true, scryfallId: true },
  });
  if (!wants.length) process.exitCode = 0;
  else {
    for (let offset = 0; offset < wants.length; offset += 75) {
      const chunk = wants.slice(offset, offset + 75);
      const response = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "application/json",
          "User-Agent": "TradeMTG/1.0",
        },
        body: JSON.stringify({
          identifiers: chunk.map((want) => ({ id: want.scryfallId })),
        }),
      });
      if (!response.ok)
        throw new Error(`Scryfall collection request failed (${response.status})`);
      const typeLines = new Map(
        ((await response.json()).data ?? []).map((card) => [card.id, card.type_line]),
      );
      await prisma.$transaction(
        chunk.flatMap((want) => {
          const typeLine = typeLines.get(want.scryfallId);
          return typeof typeLine === "string"
            ? [prisma.want.update({ where: { id: want.id }, data: { typeLine } })]
            : [];
        }),
      );
    }
  }
} catch (error) {
  console.error("Want type-line backfill skipped:", error);
} finally {
  await prisma.$disconnect().catch((error) =>
    console.error("Want type-line backfill disconnect failed:", error),
  );
}

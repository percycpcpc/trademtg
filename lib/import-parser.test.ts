import { describe, expect, it } from "vitest";
import { mergeResolved, parseImport } from "./import-parser";
import { importTargets, validateImportCommit } from "./import-service";
describe("import grammar", () => {
  it.each([
    [
      "4x Lightning Bolt (m11) 149 [Instant] *F*",
      {
        qty: 4,
        parsedName: "Lightning Bolt",
        setCode: "m11",
        collectorNo: "149",
      },
    ],
    [
      "2X Fire // Ice (MH2) 290 [Instant]",
      { qty: 2, parsedName: "Fire // Ice", setCode: "mh2", collectorNo: "290" },
    ],
    ["1 The 14th Doctor", { qty: 1, parsedName: "The 14th Doctor" }],
    [
      "1 Boseiju, Who Endures (NEO) 266",
      {
        qty: 1,
        parsedName: "Boseiju, Who Endures",
        setCode: "neo",
        collectorNo: "266",
      },
    ],
    ["Counterspell", { qty: 1, parsedName: "Counterspell" }],
    [
      "Counterspell (MH2) 267",
      { qty: 1, parsedName: "Counterspell", setCode: "mh2", collectorNo: "267" },
    ],
  ])("parses %s", (input, want) =>
    expect(parseImport(input)[0]).toMatchObject(want),
  );
  it.each(["0 Island", "0x Island", "4.5x Island", "2.5 Island", "10000 Island", "10000x Island", "4xCard"])(
    "reports invalid quantity %s",
    (x) => expect(parseImport(x)[0]).toMatchObject({
      state: "unresolved",
      reason: "Quantity must be a whole number between 1 and 9999",
    }),
  );
  it("reports a missing card name", () =>
    expect(parseImport("3 [Creature]")[0].reason).toBe("Card name is missing"));
  it("keeps unknown candidates", () =>
    expect(parseImport("2 Definitely Not A Card (ABC) 123")[0]).toMatchObject({
      parsedName: "Definitely Not A Card",
      qty: 2,
      setCode: "abc",
      state: "unresolved",
    }));
  it("preserves lines and ignores sections", () =>
    expect(parseImport("\uFEFFDeck:\r\n# hi\r\n1 Éowyn")).toMatchObject([
      { lineNo: 1, state: "ignored" },
      { lineNo: 2, state: "ignored" },
      { lineNo: 3, parsedName: "Éowyn" },
    ]));
});
describe("merge", () => {
  it("sums duplicates and adds to current", () =>
    expect(
      mergeResolved({ a: 2 }, [
        { scryfallId: "a", qty: 3 },
        { scryfallId: "a", qty: 1 },
      ]),
    ).toEqual({ a: 6 }));
});
describe("import commit semantics",()=>{
  it("sums duplicate resolved lines into an absolute target",()=>expect(importTargets({a:2},[{scryfallId:"a",qty:3,state:"unresolved"},{scryfallId:"a",qty:1,state:"unresolved"},{scryfallId:"a",qty:9,state:"resolved"}])).toEqual([{scryfallId:"a",currentQty:2,importQty:4,targetQty:6}]));
  it("binds a commit to every unresolved contributing line",()=>expect(validateImportCommit([{scryfallId:"a",qty:6}],[{id:"1",resolvedScryfallId:"a",qty:3,state:"unresolved"},{id:"2",resolvedScryfallId:"a",qty:1,state:"unresolved"}]).get("a")).toBe(4));
  it("rejects items not backed by selected lines",()=>expect(()=>validateImportCommit([{scryfallId:"b",qty:1}],[{id:"1",resolvedScryfallId:"a",qty:1,state:"unresolved"}])).toThrow(/no longer match/));
});

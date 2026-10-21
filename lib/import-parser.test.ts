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
  ])("parses %s", (input, want) =>
    expect(parseImport(input)[0]).toMatchObject(want),
  );
  it.each(["0 Island", "Island", "4xCard", "3 [Creature]"])("reports %s", (x) =>
    expect(parseImport(x)[0].reason).toBeTruthy(),
  );
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

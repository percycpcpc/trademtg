import { describe, expect, it } from "vitest";
import { parseFinish, parseFoilPref, parseTargetPrice } from "./server";

describe("trade field API validation", () => {
  it.each(["glossy", "", null])("rejects bad foil preference %j", (value) => {
    expect(() => parseFoilPref(value)).toThrow(/Foil preference/);
  });
  it.each(["either", "etched", ""])("rejects bad offer finish %j", (value) => {
    expect(() => parseFinish(value)).toThrow(/Finish/);
  });
  it("rejects a negative target", () => {
    expect(() => parseTargetPrice("-0.01")).toThrow(/Target price/);
  });
  it("clears a target with null", () => {
    expect(parseTargetPrice(null)).toBeNull();
  });
  it("accepts the inclusive target ceiling", () => {
    expect(parseTargetPrice("99999999.99")?.toFixed(2)).toBe("99999999.99");
  });
});

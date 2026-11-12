import { describe, expect, it } from "vitest";
import { sanitizeCell, toCSV } from "./export";

describe("exports", () => {
  it("escapes CSV and neutralises formula injection", () => {
    const csv = toCSV([{ header: "A", value: (r: { a: string }) => r.a }], [{ a: "=HYPERLINK(\"x\")" }, { a: "a,b" }, { a: "plain" }]);
    expect(csv).toBe('A\r\n"\'=HYPERLINK(""x"")"\r\n"a,b"\r\nplain');
    expect(sanitizeCell("-5")).toBe("'-5");
    expect(sanitizeCell(-5)).toBe(-5);
  });
});

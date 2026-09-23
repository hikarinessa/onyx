import { describe, expect, it } from "vitest";
import {
  dateOrderFromPartTypes,
  dateOrderFromPattern,
  datePlaceholder,
  formatDisplayDate,
  parseDisplayDate,
  parseISODate,
} from "./dateFormat";

describe("dateOrderFromPattern", () => {
  it("reads the order macOS gives for common regions", () => {
    expect(dateOrderFromPattern("dd.MM.yyyy")).toBe("DMY"); // en_US@rg=dezzzz, de_DE
    expect(dateOrderFromPattern("dd/MM/yyyy")).toBe("DMY"); // en_GB
    expect(dateOrderFromPattern("MM/dd/yyyy")).toBe("MDY"); // en_US
    expect(dateOrderFromPattern("yyyy/MM/dd")).toBe("YMD"); // ja_JP
    expect(dateOrderFromPattern("yyyy-MM-dd")).toBe("YMD"); // sv_SE
  });

  it("ignores pattern letters inside quoted literals", () => {
    expect(dateOrderFromPattern("dd 'de' MM 'y' yyyy")).toBe("DMY");
    expect(dateOrderFromPattern("'d' MM/dd/yyyy")).toBe("MDY");
  });

  it("treats standalone month and ISO-year letters as month and year", () => {
    expect(dateOrderFromPattern("dd.LL.uuuu")).toBe("DMY");
  });

  it("returns null when a field is missing or the order is unsupported", () => {
    expect(dateOrderFromPattern("MM/yyyy")).toBeNull();
    expect(dateOrderFromPattern("")).toBeNull();
    expect(dateOrderFromPattern("dd yyyy MM")).toBeNull();
  });
});

describe("dateOrderFromPartTypes", () => {
  it("reads Intl formatToParts order", () => {
    expect(dateOrderFromPartTypes(["month", "literal", "day", "literal", "year"])).toBe("MDY");
    expect(dateOrderFromPartTypes(["day", "literal", "month", "literal", "year"])).toBe("DMY");
    expect(dateOrderFromPartTypes(["year", "literal", "month", "literal", "day"])).toBe("YMD");
    expect(dateOrderFromPartTypes(["month", "literal", "year"])).toBeNull();
  });
});

describe("datePlaceholder", () => {
  it("spells the order with slashes", () => {
    expect(datePlaceholder("DMY")).toBe("DD/MM/YYYY");
    expect(datePlaceholder("MDY")).toBe("MM/DD/YYYY");
    expect(datePlaceholder("YMD")).toBe("YYYY/MM/DD");
  });
});

describe("parseISODate", () => {
  it("accepts real dates only", () => {
    expect(parseISODate("2026-09-23")).toEqual({ year: 2026, month: 9, day: 23 });
    expect(parseISODate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseISODate("2026-02-29")).toBeNull();
    expect(parseISODate("2026-13-01")).toBeNull();
    expect(parseISODate("2026-9-23")).toBeNull();
    expect(parseISODate("2026-09-23T10:00")).toBeNull();
  });
});

describe("formatDisplayDate", () => {
  it("formats ISO into the region order", () => {
    expect(formatDisplayDate("2026-09-03", "DMY")).toBe("03/09/2026");
    expect(formatDisplayDate("2026-09-03", "MDY")).toBe("09/03/2026");
    expect(formatDisplayDate("2026-09-03", "YMD")).toBe("2026/09/03");
  });

  it("returns null for values that are not a plain ISO date", () => {
    expect(formatDisplayDate("", "DMY")).toBeNull();
    expect(formatDisplayDate("next week", "DMY")).toBeNull();
    expect(formatDisplayDate("2026-02-30", "DMY")).toBeNull();
  });
});

describe("parseDisplayDate", () => {
  it("reads the region order", () => {
    expect(parseDisplayDate("03/09/2026", "DMY")).toBe("2026-09-03");
    expect(parseDisplayDate("03/09/2026", "MDY")).toBe("2026-03-09");
    expect(parseDisplayDate("2026/09/03", "YMD")).toBe("2026-09-03");
  });

  it("accepts other separators, single digits and surrounding space", () => {
    expect(parseDisplayDate("3.9.2026", "DMY")).toBe("2026-09-03");
    expect(parseDisplayDate(" 3-9-2026 ", "DMY")).toBe("2026-09-03");
    expect(parseDisplayDate("3 9 2026", "DMY")).toBe("2026-09-03");
    expect(parseDisplayDate("23 / 09 / 2026", "DMY")).toBe("2026-09-23");
  });

  it("reads a leading four-digit year as ISO in any region", () => {
    expect(parseDisplayDate("2026-09-03", "DMY")).toBe("2026-09-03");
    expect(parseDisplayDate("2026-09-03", "MDY")).toBe("2026-09-03");
  });

  it("round-trips with formatDisplayDate", () => {
    for (const order of ["DMY", "MDY", "YMD"] as const) {
      const shown = formatDisplayDate("2024-02-29", order)!;
      expect(parseDisplayDate(shown, order)).toBe("2024-02-29");
    }
  });

  it("rejects impossible dates", () => {
    expect(parseDisplayDate("31/02/2026", "DMY")).toBeNull();
    expect(parseDisplayDate("29/02/2026", "DMY")).toBeNull();
    expect(parseDisplayDate("13/13/2026", "DMY")).toBeNull();
    expect(parseDisplayDate("23/09/2026", "MDY")).toBeNull(); // month 23
    expect(parseDisplayDate("00/09/2026", "DMY")).toBeNull();
  });

  it("rejects incomplete, ambiguous or malformed text", () => {
    expect(parseDisplayDate("", "DMY")).toBeNull();
    expect(parseDisplayDate("23/09", "DMY")).toBeNull();
    expect(parseDisplayDate("23/09/26", "DMY")).toBeNull(); // two-digit year
    expect(parseDisplayDate("23//09/2026", "DMY")).toBeNull();
    expect(parseDisplayDate("23/09/2026/1", "DMY")).toBeNull();
    expect(parseDisplayDate("123/09/2026", "DMY")).toBeNull();
    expect(parseDisplayDate("23/Sep/2026", "DMY")).toBeNull();
    expect(parseDisplayDate("23/09/2026", "YMD")).toBeNull();
    expect(parseDisplayDate("20260/09/23", "DMY")).toBeNull();
  });
});

/** S0 general notes follow the project: code cycle, criteria, exposure and the members designed. */
import { describe, expect, it } from "vitest";
import { validationItems } from "@/components/report/package";
import { exposureRequirements } from "@/engine/data/concreteExposure";
import { designProject, eastLincolnTrussProject, exampleProject } from "@/engine/project";
import { fillTemplate, generalNotesSheet } from "@/engine/project/generalNotesSheet";

const text = (p: ReturnType<typeof exampleProject>) =>
  generalNotesSheet(p, designProject(p))
    .panels.flatMap((x) => (x.kind === "notes" ? x.lines : x.kind === "criteria" ? x.foot : x.rows.flat()))
    .join("\n");

describe("S0 template filling", () => {
  it("drops empty lists and false conditions with their sub-lines, and renumbers", () => {
    const out = fillTemplate("1. A {X}\n2. {IF_NO}B\nsub of B\n3. {LIST}\n4. D", { X: "x", IF_NO: false, LIST: [] });
    expect(out).toEqual(["1. A x", "2. D"]);
  });
  it("expands a list into lines", () => {
    expect(fillTemplate("1. {L}", { L: ["first", "second"] })).toEqual(["1. first", "second"]);
  });
});

describe("ACI 318-19 exposure", () => {
  it("S2 needs w/cm 0.45 and f'c 4,500 psi with Type V", () => {
    const r = exposureRequirements({ F: "F0", S: "S2", W: "W0", C: "C0" });
    expect(r).toMatchObject({ wcm: 0.45, fc: 4500 });
    expect(r.notes.join()).toMatch(/Type V/);
  });
  it("f'c below the exposure minimum is a validation item", () => {
    const p = exampleProject();
    p.criteria.concrete.exposure = { F: "F0", S: "S2", W: "W0", C: "C0" };
    expect(validationItems(p, designProject(p)).some((v) => /19\.3\.2\.1/.test(v.text))).toBe(true);
  });
});

describe("S0 follows the project", () => {
  it("prints the cycle's codes, never California names on a model-code project", () => {
    const p = exampleProject();
    p.cycleId = "IBC2024";
    const t = text(p);
    expect(t).toMatch(/INTERNATIONAL BUILDING CODE/);
    expect(t).toMatch(/IBC 718\.2 \/ IRC R302\.11/);
    expect(t).not.toMatch(/\bCBC\b|\bCRC\b|CALIFORNIA/);
  });
  it("has no generic sizes, grades or loads that the calculations do not use", () => {
    const t = text(exampleProject());
    expect(t).not.toMatch(/2X12 DF-L|24F-V4|1\.9E WITH|SIMPSON H1 IS REQUIRED|5\/8" CDX|S2-SEVERE/);
    expect(t).toMatch(/DF-L NO\.2/);
  });
  it("truss loads and deflection are the ones the truss was designed for", () => {
    const t = text(eastLincolnTrussProject());
    expect(t).toMatch(/T-1 TOP CHORD: 15 PSF DL, 20 PSF LL/);
    expect(t).toMatch(/L\/240 FOR TOTAL LOAD OR L\/360 FOR LIVE LOAD/);
  });
});

describe("Florida cycle", () => {
  it("FBC 8th Ed.: 2021 I-code standards with ASCE 7-22 loads", async () => {
    const { getCycle } = await import("@/engine/core/codes");
    expect(getCycle("FL2023")).toMatchObject({
      asce7: "ASCE 7-22",
      nds: "NDS-2018",
      aisc360: "AISC 360-16",
      tms402: "TMS 402/602-16",
      edition: "2021",
      snowIncludesIs: false,
    });
  });
  it("S0 prints the Florida codes and FBC section references", () => {
    const p = exampleProject();
    p.cycleId = "FL2023";
    const t = text(p);
    expect(t).toMatch(/FLORIDA BUILDING CODE, BUILDING, 8TH EDITION/);
    expect(t).toMatch(/ASCE\/SEI 7-22/);
    expect(t).toMatch(/FBC 718\.2 \/ FBC-R R302\.11/);
    expect(t).not.toMatch(/\bCBC\b|CALIFORNIA/);
  });
});

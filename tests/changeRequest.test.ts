/** Smithey Duplex change request (A1–A6). */
import { describe, expect, it } from "vitest";
import { getCycle } from "@/engine/core/codes";
import { defaultAssemblies } from "@/engine/loads/dead";
import { liveLoad } from "@/engine/loads/live";
import { designBeam, type BeamInput, type DesignContext } from "@/engine/members";
import { designFooting, type FootingInput } from "@/engine/members/footing";
import { projectSchema } from "@/engine/project/schema";
import { newProject } from "@/engine/project";
import { softwareText } from "@/engine/version";

const ctx: DesignContext = {
  cycleId: "IBC2024",
  liveBasis: "IRC",
  assemblies: defaultAssemblies(),
  roofLive: { L0: 20, reduce: false },
  snow: { pg: 0, Ce: 1, Ct: 1, Is: 1, slippery: false },
  Kcr: 1.0,
  SDS: 0.2,
};

describe("A1 — model-code cycles", () => {
  it('reads the short ids "2024" / "2021" as the IBC / IRC cycles', () => {
    expect(getCycle("2024").residential).toBe("2024 IRC");
    expect(getCycle("2021").asce7).toBe("ASCE 7-16");
    const p = { ...newProject(), cycleId: "2024" };
    expect(projectSchema.parse(p).cycleId).toBe("IBC2024");
  });
  it("prints the cycle's code in live-load references (no CBC / CRC out of state)", () => {
    expect(liveLoad("living", "IRC", getCycle("IBC2024")).ref).toBe("2024 IRC Table R301.5");
    expect(liveLoad("living", "IBC", getCycle("IBC2024")).ref).not.toMatch(/CBC/);
  });
});

describe("A3 — final issue software line", () => {
  it("drops the build-status wording when final", () => {
    expect(softwareText("IBC2024", true)).not.toMatch(/pre-release|UNLOCKED/);
  });
});

const footing = (over: Partial<FootingInput>): FootingInput => ({
  id: "f",
  mark: "F-1",
  description: "",
  type: "pad",
  B: 2,
  L: 2,
  h: 10,
  depth: 12,
  c1: 8,
  fc: 3000,
  fy: 60000,
  cover: 3,
  extra: [{ kind: "point", type: "D", label: "Pier", P: 2000, x: 0 }],
  qa: 1500,
  qaSource: "presumptive",
  soilDensity: 120,
  frostDepth: 18,
  stories: 1,
  ...over,
});
const depthCheck = (f: FootingInput) => designFooting(ctx, f).checks.find((c) => c.name.startsWith("Depth below"))!;

describe("A4 — frost depth per footing", () => {
  it("interior pads default to the 12 in. minimum; strip footings take the frost depth", () => {
    expect(depthCheck(footing({})).demand).toBe(12);
    expect(depthCheck(footing({})).pass).toBe(true);
    expect(depthCheck(footing({ frost: true })).demand).toBe(18);
    expect(depthCheck(footing({ type: "strip", L: undefined, extra: [] })).demand).toBe(18);
    expect(depthCheck(footing({ type: "strip", L: undefined, extra: [], frost: false })).demand).toBe(12);
  });
});

const girder: BeamInput = {
  id: "g",
  mark: "G-1",
  description: "",
  role: "beam",
  material: { kind: "sawn", species: "SP", grade: "No.2", size: "2x10", plies: 3 },
  spans: [8],
  area: [],
  walls: [],
  extra: [
    { kind: "line", type: "D", label: "Floor", w: 200 },
    { kind: "line", type: "L", label: "Floor", w: 400 },
  ],
  bearing: [3, 3],
  luTop: 0,
  luBottom: 0,
  deflection: { preset: "floor" },
  selfWeight: false,
};

describe("A5 — built-up ply connection", () => {
  it("defaults a multi-ply sawn beam to 2 rows 16d common @ 12 in., top-loaded, with the NDS 12.3 check", () => {
    const r = designBeam(ctx, girder);
    expect(r.input.plyConnection).toMatchObject({ nail: "16d-common", rows: 2, spacing: 12, load: "top" });
    expect(r.flags.join(" ")).not.toMatch(/not designed/);
    expect(r.assumptions.some((a) => a.item === "Ply connection")).toBe(true);
  });
});

describe("A6 — girder spliced over supports", () => {
  it("adds an interior reaction 2 × wL/2 × 1.25", () => {
    const r = designBeam(ctx, { ...girder, spliced: { factor: 1.25 } });
    expect(r.reactions).toHaveLength(3);
    const R = r.reactions[2];
    expect(R.byType.D).toBeCloseTo(2 * ((200 * 8) / 2) * 1.25, 3);
    expect(R.byType.L).toBeCloseTo(2 * ((400 * 8) / 2) * 1.25, 3);
    expect(R.maxDown).toBeCloseTo(2.5 * r.reactions[0].maxDown, 6);
  });
  it("needs a single span", () => {
    expect(() => designBeam(ctx, { ...girder, spans: [8, 8], bearing: [3, 3, 3], spliced: { factor: 1.25 } })).toThrow(
      /one simple span/,
    );
  });
});

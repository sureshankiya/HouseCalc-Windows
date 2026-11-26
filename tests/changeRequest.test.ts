/** Smithey Duplex change request (A1–A6). */
import { describe, expect, it } from "vitest";
import { getCycle } from "@/engine/core/codes";
import { defaultAssemblies } from "@/engine/loads/dead";
import { liveLoad } from "@/engine/loads/live";
import { designBeam, type BeamInput, type DesignContext } from "@/engine/members";
import { designFooting, type FootingInput } from "@/engine/members/footing";
import { projectSchema } from "@/engine/project/schema";
import { designProject, exampleProject, newMemberSpec, newProject } from "@/engine/project";
import { softwareText } from "@/engine/version";
import { designSillAnchor } from "@/engine/members/sillAnchor";
import { designLintel } from "@/engine/members/lintel";
import { designCrawlSpace } from "@/engine/members/crawlSpace";

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

describe("B1 — sill anchorage", () => {
  const sa = designSillAnchor(ctx, {
    id: "sa",
    mark: "SA-1",
    description: "",
    V: 115,
    exposure: "C",
    Kzt: 1,
    Ke: 1,
    h: 15,
    G: 0.85,
    CpW: 0.8,
    X: { face: 30, height: 12, sill: 80 },
    Y: { face: 40, height: 12, sill: 60 },
    bolt: { d: 0.5, spacing: 72, embed: 7 },
    sill: { t: 1.5, G: 0.55, species: "SP" },
    Fem: 7500,
    CD: 1.6,
    SDC: "B",
  });
  it("NDS 12.3.1 wood-to-concrete bolt value (hand check: Mode IIIs, Z = 684 lb)", () => {
    expect(sa.Z).toBeCloseTo(684.14, 1);
    expect(sa.va).toBeCloseTo((684.14 * 1.6) / 6, 0);
  });
  it("ASCE 7-22 directional sill shear (hand check: q_h = 28.82 psf, v_X = 69.3 plf)", () => {
    expect(sa.qh).toBeCloseTo(28.817, 2);
    const x = sa.checks.find((c) => c.name === "Sill shear, wind, direction X")!;
    expect(x.demand).toBeCloseTo(69.33, 1);
    expect(sa.pass).toBe(true);
    expect(sa.assumptions.some((a) => a.value.includes("IRC R301.2.2"))).toBe(true);
  });
});

describe("B2 — concrete pier on a pad", () => {
  it("plain pier: φPn = 0.36 f'c [1 − (ℓc/32h)²] A1; pier weight reaches the pad", () => {
    const r = designFooting(
      ctx,
      footing({ c1: 12, c2: 12, pier: { height: 24, bearing: { b: 3.5, l: 3.5, Fcperp: 565 } } }),
    );
    const ax = r.checks.find((c) => c.name.startsWith("Pier axial"))!;
    expect(ax.capacity).toBeCloseTo(0.36 * 3000 * (1 - (24 / 384) ** 2) * 144, 0);
    expect(r.weights.stem).toBeCloseTo(150 * 1 * 2, 6);
    const wood = r.checks.find((c) => c.name.startsWith("Wood bearing"))!;
    expect(wood.demand).toBeCloseTo(2000 / 12.25, 3);
    expect(r.pierCalc?.length).toBeGreaterThan(2);
  });
});

describe("B4 — foundation wall lintel", () => {
  it("flexure and shear at d (hand check)", () => {
    const r = designLintel(ctx, {
      id: "ln",
      mark: "LN-1",
      description: "",
      opening: 3,
      bearing: 8,
      h: 16,
      b: 8,
      bars: { size: "#4", count: 2 },
      cover: 1.5,
      fc: 2500,
      fy: 60000,
      extra: [
        { kind: "line", type: "D", label: "Wall", w: 500 },
        { kind: "line", type: "L", label: "Floor", w: 400 },
      ],
    });
    const wu = 1.2 * (500 + (150 * 8 * 16) / 144) + 1.6 * 400;
    const M = r.checks.find((c) => c.name.startsWith("Flexure"))!;
    expect(M.demand).toBeCloseTo(((wu / 12) * 44 ** 2) / 8 / 12, 1);
    const a = (0.4 * 60000) / (0.85 * 2500 * 8);
    expect(M.capacity).toBeCloseTo((0.9 * 0.4 * 60000 * (14.25 - a / 2)) / 12, 0);
    const V = r.checks.find((c) => c.name.startsWith("One-way shear"))!;
    expect(V.demand).toBeCloseTo((wu / 12) * (18 - 14.25), 3);
    expect(r.pass).toBe(true);
    expect(r.flags.join(" ")).toMatch(/deep beam/);
  });
});

describe("B5 — crawl space", () => {
  it("vent area, access and clearances (IRC R408 / R317)", () => {
    const r = designCrawlSpace(ctx, {
      id: "cr",
      mark: "CR-1",
      description: "",
      area: 1000,
      vaporRetarder: true,
      vents: { count: 4, netArea: 50, nearCorners: true },
      access: { through: "wall", w: 24, h: 16, location: "" },
      stemAboveGrade: 16,
      sill: 1.5,
      girderDepth: 9.25,
      treated: false,
    });
    expect(r.checks[0].demand).toBeCloseTo(96, 6);
    expect(r.checks.find((c) => c.name.startsWith("Access"))!.pass).toBe(true);
    expect(r.checks.find((c) => c.name.startsWith("Joist clearance"))!.pass).toBe(false); // 17.5 in < 18 in
    expect(r.checks.find((c) => c.name.startsWith("Girder clearance"))!.pass).toBe(false); // 8.25 in < 12 in
  });
});

describe("B3 — stoop / short retaining wall", () => {
  const make = (returns?: { W: number; area: number; L: number }) => {
    const p = exampleProject();
    p.criteria.soil.class = "5";
    const s = p.structures[0];
    const rw = newMemberSpec(p, "retainingWall", s.id, s.levels[0].id);
    if (rw.kind !== "retainingWall") throw new Error("kind");
    rw.Hr = 3;
    rw.stem = { ...rw.stem, material: "concrete", height: 3, t: 8, plain: true };
    rw.soil = { ...rw.soil, surcharge: 100, Ka: 0.5 };
    rw.returns = returns;
    p.members.push(rw);
    const r = designProject(p).outcomes.get(rw.id)!.result;
    if (r?.kind !== "retainingWall") throw new Error("not designed");
    return r;
  };
  it("plain stem flexure / shear with 100 psf surcharge at K_a = 0.5 (hand check)", () => {
    const r = make();
    const efp = r.input.soil.efp;
    const Mu = 1.6 * ((efp * 27) / 6 + (0.5 * 100 * 9) / 2);
    const m = r.checks.find((c) => c.name.includes("plain concrete flexure"))!;
    expect(m.demand).toBeCloseTo(Mu, 6);
    const fc = r.input.stem.concrete!.fc;
    expect(m.capacity).toBeCloseTo((0.6 * 5 * Math.sqrt(fc) * ((12 * 64) / 6)) / 12, 6);
    const v = r.checks.find((c) => c.name.includes("plain concrete shear"))!;
    expect(v.capacity).toBeCloseTo(0.6 * (4 / 3) * Math.sqrt(fc) * 12 * 8, 6);
    expect(r.stability[0].friction).toBeGreaterThan(0); // Class 5: cohesion
  });
  it("return walls add to the sliding resistance", () => {
    const a = make().stability[0].friction;
    const b = make({ W: 3000, area: 10, L: 5 }).stability[0].friction;
    expect(b - a).toBeCloseTo(Math.min(130 * 10, 1500) / 5, 6);
  });
});

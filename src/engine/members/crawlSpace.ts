/**
 * CS-# crawl space — ventilation, access and wood clearance to grade (IRC R408, R317.1).
 *
 *  - Net vent area ≥ A / 150, or A / 1,500 with a Class I vapor retarder on the ground
 *    surface (R408.1, R408.2); one vent within 3 ft of each corner (R408.2)
 *  - Access ≥ 16 × 24 in. through a perimeter wall, ≥ 18 × 24 in. through the floor (R408.4)
 *  - Wood joists ≥ 18 in. and wood girders ≥ 12 in. above exposed ground, or naturally
 *    durable / preservative-treated wood (R317.1 item 1)
 *  - Levels: joists bear on the sill; girder tops flush with the top of the sill
 */

import { getCycle } from "../core/codes";
import { fmt } from "../core/fmt";
import { fromDefault } from "../core/provenance";
import { governingCheck, type Check } from "../design/wood";
import type { DesignContext } from "./common";
import type { CalcLine, CalcSheetData } from "./sillAnchor";
import type { MemberResultBase } from "./types";

export interface CrawlSpaceInput {
  id: string;
  mark: string;
  description: string;
  /** crawl space area per unit, ft² */
  area: number;
  /** Class I vapor retarder on the ground surface (A / 1,500) */
  vaporRetarder: boolean;
  vents: { count: number; netArea: number; nearCorners: boolean };
  access: { through: "wall" | "floor"; w: number; h: number; location: string };
  /** levels, in: top of stem above interior grade, sill thickness, girder depth */
  stemAboveGrade: number;
  sill: number;
  girderDepth: number;
  /** wood within the clearances is naturally durable or preservative-treated */
  treated: boolean;
}

export interface CrawlSpaceResult extends MemberResultBase, CalcSheetData {
  kind: "crawlSpace";
  input: CrawlSpaceInput;
}

export function designCrawlSpace(ctx: DesignContext, c: CrawlSpaceInput): CrawlSpaceResult {
  const rc = getCycle(ctx.cycleId).residential;
  const ratio = c.vaporRetarder ? 1500 : 150;
  const req = (c.area / ratio) * 144; // in²
  const prov = c.vents.count * c.vents.netArea;
  const [minW, minH] = c.access.through === "wall" ? [16, 24] : [18, 24];
  const aw = Math.min(c.access.w, c.access.h);
  const ah = Math.max(c.access.w, c.access.h);
  const accessOk = aw >= minW && ah >= minH;
  const joist = c.stemAboveGrade + c.sill;
  const girder = joist - c.girderDepth;
  const calc: CalcLine[] = [
    {
      head: `Ventilation — ${rc} R408.1, R408.2`,
      desc: "Crawl space area",
      expr: `A = ${fmt(c.area, 0)} ft²; ${c.vaporRetarder ? "Class I vapor retarder on the ground: 1 ft² per 1,500 ft²" : "no vapor retarder: 1 ft² per 150 ft²"}`,
    },
    {
      desc: "Net vent area",
      expr: `required = ${fmt(c.area, 0)} / ${fmt(ratio, 0)} × 144 = ${fmt(req, 1)} in²; provided = ${c.vents.count} × ${fmt(c.vents.netArea, 1)} = ${fmt(prov, 1)} in²`,
      pass: prov >= req,
    },
    { desc: "Vent within 3 ft of each corner", expr: c.vents.nearCorners ? "Yes" : "No", pass: c.vents.nearCorners },
    {
      head: `Access — ${rc} R408.4`,
      desc: `Opening through the ${c.access.through}`,
      expr: `${fmt(c.access.w, 0)} × ${fmt(c.access.h, 0)} in ≥ ${minW} × ${minH} in${c.access.location ? ` (${c.access.location})` : ""}`,
      pass: accessOk,
    },
    {
      head: `Clearance to exposed ground — ${rc} R317.1 item 1`,
      desc: "Levels",
      expr: `top of stem ${fmt(c.stemAboveGrade, 1)} in above interior grade; sill ${fmt(c.sill, 2)} in; girder depth ${fmt(c.girderDepth, 2)} in (girder top flush with top of sill)`,
    },
    {
      desc: "Underside of joists",
      expr: `${fmt(c.stemAboveGrade, 1)} + ${fmt(c.sill, 2)} = ${fmt(joist, 1)} in ≥ 18 in${joist < 18 && c.treated ? " — treated / naturally durable wood" : ""}`,
      pass: joist >= 18 || c.treated,
    },
    {
      desc: "Underside of girders",
      expr: `${fmt(joist, 1)} − ${fmt(c.girderDepth, 2)} = ${fmt(girder, 1)} in ≥ 12 in${girder < 12 && c.treated ? " — treated / naturally durable wood" : ""}`,
      pass: girder >= 12 || c.treated,
    },
  ];
  const det = (name: string, demand: number, capacity: number, unit: string): Check => ({
    name,
    category: "detailing",
    demand,
    capacity,
    ratio: capacity > 0 ? demand / capacity : demand > 0 ? Infinity : 0,
    pass: demand <= capacity,
    combo: "—",
    CD: 1,
    unit,
  });
  const checks: Check[] = [
    det(`Net vent area (${rc} R408.2)`, req, prov, "in²"),
    det("Vent within 3 ft of each corner (R408.2)", 1, c.vents.nearCorners ? 1 : 0, "—"),
    det(`Access opening ${minW} × ${minH} in. min. (R408.4)`, minW * minH, accessOk ? aw * ah : 0, "in²"),
    det("Joist clearance to grade ≥ 18 in. (R317.1)", 18, c.treated ? Math.max(joist, 18) : joist, "in"),
    det("Girder clearance to grade ≥ 12 in. (R317.1)", 12, c.treated ? Math.max(girder, 12) : girder, "in"),
  ];
  const governing = governingCheck(checks);
  const callout = `${c.vents.count} vents × ${fmt(c.vents.netArea, 0)} in² net; access ${fmt(c.access.w, 0)} × ${fmt(c.access.h, 0)} in`;
  return {
    id: c.id,
    mark: c.mark,
    kind: "crawlSpace",
    title: "Crawl space",
    callout,
    pass: checks.every((k) => k.pass),
    governing,
    checks,
    reactions: [],
    loadLines: [],
    assumptions: [
      fromDefault("Levels", "Joists bear on the sill; girder tops flush with the top of the sill", "drawings"),
    ],
    flags: [],
    input: c,
    sheetTitle: `Crawl space — ventilation, access and clearances (${rc} R408, R317)`,
    material: `${rc} R317.1, R408`,
    combos: "—",
    calc,
    summary: [
      ["Ventilation", `${fmt(prov, 0)} in² provided / ${fmt(req, 0)} in² required`],
      ["Access", `${fmt(c.access.w, 0)} × ${fmt(c.access.h, 0)} in through the ${c.access.through}`],
      ["Clearances", `joists ${fmt(joist, 1)} in; girders ${fmt(girder, 1)} in above grade`],
    ],
    limits: ["Unvented crawl spaces (R408.3) are not covered by this sheet."],
  };
}

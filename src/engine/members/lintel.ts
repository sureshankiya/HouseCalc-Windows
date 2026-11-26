/**
 * LN-# opening lintel in a concrete foundation (stem) wall — crawl access openings and
 * vents that cut the top of a bearing wall. Simple span, uniform line loads.
 *
 *  - Span: clear opening + one bearing length (centre to centre of bearing)
 *  - Factored load: ASCE 7 §2.3 combinations, wall self weight 150 pcf added
 *  - Flexure (ACI 318-19 22.2): φMn = φ A_s f_y (d − a/2), a = A_s f_y / (0.85 f'c b)
 *  - Minimum steel (9.6.1.2): A_s,min = max(3√f'c, 200) b d / f_y
 *  - One-way shear at d from the face (9.4.3.2, 22.5): no stirrups → Table 22.5.5.1(c),
 *    V_c = 8 λ_s λ ρ_w^(1/3) √f'c b d; A_v,min required where V_u > φ λ √f'c b d
 *    (9.6.3.1) unless h ≤ 10 in. (Table 9.6.3.1)
 *  - ℓn / h < 4: deep beam (9.9.1.1) — flagged; sectional design used
 */

import { getCycle } from "../core/codes";
import { combine, relevantCombinations, strengthCombinations } from "../core/combos";
import { fmt } from "../core/fmt";
import { LOAD_TYPES, zeroLoads, type LoadType } from "../core/loads";
import { fromDefault } from "../core/provenance";
import { bar, flexure, oneWayShear } from "../design/concrete";
import { governingCheck, type Check } from "../design/wood";
import { asce7Of, type DesignContext, type ExtraLoad, type LoadLine } from "./common";
import type { CalcLine, CalcSheetData } from "./sillAnchor";
import type { MemberResultBase } from "./types";

export interface LintelInput {
  id: string;
  mark: string;
  description: string;
  /** clear opening width, ft */
  opening: number;
  /** bearing length each side, in */
  bearing: number;
  /** lintel depth and width (wall thickness), in */
  h: number;
  b: number;
  bars: { size: string; count: number };
  /** clear cover to the bottom bars, in */
  cover: number;
  stirrups?: boolean;
  fc: number;
  fy: number;
  extra: ExtraLoad[];
}

export interface LintelResult extends MemberResultBase, CalcSheetData {
  kind: "lintel";
  input: LintelInput;
}

export function designLintel(ctx: DesignContext, l: LintelInput): LintelResult {
  const cy = getCycle(ctx.cycleId);
  const w = zeroLoads();
  const loadLines: LoadLine[] = [];
  for (const e of l.extra) {
    if (e.kind !== "line") throw new Error(`${e.label}: lintels take line loads — use a line link or a line load`);
    w[e.type] += e.w ?? 0;
    loadLines.push({ type: e.type, label: e.label, expr: `${fmt(e.w ?? 0, 1)} plf`, value: e.w ?? 0, unit: "plf" });
  }
  const sw = (150 * l.b * l.h) / 144;
  w.D += sw;
  loadLines.push({
    type: "D",
    label: "Lintel self weight",
    expr: `150 pcf × ${fmt(l.b, 2)} × ${fmt(l.h, 2)} in / 144`,
    value: sw,
    unit: "plf",
  });
  const present: Partial<Record<LoadType, boolean>> = { D: true };
  for (const t of LOAD_TYPES) if (Math.abs(w[t]) > 1e-9) present[t] = true;
  const combos = relevantCombinations(
    strengthCombinations({ asce7: asce7Of(ctx), SDS: ctx.SDS, includeWind: false }),
    present,
  );
  const gov = combos.map((c) => ({ c, wu: combine(w, c) })).reduce((a, b) => (b.wu > a.wu ? b : a));
  const wu = gov.wu;

  const ln = l.opening * 12; // in
  const L = ln + l.bearing;
  const Mu = ((wu / 12) * L * L) / 8; // lb-in
  const rb = bar(l.bars.size);
  const As = rb.A * l.bars.count;
  const d = l.h - l.cover - rb.d / 2;
  const fl = flexure(As, l.b, d, l.fc, l.fy);
  const AsMin = (Math.max(3 * Math.sqrt(l.fc), 200) * l.b * d) / l.fy;
  const Vu = Math.max(0, (wu / 12) * (ln / 2 - d));
  const ow = oneWayShear(l.b, d, As, l.fc);
  const phiVc = 0.75 * ow.Vc;
  const avMinAt = 0.75 * Math.sqrt(l.fc) * l.b * d;
  const needAv = !l.stirrups && l.h > 10 && Vu > avMinAt;
  const deep = ln / l.h < 4;

  const calc: CalcLine[] = [
    {
      head: "Geometry",
      desc: "Opening / bearing",
      expr: `ℓ_n = ${fmt(l.opening, 2)} ft = ${fmt(ln, 1)} in; bearing ${fmt(l.bearing, 1)} in each side; span L = ℓ_n + bearing = ${fmt(L, 1)} in`,
    },
    {
      desc: "Section",
      expr: `b = ${fmt(l.b, 2)} in; h = ${fmt(l.h, 2)} in; ${l.bars.count} ${l.bars.size} bottom, cover ${fmt(l.cover, 2)} in; d = h − cover − d_b / 2 = ${fmt(d, 3)} in`,
    },
    { desc: "Materials", expr: `f'c = ${fmt(l.fc, 0)} psi; f_y = ${fmt(l.fy, 0)} psi; normal weight (λ = 1.0)` },
    { head: "Factored load", desc: "Governing combination", expr: `${gov.c.label}: w_u = ${fmt(wu, 1)} plf` },
    {
      desc: "Factored moment",
      expr: `M_u = w_u L² / 8 = ${fmt(wu / 12, 2)} × ${fmt(L, 1)}² / 8 = ${fmt(Mu / 12000, 3)} kip-ft`,
    },
    {
      head: "Flexure — ACI 318-19 22.2",
      desc: "Steel",
      expr: `A_s = ${l.bars.count} × ${fmt(rb.A, 2)} = ${fmt(As, 3)} in²; a = A_s f_y / (0.85 f'c b) = ${fmt(fl.a, 3)} in; ε_t = ${fmt(fl.epsT, 5)}; φ = ${fmt(fl.phi, 2)}`,
    },
    {
      desc: "Design strength",
      expr: `φM_n = φ A_s f_y (d − a/2) = ${fmt(fl.phiMn / 12000, 3)} kip-ft ≥ M_u = ${fmt(Mu / 12000, 3)} kip-ft`,
      pass: Mu <= fl.phiMn,
    },
    {
      desc: "Minimum steel (9.6.1.2)",
      expr: `A_s,min = max(3√f'c, 200) b d / f_y = ${fmt(AsMin, 3)} in² ≤ A_s = ${fmt(As, 3)} in²`,
      pass: As >= AsMin,
    },
    {
      head: "Shear — ACI 318-19 22.5 (at d from the face)",
      desc: "Factored shear",
      expr: `V_u = w_u (ℓ_n / 2 − d) = ${fmt(wu / 12, 2)} × (${fmt(ln / 2, 1)} − ${fmt(d, 2)}) = ${fmt(Vu, 0)} lb`,
    },
    {
      desc: "Concrete shear (Table 22.5.5.1(c))",
      expr: `V_c = 8 λ_s λ ρ_w^(1/3) √f'c b d = ${fmt(ow.Vc, 0)} lb (λ_s = ${fmt(ow.ls, 3)}, ρ_w = ${fmt(ow.rho, 5)}); φV_c = 0.75 V_c = ${fmt(phiVc, 0)} lb ≥ V_u`,
      pass: Vu <= phiVc,
    },
    {
      desc: "Minimum shear reinforcement (9.6.3.1)",
      expr: l.stirrups
        ? "Stirrups provided"
        : l.h <= 10
          ? "h ≤ 10 in.: A_v,min not required (Table 9.6.3.1)"
          : `φ λ √f'c b d = ${fmt(avMinAt, 0)} lb ${needAv ? "< V_u: A_v,min required" : "≥ V_u: A_v,min not required"}`,
      pass: !needAv,
    },
  ];
  const checks: Check[] = [
    {
      name: "Flexure (ACI 318-19 22.2)",
      demand: Mu / 12,
      capacity: fl.phiMn / 12,
      ratio: Mu / fl.phiMn,
      pass: Mu <= fl.phiMn,
      combo: gov.c.label,
      CD: 1,
      unit: "lb-ft",
    },
    {
      name: "Minimum flexural steel (9.6.1.2)",
      category: "detailing",
      demand: AsMin,
      capacity: As,
      ratio: AsMin / As,
      pass: As >= AsMin,
      combo: "—",
      CD: 1,
      unit: "in²",
    },
    {
      name: "One-way shear at d (22.5)",
      demand: Vu,
      capacity: phiVc,
      ratio: Vu / phiVc,
      pass: Vu <= phiVc,
      combo: gov.c.label,
      CD: 1,
      unit: "lb",
    },
  ];
  if (!l.stirrups && l.h > 10)
    checks.push({
      name: "Shear without A_v,min (9.6.3.1)",
      demand: Vu,
      capacity: avMinAt,
      ratio: Vu / avMinAt,
      pass: !needAv,
      combo: gov.c.label,
      CD: 1,
      unit: "lb",
    });
  const flags = deep
    ? [
        `ℓ_n / h = ${fmt(ln / l.h, 2)} < 4: deep beam (ACI 318-19 9.9.1.1) — sectional design used; strut-and-tie (Ch. 23) to be accepted by the Engineer of Record`,
      ]
    : [];
  const callout = `${fmt(l.b, 0)} × ${fmt(l.h, 0)} in lintel, ${l.bars.count} ${l.bars.size} bottom${l.stirrups ? ", stirrups" : ""}`;
  const governing = governingCheck(checks);
  return {
    id: l.id,
    mark: l.mark,
    kind: "lintel",
    title: "Foundation wall lintel",
    callout,
    pass: checks.every((c) => c.pass),
    governing,
    checks,
    reactions: [],
    loadLines,
    assumptions: [
      fromDefault(
        "Support",
        "Simply supported on the wall each side of the opening; bottom bars extended ℓ_d past each face",
        "ACI 318-19 9.7.3",
      ),
    ],
    flags,
    input: l,
    sheetTitle: `Opening lintel in a concrete foundation wall (${cy.aci318})`,
    material: `${cy.aci318} Ch. 9, 22; ${cy.asce7} §2.3`,
    combos: `${cy.asce7} §2.3 strength combinations`,
    calc,
    summary: [
      ["Lintel", callout],
      ["Governing check", `${governing.name} — D/C ${fmt(governing.ratio, 3)}`],
    ],
    limits: [
      "Bottom bars extend ℓ_d (ACI 318-19 25.4) beyond each face of the opening; top of opening framed per the plans.",
    ],
  };
}

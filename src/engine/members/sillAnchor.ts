/**
 * SA-# sill anchorage — wind (and optional seismic) shear along the sill lines,
 * resisted by anchor bolts in single shear, wood sill to concrete.
 *
 *  - qh per ASCE 7 Eq. 26.10-1 (Kd inside qh for ASCE 7-16; qh·Kd for ASCE 7-22)
 *  - Ch. 27 directional procedure, enclosed rigid building: net horizontal pressure
 *    p = qh·Kd·G·(Cp,ww − Cp,lw) (GCpi cancels), G = 0.85, Cp,ww = 0.8, Cp,lw by L/B
 *    (Fig. 27.3-1); §27.1.5 minimum 16 psf; ASD 0.6W
 *  - V = 0.6 p × projected height above the sill × face width; v = V / sill-line length
 *    parallel to the wind
 *  - Anchor bolt: NDS 12.3.1 yield limit equations, single shear, wood sill (side member,
 *    F_es = F_e∥ = 11,200 G, load parallel to grain along the sill) to concrete (main
 *    member, F_em = 7,500 psi, l_m = embedment, the basis of NDS Table 12E); F_yb = 45,000 psi;
 *    Z' = Z C_D (C_D = 1.6; C_M, C_t, C_g, C_Δ = 1.0); v_a = Z' / s
 *  - Prescriptive: IRC R403.1.6 (bolt spacing ≤ 6 ft, embedment ≥ 7 in.)
 */

import { getCycle } from "../core/codes";
import { fmt } from "../core/fmt";
import { fromDefault, type AssumptionEntry } from "../core/provenance";
import { dowelYieldSingle } from "../design/dowel";
import { governingCheck, type Check } from "../design/wood";
import { leewardWallCp, velocityPressure, type Exposure } from "../loads/wind";
import type { DesignContext } from "./common";
import type { MemberResultBase } from "./types";

/** One printed calculation row: description, expression and (for checks) pass / fail. */
export interface CalcLine {
  head?: string;
  desc: string;
  expr: string;
  pass?: boolean;
}

export interface CalcSheetData {
  /** sheet title and material standards */
  sheetTitle: string;
  material: string;
  combos: string;
  calc: CalcLine[];
  summary: Array<[string, string]>;
  limits: string[];
}

export interface SillDirection {
  /** face width normal to the wind, ft */
  face: number;
  /** projected height above the sill (wall + roof rise), ft */
  height: number;
  /** total length of sill lines parallel to the wind, ft */
  sill: number;
  /** leeward wall Cp (absent: Fig. 27.3-1 by L/B) */
  CpL?: number;
  /** ASD seismic base shear for this direction, lb (absent: not checked) */
  Eh?: number;
}

export interface SillAnchorInput {
  id: string;
  mark: string;
  description: string;
  V: number;
  exposure: Exposure;
  Kzt: number;
  Ke: number;
  /** mean roof height, ft */
  h: number;
  G: number;
  CpW: number;
  /** wind normal to the face of width Ly (direction X) and Lx (direction Y) */
  X: SillDirection;
  Y: SillDirection;
  bolt: { d: number; spacing: number; embed: number };
  sill: { t: number; G: number; species: string };
  Fem: number;
  CD: number;
  SDC: string;
}

export interface SillAnchorResult extends MemberResultBase, CalcSheetData {
  kind: "sillAnchor";
  input: SillAnchorInput;
  qh: number;
  Z: number;
  va: number;
}

export function designSillAnchor(ctx: DesignContext, s: SillAnchorInput): SillAnchorResult {
  const cy = getCycle(ctx.cycleId);
  const vp = velocityPressure(cy.asce7, s.V, s.h, s.exposure, s.Kzt, s.Ke, false);
  const kd = cy.asce7 === "ASCE 7-22" ? `${fmt(vp.Kd, 2)} × ` : "";
  const calc: CalcLine[] = [];
  const checks: Check[] = [];
  calc.push(
    {
      head: "Wind — ASCE 7 Ch. 26 / 27 (directional procedure)",
      desc: "Basic wind speed",
      expr: `V = ${fmt(s.V, 0)} mph; Exposure ${s.exposure}; K_zt = ${fmt(s.Kzt, 2)}; K_e = ${fmt(s.Ke, 2)}; K_d = ${fmt(vp.Kd, 2)}`,
    },
    {
      desc: "Velocity pressure exposure coeff.",
      expr: `K_h = ${fmt(vp.Kz, 3)} at h = ${fmt(s.h, 1)} ft (Table 26.10-1)`,
    },
    { desc: "Velocity pressure", expr: `${vp.expr} = ${fmt(vp.q, 2)} psf` },
  );

  // NDS 12.3.1 single shear, wood sill on concrete
  const Fes = 11200 * s.sill.G;
  const y = dowelYieldSingle({ D: s.bolt.d, Fyb: 45000, ls: s.sill.t, Fes, lm: s.bolt.embed, Fem: s.Fem, thetaDeg: 0 });
  const Zp = y.Z * s.CD;
  const va = Zp / (s.bolt.spacing / 12);
  calc.push(
    {
      head: "Anchor bolt — NDS 12.3.1, single shear, wood to concrete",
      desc: "Bolt",
      expr: `D = ${fmt(s.bolt.d, 3)} in; F_yb = 45,000 psi; s = ${fmt(s.bolt.spacing, 0)} in o.c.; embedment l_m = ${fmt(s.bolt.embed, 2)} in`,
    },
    {
      desc: "Sill (side member)",
      expr: `${s.sill.species}, G = ${fmt(s.sill.G, 2)}; l_s = ${fmt(s.sill.t, 2)} in; F_es = F_e∥ = 11,200 G = ${fmt(Fes, 0)} psi (load along the sill)`,
    },
    {
      desc: "Concrete (main member)",
      expr: `F_em = ${fmt(s.Fem, 0)} psi (NDS Table 12E basis); R_e = ${fmt(y.Re, 3)}; R_t = ${fmt(y.Rt, 3)}; R_d = 4.0 / 3.6 / 3.2`,
    },
    {
      desc: "Yield modes",
      expr:
        (["Im", "Is", "II", "IIIm", "IIIs", "IV"] as const).map((k) => `${k} ${fmt(y.modes[k], 0)}`).join("; ") + " lb",
    },
    { desc: "Reference design value", expr: `Z = ${fmt(y.Z, 0)} lb (Mode ${y.mode})` },
    {
      desc: "Adjusted design value",
      expr: `Z' = Z C_D = ${fmt(y.Z, 0)} × ${fmt(s.CD, 2)} = ${fmt(Zp, 0)} lb (C_M, C_t, C_g, CΔ = 1.00)`,
    },
    {
      desc: "Allowable sill shear",
      expr: `v_a = Z' / s = ${fmt(Zp, 0)} / ${fmt(s.bolt.spacing / 12, 3)} ft = ${fmt(va, 0)} plf`,
    },
  );

  const dirs: Array<["X" | "Y", SillDirection, number]> = [
    ["X", s.X, s.Y.face],
    ["Y", s.Y, s.X.face],
  ];
  for (const [name, d, along] of dirs) {
    // L = plan dimension parallel to the wind, B = face width normal to it
    const CpL = d.CpL ?? leewardWallCp(along / d.face);
    const pCalc = vp.qEff * s.G * (s.CpW - CpL);
    const p = Math.max(pCalc, 16);
    const Vw = 0.6 * p * d.height * d.face;
    const v = Vw / d.sill;
    calc.push(
      {
        head: `Direction ${name} — wind on the ${fmt(d.face, 1)} ft face`,
        desc: "Pressure coefficients",
        expr: `G = ${fmt(s.G, 2)}; C_p,ww = ${fmt(s.CpW, 2)}; C_p,lw = ${fmt(CpL, 2)} (L/B = ${fmt(along, 1)} / ${fmt(d.face, 1)} = ${fmt(along / d.face, 2)})`,
      },
      {
        desc: "Net horizontal pressure",
        expr: `p = q_h ${kd ? "K_d " : ""}G (C_p,ww − C_p,lw) = ${fmt(vp.q, 2)} × ${kd}${fmt(s.G, 2)} × (${fmt(s.CpW, 2)} − (${fmt(CpL, 2)})) = ${fmt(pCalc, 2)} psf${pCalc < 16 ? " < 16 psf minimum (§27.1.5): p = 16.00 psf" : ""}`,
      },
      {
        desc: "Base shear (ASD)",
        expr: `V = 0.6 p H_p B = 0.6 × ${fmt(p, 2)} × ${fmt(d.height, 2)} × ${fmt(d.face, 2)} = ${fmt(Vw, 0)} lb`,
      },
      {
        desc: "Sill shear",
        expr: `v = V / ΣL_sill = ${fmt(Vw, 0)} / ${fmt(d.sill, 1)} = ${fmt(v, 1)} plf`,
        pass: v <= va,
      },
    );
    checks.push({
      name: `Sill shear, wind, direction ${name}`,
      demand: v,
      capacity: va,
      ratio: v / va,
      pass: v <= va,
      combo: "D + 0.6W",
      CD: s.CD,
      unit: "plf",
    });
    if (d.Eh) {
      const vE = d.Eh / d.sill;
      calc.push({
        desc: "Sill shear, seismic (ASD)",
        expr: `v_E = 0.7E / ΣL_sill = ${fmt(d.Eh, 0)} / ${fmt(d.sill, 1)} = ${fmt(vE, 1)} plf`,
        pass: vE <= va,
      });
      checks.push({
        name: `Sill shear, seismic, direction ${name}`,
        demand: vE,
        capacity: va,
        ratio: vE / va,
        pass: vE <= va,
        combo: "D + 0.7E",
        CD: s.CD,
        unit: "plf",
      });
    }
  }

  const sMax = 72;
  const embMin = 7;
  calc.push(
    {
      head: "Prescriptive anchorage — IRC R403.1.6",
      desc: "Bolt spacing",
      expr: `s = ${fmt(s.bolt.spacing, 0)} in ≤ ${sMax} in (6 ft); bolts within 12 in. of each sill end, minimum 2 per sill piece`,
      pass: s.bolt.spacing <= sMax,
    },
    { desc: "Embedment", expr: `l_m = ${fmt(s.bolt.embed, 2)} in ≥ ${embMin} in`, pass: s.bolt.embed >= embMin },
  );
  checks.push(
    {
      name: "Bolt spacing ≤ 6 ft (IRC R403.1.6)",
      category: "detailing",
      demand: s.bolt.spacing,
      capacity: sMax,
      ratio: s.bolt.spacing / sMax,
      pass: s.bolt.spacing <= sMax,
      combo: "—",
      CD: 1,
      unit: "in",
    },
    {
      name: "Embedment ≥ 7 in. (IRC R403.1.6)",
      category: "detailing",
      demand: embMin,
      capacity: s.bolt.embed,
      ratio: embMin / s.bolt.embed,
      pass: s.bolt.embed >= embMin,
      combo: "—",
      CD: 1,
      unit: "in",
    },
  );

  const exempt = ["A", "B", "C"].includes(s.SDC);
  const assumptions: AssumptionEntry[] = [
    fromDefault(
      "Enclosure",
      "Enclosed building, rigid (G = 0.85); internal pressure cancels in the net horizontal force",
      "ASCE 7 §26.11, 26.12",
    ),
    fromDefault(
      "Load path",
      "All wind on the projected area above the sill reaches the sill lines parallel to the wind in proportion to length",
      "rigid / simplified distribution",
    ),
    fromDefault(
      "Seismic",
      exempt && !s.X.Eh && !s.Y.Eh
        ? `SDC ${s.SDC}: detached one- and two-family dwellings are exempt from the seismic provisions (IRC R301.2.2); seismic sill shear not checked`
        : "Seismic sill shear checked where an ASD base shear is entered",
      "IRC R301.2.2",
    ),
  ];
  const callout = `${fmtBolt(s.bolt.d)} anchor bolts @ ${fmt(s.bolt.spacing, 0)} in o.c., ${fmt(s.bolt.embed, 0)} in embedment, ${fmt(s.sill.t, 2)} in ${s.sill.species} sill`;
  const governing = governingCheck(checks);
  return {
    id: s.id,
    mark: s.mark,
    kind: "sillAnchor",
    title: "Sill anchorage",
    callout,
    pass: checks.every((c) => c.pass),
    governing,
    checks,
    reactions: [],
    loadLines: [],
    assumptions,
    flags: [],
    input: s,
    qh: vp.q,
    Z: y.Z,
    va,
    sheetTitle: `Sill anchorage — wind sill shear (${cy.asce7}, ANSI/AWC ${cy.nds})`,
    material: `${cy.asce7} Ch. 26, 27; ANSI/AWC ${cy.nds} 12.3; ${cy.residential} R403.1.6`,
    combos: "D + 0.6W (ASD); D + 0.7E where entered",
    calc,
    summary: [
      ["Anchorage", callout],
      ["Governing check", `${governing.name} — D/C ${fmt(governing.ratio, 3)}`],
    ],
    limits: [
      "Shear walls, hold-downs and their anchorage are designed on their own sheets where required.",
      "Plate washers per the shear-wall schedule where shear walls bear on the sill.",
    ],
  };
}

const fmtBolt = (d: number) =>
  (({ 0.5: "1/2 in.", 0.625: "5/8 in.", 0.75: "3/4 in." }) as Record<number, string>)[d] ?? `${fmt(d, 3)} in.`;

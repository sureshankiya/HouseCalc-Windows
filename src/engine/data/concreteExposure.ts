/**
 * ACI 318-19 exposure categories and classes (Table 19.3.1.1) and the concrete requirements
 * for each class (Table 19.3.2.1): maximum w/cm, minimum f'c, cementitious / air limits.
 * ACI 318-19 replaced the 318-14 "P" (permeability) category with "W" (in contact with water).
 */

export type ExposureF = "F0" | "F1" | "F2" | "F3";
export type ExposureS = "S0" | "S1" | "S2" | "S3";
export type ExposureW = "W0" | "W1" | "W2";
export type ExposureC = "C0" | "C1" | "C2";
export interface ConcreteExposure {
  F: ExposureF;
  S: ExposureS;
  W: ExposureW;
  C: ExposureC;
}

export const DEFAULT_EXPOSURE: ConcreteExposure = { F: "F0", S: "S0", W: "W0", C: "C0" };

interface ClassReq {
  label: string;
  /** maximum w/cm (undefined = no limit) */
  wcm?: number;
  /** minimum f'c, psi */
  fc: number;
  /** cementitious / air / chloride requirement, as worded for the notes */
  note?: string;
}

export const EXPOSURE_CLASSES: {
  F: Record<ExposureF, ClassReq>;
  S: Record<ExposureS, ClassReq>;
  W: Record<ExposureW, ClassReq>;
  C: Record<ExposureC, ClassReq>;
} = {
  F: {
    F0: { label: "Not applicable", fc: 2500 },
    F1: { label: "Moderate", wcm: 0.55, fc: 3500, note: "Air entrainment per ACI 318 Table 19.3.3.1" },
    F2: { label: "Severe", wcm: 0.45, fc: 4500, note: "Air entrainment per ACI 318 Table 19.3.3.1" },
    F3: {
      label: "Very severe",
      wcm: 0.4,
      fc: 5000,
      note: "Air entrainment per ACI 318 Table 19.3.3.1; supplementary cementitious materials limited per 26.4.2.2(b)",
    },
  },
  S: {
    S0: { label: "Not applicable", fc: 2500 },
    S1: { label: "Moderate", wcm: 0.5, fc: 4000, note: "ASTM C150 Type II (or C595 / C1157 MS)" },
    S2: { label: "Severe", wcm: 0.45, fc: 4500, note: "ASTM C150 Type V (or C595 / C1157 HS)" },
    S3: {
      label: "Very severe",
      wcm: 0.45,
      fc: 4500,
      note: "ASTM C150 Type V plus pozzolan or slag cement (or C595 / C1157 HS plus pozzolan or slag cement)",
    },
  },
  W: {
    W0: { label: "Dry in service", fc: 2500 },
    W1: { label: "In contact with water, low permeability not required", fc: 2500 },
    W2: { label: "In contact with water, low permeability required", wcm: 0.5, fc: 4000 },
  },
  C: {
    C0: { label: "Not applicable", fc: 2500 },
    C1: { label: "Moderate", fc: 2500 },
    C2: { label: "Severe", wcm: 0.4, fc: 5000 },
  },
};

/** Governing mix requirements for a set of exposure classes (the most restrictive of each). */
export function exposureRequirements(e: ConcreteExposure): { wcm?: number; fc: number; notes: string[] } {
  const reqs = [EXPOSURE_CLASSES.F[e.F], EXPOSURE_CLASSES.S[e.S], EXPOSURE_CLASSES.W[e.W], EXPOSURE_CLASSES.C[e.C]];
  const limits = reqs.flatMap((r) => (r.wcm === undefined ? [] : [r.wcm]));
  return {
    wcm: limits.length ? Math.min(...limits) : undefined,
    fc: Math.max(...reqs.map((r) => r.fc)),
    notes: reqs.flatMap((r) => (r.note ? [r.note] : [])),
  };
}

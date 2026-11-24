/**
 * Content of the S0 general notes drawing sheet, laid out like the engineer's issued S0 sheets:
 * titled panels of all-caps notes (their standard text, s0Template.ts, overridable per project)
 * plus the parts generated from the project so the sheet agrees with the calculations — codes
 * and standards, structural criteria, symbol legend, lap splice schedule (from f'c), nailing,
 * shear wall and hardware schedules, special inspections, deferred submittals, drawing index.
 */

import { getCycle } from "../core/codes";
import { fmt } from "../core/fmt";
import { DEFAULT_EXPOSURE, EXPOSURE_CLASSES, exposureRequirements } from "../data/concreteExposure";
import { S0_TEMPLATE } from "../data/s0Template";
import { TYPICAL_NAILING } from "../data/nailing";
import { nailDef } from "../design/dowel";
import type { PlyConnectionInput } from "../design/plies";
import { resolveWood, type WoodMaterial } from "../design/wood";
import { assemblyDesignValue } from "../loads/dead";
import { DEFLECTION_PRESETS } from "../loads/deflection";
import { liveLoad } from "../loads/live";
import type { AnyResult, ProjectDesign } from "./design";
import { issuedNoteLine } from "./drawingData";
import { generateNotes, hardwareSchedule } from "./notes";
import type { Project } from "./schema";

export type S0Panel =
  | { title: string; kind: "notes"; lines: string[] }
  | {
      title: string;
      kind: "criteria";
      groups: Array<{ head: string; rows: Array<[string, string]> }>;
      foot: string[];
    }
  | {
      title: string;
      kind: "table";
      head: string[];
      /** column width fractions */
      widths: number[];
      rows: string[][];
      caption?: string;
      foot?: string[];
    };

export interface GeneralNotesSheet {
  panels: S0Panel[];
  /** sheet number, title */
  index: Array<[string, string]>;
  sheetNo: string;
}

/**
 * Tension lap splices, inches, per ACI 318-19 25.4.2.3 (simplified, Grade 60 uncoated, normal
 * weight; ψt = 1.3 top bars) and 25.5.2: Class A = 1.0 ld, Class B = 1.3 ld, 12 in. minimum.
 * Rows: class, location, #3 … #8.
 */
export function lapSpliceTable(fc: number, fy: number): string[][] {
  const bars = [3, 4, 5, 6, 7, 8];
  const ld = (n: number) => (fy * (n / 8)) / ((n <= 6 ? 25 : 20) * Math.sqrt(Math.min(fc, 10000)));
  const row = (cls: string, loc: string, k: number) => [
    cls,
    loc,
    ...bars.map((n) => String(Math.max(12, Math.ceil(k * ld(n) - 1e-9)))),
  ];
  return [row("A", "TOP", 1.3), row("A", "BOTTOM", 1), row("B", "TOP", 1.3 * 1.3), row("B", "BOTTOM", 1.3)];
}

const plyText = (c: PlyConnectionInput) =>
  c.fastener === "nail"
    ? `${c.rows} rows ${nailDef(c.nail ?? "16d-common").label}`
    : `${c.rows} rows ${fmt(c.boltDia ?? 0.5, 3)} in. dia. through-bolts`;

const up = (s: string) => s.toUpperCase();
const psi = (n: number) => Math.round(n).toLocaleString("en-US");

/** every object in a member input tree (materials sit at different depths per member kind) */
function eachObject(x: unknown, f: (o: Record<string, unknown>) => void) {
  if (Array.isArray(x)) for (const v of x) eachObject(v, f);
  else if (x && typeof x === "object") {
    f(x as Record<string, unknown>);
    for (const v of Object.values(x)) eachObject(v, f);
  }
}

/**
 * Template placeholder values. Text: replaced in the line. List: the line is dropped when empty;
 * the first item replaces the placeholder and the rest follow as lines. Condition: the line is kept
 * only when true.
 */
export type S0Value = string | string[] | boolean;

/**
 * Fill one template text: placeholders, dropped lines (a dropped numbered note takes its
 * unnumbered sub-lines with it), `post` applied to each line, numbered notes renumbered.
 */
export function fillTemplate(
  text: string,
  vars: Record<string, S0Value>,
  post: (line: string) => string = (l) => l,
): string[] {
  const numbered = (l: string) => /^\d+\.\s/.test(l);
  const out: string[] = [];
  let skipping = false;
  for (const raw of lines(text)) {
    if (skipping && !numbered(raw)) continue;
    skipping = false;
    let line = raw;
    let extra: string[] = [];
    let keep = true;
    for (const [, key] of raw.matchAll(/\{([A-Z0-9_]+)\}/g)) {
      const v = vars[key];
      if (v === undefined) continue;
      if (typeof v === "boolean") keep &&= v;
      else if (Array.isArray(v)) {
        if (!v.length) keep = false;
        else {
          line = line.replace(`{${key}}`, v[0]);
          extra = [...extra, ...v.slice(1)];
        }
        continue;
      }
      line = line.replace(`{${key}}`, typeof v === "string" ? v : "");
    }
    // a note emptied by `post` (final-issue wording removed) goes, number and all
    if (keep) out.push(...[line, ...extra].map(post).filter((l) => l && !/^\d+\.$/.test(l.trim())));
    else skipping = numbered(raw);
  }
  let n = 0;
  return out.map((l) => (numbered(l) ? l.replace(/^\d+/, String(++n)) : l));
}
/** template text: markdown emphasis and quote markers removed, one note per line */
const lines = (s: string) =>
  s
    .split(/\n+/)
    .map((l) => l.replace(/\*\*/g, "").replace(/^>\s*/, "").trim())
    .filter(Boolean);

export function generalNotesSheet(
  p: Project,
  d: ProjectDesign,
  /** from the drawing set: the full drawing index, and the detail(s) a mark is drawn in ("2/S-6") */
  set?: { index: Array<[string, string]>; detailRef: (mark: string) => string },
): GeneralNotesSheet {
  const c = getCycle(p.cycleId);
  const rs = [...d.outcomes.values()].flatMap((o) => (o.result ? [o.result] : []));
  const has = (...k: AnyResult["kind"][]) => rs.some((r) => k.includes(r.kind));
  const cr = p.criteria;
  const L = d.lateral;
  const gen = generateNotes(p, d);
  const final = (p.info.issue ?? "final") === "final";
  const issued = (l: string) => (final ? issuedNoteLine(l) : l);
  const concrete = has("footing", "holdownFooting", "masonryWall", "tieIn", "basePlate", "retainingWall", "shearWall");
  const steel = has("steelBeam", "steelColumn", "basePlate", "steelTruss", "guardPost");
  const cmu = rs.some(
    (r) =>
      (r.kind === "masonryWall" && r.input.material === "cmu") ||
      (r.kind === "retainingWall" && r.input.stem.material === "cmu"),
  );

  const vars = s0Values(p, d, rs);
  const fill = (key: string): string[] =>
    fillTemplate(p.s0Notes?.[key] ?? S0_TEMPLATE[key] ?? "", vars, (l) => issued(up(l)));
  const panel = (key: string, title = key): S0Panel => ({ title, kind: "notes", lines: fill(key) });

  // ---------------------------------------------------------------- codes and standards
  const jur = p.info.jurisdiction.trim();
  const codes = [
    `${c.building.split(" / ")[0]} (${c.buildingName}${jur ? `), including the ${jur} amendments` : ")"}.`,
    `${c.residential.split(" / ")[0]} (${c.residentialName}), where applicable to one- and two-family dwellings and accessory structures.`,
    ...(vars.IF_EXISTING ? [`${c.existingCode} for work on existing construction.`] : []),
    `ASCE/SEI ${c.asce7.replace("ASCE ", "")} for the determination of dead, live, roof, snow, wind and seismic loads.`,
    `ANSI/AWC ${c.nds} (National Design Specification for Wood Construction) with the ${c.ndsSupplement}.`,
    `ANSI/AWC ${c.sdpws} (Special Design Provisions for Wind and Seismic) for shear walls and diaphragms.`,
    ...(concrete
      ? [`${c.aci318} for structural concrete, including reinforcing details, anchorage and development lengths.`]
      : []),
    ...(cmu ? [`${c.tms402} for masonry construction.`] : []),
    ...(steel ? [`ANSI/${c.aisc360} for structural steel.`] : []),
    ...(has("cfsWall") ? ["AISI S100 / AISI S240 for cold-formed steel framing."] : []),
    "ASTM standards as referenced in these notes; ICC-ES evaluation reports (ESR) for all proprietary connectors, anchors, engineered lumber and panels.",
  ].map((s, i) => up(`${i + 1}. ${s}`));

  // ---------------------------------------------------------------- structural criteria
  const uses = new Map<string, string>();
  for (const m of p.members) {
    const add = (use?: string) => {
      if (!use) return;
      const l = liveLoad(use as Parameters<typeof liveLoad>[0], cr.liveBasis);
      uses.set(l.label, `${fmt(l.psf, 0)} PSF`);
    };
    if ("live" in m && m.live) add((m.live as { use?: string }).use);
    if (m.kind === "beam") for (const a of m.area) add(a.live?.use);
  }
  const presets = new Set(p.members.flatMap((x) => ("deflection" in x ? [x.deflection.preset] : [])));
  // subscripts written plainly as on the issued sheets (S_DS -> SDS)
  const r2 = (a: string, b: string): [string, string] => [up(a.replace(/_/g, "")), up(b)];
  const groups: Array<{ head: string; rows: Array<[string, string]> }> = [
    {
      head: `GRAVITY LOADS (${up(c.building.split(" / ")[0])} CH. 16 & ${c.asce7})`,
      rows: [
        r2("Risk category", cr.riskCategory),
        ...p.assemblies.map((a) => r2(`${a.name} dead`, `${fmt(assemblyDesignValue(a), 0)} psf`)),
        ...[...uses].map(([k, v]) => r2(`${k} live`, v)),
        r2("Roof live", `${fmt(cr.roofLive.L0, 0)} psf${cr.roofLive.reduce ? " (reducible)" : ""}`),
        r2("Ground snow, p_g", `${fmt(cr.snow.pg, 0)} psf`),
      ],
    },
    ...(presets.size
      ? [
          {
            head: "DEFLECTION CRITERIA",
            rows: Object.values(DEFLECTION_PRESETS)
              .filter((x) => presets.has(x.preset))
              .map((x) => r2(x.label, `L/${x.live} live, L/${x.total} total`)),
          },
        ]
      : []),
    {
      head: `SEISMIC DESIGN PARAMETERS (${c.asce7} CH. 11-12)`,
      rows: [
        r2("Risk category", cr.riskCategory),
        r2("Site class", cr.seismic.siteClass),
        r2("Seismic design category", cr.seismic.SDC),
        r2("S_DS / S_D1", `${fmt(cr.seismic.SDS, 3)} / ${fmt(cr.seismic.SD1, 3)}`),
        ...(L
          ? [
              r2("Importance factor, I_e", fmt(L.Ie, 2)),
              r2("Basic seismic-force-resisting system", L.system.label),
              r2("R / Ω0 / C_d", `${fmt(L.system.R, 1)} / ${fmt(L.system.Omega0, 1)} / ${fmt(L.system.Cd, 1)}`),
              r2("Seismic response coefficient, C_s", fmt(L.cs.Cs, 4)),
              r2("Design base shear, V (strength)", `${fmt(L.dist.V, 0)} lb`),
              r2("Redundancy factor, ρ", fmt(L.rho, 2)),
              r2(
                "Analysis procedure",
                L.seismicMethod === "simplified" ? "Simplified alternative (12.14)" : "Equivalent lateral force (12.8)",
              ),
            ]
          : []),
      ],
    },
    {
      head: `WIND DESIGN PARAMETERS (${c.asce7} CH. 26-30)`,
      rows: [
        r2("Basic wind speed, V (ultimate)", `${fmt(cr.wind.V, 0)} mph`),
        r2("Risk category", cr.riskCategory),
        r2("Exposure category", cr.wind.exposure),
        r2("Directionality factor, K_d", "0.85"),
        r2("Topographic factor, K_zt", fmt(cr.wind.Kzt, 2)),
        ...(L ? [r2("Mean roof height", `${fmt(L.h, 1)} ft`)] : []),
        r2("Enclosure / GC_pi", "Enclosed / ±0.18"),
        ...(L
          ? [r2("MWFRS procedure", L.windMethod === "directional" ? "Directional (Ch. 27)" : "Envelope (Ch. 28)")]
          : []),
        r2("Components and cladding", "Ch. 30"),
      ],
    },
    {
      head: "FOUNDATION",
      rows: [
        r2("Allowable soil bearing", `${fmt(cr.soil.bearing, 0)} psf`),
        r2("Basis", cr.soil.source),
        ...(concrete
          ? [
              r2("Concrete, f'c (28 days)", `${fmt(cr.concrete.fc, 0)} psi`),
              r2("Reinforcement", `ASTM A615 Gr. ${fmt(cr.concrete.fy / 1000, 0)}`),
            ]
          : []),
      ],
    },
  ];

  // ---------------------------------------------------------------- symbol legend
  const legend = new Map<string, string>();
  for (const r of rs) {
    const pre =
      r.mark
        .replace(/^\([EN]\)/, "")
        .replace(/^\d+/, "")
        .replace(/-?\d+[A-Z]?$/, "") || r.mark;
    if (!legend.has(pre)) legend.set(pre, up(r.title));
  }
  const hw = hardwareSchedule(p, d);
  for (const h of hw) if (!legend.has(up(h.model))) legend.set(up(h.model), up(h.description || h.model));
  for (const [k, v] of [
    ["PT", "PRESSURE-TREATED LUMBER"],
    ["TYP", "TYPICAL"],
    ["U.N.O.", "UNLESS NOTED OTHERWISE"],
    ["(E)", "EXISTING"],
    ["(N)", "NEW"],
  ])
    legend.set(k, v);

  // ---------------------------------------------------------------- nailing (designed)
  const nailing: string[][] = [];
  for (const r of rs) {
    if (r.kind === "shearWall")
      for (const s of r.sides)
        nailing.push([
          r.mark,
          `Shear wall sheathing - ${s.row.label}`,
          s.row.nail,
          `${s.spacing} in. edges / 12 in. field, blocked`,
        ]);
    if (r.kind === "diaphragm")
      nailing.push([r.mark, "Diaphragm sheathing", r.callout, r.input.blocked ? "Blocked" : "Unblocked"]);
    if (r.kind === "transfer") nailing.push([r.mark, "Shear transfer", r.callout, "Full length of the shear wall"]);
    if (r.kind === "beam" && r.input.plyConnection && r.input.material.kind !== "glulam")
      nailing.push([
        r.mark,
        "Built-up plies",
        plyText(r.input.plyConnection),
        `${fmt(r.input.plyConnection.spacing, 0)} in. o.c., staggered`,
      ]);
    if (r.kind === "joist" && r.input.sister?.connection)
      nailing.push([
        r.mark,
        "Sister joist to existing",
        plyText(r.input.sister.connection),
        `${fmt(r.input.sister.connection.spacing, 0)} in. o.c.`,
      ]);
    if (r.kind === "ceilingJoist" && r.input.heel)
      nailing.push([
        r.mark,
        "Rafter to ceiling joist (heel)",
        `${r.input.heel.count}-${nailDef(r.input.heel.nail).label}`,
        "Face nail each heel",
      ]);
  }
  // one row per identical connection, listing every mark that uses it
  const merged = new Map<string, string[]>();
  for (const [mark, ...rest] of nailing) {
    const key = rest.join("\u0000");
    merged.set(key, [...(merged.get(key) ?? []), mark]);
  }
  const nailingRows = [...merged].map(([key, marks]) => [marks.join(", "), ...key.split("\u0000")].map(up));

  // ---------------------------------------------------------------- shear wall schedule
  const walls = rs.flatMap((r) => (r.kind === "shearWall" ? [r] : []));
  const wallRows = walls.map((r) =>
    [
      r.mark,
      r.sides.map((s) => s.row.label).join(" + "),
      r.sides.map((s) => `${s.row.nail} @ ${s.spacing}/12`).join(" + "),
      r.rod ? "Continuous rod" : r.holdown ? `${r.holdown.item.model} (${r.post.label})` : "-",
      r.input.sill.type === "framing"
        ? "Sole plate to floor framing, see shear transfer"
        : `${fmt(r.input.sill.d, 3)} in. dia. ${r.input.sill.type === "post-installed" ? "adhesive anchor" : "A.B."} @ ${fmt(r.input.sill.spacing, 0)} in. o.c., ${fmt(r.input.sill.embed, 0)} in. emb.`,
      ...(set ? [set.detailRef(r.mark) || "-"] : []),
    ].map(up),
  );

  // ---------------------------------------------------------------- hardware schedule
  const hardware = hw.map((h) =>
    [`${h.manufacturer} ${h.model}`.trim(), h.description, h.fasteners || "Per manufacturer", h.usedAt.join("; ")].map(
      up,
    ),
  );

  // generated sections not already covered by the standard text
  const covered = new Set([
    "Codes and design criteria",
    "Foundations and concrete",
    "Wood framing",
    "Connectors",
    "General",
  ]);
  const extra: S0Panel[] = gen.sections
    .filter((s) => !covered.has(s.title))
    .map((s) => ({
      title: up(`${s.title} notes`),
      kind: "notes",
      lines: s.notes.map((n, i) => up(issued(`${i + 1}. ${n}`))),
    }));

  const index: Array<[string, string]> =
    set?.index ??
    ((p.drawingIndex ?? []).length
      ? p.drawingIndex!.map((s) => [up(s.number), up(s.title)])
      : [["S-0", "GENERAL NOTES AND SPECIFICATIONS"]]);

  const all: S0Panel[] = [
    ...(concrete
      ? [
          panel("REINFORCED CONCRETE NOTES"),
          {
            title: "REINFORCED CONCRETE LAP SPLICE SCHEDULE",
            kind: "table" as const,
            caption: `F'C = ${fmt(cr.concrete.fc, 0)} PSI AT 28 DAYS - LAP LENGTH (INCHES)`,
            head: ["SPLICE CLASS", "LOCATION", "#3", "#4", "#5", "#6", "#7", "#8"],
            widths: [0.17, 0.19, 0.11, 0.11, 0.11, 0.11, 0.1, 0.1],
            rows: lapSpliceTable(cr.concrete.fc, cr.concrete.fy),
            foot: [
              `TENSION LAP SPLICES PER ${c.aci318} 25.4.2.3 AND 25.5.2, GRADE ${fmt(cr.concrete.fy / 1000, 0)} UNCOATED BARS, NORMAL-WEIGHT CONCRETE. CLEAR SPACING AND COVER NOT LESS THAN d_b. TOP BARS: MORE THAN 12 IN. OF FRESH CONCRETE CAST BELOW THE SPLICE. USE CLASS B UNLESS NOTED OTHERWISE.`,
            ],
          },
        ]
      : []),
    { title: "SYMBOL LEGEND", kind: "table", head: ["SYMBOL", "DESCRIPTION"], widths: [0.28, 0.72], rows: [...legend] },
    panel("SITE DRAINAGE RECOMMENDATIONS"),
    ...(has("truss", "woodTruss") ? [panel("ENGINEERED WOOD TRUSSES/RAFTER")] : []),
    { title: "CODES AND STANDARDS", kind: "notes", lines: [...codes, ...fill("CODES AND STANDARDS NOTES")] },
    { title: "STRUCTURAL CRITERIA", kind: "criteria", groups, foot: fill("STRUCTURAL CRITERIA NOTES") },
    panel("NAILING SCHEDULE"),
    ...(nailingRows.length
      ? [
          {
            title: "NAILING SCHEDULE - DESIGNED CONNECTIONS",
            kind: "table" as const,
            head: ["MARK", "CONNECTION", "FASTENER", "SPACING"],
            widths: [0.15, 0.31, 0.27, 0.27],
            rows: nailingRows,
          },
        ]
      : []),
    {
      title: "FASTENING SCHEDULE - TYPICAL FRAMING",
      kind: "table",
      head: ["CONNECTION", "FASTENER", "LOCATION / SPACING"],
      widths: [0.44, 0.27, 0.29],
      rows: TYPICAL_NAILING.map((r) => r.map(up)),
      foot: [
        `COMMON WIRE NAILS PER ${up(c.building.split(" / ")[0])} TABLE 2304.10.2 / ${up(c.residential.split(" / ")[0])} TABLE R602.3(1) UNLESS NOTED. SCHEDULED CONNECTIONS ON THE PLANS AND CALCULATIONS GOVERN.`,
      ],
    },
    panel("WOOD FRAMING NOTES"),
    ...(wallRows.length
      ? [
          {
            title: "SHEAR WALL SCHEDULE",
            kind: "table" as const,
            head: ["MARK", "SHEATHING", "EDGE / FIELD NAILING", "HOLDOWN", "SILL ANCHOR", ...(set ? ["DETAIL"] : [])],
            widths: set ? [0.1, 0.22, 0.2, 0.16, 0.2, 0.12] : [0.12, 0.25, 0.23, 0.18, 0.22],
            rows: wallRows,
            foot: [
              "ALL PANEL EDGES BLOCKED. 3/8 IN. MIN. NAIL EDGE DISTANCE. SILL ANCHORS WITH 3 IN. X 3 IN. X 0.229 IN. PLATE WASHERS. HOLDOWNS PER MANUFACTURER WITH ALL SPECIFIED FASTENERS.",
            ],
          },
        ]
      : []),
    ...(hardware.length
      ? [
          {
            title: "HARDWARE SCHEDULE",
            kind: "table" as const,
            head: ["PRODUCT", "DESCRIPTION", "FASTENERS", "LOCATION"],
            widths: [0.22, 0.24, 0.26, 0.28],
            rows: hardware,
            foot: [
              "INSTALL ALL CONNECTORS WITH THE FULL NUMBER AND SIZE OF FASTENERS LISTED BY THE MANUFACTURER. SUBSTITUTIONS REQUIRE THE ENGINEER'S APPROVAL.",
            ],
          },
        ]
      : []),
    ...extra,
    ...(gen.inspections.length
      ? [
          {
            title: `SPECIAL INSPECTIONS (${up(c.building.split(" / ")[0])} CH. 17)`,
            kind: "table" as const,
            head: ["ITEM", "TYPE", "MEMBERS"],
            widths: [0.55, 0.2, 0.25],
            rows: gen.inspections.map((i) => [i.item, i.type, i.members].map(up)),
          },
        ]
      : []),
    ...(gen.deferred.length
      ? [
          {
            title: "DEFERRED SUBMITTALS",
            kind: "notes" as const,
            lines: gen.deferred.map((s, i) => up(`${i + 1}. ${s}`)),
          },
        ]
      : []),
    { title: "DRAWING INDEX", kind: "table", head: ["NO.", "DRAWING INDEX"], widths: [0.2, 0.8], rows: index },
    panel("GENERAL STRUCTURAL NOTES"),
    panel("GENERAL NOTES"),
    panel("MISCELLANEOUS"),
    ...(p.notes.trim()
      ? [
          {
            title: "PROJECT NOTES",
            kind: "notes" as const,
            lines: p.notes
              .split(/\n+/)
              .map((l) => up(issued(l).trim()))
              .filter(Boolean),
          },
        ]
      : []),
  ];
  const panels = all.filter((x) => x.kind !== "notes" || x.lines.length);

  return { panels, index, sheetNo: index[0][0] };
}

/** Values for the S0 template placeholders, taken from the project and its calculation results. */
export function s0Values(p: Project, d: ProjectDesign, rs: AnyResult[]): Record<string, S0Value> {
  const c = getCycle(p.cycleId);
  const cr = p.criteria;
  const has = (...k: AnyResult["kind"][]) => rs.some((r) => k.includes(r.kind));
  const of = <K extends AnyResult["kind"]>(k: K) =>
    rs.filter((r): r is Extract<AnyResult, { kind: K }> => r.kind === k);
  const code = (full: string) => full.split(" ")[1] ?? full;
  const nds = c.nds;

  // materials anywhere in the member inputs
  const grades = new Set<string>();
  const scl = new Map<string, string>();
  const glulam = new Set<string>();
  let builtUp = false;
  for (const m of p.members)
    eachObject(m, (o) => {
      if (typeof o.species === "string" && typeof o.grade === "string") grades.add(`${o.species} ${o.grade}`);
      if ((o.kind === "sawn" || o.kind === "scl") && typeof o.plies === "number" && o.plies > 1) builtUp = true;
      if (o.kind === "glulam" && typeof o.combo === "string") glulam.add(o.combo);
      if (o.kind === "scl" && typeof o.product === "string" && !scl.has(o.product)) {
        const w = resolveWood(o as unknown as WoodMaterial, nds);
        scl.set(
          o.product,
          `${w.speciesLabel}: E = ${psi(w.E)} psi, Fb = ${psi(w.Fb)} psi, Fv = ${psi(w.Fv)} psi, Fc⊥ = ${psi(w.Fcperp)} psi.`,
        );
      }
    });

  // concrete exposure (ACI 318-19 Tables 19.3.1.1 / 19.3.2.1)
  const e = cr.concrete.exposure ?? DEFAULT_EXPOSURE;
  const req = exposureRequirements(e);
  const X = EXPOSURE_CLASSES;
  const exposure = [
    "Struct. member - exposure category and class",
    "Footings, walls, grade beams:",
    `F. Freezing and thawing: ${e.F}-${X.F[e.F].label}`,
    `S. Sulfate: ${e.S}-${X.S[e.S].label}`,
    `W. In contact with water: ${e.W}-${X.W[e.W].label}`,
    `C. Corrosion prot. of reinf.: ${e.C}-${X.C[e.C].label}`,
  ];
  const mix = [
    `Concrete compressive strength, f'c: ${psi(cr.concrete.fc)} psi (ACI minimum for these classes ${psi(req.fc)} psi)`,
    `Maximum water to cementitious materials ratio: ${req.wcm === undefined ? "no limit" : fmt(req.wcm, 2)}`,
    `Cementitious material: ${X.S[e.S].note ?? "no restriction on cement type (ASTM C150)"}`,
    ...req.notes.filter((n) => n !== X.S[e.S].note),
  ];

  // trusses
  const roofDl = p.assemblies.filter((a) => a.kind === "roof");
  const ceilingDl = p.assemblies.filter((a) => a.kind === "ceiling");
  const atticLive = Math.max(
    liveLoad("attic-no-storage", cr.liveBasis).psf,
    ...of("woodTruss").map((r) => r.input.atticLive),
  );
  const snow = cr.snow.pg > 0 ? `, ground snow p_g = ${fmt(cr.snow.pg, 0)} psf` : "";
  const deadOf = (r: { assemblyId?: string; psf?: number }) => {
    const a = r.assemblyId ? p.assemblies.find((x) => x.id === r.assemblyId) : undefined;
    return a ? assemblyDesignValue(a) : (r.psf ?? 0);
  };
  // engineered trusses: the loads each truss was designed for; otherwise the roof / ceiling assemblies
  const designed = of("woodTruss").map(
    (r) =>
      `${r.mark} top chord: ${fmt(deadOf(r.input.roofDead), 0)} psf DL${r.input.roofLive ? `, ${fmt(cr.roofLive.L0, 0)} psf LL` : ""}${r.input.snow ? snow : ""}; bottom chord: ${fmt(deadOf(r.input.ceilingDead), 0)} psf DL, ${fmt(r.input.atticLive, 0)} psf LL (not concurrent w/ top chord LL)`,
  );
  const trussLoads = designed.length
    ? designed
    : [
        ...roofDl.map(
          (a) =>
            `${a.name} (top chord): ${fmt(assemblyDesignValue(a), 0)} psf DL, ${fmt(cr.roofLive.L0, 0)} psf LL${snow}`,
        ),
        ...ceilingDl.map(
          (a) =>
            `${a.name} (bottom chord): ${fmt(assemblyDesignValue(a), 0)} psf DL, ${fmt(atticLive, 0)} psf LL (not concurrent w/ top chord LL)`,
        ),
      ];
  // deflection limits of the roof framing as designed (preset, or the member's own L/n)
  const roofLimits = p.members.flatMap((m) => {
    if (!("deflection" in m) || !m.deflection) return [];
    const dl = m.deflection as { preset: string; live?: number; total?: number };
    const roofMember = m.kind === "woodTruss" || m.kind === "rafter" || dl.preset.startsWith("roof");
    if (!roofMember) return [];
    if (dl.preset in DEFLECTION_PRESETS) return [DEFLECTION_PRESETS[dl.preset as keyof typeof DEFLECTION_PRESETS]];
    return dl.live && dl.total ? [{ live: dl.live, total: dl.total }] : [];
  });
  const stiff = roofLimits.sort((a, b) => b.live - a.live)[0];
  const lum = (l: { size: string; species: string; grade: string }) => `${l.size} ${l.species} ${l.grade}`;
  const trussPlate = of("truss").map((r) => r.input.plate)[0];
  const wallPlate = of("wall")
    .flatMap((r) => r.packs.map((k) => k.mat))
    .find((m) => m.kind === "sawn");
  const fcPerp = trussPlate
    ? {
        label: `${trussPlate.species} ${trussPlate.grade}`,
        v: resolveWood({ kind: "sawn", ...trussPlate, plies: 1 }, nds).Fcperp,
      }
    : wallPlate && { label: wallPlate.speciesLabel, v: wallPlate.Fcperp };

  // framing
  const floorDia = of("diaphragm").filter((r) => r.input.level === "floor");
  const byCallout = new Map<string, string[]>();
  for (const r of floorDia) byCallout.set(r.callout, [...(byCallout.get(r.callout) ?? []), r.mark]);
  const plyMarks = rs.flatMap((r) => (r.kind === "beam" && r.input.plyConnection ? [r.mark] : []));
  const ties = new Map<string, string[]>();
  for (const r of of("connector"))
    if (r.item.kind === "tie") {
      const k = `${r.item.manufacturer} ${r.item.model}`.trim();
      ties.set(k, [...(ties.get(k) ?? []), r.input.sourceMark]);
    }
  const makers = [
    ...new Set(
      hardwareSchedule(p, d)
        .map((h) => h.manufacturer.trim())
        .filter(Boolean),
    ),
  ];
  const joists = rs.filter((r) => r.kind === "joist" || r.kind === "ijoist");
  const deckLive = p.members.flatMap((m) =>
    eachUse(m)
      .filter((u) => u === "deck" || u === "balcony")
      .map((u) => liveLoad(u, cr.liveBasis).psf),
  );
  const jur = p.info.jurisdiction.trim();

  return {
    FC: psi(cr.concrete.fc),
    FY: fmt(cr.concrete.fy / 1000, 0),
    ASCE: c.asce7,
    BC: code(c.building),
    RC: code(c.residential),
    BUILDING: c.building.split(" / ")[0],
    AUTHORITY: jur || "the building official",
    DECK_LIVE: deckLive.length
      ? ` Exterior decks and balconies shall be designed for ${fmt(Math.max(...deckLive), 0)} psf live load.`
      : "",
    EXPOSURE: exposure,
    MIX: mix,
    TRUSS_LOADS: trussLoads,
    TRUSS_DEFL: [
      stiff
        ? `Truss maximum deflection shall not exceed L/${stiff.total} for total load or L/${stiff.live} for live load.`
        : `Truss maximum deflection shall not exceed the limits of ${code(c.building)} Table 1604.3.`,
    ],
    TRUSS_LUMBER: of("woodTruss").map(
      (r) =>
        `Truss lumber per calculations, ${r.mark}: top chord ${lum(r.input.tc)}, bottom chord ${lum(r.input.bc)}, webs ${lum(r.input.web)}, or better.`,
    ),
    TRUSS_BEARING: fcPerp
      ? `Maximum plate bearing stress Fc(perp) = ${psi(fcPerp.v)} psi (${fcPerp.label} top plate). If bearing stress on the top plate exceeds ${psi(fcPerp.v)} psi, the truss design shall include all of the required bearing improvements.`
      : "",
    SAWN_GRADES: grades.size ? [[...grades].join(" / ")] : [],
    FLOOR_JOISTS: joists.length ? [`Floor joists: ${joists.map((r) => `${r.mark}: ${r.callout}`).join("; ")}`] : [],
    SUBFLOOR: [...byCallout].map(([callout, marks]) => `Subfloor: ${callout} (${marks.join(", ")}).`),
    SCL: scl.size
      ? ["Structural composite lumber per the manufacturer's ICC-ES evaluation report:", ...scl.values()]
      : [],
    GLULAM: glulam.size
      ? [
          `Structural glue laminated timber shall be ${[...glulam].join(" / ")} as scheduled and manufactured and identified as required in ANSI A190.1 and ASTM D 3737.`,
        ]
      : [],
    BUILTUP_DESIGNED: plyMarks.length
      ? [
          `Where ply fastening is listed in the nailing schedule - designed connections (${plyMarks.join(", ")}), the scheduled fastening governs.`,
        ]
      : [],
    ROOF_TIES: ties.size
      ? [
          `Roof framing to wall top plate: ${[...ties].map(([k, m]) => `${k} at ${[...new Set(m)].join(", ")}`).join("; ")}, installed with all specified fasteners.`,
        ]
      : [],
    HARDWARE_MAKERS: makers.length
      ? [
          `All metal hardware to be ${makers.join(" or ")} as scheduled, or an approved equal of equal or greater capacity, and installed according to manufacturers requirements.`,
        ]
      : [],
    CONSTRUCTION_TYPE: p.info.constructionType?.trim() ? [`Construction type: ${p.info.constructionType.trim()}.`] : [],
    IF_IJOIST: has("ijoist"),
    IF_BUILTUP: builtUp,
    IF_TRUSS: has("truss", "woodTruss"),
    IF_JOIST: joists.length > 0,
    IF_EXISTING:
      rs.some((r) => JSON.stringify(r.input).includes('"existing"')) ||
      rs.some((r) => r.kind === "joist" && !!r.input.sister),
    IF_DFL2: grades.has("DF-L No.2"),
  };
}

/** live-load uses named anywhere in a member input */
function eachUse(m: unknown): Parameters<typeof liveLoad>[0][] {
  const out: Parameters<typeof liveLoad>[0][] = [];
  eachObject(m, (o) => {
    if (typeof o.use === "string") out.push(o.use as Parameters<typeof liveLoad>[0]);
  });
  return out;
}

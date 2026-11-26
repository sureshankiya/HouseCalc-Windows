/**
 * Sheet for members whose engine returns its calculation as printed rows (sill anchorage,
 * foundation-wall lintel, crawl space): Tedds-style layout shared with the other sheets.
 */

import { Fragment } from "react";
import type { CalcLine } from "@/engine/members/sillAnchor";
import type { CrawlSpaceResult } from "@/engine/members/crawlSpace";
import type { LintelResult } from "@/engine/members/lintel";
import type { SillAnchorResult } from "@/engine/members/sillAnchor";
import { SectionHead, TR } from "../report/primitives";
import { AssumptionRows, ChecksSummary, FinalSummary, LimitationNotes, LoadLines, MemberResult } from "./blocks";
import { DesignBasis, rich, type SheetMeta } from "./common";
import { Frame, LoadPath, verifyText } from "./Phase3Sheets";

/** Calculation rows; a row with `head` opens a section. */
export function CalcRows({ calc }: { calc: CalcLine[] }) {
  return (
    <>
      {calc.map((c, i) => (
        <Fragment key={i}>
          {c.head ? <SectionHead title={rich(c.head)} /> : null}
          <TR desc={rich(c.desc)} expr={rich(c.expr)} pass={c.pass} />
        </Fragment>
      ))}
    </>
  );
}

export function CalcSheet({
  m,
  r,
  index,
  total,
  received,
  connections,
}: {
  m: SheetMeta;
  r: SillAnchorResult | LintelResult | CrawlSpaceResult;
  index: number;
  total: number;
  received: string[];
  connections?: string[];
}) {
  return (
    <Frame
      m={m}
      r={r}
      title={r.sheetTitle}
      subtitle={
        <>
          {r.title} — member {index} of {total}: {r.mark}
        </>
      }
    >
      <DesignBasis m={m} material={<>{r.material}</>} combos={<>{r.combos}</>} />
      {r.loadLines.length ? (
        <>
          <LoadLines lines={r.loadLines} />
          <LoadPath received={received} connections={connections} />
        </>
      ) : null}
      <CalcRows calc={r.calc} />
      <ChecksSummary checks={r.checks} />
      <MemberResult r={r} />
      <FinalSummary rows={[...r.summary, ["Field / EOR verification", verifyText(r)]]} />
      <AssumptionRows items={r.assumptions} />
      <LimitationNotes notes={r.limits} />
    </Frame>
  );
}

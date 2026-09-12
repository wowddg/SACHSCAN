import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, ExternalLink, Fingerprint } from "lucide-react";
import { fetchCaseBundle, bandLabel, formatBytes, RISK_WORDING, scoreColorVar } from "@/lib/sachscan";
import { asReport, type StoredFinding, type StoredReport, type StoredSignal } from "@/lib/forensic-report";
import {
  DemoBadge,
  Disclaimer,
  HeuristicTag,
  KeyValue,
  MetricCard,
  PageShell,
  Panel,
  RiskBadge,
  ScoreRing,
  SignalIcon,
  SimulatedBadge,
  StatusChip,
} from "@/components/forensic/ui";

export const Route = createFileRoute("/investigations/$id/")({
  head: () => ({
    meta: [
      { title: "Investigation Assessment — SACHSCAN" },
      {
        name: "description",
        content:
          "Forensic assessment of an image evidence item: AI-generation likelihood, manipulation likelihood, authenticity confidence and the signals behind them.",
      },
      { property: "og:title", content: "Investigation Assessment — SACHSCAN" },
      { property: "og:description", content: "Evidence-level forensic assessment with traceable signal breakdown." },
    ],
  }),
  component: Results,
});

const TABS = ["Overview", "Metadata", "Findings", "Source trace"] as const;

function Results() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["case", id],
    queryFn: () => fetchCaseBundle(id),
  });

  if (isLoading) {
    return (
      <PageShell title="Investigation" subtitle="Loading case record…">
        <Panel>
          <p className="text-sm text-muted-foreground">Retrieving the assessment from the case database…</p>
        </Panel>
      </PageShell>
    );
  }
  if (error || !data) {
    return (
      <PageShell title="Investigation" subtitle="Case record unavailable">
        <Panel>
          <p className="text-sm text-destructive">{(error as Error)?.message ?? "Case record could not be loaded."}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[13px]"
          >
            Retry
          </button>
        </Panel>
      </PageShell>
    );
  }

  const { investigation: inv, evidence, analysis, sourceMatches, previewUrl } = data;
  const report = asReport(analysis?.signals);
  const demo = Boolean(inv.is_demo);

  return (
    <PageShell
      title={inv.case_id}
      subtitle={`${inv.evidence_name ?? "No evidence attached"} — examined by ${inv.investigator_name ?? "unattributed"}`}
      actions={
        <>
          {demo ? <DemoBadge /> : null}
          <StatusChip status={inv.status} />
          <RiskBadge risk={inv.risk_level} />
          <Link
            to="/investigations/$id/report"
            params={{ id }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-[13px] hover:bg-accent"
          >
            <FileText className="size-4" /> Report
          </Link>
        </>
      }
    >
      {demo ? (
        <p
          className="mb-4 rounded-md border border-dashed px-3 py-2 text-xs"
          style={{ borderColor: "var(--demo)", color: "var(--demo)" }}
        >
          DEMO CASE — this is a pre-written reference record for demonstration. It is not the output of a live analysis.
        </p>
      ) : null}

      {!analysis && !demo ? (
        <Panel title="Assessment pending">
          <p className="text-sm text-muted-foreground">
            No analysis result is stored for this investigation yet.
          </p>
          <Link
            to="/investigations/$id/upload"
            params={{ id }}
            className="mt-3 inline-block rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground"
          >
            Ingest evidence
          </Link>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <ScoreRing
              value={inv.ai_probability === null ? null : Number(inv.ai_probability)}
              label="AI generation likelihood"
              caption={`${bandLabel(inv.ai_probability)} · ${report?.aiBand ?? bandLabel(inv.ai_probability)}`}
            />
            <ScoreRing
              value={inv.manipulation_probability === null ? null : Number(inv.manipulation_probability)}
              label="Manipulation likelihood"
              caption={bandLabel(inv.manipulation_probability)}
            />
            <ScoreRing
              value={inv.authenticity_confidence === null ? null : Number(inv.authenticity_confidence)}
              label="Authenticity confidence"
              color="var(--primary)"
              caption={report?.confidenceStatus === "INSUFFICIENT_EVIDENCE" ? "Insufficient evidence" : "Assessed"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              label="Overall risk"
              value={inv.risk_level ?? "—"}
              sub={RISK_WORDING[(inv.risk_level ?? "").toUpperCase()] ?? "Risk banding unavailable"}
              color={scoreColorVar(
                Math.max(Number(inv.ai_probability ?? 0), Number(inv.manipulation_probability ?? 0)),
              )}
            />
            <MetricCard label="Metadata status" value={(inv.metadata_status ?? "UNKNOWN").replace("_", " ")} sub={report?.metadataStatusReason?.slice(0, 110) ?? undefined} />
          </div>

          <Panel title="Overall assessment" right={<HeuristicTag />}>
            <p className="text-sm leading-relaxed">{inv.summary ?? "No assessment summary is stored for this case."}</p>
          </Panel>

          {report ? <WhyThisResult report={report} /> : null}

          <div className="flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`mono -mb-px border-b-2 px-3 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors ${
                  tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
            <Link
              to="/investigations/$id/heatmap"
              params={{ id }}
              className="mono -mb-px border-b-2 border-transparent px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            >
              AI detection heatmap
            </Link>
          </div>

          {tab === "Overview" ? (
            <Panel title="Evidence signals" right={<HeuristicTag />}>
              {report ? (
                <>
                  <SignalList signals={report.signals} />
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <ScopeChecklist
                      title={`AI-generation assessment: ${report.aiBand}`}
                      signals={report.signals.filter((s) => ["software", "dimensions", "noise", "luminance", "c2pa"].includes(s.key))}
                    />
                    <ScopeChecklist
                      title={`Manipulation assessment: ${report.manipulationBand}`}
                      signals={report.signals.filter((s) => ["quantization", "chroma", "camera", "format"].includes(s.key))}
                    />
                  </div>
                  <p className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
                    Confidence: {report.authenticityConfidence}/100 — {report.confidenceReason}
                  </p>
                  {report.regional ? (
                    <div className="mt-4 rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="mono text-[11px] font-semibold uppercase tracking-[0.14em]">
                          Regional forensic analysis
                        </h3>
                        <Link
                          to="/investigations/$id/heatmap"
                          params={{ id }}
                          className="mono ml-auto text-[10px] uppercase tracking-[0.12em] text-primary hover:underline"
                        >
                          Open signal map
                        </Link>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{report.regional.summary}</p>
                    </div>
                  ) : null}
                  <ScoreTrace report={report} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Signal-level evidence is available only for live analyses. This record stores summary values only.
                </p>
              )}
            </Panel>
          ) : null}

          {tab === "Metadata" ? (
            <div className="space-y-4">
              <Panel title="File information">
                <KeyValue
                  items={[
                    { k: "File name", v: evidence?.file_name ?? inv.evidence_name ?? "—", mono: true },
                    { k: "Declared MIME type", v: evidence?.file_type ?? inv.evidence_type ?? "—", mono: true },
                    { k: "Verified format (byte header)", v: report?.file.detectedFormat ?? "—", mono: true },
                    { k: "Size", v: formatBytes(evidence?.file_size ?? report?.file.byteSize ?? null), mono: true },
                    {
                      k: "Dimensions",
                      v:
                        evidence?.width && evidence?.height
                          ? `${evidence.width} × ${evidence.height}`
                          : report?.file.width
                            ? `${report.file.width} × ${report.file.height}`
                            : "—",
                      mono: true,
                    },
                    { k: "Aspect ratio", v: report?.file.aspectRatio ?? "—", mono: true },
                    { k: "SHA-256", v: evidence?.file_hash ?? report?.fileHash ?? "—", mono: true },
                  ]}
                />
              </Panel>
              <Panel
                title="EXIF / XMP information"
                right={
                  <span className="mono rounded-sm border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                    {(report?.metadataStatus ?? inv.metadata_status ?? "UNKNOWN").replace("_", " ")}
                  </span>
                }
              >
                {report ? (
                  <>
                    <KeyValue
                      items={Object.entries(report.exif).map(([k, v]) => ({
                        k,
                        v: v === null || v === "" ? "Not present" : String(v),
                        mono: true,
                      }))}
                    />
                    <p className="mt-3 text-xs text-muted-foreground">{report.metadataStatusReason}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No parsed metadata block is stored for this record.</p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Missing metadata alone is not evidence of manipulation or AI generation. Screenshots, messaging-app
                  downloads and social-media exports strip metadata legitimately. Precise GPS coordinates are never
                  displayed — only their presence is reported.
                </p>
              </Panel>
              {report ? (
                <Panel title="Image characteristics">
                  <KeyValue
                    items={[
                      { k: "Pixel analysis", v: report.imageStats.available ? "Completed" : report.imageStats.reason ?? "Unavailable" },
                      { k: "Luminance mean", v: report.imageStats.luminanceMean ?? "—", mono: true },
                      { k: "Luminance σ", v: report.imageStats.luminanceStdDev ?? "—", mono: true },
                      { k: "Noise floor (neighbour Δ)", v: report.imageStats.noiseFloor ?? "—", mono: true },
                      { k: "Sampled pixels", v: report.imageStats.sampledPixels ?? "—", mono: true },
                      { k: "JPEG est. quality", v: report.jpeg.estimatedQuality ?? "—", mono: true },
                      { k: "Quantisation table Σ", v: report.jpeg.quantizationSum ?? "—", mono: true },
                      { k: "Chroma subsampling", v: report.jpeg.chromaSubsampling ?? "—", mono: true },
                    ]}
                  />
                </Panel>
              ) : null}
            </div>
          ) : null}

          {tab === "Findings" ? (
            <Panel title="Forensic findings" right={<HeuristicTag />}>
              {report && report.findings.length > 0 ? (
                <ul className="space-y-3">
                  {report.findings.map((f) => (
                    <FindingItem key={f.id} finding={f} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No structured findings are stored for this record.
                </p>
              )}
            </Panel>
          ) : null}

          {tab === "Source trace" ? (
            <div className="space-y-4">
              <Panel title="Provenance & source trace">
                <p
                  className="mb-4 rounded-md border px-3 py-2 text-xs"
                  style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
                >
                  Automated web-wide source verification is not available in this prototype.
                </p>
                <KeyValue
                  items={[
                    { k: "File fingerprint (SHA-256)", v: evidence?.file_hash ?? report?.fileHash ?? "—", mono: true },
                    { k: "Container format", v: report?.file.detectedFormat ?? inv.evidence_type ?? "—", mono: true },
                    { k: "Software lineage", v: String(report?.exif?.["Software"] ?? "No software tag recorded"), mono: true },
                    { k: "Capture device", v: `${report?.exif?.["Make"] ?? "—"} ${report?.exif?.["Model"] ?? ""}`.trim(), mono: true },
                    { k: "C2PA content credentials", v: report?.c2paPresent ? "Present" : "Not detected", mono: true },
                    { k: "Geolocation tags", v: report?.exif?.["GPSPresent"] ? "Present (coordinates withheld)" : "Not present", mono: true },
                    { k: "Source trace status", v: inv.source_trace_status ?? "NOT_AVAILABLE", mono: true },
                  ]}
                />
              </Panel>
              <Panel title="Illustrative source-match rows">
                {sourceMatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No source-match records are attached to this case.</p>
                ) : (
                  <ul className="space-y-3">
                    {sourceMatches.map((m) => (
                      <li key={m.id} className="rounded-md border border-dashed p-3" style={{ borderColor: "var(--demo)" }}>
                        <div className="flex flex-wrap items-center gap-2">
                          <SimulatedBadge />
                          <span className="text-sm">{m.source_name}</span>
                          {m.source_url ? (
                            <a
                              href={m.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mono inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                            >
                              <ExternalLink className="size-3" /> reference
                            </a>
                          ) : null}
                        </div>
                        <p className="mono mt-1.5 text-[11px] text-muted-foreground">
                          similarity {m.similarity_score ?? "—"} · confidence {m.confidence ?? "—"} · recorded{" "}
                          {m.discovered_date ?? "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel title="Evidence item">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Evidence image for case ${inv.case_id}`}
                className="w-full rounded border border-border object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">No evidence preview is available for this record.</p>
            )}
            <div className="mono mt-3 flex items-start gap-2 text-[11px] break-all text-muted-foreground">
              <Fingerprint className="mt-0.5 size-3.5 shrink-0" />
              {evidence?.file_hash ?? report?.fileHash ?? "no fingerprint recorded"}
            </div>
          </Panel>
          <Panel title="Case record">
            <KeyValue
              items={[
                { k: "Case ID", v: inv.case_id, mono: true },
                { k: "Investigator", v: inv.investigator_name ?? "—" },
                { k: "Opened", v: new Date(inv.created_at).toLocaleString(), mono: true },
                { k: "Status", v: inv.status ?? "—", mono: true },
                { k: "Description", v: inv.evidence_description ?? "—" },
              ]}
            />
          </Panel>
          <Disclaimer />
        </div>
      </div>
    </PageShell>
  );
}

function SignalList({ signals }: { signals: StoredSignal[] }) {
  return (
    <ul className="divide-y divide-border">
      {signals.map((s) => (
        <li key={s.key} className="flex items-start gap-3 py-2.5">
          <span className="mt-0.5">
            <SignalIcon status={s.status} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium">{s.label}</span>
              <span className="mono text-[11px] text-muted-foreground">{s.value}</span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ScopeChecklist({ title, signals }: { title: string; signals: StoredSignal[] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <h3 className="mono text-[11px] font-semibold uppercase tracking-[0.14em]">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {signals.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-xs">
            <span className="mono mt-0.5" style={{ color: s.status === "supportive" ? "var(--ok)" : s.status === "inconsistent" ? "var(--warn)" : "var(--muted-foreground)" }}>
              {s.status === "supportive" ? "✓" : s.status === "inconsistent" ? "⚠" : "—"}
            </span>
            <span>
              {s.label}: <span className="text-muted-foreground">{s.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreTrace({ report }: { report: { signalBreakdown: { signal: string; weight: number; normalized: number; contribution: number; scope: string }[] } }) {
  return (
    <details className="mt-4 rounded-md border border-border">
      <summary className="mono cursor-pointer px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Score trace — weighted signal contributions
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Signal</th>
              <th className="py-1.5 pr-3 font-medium">Scope</th>
              <th className="py-1.5 pr-3 font-medium">Weight</th>
              <th className="py-1.5 pr-3 font-medium">Normalised</th>
              <th className="py-1.5 font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {report.signalBreakdown.map((b) => (
              <tr key={`${b.scope}-${b.signal}`} className="border-t border-border/60">
                <td className="py-1.5 pr-3">{b.signal}</td>
                <td className="mono py-1.5 pr-3 uppercase">{b.scope}</td>
                <td className="mono py-1.5 pr-3">{b.weight}</td>
                <td className="mono py-1.5 pr-3">{b.normalized}</td>
                <td className="mono py-1.5">{b.contribution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  INFORMATIONAL: "var(--primary)",
  LOW: "var(--ok)",
  MODERATE: "var(--warn)",
  HIGH: "var(--high)",
};

export function FindingItem({ finding }: { finding: StoredFinding }) {
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="mono rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]"
          style={{ color: SEVERITY_COLOR[finding.severity], borderColor: SEVERITY_COLOR[finding.severity] }}
        >
          {finding.severity}
        </span>
        <span className="text-sm font-medium">{finding.title}</span>
        <span className="mono ml-auto text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          confidence {finding.confidence} · {finding.signalType}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{finding.explanation}</p>
    </li>
  );
}

/**
 * Explainability panel: lists the strongest signals that actually moved the
 * scores (+ supportive of the assessment, - weakening it), then explains how
 * they were combined. Everything here is derived from the persisted report —
 * no signal is invented and nothing is shown that was not measured.
 */
function WhyThisResult({ report }: { report: StoredReport }) {
  const contributors = [...report.signalBreakdown]
    .filter((b) => b.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 6);
  const unavailable = report.signals.filter((s) => s.status === "unavailable").slice(0, 4);
  const supportive = report.signals.filter((s) => s.status === "supportive").slice(0, 4);
  const regional = report.regional;

  return (
    <details className="panel rounded-md" open>
      <summary className="mono cursor-pointer px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Why this result?
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <ul className="space-y-1.5">
          {supportive.map((s) => (
            <li key={`s-${s.key}`} className="flex items-start gap-2 text-xs">
              <span className="mono" style={{ color: "var(--ok)" }}>
                +
              </span>
              <span>
                {s.label} <span className="text-muted-foreground">— {s.value}</span>
              </span>
            </li>
          ))}
          {contributors.map((b) => (
            <li key={`c-${b.scope}-${b.signal}`} className="flex items-start gap-2 text-xs">
              <span className="mono" style={{ color: "var(--warn)" }}>
                +
              </span>
              <span>
                {b.signal} raised the {b.scope === "ai" ? "AI-generation" : "manipulation"} score by{" "}
                <span className="mono">{b.contribution}</span> of {b.weight} available points
              </span>
            </li>
          ))}
          {unavailable.map((s) => (
            <li key={`u-${s.key}`} className="flex items-start gap-2 text-xs">
              <span className="mono text-muted-foreground">−</span>
              <span className="text-muted-foreground">
                {s.label} could not be measured — {s.detail}
              </span>
            </li>
          ))}
          {regional?.available ? (
            <li className="flex items-start gap-2 text-xs">
              <span className="mono" style={{ color: regional.strongTileRatio > 0.1 ? "var(--warn)" : "var(--ok)" }}>
                {regional.strongTileRatio > 0.1 ? "+" : "−"}
              </span>
              <span>
                {regional.strongTileRatio > 0.1
                  ? `${Math.round(regional.strongTileRatio * 100)}% of image tiles deviate strongly from this image's own baseline`
                  : "No strong regional anomalies detected across the tile grid"}
              </span>
            </li>
          ) : null}
        </ul>

        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          How these combined: AI-generation likelihood and manipulation likelihood are scored independently — neither is
          derived from the other — by summing the weighted contributions above over the points that were actually
          measurable ({report.availableSignalCount} signal families available). Authenticity confidence (
          {report.authenticityConfidence}/100) reflects how much evidence was available and how well the signals agree:{" "}
          {report.confidenceReason}
          {report.confidenceStatus === "INSUFFICIENT_EVIDENCE"
            ? " Because too little was measurable, this case is reported as insufficient evidence rather than as a percentage judgement."
            : ""}
        </p>
      </div>
    </details>
  );
}

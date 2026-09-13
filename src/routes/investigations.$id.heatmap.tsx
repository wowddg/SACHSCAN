import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { fetchCaseBundle } from "@/lib/sachscan";
import { asReport, type StoredRegionTile } from "@/lib/forensic-report";
import { Disclaimer, KeyValue, PageShell, Panel } from "@/components/forensic/ui";

export const Route = createFileRoute("/investigations/$id/heatmap")({
  head: () => ({
    meta: [
      { title: "Regional Forensic Signal Map — SACHSCAN" },
      {
        name: "description",
        content:
          "Tile-level forensic signal map of an evidence image: local noise, texture, edge and compression deviation from the image-wide baseline.",
      },
      { property: "og:title", content: "Regional Forensic Signal Map — SACHSCAN" },
      {
        property: "og:description",
        content: "Deterministic per-tile forensic deviation map overlaid on the evidence image.",
      },
    ],
  }),
  component: HeatmapPage,
});

const HEATMAP_NOTE =
  "Highlighted regions represent areas with stronger detected forensic signals. This visualization is indicative and does not independently prove AI generation or manipulation.";

type Mode = "Original" | "Heatmap" | "Overlay";

/** Blue → cyan → amber → red ramp; intensity is also encoded by opacity and by
 * the numeric legend, so risk is never communicated by colour alone. */
function ramp(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [12, 34, 58]],
    [0.35, [56, 225, 208]],
    [0.65, [232, 179, 58]],
    [1, [231, 76, 60]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!;
    const [p0, c0] = stops[i - 1]!;
    if (t <= p1) {
      const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1]![1];
}

function HeatmapPage() {
  const { id } = Route.useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["case", id],
    queryFn: () => fetchCaseBundle(id),
  });

  const [mode, setMode] = useState<Mode>("Overlay");
  const [opacity, setOpacity] = useState(0.6);
  const [hover, setHover] = useState<StoredRegionTile | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const report = asReport(data?.analysis?.signals);
  const regional = report?.regional;
  const tiles = useMemo(() => regional?.tiles ?? [], [regional]);

  // Draw the tile lattice on a canvas sized to the image's intrinsic aspect
  // ratio, so the overlay never distorts at any resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !regional?.available || tiles.length === 0) return;
    const w = 900;
    const h = Math.max(
      1,
      Math.round((w * (regional.sourceHeight || regional.gridHeight)) / (regional.sourceWidth || regional.gridWidth)),
    );
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    for (const t of tiles) {
      const [r, g, b] = ramp(t.intensity);
      ctx.fillStyle = `rgba(${r},${g},${b},${(0.25 + t.intensity * 0.75).toFixed(3)})`;
      ctx.fillRect(t.x * w, t.y * h, Math.ceil(t.w * w) + 1, Math.ceil(t.h * h) + 1);
    }
  }, [tiles, regional]);

  if (isLoading) {
    return (
      <PageShell title="Regional signal map" subtitle="Loading persisted regional analysis…">
        <Panel>
          <p className="text-sm text-muted-foreground">Retrieving the stored tile measurements…</p>
        </Panel>
      </PageShell>
    );
  }
  if (error || !data) {
    return (
      <PageShell title="Regional signal map" subtitle="Case record unavailable">
        <Panel>
          <p className="text-sm text-destructive">{(error as Error)?.message ?? "Case record could not be loaded."}</p>
          <button onClick={() => refetch()} className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[13px]">
            Retry
          </button>
        </Panel>
      </PageShell>
    );
  }

  const { investigation: inv, previewUrl } = data;
  const sorted = [...tiles].sort((a, b) => b.intensity - a.intensity).slice(0, 6);

  return (
    <PageShell
      title={`${inv.case_id} — regional map`}
      subtitle="Tile-level forensic deviation from this image's own baseline"
      actions={
        <Link
          to="/investigations/$id"
          params={{ id }}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-[13px] hover:bg-accent"
        >
          <ArrowLeft className="size-4" /> Back to assessment
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Regional forensic signal map"
          right={
            <div className="flex items-center gap-1">
              {(["Original", "Heatmap", "Overlay"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`mono rounded-sm border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
                    mode === m ? "border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          }
        >
          {!regional ? (
            <p className="text-sm text-muted-foreground">
              No regional analysis is stored for this case. Regional measurements are produced during a live examination;
              re-run the analysis on the evidence file to generate them.
            </p>
          ) : !regional.available ? (
            <p className="text-sm" style={{ color: "var(--warn)" }}>
              Regional analysis unavailable: {regional.reason ?? "the evidence file could not be tiled."}
            </p>
          ) : (
            <>
              <div className="relative overflow-hidden rounded border border-border bg-surface-2">
                {previewUrl && mode !== "Heatmap" ? (
                  <img
                    src={previewUrl}
                    alt={`Evidence image for case ${inv.case_id}`}
                    className="block w-full object-contain"
                  />
                ) : (
                  <div
                    style={{
                      aspectRatio: `${regional.sourceWidth || regional.gridWidth} / ${regional.sourceHeight || regional.gridHeight}`,
                    }}
                  />
                )}
                {mode !== "Original" ? (
                  <canvas
                    ref={canvasRef}
                    aria-label="Regional forensic signal overlay"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    style={{ opacity: mode === "Heatmap" ? 1 : opacity, mixBlendMode: mode === "Heatmap" ? "normal" : "screen" }}
                  />
                ) : null}
                {mode !== "Original" ? (
                  <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${regional.cols}, 1fr)` }}>
                    {tiles.map((t) => (
                      <button
                        key={`${t.cx}-${t.cy}`}
                        onMouseEnter={() => setHover(t)}
                        onFocus={() => setHover(t)}
                        onMouseLeave={() => setHover(null)}
                        aria-label={`Tile ${t.cx + 1}, ${t.cy + 1} — intensity ${t.intensity.toFixed(2)}`}
                        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        style={{ gridColumn: t.cx + 1, gridRow: t.cy + 1 }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Overlay opacity
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={Math.round(opacity * 100)}
                    onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                    disabled={mode !== "Overlay"}
                    className="w-40 accent-[var(--primary)]"
                  />
                  <span className="mono">{Math.round(opacity * 100)}%</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Intensity</span>
                  <span className="flex h-3 w-40 overflow-hidden rounded-sm border border-border">
                    {Array.from({ length: 20 }, (_, i) => {
                      const [r, g, b] = ramp(i / 19);
                      return <span key={i} className="flex-1" style={{ background: `rgb(${r},${g},${b})` }} />;
                    })}
                  </span>
                  <span className="mono text-[10px] text-muted-foreground">0.00 → 1.00</span>
                </div>
              </div>

              <p className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
                {HEATMAP_NOTE}
              </p>
            </>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title={hover ? `Tile ${hover.cx + 1}, ${hover.cy + 1}` : "Map statistics"}>
            {hover ? (
              <KeyValue
                items={[
                  { k: "Intensity", v: hover.intensity.toFixed(3), mono: true },
                  { k: "Local noise", v: hover.metrics.noise, mono: true },
                  { k: "Local texture σ", v: hover.metrics.texture, mono: true },
                  { k: "Local edge energy", v: hover.metrics.edge, mono: true },
                  { k: "Blockiness ratio", v: hover.metrics.blockiness, mono: true },
                  { k: "Noise deviation", v: hover.deviations.noise, mono: true },
                  { k: "Texture deviation", v: hover.deviations.texture, mono: true },
                  { k: "Edge deviation", v: hover.deviations.edge, mono: true },
                  { k: "Compression deviation", v: hover.deviations.blockiness, mono: true },
                ]}
              />
            ) : regional?.available ? (
              <KeyValue
                items={[
                  { k: "Tile grid", v: `${regional.cols} × ${regional.rows}`, mono: true },
                  { k: "Analysis grid", v: `${regional.gridWidth} × ${regional.gridHeight} px`, mono: true },
                  { k: "Source dimensions", v: `${regional.sourceWidth} × ${regional.sourceHeight} px`, mono: true },
                  { k: "Peak intensity", v: regional.peakIntensity.toFixed(3), mono: true },
                  { k: "Strong-signal tiles", v: `${Math.round(regional.strongTileRatio * 100)}%`, mono: true },
                  { k: "Baseline noise", v: regional.baseline.noise, mono: true },
                  { k: "Baseline texture σ", v: regional.baseline.texture, mono: true },
                  { k: "Baseline edge energy", v: regional.baseline.edge, mono: true },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No tile measurements are stored for this case.</p>
            )}
          </Panel>

          {regional?.available ? (
            <Panel title="Strongest regions">
              <ul className="space-y-2">
                {sorted.map((t) => (
                  <li key={`${t.cx}-${t.cy}`} className="flex items-center gap-3 text-xs">
                    <span
                      className="size-3 shrink-0 rounded-sm border border-border"
                      style={{ background: `rgb(${ramp(t.intensity).join(",")})` }}
                    />
                    <span className="mono">
                      col {t.cx + 1}, row {t.cy + 1}
                    </span>
                    <span className="mono ml-auto">{t.intensity.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{regional.summary}</p>
            </Panel>
          ) : null}
          <Disclaimer />
        </div>
      </div>
    </PageShell>
  );
}

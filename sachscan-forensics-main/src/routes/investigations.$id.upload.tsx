import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileWarning, CheckCircle2, RefreshCw, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ACCEPTED_EXT,
  ACCEPTED_TYPES,
  EVIDENCE_KIND_LABEL,
  MAX_FILE_BYTES,
  evidenceKind,
  formatBytes,
  type EvidenceKind,
} from "@/lib/sachscan";
import { countWords, extractDocumentText } from "@/lib/document-text";
import { Disclaimer, KeyValue, PageShell, Panel } from "@/components/forensic/ui";

export const Route = createFileRoute("/investigations/$id/upload")({
  head: () => ({
    meta: [
      { title: "Evidence Intake — SACHSCAN" },
      {
        name: "description",
        content:
          "Ingest image, video or text evidence into a SACHSCAN investigation with per-type validation, fingerprinting and upload.",
      },
      { property: "og:title", content: "Evidence Intake — SACHSCAN" },
      { property: "og:description", content: "Validated evidence upload for digital media forensic examination." },
    ],
  }),
  component: UploadEvidence,
});

interface Prepared {
  file: File;
  kind: EvidenceKind;
  width: number;
  height: number;
  hash: string;
  previewUrl: string;
  /** Text evidence only: readable text extracted in the browser. */
  text?: string;
  wordCount?: number;
  extractedFrom?: string;
  durationSeconds?: number;
}

async function sha256(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function decode(file: File): Promise<{ width: number; height: number; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The file could not be decoded as an image and may be corrupted or truncated."));
    };
    img.src = url;
  });
}

/** Video validation: the browser must be able to decode the container. */
function probeVideo(file: File): Promise<{ width: number; height: number; duration: number; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "This video could not be decoded by the browser. The file may be corrupted, or its codec is not supported here.",
        ),
      );
    };
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0) return fail();
      resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration, url });
    };
    video.onerror = fail;
    setTimeout(() => reject(new Error("The video did not report its metadata within 20 seconds.")), 20_000);
    video.src = url;
  });
}

/** Real upload progress via XHR against the storage REST endpoint. */
function uploadWithProgress(
  path: string,
  body: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const base = import.meta.env["VITE_SUPABASE_URL"] as string;
    const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/storage/v1/object/evidence/${path}`);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("authorization", `Bearer ${key}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("content-type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage rejected the upload (HTTP ${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    xhr.onerror = () => reject(new Error("Network failure while transferring the evidence file."));
    xhr.send(body);
  });
}

function UploadEvidence() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [limitedNotice, setLimitedNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setValidationError(null);
    setUploadError(null);
    setLimitedNotice(null);
    setPrepared(null);

    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
    const kind = evidenceKind(file.name, file.type);

    if (file.type.startsWith("audio/")) {
      setValidationError("Audio evidence cannot be ingested in this build.");
      return;
    }
    if (kind === "unsupported" || (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXT.includes(ext))) {
      setValidationError(`Unsupported evidence format. Accepted formats: ${ACCEPTED_EXT.join(" ")}.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setValidationError(`File exceeds the ${formatBytes(MAX_FILE_BYTES)} intake limit.`);
      return;
    }
    if (file.size === 0) {
      setValidationError("This file is empty.");
      return;
    }

    setPreparing(true);
    try {
      const hash = await sha256(file);

      if (kind === "image") {
        // Unchanged image path: decode-based validation and dimensions.
        const { width, height, url } = await decode(file);
        setPrepared({ file, kind, width, height, hash, previewUrl: url });
        return;
      }

      if (kind === "video") {
        const probe = await probeVideo(file);
        if (probe.duration > 60) {
          setLimitedNotice(
            `Only the first 60 seconds of this ${Math.round(probe.duration)}-second video will be analysed.`,
          );
        }
        setPrepared({
          file,
          kind,
          width: probe.width,
          height: probe.height,
          hash,
          previewUrl: probe.url,
          durationSeconds: probe.duration,
        });
        return;
      }

      // Text evidence — extract readable text in the browser.
      let text: string;
      let extractedFrom: string;
      if (ext === ".pdf" || ext === ".docx") {
        const result = await extractDocumentText(file);
        text = result.text;
        extractedFrom = ext === ".pdf" ? "PDF EXTRACTION" : "DOCX EXTRACTION";
      } else {
        text = (await file.text()).replace(/\r\n/g, "\n").trim();
        extractedFrom = "PLAIN TEXT";
      }
      if (!text) throw new Error("No readable text could be extracted from this file.");
      const wordCount = countWords(text);
      if (wordCount < 50) {
        setLimitedNotice(
          `This specimen contains ${wordCount} words. Below 50 words the linguistic engine reports "insufficient evidence" rather than a score.`,
        );
      }
      setPrepared({ file, kind, width: 0, height: 0, hash, previewUrl: "", text, wordCount, extractedFrom });
    } catch (e) {
      setValidationError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }, []);

  async function ingest() {
    if (!prepared) return;
    setUploadError(null);
    setProgress(0);
    const name = prepared.file.name;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    const path = `${id}/${prepared.hash}${ext}`;
    try {
      try {
        await uploadWithProgress(path, prepared.file, prepared.file.type, setProgress);
      } catch (e) {
        // Identical bytes for this case are already in the evidence store. The
        // stored object is byte-identical (the path is the file's own SHA-256),
        // so the existing copy is reused instead of overwriting it.
        const existing = await supabase.storage.from("evidence").createSignedUrl(path, 60);
        if (!existing.data?.signedUrl) throw e;
      }

      // Text evidence: the extracted plain-text specimen is stored alongside the
      // original document so the server examines exactly what was extracted.
      if (prepared.kind === "text" && prepared.text) {
        await uploadWithProgress(
          `${path}.extracted.txt`,
          new Blob([prepared.text], { type: "text/plain" }),
          "text/plain",
          () => {},
        );
      }
      setProgress(100);

      const { error } = await supabase.from("evidence").insert({
        investigation_id: id,
        file_name: name,
        file_type: prepared.file.type || (prepared.kind === "text" ? "text/plain" : ""),
        file_size: prepared.file.size,
        file_url: path,
        file_hash: prepared.hash,
        width: prepared.width,
        height: prepared.height,
      });
      if (error) throw new Error(`Evidence record could not be written: ${error.message}`);
      await supabase
        .from("investigations")
        .update({
          evidence_name: name,
          evidence_type: prepared.file.type || (prepared.kind === "text" ? "text/plain" : ""),
          status: "analysing",
        })
        .eq("id", id);
      toast.success("Evidence ingested");
      navigate({ to: "/investigations/$id/analysis", params: { id } });
    } catch (e) {
      setProgress(null);
      setUploadError((e as Error).message);
    }
  }

  return (
    <PageShell title="Evidence intake" subtitle="Case intake — step 2 of 3">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Upload evidence file">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 py-12 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"
            }`}
          >
            <UploadCloud className="size-7 text-primary" />
            <p className="mt-3 text-sm font-medium">Drop image, video or text evidence here, or click to browse</p>
            <p className="mono mt-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {ACCEPTED_EXT.join(" · ")} — max {formatBytes(MAX_FILE_BYTES)}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={[...ACCEPTED_EXT, ...ACCEPTED_TYPES].join(",")}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>

          {preparing ? (
            <p className="mono mt-3 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Validating and fingerprinting the file…
            </p>
          ) : null}

          {limitedNotice ? (
            <p className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
              {limitedNotice}
            </p>
          ) : null}

          {validationError ? (
            <p className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <FileWarning className="mt-0.5 size-4 shrink-0" /> {validationError}
            </p>
          ) : null}

          {prepared ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
              {prepared.kind === "video" ? (
                <video
                  src={prepared.previewUrl}
                  muted
                  className="h-[120px] w-full rounded border border-border object-cover"
                />
              ) : prepared.kind === "text" ? (
                <div className="flex h-[120px] w-full items-center justify-center rounded border border-border bg-surface-2">
                  <FileText className="size-8 text-primary" />
                </div>
              ) : (
                <img
                  src={prepared.previewUrl}
                  alt={`Preview of evidence file ${prepared.file.name}`}
                  className="h-[120px] w-full rounded border border-border object-cover"
                />
              )}
              <KeyValue
                items={[
                  { k: "Evidence type", v: EVIDENCE_KIND_LABEL[prepared.kind] ?? "—", mono: true },
                  { k: "File name", v: prepared.file.name, mono: true },
                  { k: "MIME type", v: prepared.file.type || "—", mono: true },
                  { k: "Size", v: formatBytes(prepared.file.size), mono: true },
                  {
                    k: prepared.kind === "text" ? "Extraction" : "Dimensions",
                    v:
                      prepared.kind === "text"
                        ? `${prepared.extractedFrom} — ${prepared.wordCount} words`
                        : prepared.kind === "video"
                          ? `${prepared.width} × ${prepared.height}, ${Math.round(prepared.durationSeconds ?? 0)}s`
                          : `${prepared.width} × ${prepared.height}`,
                    mono: true,
                  },
                  { k: "SHA-256", v: prepared.hash, mono: true },
                ]}
              />
            </div>
          ) : null}

          {prepared?.kind === "text" && prepared.text ? (
            <div className="mono mt-4 max-h-40 overflow-auto rounded border border-border bg-surface-2 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {prepared.text.slice(0, 800)}
              {prepared.text.length > 800 ? "…" : ""}
            </div>
          ) : null}

          {progress !== null ? (
            <div className="mt-5">
              <div className="mono mb-1.5 flex justify-between text-[11px] text-muted-foreground">
                <span>Transferring to evidence store</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2">
                <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
              </div>
              {progress === 100 ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "var(--ok)" }}>
                  <CheckCircle2 className="size-3.5" /> Transfer confirmed by the evidence store.
                </p>
              ) : null}
            </div>
          ) : null}

          {uploadError ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{uploadError}</span>
              <button
                onClick={ingest}
                className="inline-flex items-center gap-1.5 rounded border border-destructive/50 px-2.5 py-1 text-xs"
              >
                <RefreshCw className="size-3.5" /> Retry upload
              </button>
            </div>
          ) : null}

          <div className="mt-6 flex items-center gap-3">
            <button
              disabled={!prepared || progress !== null}
              onClick={ingest}
              className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {progress !== null ? "Ingesting…" : "Ingest evidence & analyse"}
            </button>
            <span className="text-xs text-muted-foreground">
              The file is fingerprinted before transfer; identical files always return an identical assessment.
            </span>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Intake validation">
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>Images: decoded before transfer — corrupted or truncated files are rejected at decode time.</li>
              <li>Videos: container decoded for dimensions and duration; the first 60 seconds are analysed.</li>
              <li>Text: readable text is extracted from .txt, .md, .pdf and .docx before transfer.</li>
              <li>SHA-256 fingerprint is computed locally and stored with the evidence record.</li>
            </ul>
          </Panel>
          <Disclaimer />
        </div>
      </div>
    </PageShell>
  );
}

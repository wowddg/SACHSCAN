# Evidence Console

# SachScan — Lovable Build Prompt (copy everything below into Lovable)




---




Inspect the existing project first — routes, components, database schema, and Supabase configuration — before writing any code. Preserve anything already working. Then build/extend this project into the following complete, working, full-stack hackathon prototype. Do not ask me questions. Make the reasonable technical decisions specified below and implement everything end to end.




## 1. Product




**Name:** SACHSCAN

**Subtitle:** Digital Media Forensics & Verification

**Tagline:** "Verify the evidence. Understand the media."

**Alt short tagline for tight UI spots:** "Investigate. Verify. Understand."




SachScan is a digital-media forensic investigation console for investigators, journalists, fact-checkers, researchers, and security teams. It assesses whether an image is authentic, manipulated, or potentially AI-generated, and shows the underlying evidence for that assessment. It is not an "AI detector" — it is a forensic evidence-and-signals platform. "Sach" = truth, "Scan" = systematic examination. Never use the name "TruthLens AI" anywhere. Use "SACHSCAN" consistently in the nav, browser tab title, dashboard, upload flow, analysis screen, report, case history, empty states, and loading states.




**Visual identity:** dark digital-forensics command center — closer to a SOC / evidence-management console than a SaaS landing page. Deep dark background, restrained accent colors (one primary accent, e.g. a cold cyan or amber used sparingly for status/risk indicators — pick one and use it consistently), clean technical typography (e.g. Inter for UI, a monospace font like JetBrains Mono for IDs/hashes/technical values), subtle 1px borders, compact information density, professional line-icon set (lucide-react), clear visual hierarchy, and only subtle motion (fades/slides, no flashy "AI is thinking" animations). Explicitly avoid: gradients used decoratively, cartoon icons, oversized hero text, glassmorphism, neon glow, generic rounded SaaS cards, and marketing copy.




## 2. Non-negotiable integrity rules




These override any temptation to fake a demo:




- **Never use `Math.random()` or any randomness to produce a score, finding, or probability.** All scoring must be a deterministic function of the actual uploaded file's bytes/metadata/pixels.

- **The same file must always produce the same result.** Hash every uploaded file (SHA-256, computed client-side or in the edge function) and use that hash as a cache/dedupe key — if the same hash is analyzed again, return the same stored result rather than recomputing differently.

- **Never hard-code a result for real uploads.** Only the explicitly labeled demo cases (Section 12) may contain pre-written data, and they must always be visibly labeled `DEMO CASE`, never mixed into a live analysis result.

- **Missing EXIF/metadata must never be treated as evidence of AI generation or manipulation.** Screenshots, WhatsApp/Telegram downloads, and social-media exports strip metadata legitimately. Missing metadata is reported as "Metadata unavailable" and contributes only mild uncertainty, not a fake-positive signal.

- **Never fabricate reverse-image-search or web source matches.** If no real source-verification API is wired up, say plainly: "Automated web-wide source verification is not available in this prototype," and only ever show clearly labeled `DEMO / SIMULATED SOURCE MATCH` entries, never presented as real discoveries.

- Every results screen must carry a visible, professionally worded line: **"Prototype forensic assessment — results are probabilistic indicators, not a definitive determination of authenticity."**

- Never claim a "scientifically validated AI detector" — this is a transparent heuristic engine, and the UI should say so plainly wherever results are shown (e.g., a small "Heuristic analysis, not a trained classifier" tag near the AI-likelihood score).




## 3. End-to-end flow (every stage must actually function, no decorative dead-end buttons)




Dashboard → New Investigation → Case Information → Upload Evidence → Client-side Validation → Upload to Supabase Storage → Create Investigation row in Supabase → Analysis Progress → Deterministic Forensic Analysis (edge function) → Save Results to Supabase → Investigation Results → Metadata Analysis tab → Forensic Findings tab → Provenance tab → Report → Case History (persists across refresh).




## 4. Dashboard




Header: `SACHSCAN` with subtitle `Digital Media Forensics & Verification`.




Stat cards (from live Supabase data): Total Investigations, Active Investigations, High-Risk Cases, Recent Investigations count.




Primary CTA: **New Investigation**. Secondary: **View Investigations**, **Reports**.




A "Recent Investigations" list pulled from the `investigations` table. If the table is empty, seed 2–3 clearly labeled `DEMO CASE` rows so the dashboard doesn't look empty for judges — but every demo row must carry a persistent `DEMO CASE` badge distinct from the styling used for real analyses (e.g., a dashed border + amber "DEMO" chip vs. solid border for live cases), and demo cases must never appear indistinguishable from real ones in any list, filter, or count.




## 5. New Investigation




Fields: Case ID (optional — auto-generate a unique ID like `SS-{YYYYMMDD}-{4 random alphanumeric}` if left blank), Investigator Name, Evidence Description (textarea). On submit, create a row in `investigations` with status `draft`, timestamp, and the entered fields, then route to Upload Evidence with the investigation id in the URL/state. CTA: **Continue to Evidence**.




## 6. Evidence Upload




Drag-and-drop + click-to-browse uploader. Accept `.jpg .jpeg .png .webp` only (reject others with a clear inline error). Client-side validation before upload: file type check, size limit (e.g. 25MB, configurable constant), and a corrupted-file check (attempt to decode the image via an `Image()`/canvas load and catch failure).




Once valid, show: file name, MIME type, file size (human-readable), image preview thumbnail, and pixel dimensions (read via the decoded image). Then upload the real file to a Supabase Storage bucket named `evidence`, with a real progress indicator tied to the actual upload (not a fake timer). Only mark upload as complete once Supabase confirms it; on failure show a retry button and a clear error message, never a silently-stuck spinner. On success, insert a row into `evidence` linked by `investigation_id` with the file's storage URL, name, type, size, width, height. Then trigger the Analysis Progress screen.




If a video/audio file somehow reaches this stage, show a clearly limited-analysis notice ("Only file-level metadata is analyzed for this file type in this prototype — pixel-level forensic analysis is image-only") rather than pretending full analysis ran.




## 7. Forensic analysis engine (the core of the product — implement for real)




Implement this as a Supabase Edge Function (Deno/TypeScript) invoked after upload, so scoring logic lives server-side and is not visible/tamperable from the client, and so it can run consistently regardless of client device. The function receives the storage path, fetches the file, and computes the following **real, measurable signals** — no invented numbers:




**A. File signals**

- MIME type & extension (from the actual file, not the filename string alone — sniff the byte header/magic numbers: `FFD8FF` = JPEG, `89504E47` = PNG, `52494646...57454250` = WEBP)

- File size in bytes

- SHA-256 hash of the file (for the determinism/dedupe cache described in Section 2)

- Width, height, aspect ratio (decoded from image headers)

- For JPEG: quantization table values (used below for recompression/quality signals)




**B. Metadata (EXIF/XMP)**

Use the `exifr` npm package (works in Deno edge functions) to parse EXIF/XMP/IPTC. Extract: camera Make/Model, DateTimeOriginal, Software tag, GPS presence (boolean only — never store/display raw precise GPS coordinates in results without explicit note that they're present, to avoid privacy issues in a demo), Orientation, ColorSpace, and any XMP `CreatorTool`/`Software` fields. Compute a `metadata_status` of one of: `INTACT`, `PARTIALLY_AVAILABLE`, `MISSING`, `INCONSISTENT`, `UNKNOWN` — e.g. `INCONSISTENT` if DateTimeOriginal predates the Software tag's known release, or if GPS altitude/timestamp fields conflict with each other; `MISSING` only when essentially no EXIF block exists at all (which, per Section 2, is reported neutrally, not as a red flag).




**C. Image characteristics (computed via pixel access, e.g. Deno-compatible image decoding + manual pixel loops, or `sharp` if available in the edge runtime — otherwise implement lightweight canvas-equivalent pixel math)**

- Luminance mean & standard deviation across the image (flag unusually low variance as "unusually uniform" — a mild signal, not a verdict)

- Simple noise-floor estimate: average absolute difference between each pixel and its neighbors in a sampled grid (very smooth/denoised images typical of some generators score low here; real camera sensor noise scores higher) — treat as one weighted input among several, not a standalone verdict

- Block-artifact / recompression indicator for JPEGs: inspect the quantization tables — multiple generations of recompression tend to leave characteristic quantization patterns; a very "clean" quantization table paired with claimed camera EXIF is a mild inconsistency signal

- Chroma subsampling pattern (JPEG) — many camera pipelines and many AI generator export pipelines have characteristically different default subsampling; use only as a weak corroborating signal, documented as such in code comments

- Common AI-generator output resolutions check: dimensions matching well-known generator defaults (e.g. 512×512, 768×768, 1024×1024, 1024×1536, 1536×1024 and their common variants) is one weak, clearly-labeled contributing signal — never sufficient alone




**D. Other signals**

- Software tag matched against a maintained list of known generative-AI / editing tool signatures (e.g. tags containing "Midjourney", "DALL", "Stable Diffusion", "Leonardo", "Firefly", plus known heavy editors like "Photoshop" logged as an editing signal, not an AI signal)

- Presence of C2PA/Content Credentials metadata if the parser finds it (log as a strong signal in whichever direction it points, since this is a real provenance standard)




All of the above must be **actually computed from the actual bytes of the actual uploaded file**. Do not stub any of these with placeholder constants.




## 8. Deterministic scoring




In the edge function, implement a documented weighted-sum scoring model (comment the weights inline, e.g. in a `SCORING_WEIGHTS` const object) roughly like:




```

AI Generation Likelihood = Σ(weight_i × normalized_signal_i)

  signals: generator-software-tag match (high weight),

           common-generator-resolution match (low weight),

           smooth/low-noise indicator (medium weight),

           absence of any camera indicators combined with presence of

             editing/generation software tag (medium weight)

           C2PA credentials indicating AI training/generation, if present (very high weight)




Manipulation Likelihood = Σ(weight_i × normalized_signal_i)

  signals: metadata inconsistency (high weight),

           recompression/quantization anomaly (medium weight),

           chroma-subsampling mismatch vs. claimed source (low weight),

           heavy-editor software tag present (medium weight)




Authenticity Confidence = f(number_of_available_signals, signal_agreement, evidence_strength)

  NOT simply "100 - AI likelihood." If fewer than ~4 signals are available, cap

  confidence and explicitly return status "Insufficient evidence" rather than a

  precise number.




Overall Risk = derived from combining AI likelihood + Manipulation likelihood,

  banded into LOW / MODERATE / HIGH / CRITICAL — CRITICAL must be worded in the UI

  as "high concentration of suspicious indicators," never "confirmed fake."

```




Score bands for the two likelihood scores: 0–20 Low, 21–40 Mild, 41–60 Moderate, 61–80 High, 81–100 Very High. Store the exact numeric scores plus the band label. Every score must be traceable in the stored `signals` JSON to the individual signal values that produced it (store the raw signal breakdown, not just the final numbers), so the Findings and Report pages can explain *why*.




## 9. Result explanation




Every result must render as evidence, not just a number. For each of AI-likelihood and Manipulation-likelihood, render a short checklist of the actual signals that fired, phrased professionally, e.g.:




> AI-generation assessment: **Low**

> ✓ Camera metadata present (Make/Model detected)

> ✓ Dimensions consistent with typical smartphone capture, not a known generator default

> ✓ No generative-AI software tag detected

> — No strong synthetic-image statistical indicators detected




Include a Confidence line with a plain-language reason ("Several independent signals were available and were consistent with each other" / "Few independent signals were available; treat this assessment as preliminary").




## 10. Analysis Progress screen




Sequential, real progress through: Evidence ingestion → File integrity verification → Metadata extraction → Image characteristics analysis → Manipulation indicator analysis → AI-generation indicator analysis → Provenance assessment → Confidence calculation → Report preparation. Drive this off the actual async edge-function call's lifecycle (e.g., simulate stage transitions on a timer while the real request is in flight, but do not claim a stage is "done" before the real computation for that stage has actually run inside the edge function). Do not imply an external hosted AI model is being called — phrase stage labels around "analysis" and "extraction," not "AI is scanning."




## 11. Results Dashboard (highest-priority screen for judging)




Above the fold: Overall Assessment, AI Generation Likelihood, Manipulation Likelihood, Authenticity Confidence, Overall Risk — as gauge/ring components + metric cards, understandable within ~5 seconds. Below: an evidence-signal list with chips (✓ supportive / ⚠ inconsistent / — unavailable), and tabs or sections for Metadata, Findings, Provenance, Report. Keep visual effects restrained — no exploding confetti-style reveals; a calm, confident, evidence-desk feel.




## 12. Metadata Analysis page




**File information:** file name, type, MIME type, size, width, height, aspect ratio, SHA-256 hash.

**EXIF information:** camera make/model, capture time, software, orientation, GPS (presence only, as noted above), other available fields.

**Metadata status badge:** `INTACT` / `PARTIALLY AVAILABLE` / `MISSING` / `INCONSISTENT` / `UNKNOWN`, with a one-line explanation of what that status means and a reminder that missing metadata alone is not evidence of manipulation or AI generation.




## 13. Provenance / Source Trace page




Show whatever real provenance clues exist (metadata origin clues, software lineage, file hash/fingerprint, C2PA data if present). Prominently state: **"Automated web-wide source verification is not available in this prototype."** If you include illustrative source-match rows for demo purposes, each row must carry a persistent `DEMO / SIMULATED SOURCE MATCH` badge and must never appear in the same visual treatment as real computed data.




## 14. Forensic Findings page




A structured list of individual findings, each with: severity, confidence, title, plain-language explanation, and the underlying signal type it came from (pulled straight from the `signals`/`findings` JSON saved by the edge function) — e.g. "Camera metadata detected," "Processing software tag detected," "Metadata appears incomplete," "Dimensions consistent with common smartphone capture," "Compression characteristics indicate recompression." Use professional forensic wording throughout, never casual language.




## 15. Report




Header: `SACHSCAN — Digital Media Forensic Assessment`. Include Case ID, Investigator, Evidence name, Date, Status, Executive Summary, Overall Assessment, AI Generation Assessment, Manipulation Assessment, Authenticity Confidence, Metadata Findings, Forensic Findings, Provenance Findings, Technical Signals, Limitations, and a Disclaimer paragraph restating the prototype/probabilistic-indicator language from Section 2. Provide **Print Report** (browser print stylesheet) and, if feasible in the time available, a **Download/Export** (PDF via a client-side lib, or at minimum a clean print-to-PDF-ready layout) — implement whichever is realistically achievable rather than leaving a broken button.




## 16. Case History




Table of all investigations from Supabase: Case ID, Evidence, Investigator, Date, Risk Level, AI Probability, Manipulation Probability, Status. Clicking a row opens the full investigation. Data must persist across a browser refresh (i.e., genuinely read from Supabase on load, not from local component state only).




## 17. Supabase schema




Create these tables if they don't already exist (adapt sensibly to whatever's already in the project rather than duplicating):




```sql

investigations (

  id uuid primary key default gen_random_uuid(),

  case_id text unique not null,

  investigator_name text,

  evidence_name text,

  evidence_type text,

  evidence_description text,

  status text default 'draft',

  ai_probability numeric,

  manipulation_probability numeric,

  authenticity_confidence numeric,

  risk_level text,

  metadata_status text,

  source_trace_status text,

  summary text,

  is_demo boolean default false,

  created_at timestamptz default now()

);




evidence (

  id uuid primary key default gen_random_uuid(),

  investigation_id uuid references investigations(id) on delete cascade,

  file_name text,

  file_type text,

  file_size bigint,

  file_url text,

  file_hash text,

  width integer,

  height integer,

  created_at timestamptz default now()

);




analysis_results (

  id uuid primary key default gen_random_uuid(),

  investigation_id uuid references investigations(id) on delete cascade,

  ai_probability numeric,

  manipulation_probability numeric,

  authenticity_confidence numeric,

  risk_level text,

  findings jsonb,

  signals jsonb,

  created_at timestamptz default now()

);




source_matches (

  id uuid primary key default gen_random_uuid(),

  investigation_id uuid references investigations(id) on delete cascade,

  source_name text,

  source_url text,

  similarity_score numeric,

  confidence numeric,

  discovered_date text,

  is_demo boolean default true,

  created_at timestamptz default now()

);

```




Add sensible indexes (`case_id`, `investigation_id` foreign key columns) and use `file_hash` on `evidence` as the dedupe key described in Section 2 — check for an existing `analysis_results` row for the same hash before recomputing.




## 18. Supabase Storage & security




Create/use a bucket named `evidence`. Configure reasonable policies for the hackathon (authenticated or public-insert with sane limits — match whatever auth already exists in the project; if there is no auth yet, design storage/RLS so it can be tightened later without a rewrite). Enable RLS on all four tables with functional-but-simple policies appropriate for a hackathon demo (e.g., allow read/insert, restrict update/delete as appropriate). **Never** put a Supabase service-role key in any frontend code — service-role access, if needed, stays inside the edge function only.




## 19. Error handling




Every operation below needs loading, success, and error states, with a retry action where sensible — never leave the user on a stuck spinner: file validation, Supabase upload, database insert, analysis edge-function call, results save, report generation/export.




## 20. Demo cases




Seed 2–3 demo investigations (e.g., "Authentic smartphone photograph," "Edited/compressed image," "AI-generated example") purely so the dashboard/case history aren't empty on first load. Every demo row/badge must say `DEMO CASE` persistently and must be visually distinct from real analyses at all times — never implied to be a live result.




## 21. Responsive design




Optimize primarily for laptop/desktop (the demo will run on a laptop), with tablet as a secondary target. All core screens (dashboard, upload, results, report, case history) must not break at typical laptop and tablet widths.




## 22. Priorities, in order




1. Working end-to-end flow: create case → upload real image → Supabase Storage → Supabase DB → real signal extraction → deterministic scoring → results → findings/metadata/provenance → report → case history, all functioning with no dead buttons.

2. Real analysis of the actual uploaded file (no randomness, no hard-coded results for live uploads).

3. Explainability — every score traceable to real signals shown to the user.

4. Correct, working Supabase integration (Storage + Database + RLS), no exposed secrets.

5. Professional forensic-console UI matching Section 1.

6. Reliability — proper loading/success/error states everywhere.

7. Demo polish for a 3–5 minute judged presentation.




Build SACHSCAN as a serious digital-media forensic investigation platform — not an "AI detector" — with every score and finding traceable to a real, deterministic signal computed from the actual uploaded file.


==================================================

IMPLEMENTATION PRIORITY

==================================================

If implementation complexity becomes too high, DO NOT leave the core workflow incomplete.

Prioritize in this exact order:

1. Working image upload

2. Supabase Storage

3. Supabase investigation/database records

4. Actual deterministic image/file signal extraction

5. Explainable forensic scoring

6. Results saved to Supabase

7. Results page

8. Case history

9. Metadata page

10. Professional UI polish

11. Report generation

12. Provenance/source-trace enhancements

13. Video/audio support

The application MUST have a completely working path:

Upload real image

→ analyze that actual image

→ generate deterministic result

→ save result to Supabase

→ display result

→ retrieve result after refresh

Do NOT sacrifice this working core in order to implement additional features.

If a sophisticated AI/ML detector cannot genuinely be implemented, use a transparent deterministic forensic heuristic system and clearly label it as a prototype forensic assessment.

NEVER use random values or fake analysis results for live uploaded evidence.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://sachscan-forensics.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/93788b10-6427-49cd-a5df-400e576a7d71).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

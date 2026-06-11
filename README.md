# PINIT-DNA — Persistent Image DNA Fingerprint System

> A production-ready backend API that generates and verifies a 6-layer invisible fingerprint for any digital image — proving ownership and detecting tampering even after compression, resizing, or colour adjustment.

## ngrok http 3000

## What Is This Project?

PINIT-DNA is inspired by biological DNA. Just as human DNA identifies a person across their entire lifetime even if they change appearance, Image DNA identifies a photo across its entire life on the internet even after edits.

The system takes any uploaded image and simultaneously computes **6 different fingerprints** using 6 completely different techniques. Each fingerprint survives a different set of attacks. An attacker would need to destroy all 6 at once — which would make the image visually worthless.

---

## The Problem It Solves

Every day billions of images are stolen, reposted, and claimed by others. Existing protection methods all fail:

| Method | Why It Fails |
|---|---|
| Visible watermark | Anyone can crop it out in seconds |
| File metadata (EXIF) | Every social media platform strips it automatically |
| Single hidden watermark | One targeted attack removes all protection |
| Copyright notice | Cannot be proven technically inside the image |

---

## The 6 Fingerprint Layers

### Layer 1 — SHA-256 Cryptographic Hash
- Reads every single pixel and feeds them into SHA-256 — always produces the same unique 64-character code for the same input
- **Two hashes:** Raw file hash + pixel-only hash (survives EXIF stripping)
- **Survives:** Nothing — any change breaks it. Acts like a wax seal
- **Purpose:** Proves instantly whether the image is the exact untouched original

### Layer 2 — Structural Fingerprint (Sobel Edge Detection)
- Detects all edges in the image (where light meets dark, where objects end) and creates a 64-bit signature from the edge pattern across an 8×8 grid of zones
- Signature is hidden in the **Red channel LSBs** at edge pixel positions — locations where the human eye is least sensitive to change
- **Survives:** Colour changes, brightness adjustments, mild compression
- **Defeated by:** Heavy cropping that removes large portions of the image

### Layer 3 — Perceptual Visual Hash (DCT pHash)
- Shrinks the image to 32×32 greyscale, applies Discrete Cosine Transform (same maths used in JPEG compression), extracts the 64 most visually important patterns, creates a 64-bit code
- Three hashes computed: **pHash** (DCT-based, primary), **aHash** (average, fast pre-filter), **dHash** (difference, contrast-robust)
- **Survives:** JPEG compression, resizing, minor brightness changes, format conversion
- **Defeated by:** Heavy artistic filters, complete redrawing of image content

### Layer 4 — Semantic Color Fingerprint (RGB Histogram)
- Divides all possible colours into 8 groups and counts how many pixels fall into each group for Red, Green, and Blue separately — creating a 24-number "colour personality" of the image
- Also extracts the top 5 dominant colours with coverage percentages
- Compact 12-hex-char fingerprint derived from the 8-bin summaries
- **Survives:** Minor colour shifts, format conversion, light compression
- **Defeated by:** Complete colour inversion, radical recolouring

### Layer 5 — Metadata Provenance Record (C2PA-style)
- Extracts all EXIF/IPTC/XMP metadata (camera make/model, GPS, capture time) and creates a structured provenance manifest containing: tool name, version, DNA record ID, timestamp, and a cryptographic link to the Layer 1 hash
- Follows the C2PA (Coalition for Content Provenance and Authenticity) standard
- **Survives:** Normal file sharing, email, messaging apps
- **Defeated by:** Any image editor or social media platform that strips metadata

### Layer 6 — Hidden AI Signature (LSB Steganography)
- Generates a unique random cryptographic token, converts it to binary, and hides it by changing the very last bit of the **Blue channel** value in consecutive pixels
- Example: A pixel with blue value 200 (binary: `11001000`) becomes 201 (binary: `11001001`) — a change of just 1 unit, completely invisible to the human eye
- Payload: Magic header (16 bits) + Token (256 bits) + HMAC-SHA256 (256 bits) = **528 bits total**
- The token itself lives only inside the image pixels — only the HMAC is stored in the database
- **Survives:** PNG re-saves, brightness/contrast changes, high-quality JPEG (≥90)
- **Defeated by:** Lossy JPEG re-encoding at low quality, full image resampling

---

## Coverage Matrix

| Attack Type | L1 Hash | L2 Structural | L3 pHash | L4 Semantic | L5 Metadata | L6 AI Sig |
|---|---|---|---|---|---|---|
| JPEG Compression | FAIL | SURVIVES | SURVIVES | SURVIVES | SURVIVES | SURVIVES |
| Resize / Scale | FAIL | SURVIVES | SURVIVES | SURVIVES | SURVIVES | PARTIAL |
| Crop (small) | FAIL | PARTIAL | SURVIVES | SURVIVES | SURVIVES | PARTIAL |
| Brightness Change | FAIL | SURVIVES | SURVIVES | SURVIVES | SURVIVES | SURVIVES |
| Metadata Strip | SURVIVES | SURVIVES | SURVIVES | SURVIVES | FAIL | SURVIVES |
| Format Convert | FAIL | SURVIVES | SURVIVES | SURVIVES | PARTIAL | SURVIVES |
| Exact Original | SURVIVES | SURVIVES | SURVIVES | SURVIVES | SURVIVES | SURVIVES |

For any given attack, **at least 3 to 5 layers survive.**

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript 5 |
| Framework | Express.js 4 |
| Database | PostgreSQL 16 (Supabase) |
| ORM | Prisma 5 |
| Image Processing | Sharp |
| Metadata Extraction | exifr |
| File Upload | Multer |
| Validation | Zod |
| Logging | Winston |
| Testing | Jest + ts-jest |

---

## Database Schema

8 tables in PostgreSQL:

```
dna_records          — Root record: image metadata + processing status
crypto_layers        — Layer 1: SHA-256 raw + normalised hashes
structural_layers    — Layer 2: Edge map, 64 vectors, 64-bit signature
perceptual_layers    — Layer 3: pHash64, pHash256, aHash64, dHash64
semantic_layers      — Layer 4: RGB/HSV histograms, dominant colours
metadata_layers      — Layer 5: EXIF/IPTC/XMP, device, GPS, provenance
stego_layers         — Layer 6: HMAC, channel, carrier image path
verification_logs    — Every verification run with per-layer scores
```

---

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Server health check |
| `POST` | `/api/v1/dna/generate` | Upload image → generate 6-layer DNA |
| `GET` | `/api/v1/dna/:id` | Retrieve DNA record summary |
| `POST` | `/api/v1/dna/:id/verify` | Upload probe image → verify against stored DNA |

### Generate DNA

```http
POST /api/v1/dna/generate
Content-Type: multipart/form-data

image: <file>
```

```json
{
  "success": true,
  "dnaRecordId": "b77b190d-c2a2-4d17-8888-e76d86c33479",
  "status": "COMPLETE",
  "schemaVersion": "1.0.0",
  "summary": {
    "totalLayers": 6,
    "successfulLayers": 6,
    "failedLayers": 0,
    "totalProcessingMs": 9320
  },
  "generatedAt": "2026-06-01T06:19:48.644Z"
}
```

### Verify DNA

```http
POST /api/v1/dna/b77b190d-c2a2-4d17-8888-e76d86c33479/verify
Content-Type: multipart/form-data

image: <probe_file>
```

```json
{
  "success": true,
  "passed": true,
  "confidenceScore": 0.85,
  "layerResults": [
    { "layer": "cryptographic", "passed": true, "similarityScore": 1.0, "threshold": 1.0 },
    { "layer": "structural",    "passed": true, "similarityScore": 0.92, "threshold": 0.75 },
    { "layer": "perceptual",    "passed": true, "similarityScore": 0.98, "threshold": 0.80 },
    { "layer": "semantic",      "passed": true, "similarityScore": 0.96, "threshold": 0.70 },
    { "layer": "metadata",      "passed": true, "similarityScore": 1.0,  "threshold": 0.60 },
    { "layer": "steganography", "passed": true, "similarityScore": 1.0,  "threshold": 1.0  }
  ],
  "verifiedAt": "2026-06-01T06:21:00.000Z"
}
```

---

## Verification Scoring

Each layer has a weight and pass threshold:

| Layer | Weight | Threshold |
|---|---|---|
| Cryptographic | 30% | 1.0 (exact match only) |
| Structural | 20% | 0.75 |
| Perceptual | 20% | 0.80 |
| Semantic | 15% | 0.70 |
| Metadata | 5% | 0.60 |
| Steganography | 10% | 1.0 (HMAC verified) |

**Pass criteria:** Confidence score ≥ 0.70 AND at least Layer 1 OR Layer 3 individually passes.

---

## Project Structure

```
Pinit-DNA/
├── src/
│   ├── app.ts                          — Express server entry point
│   ├── config/index.ts                 — All environment variables (typed)
│   ├── lib/
│   │   ├── logger.ts                   — Winston structured logger
│   │   └── prisma.ts                   — PrismaClient singleton
│   ├── types/
│   │   └── dna.types.ts                — All TypeScript interfaces
│   ├── services/
│   │   ├── dna.orchestrator.ts         — Runs all 6 layers, persists to DB
│   │   ├── dna.verifier.ts             — Weighted scoring + pass/fail logic
│   │   └── layers/
│   │       ├── layer1.cryptographic.ts — SHA-256 hash
│   │       ├── layer2.structural.ts    — Sobel edge detection + LSB embed
│   │       ├── layer3.perceptual.ts    — DCT pHash / aHash / dHash
│   │       ├── layer4.semantic.ts      — RGB histogram descriptor
│   │       ├── layer5.metadata.ts      — EXIF/IPTC/XMP + C2PA provenance
│   │       └── layer6.steganography.ts — LSB steganography + HMAC verify
│   └── api/
│       ├── routes/dna.routes.ts        — Route definitions
│       ├── controllers/dna.controller.ts — Request/response handling
│       └── middleware/
│           ├── upload.middleware.ts    — Multer file upload + MIME validation
│           └── error.middleware.ts     — Global error handler
├── prisma/
│   └── schema.prisma                   — 8-table database schema
├── tests/
│   ├── health.test.ts
│   └── layers/
│       ├── layer1.cryptographic.test.ts
│       ├── layer2.structural.test.ts
│       ├── layer3.perceptual.test.ts
│       ├── layer4.semantic.test.ts
│       ├── layer5.metadata.test.ts
│       └── layer6.steganography.test.ts
├── ARCHITECTURE.md                     — Full design document and roadmap
├── .env.example                        — Environment variable template
└── package.json
```

---

## Setup & Installation

### Prerequisites
- Node.js 20+
- A PostgreSQL database (Supabase free tier works)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
DATABASE_URL="postgresql://..."   # Supabase Transaction Pooler (port 6543)
DIRECT_URL="postgresql://..."     # Supabase Session Pooler (port 5432)
LSB_SIGNATURE_SECRET="your-secret-key"
```

### 3. Push database schema

```bash
npx prisma db push
```

### 4. Start the server

```bash
npm run dev        # Development (auto-restart)
npm run build      # Compile TypeScript
npm start          # Production
```

Server runs on `http://localhost:4000`

---

## Running Tests

```bash
# All tests
npm test

# Single layer
npx jest tests/layers/layer1.cryptographic.test.ts --no-coverage
npx jest tests/layers/layer2.structural.test.ts --no-coverage
npx jest tests/layers/layer3.perceptual.test.ts --no-coverage
npx jest tests/layers/layer4.semantic.test.ts --no-coverage
npx jest tests/layers/layer5.metadata.test.ts --no-coverage
npx jest tests/layers/layer6.steganography.test.ts --no-coverage
```

### Test Results

| Layer | Tests | Result |
|---|---|---|
| Layer 1 — Cryptographic Hash | 7 | PASS |
| Layer 2 — Structural Fingerprint | 9 | PASS |
| Layer 3 — Perceptual Visual Hash | 9 | PASS |
| Layer 4 — Semantic Color Fingerprint | 11 | PASS |
| Layer 5 — Metadata Provenance | 11 | PASS |
| Layer 6 — AI Signature (LSB Stego) | 10 | PASS |
| **Total** | **57** | **ALL PASS** |

---

## Live API Test Results

Tested on a real 562KB JPEG (`tiger.jpeg`):

```
POST /api/v1/dna/generate
→ 201 Created
→ status: COMPLETE
→ successfulLayers: 6/6
→ processingTime: 9.3 seconds

GET /api/v1/dna/b77b190d-c2a2-4d17-8888-e76d86c33479
→ 200 OK
→ All 6 layers stored in Supabase

POST /api/v1/dna/b77b190d-c2a2-4d17-8888-e76d86c33479/verify
→ 200 OK
→ passed: true
→ confidenceScore: 0.85
→ Layer 1 cryptographic: similarityScore 1.0 (exact pixel match confirmed)
```

---

## Key Achievement

No existing open-source system combines all 6 of these techniques into a single unified pipeline. Each technique individually exists in research — SHA-256, pHash, LSB steganography, colour histograms, edge detection, metadata provenance — but PINIT-DNA is the first prototype to chain all six into one production-ready API where each layer compensates for the weaknesses of the others.

---

## Future Roadmap

- **Phase 4:** AES-256-GCM encryption of DNA fields before vault storage
- **Phase 5:** Async job queue (BullMQ) for large image processing
- **Phase 6:** Batch verification across multiple record IDs
- **Phase 7:** Android SDK integration

---

## License

This project is a research prototype built as part of academic work on Persistent Image DNA fingerprinting systems.

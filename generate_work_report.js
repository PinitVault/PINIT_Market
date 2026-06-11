const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, LevelFormat, ExternalHyperlink,
  PageBreak
} = require('docx');
const fs = require('fs');

const TEAL = "0F7173";
const DARK = "1A1A2E";
const LIGHT_TEAL = "E0F4F4";
const MID_TEAL = "C5E8E8";
const WHITE = "FFFFFF";
const GRAY = "F5F5F5";
const TEXT_GRAY = "555555";

const border = { style: BorderStyle.SINGLE, size: 1, color: "D0D0D0" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function sectionHeading(text, emoji) {
  return new Paragraph({
    spacing: { before: 360, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 4 } },
    children: [
      new TextRun({ text: `${emoji}  ${text}`, bold: true, size: 28, color: DARK, font: "Arial" })
    ]
  });
}

function subHeading(text) {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, color: TEAL, font: "Arial" })]
  });
}

function bullet(text, bold = false) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 20, font: "Arial", bold, color: "333333" })]
  });
}

function bodyText(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 20, font: "Arial", color: "333333" })]
  });
}

function spacer(before = 120) {
  return new Paragraph({ spacing: { before, after: 0 }, children: [new TextRun("")] });
}

function statusRow(module, status, color) {
  return new TableRow({
    children: [
      new TableCell({
        borders, width: { size: 5200, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 160, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: module, size: 20, font: "Arial", color: "333333" })] })]
      }),
      new TableCell({
        borders, width: { size: 2080, type: WidthType.DXA },
        shading: { fill: color, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: status, size: 18, font: "Arial", bold: true, color: WHITE })]
        })]
      }),
    ]
  });
}

function techBadge(tech) {
  return new TableCell({
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
    shading: { fill: LIGHT_TEAL, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: tech, size: 18, font: "Arial", bold: true, color: TEAL })]
    })]
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 560, hanging: 280 } } }
        }]
      },
      {
        reference: "sub-bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 900, hanging: 280 } } }
        }]
      }
    ]
  },
  styles: {
    default: {
      document: { run: { font: "Arial", size: 20, color: "333333" } }
    }
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1260, bottom: 1080, left: 1260 }
      }
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL, space: 4 } },
            spacing: { before: 0, after: 120 },
            children: [
              new TextRun({ text: "PINIT-DNA  |  Internship Work Report  |  April 9 – June 9, 2026", size: 18, font: "Arial", color: TEXT_GRAY })
            ]
          })
        ]
      })
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: TEAL, space: 4 } },
            spacing: { before: 100, after: 0 },
            tabStops: [{ type: "right", position: 9360 }],
            children: [
              new TextRun({ text: "Kavvam Ashwitha  |  Junior Software Developer Intern", size: 18, font: "Arial", color: TEXT_GRAY }),
              new TextRun({ text: "\t", size: 18 }),
              new TextRun({ text: "Page ", size: 18, font: "Arial", color: TEXT_GRAY }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Arial", color: TEXT_GRAY }),
            ]
          })
        ]
      })
    },
    children: [

      // ─── COVER BLOCK ────────────────────────────────────────────────────────
      spacer(240),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        shading: { fill: DARK, type: ShadingType.CLEAR },
        children: [new TextRun({ text: " ", size: 4, font: "Arial" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        shading: { fill: TEAL, type: ShadingType.CLEAR },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: DARK } },
        children: [
          new TextRun({ text: "PINIT-DNA", bold: true, size: 72, font: "Arial", color: WHITE }),
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        shading: { fill: TEAL, type: ShadingType.CLEAR },
        children: [
          new TextRun({ text: "Unified Forensic & Secure Document Intelligence Platform", size: 26, font: "Arial", color: WHITE, italics: true }),
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 0 },
        shading: { fill: TEAL, type: ShadingType.CLEAR },
        children: [new TextRun({ text: " ", size: 8 })]
      }),

      spacer(280),

      // Info table
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2200, 4960, 2200],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                width: { size: 2200, type: WidthType.DXA },
                shading: { fill: LIGHT_TEAL, type: ShadingType.CLEAR },
                margins: { top: 120, bottom: 120, left: 180, right: 120 },
                children: [
                  new Paragraph({ children: [new TextRun({ text: "Submitted By", size: 18, font: "Arial", color: TEAL, bold: true })] }),
                  new Paragraph({ children: [new TextRun({ text: "Kavvam Ashwitha", size: 22, font: "Arial", color: DARK, bold: true })] }),
                ]
              }),
              new TableCell({
                borders: noBorders,
                width: { size: 4960, type: WidthType.DXA },
                shading: { fill: GRAY, type: ShadingType.CLEAR },
                margins: { top: 120, bottom: 120, left: 240, right: 120 },
                children: [
                  new Paragraph({ children: [new TextRun({ text: "Role", size: 18, font: "Arial", color: TEAL, bold: true })] }),
                  new Paragraph({ children: [new TextRun({ text: "Junior Software Developer Intern", size: 22, font: "Arial", color: DARK, bold: true })] }),
                ]
              }),
              new TableCell({
                borders: noBorders,
                width: { size: 2200, type: WidthType.DXA },
                shading: { fill: LIGHT_TEAL, type: ShadingType.CLEAR },
                margins: { top: 120, bottom: 120, left: 180, right: 120 },
                children: [
                  new Paragraph({ children: [new TextRun({ text: "Period", size: 18, font: "Arial", color: TEAL, bold: true })] }),
                  new Paragraph({ children: [new TextRun({ text: "Apr 9 – Jun 9, 2026", size: 22, font: "Arial", color: DARK, bold: true })] }),
                ]
              }),
            ]
          })
        ]
      }),

      spacer(320),

      // ─── OVERVIEW ─────────────────────────────────────────────────────────
      sectionHeading("Executive Overview", "📋"),
      spacer(80),
      bodyText("Over the course of two months, I contributed to the full-stack development of PINIT-DNA — a forensic-grade, enterprise document intelligence platform. The work spanned three major phases:"),
      spacer(60),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [1600, 7760],
        rows: [
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 1600, type: WidthType.DXA }, shading: { fill: TEAL, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 120 }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Phase 1", size: 20, font: "Arial", bold: true, color: WHITE })] })] }),
            new TableCell({ borders, width: { size: 7760, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 160, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: "April 9 – April 28  |  Digital Identity, Vault & Portfolio Modules", size: 20, font: "Arial", color: "333333" })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 1600, type: WidthType.DXA }, shading: { fill: "0A5C5E", type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 120 }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Phase 2", size: 20, font: "Arial", bold: true, color: WHITE })] })] }),
            new TableCell({ borders, width: { size: 7760, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 160, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: "April 29 – May 19  |  Forensics, AI Detection, Encryption & Resume Sharing", size: 20, font: "Arial", color: "333333" })] })] }),
          ]}),
          new TableRow({ children: [
            new TableCell({ borders, width: { size: 1600, type: WidthType.DXA }, shading: { fill: DARK, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 120 }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Phase 3", size: 20, font: "Arial", bold: true, color: WHITE })] })] }),
            new TableCell({ borders, width: { size: 7760, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 160, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: "May 20 – June 9   |  Universal DNA Engine, Smart Links, Privacy Masking & Certificates", size: 20, font: "Arial", color: "333333" })] })] }),
          ]}),
        ]
      }),

      spacer(120),

      // ─── PAGE BREAK ───────────────────────────────────────────────────────
      new Paragraph({ children: [new PageBreak()] }),

      // ─── PHASE 1 ──────────────────────────────────────────────────────────
      sectionHeading("Phase 1 — Digital Identity, Vault & Portfolio  (April 9–28)", "🗂️"),

      subHeading("Digital Identity Module"),
      bullet("Implemented user profile creation and management flow"),
      bullet("Integrated profile data with portfolio usage and document linking"),
      bullet("Handled profile information persistence and secure data handling"),

      subHeading("Secure Document Vault"),
      bullet("Built secure document upload and storage workflows"),
      bullet("Implemented document categorization, retrieval and management"),
      bullet("Integrated AES-256-GCM encryption for all uploaded documents"),
      bullet("Configured encrypted storage architecture with Supabase Storage"),
      bullet("Implemented secure decryption during authorized downloads"),

      subHeading("Portfolio Module"),
      bullet("Designed Portfolio Dashboard UI with type selection flow"),
      bullet("Implemented four portfolio types: Academic, Masters, Personal, Professional"),
      bullet("Built complete CRUD operations — Create, View, Edit, Delete, Share"),
      bullet("Integrated Vault documents with Portfolio sections dynamically"),
      bullet("Implemented portfolio-specific document mapping and persistence"),
      bullet("Fixed navigation, routing, and local storage handling issues"),

      subHeading("Portfolio Sharing"),
      bullet("Implemented share settings: view-only / download access controls"),
      bullet("Added expiry settings, watermark options, and public/private controls"),
      bullet("Architected share-link generation and portfolio share token handling"),
      bullet("Worked on browser-access portfolio rendering flow and backend integration"),

      subHeading("Testing & Build"),
      bullet("Fixed Portfolio UI rendering, creation workflow and data persistence bugs"),
      bullet("Debugged API integration and frontend-backend synchronization issues"),
      bullet("Managed Android APK generation via Capacitor synchronization workflows"),

      spacer(120),
      new Paragraph({ children: [new PageBreak()] }),

      // ─── PHASE 2 ──────────────────────────────────────────────────────────
      sectionHeading("Phase 2 — Forensics, AI Detection & Resume Sharing  (Apr 29–May 19)", "🔬"),

      subHeading("Unified Forensics Module"),
      bullet("Integrated Tesseract OCR for text extraction from documents and PDFs"),
      bullet("Implemented metadata analysis and forensic information extraction"),
      bullet("Added PDF forensic inspection — file structure and binary analysis"),
      bullet("Integrated camera source detection logic for image provenance"),
      bullet("Built AI-generated image detection pipeline using TensorFlow.js and ONNX Runtime"),
      bullet("Implemented unified forensic scoring and authenticity assessment workflows"),

      subHeading("AI Image Detection"),
      bullet("Configured ONNX Runtime inference for AI vs camera-captured classification"),
      bullet("Generated confidence scores and result interpretation outputs"),
      bullet("Performed model validation testing with failure sample collection"),

      subHeading("Secure Resume Sharing System"),
      bullet("Developed end-to-end secure resume sharing workflow with share-link generation"),
      bullet("Built protected resume viewer with contact information masking (Email & Phone)"),
      bullet("Implemented approval-based access workflow — Approve / Reject controls"),
      bullet("Built viewer activity tracking, session analytics and access history logging"),

      subHeading("Security Monitoring"),
      bullet("Implemented copy, cut, text-selection and context-menu detection"),
      bullet("Added print attempt detection and before/after-print event logging"),
      bullet("Monitored screenshot shortcuts (Print Screen) and screen recording signals"),
      bullet("Tracked window blur, tab-switch and visibility change events as security events"),

      subHeading("Resume Share Dashboard"),
      bullet("Built multi-tab dashboard: Requests, Views, Share Links, Security, Settings"),
      bullet("Implemented viewer session tracking: device, browser, OS, screen size, geolocation"),
      bullet("Added security alert generation and suspicious activity monitoring"),
      bullet("Added Generate New Link and link revocation functionality"),

      subHeading("WhatsApp / OpenGraph Share Cards"),
      bullet("Generated professional OpenGraph preview cards for resume sharing"),
      bullet("Implemented OCR-assisted candidate name extraction for dynamic share-card naming"),
      bullet("Produced branded sharing experience across messaging platforms"),

      spacer(120),
      new Paragraph({ children: [new PageBreak()] }),

      // ─── PHASE 3 ──────────────────────────────────────────────────────────
      sectionHeading("Phase 3 — Universal DNA Engine & Enterprise Features  (May 20–Jun 9)", "🧬"),

      subHeading("Universal DNA Engine (Multi-File Fingerprinting)"),
      bullet("Extended DNA system from images-only to 10 file types: PDF, DOCX, Excel, PowerPoint, Video, Audio, TXT, CSV, JSON, ZIP"),
      bullet("Built a Universal File Router that detects file type and routes to the correct DNA engine"),
      bullet("Every file generates a unique 6-layer DNA fingerprint with SHA-256 hash stored per record"),

      subHeading("Vault System (Encrypted File Storage)"),
      bullet("Implemented AES-256-GCM encryption for all vault-stored files"),
      bullet("Built Vault Explorer UI — list, retrieve, preview and manage encrypted files"),
      bullet("Added Vault Integrity Check — verifies all encrypted files are untampered on disk"),

      subHeading("Smart Links System (Secure File Sharing)"),
      bullet("Built complete Smart Share Link generation with configurable expiry and max-view limits"),
      bullet("Added one-time-use link support and link revocation / force logout"),
      bullet("Implemented Policy Restrictions: allowed countries (geo-IP), device types, IP prefix allowlist"),
      bullet("Built OTP Verification — recipients must pass a code challenge before file access"),
      bullet("Implemented full Access Logging: every view, download, copy and screenshot attempt tracked with IP, browser, device and location"),
      bullet("Built CSV Audit Export for complete share link access logs"),

      subHeading("Monitoring & Forensics Dashboard"),
      bullet("Built Real-time Live Session Monitor — live view of who is currently accessing a file"),
      bullet("Implemented screenshot and screen-recording detection via window-blur heuristics"),
      bullet("Added copy and print attempt detection with per-event audit logging"),
      bullet("Built Forensic Reports page with full chronological audit trail"),
      bullet("Implemented Geo Analytics — world map visualisation of file access locations"),

      subHeading("Duplicate Prevention System"),
      bullet("Built universal duplicate detection using SHA-256 hash comparison across all DNA records"),
      bullet("Works for all 10 supported file types — PDF, DOCX, video, audio, images and more"),
      bullet("Built Duplicate Attempts Dashboard showing history of all blocked re-uploads"),

      subHeading("Privacy Masking Feature"),
      bullet("Built viewer-layer Privacy Masking for Smart Links — original file is never modified"),
      bullet("Auto-detects sensitive data: Email, Phone, Aadhaar, PAN, Address"),
      bullet("Auto-enables only the detected data types when sharing is configured"),
      bullet("Masked content rendered as a professional styled document with proper headings, sections and contact chips"),
      bullet("Masked fields highlighted in red badges so the recipient knows data is protected"),
      bullet("Built Request Unmasked Access flow — recipient requests, owner Approves or Rejects"),
      bullet("Built Unmask Requests Dashboard for owners to manage all requests in one view"),
      bullet("Full audit trail: MASKING_ENABLED, UNMASK_REQUESTED, UNMASK_APPROVED, UNMASK_REJECTED, UNMASK_VIEWED"),

      subHeading("Certificates & Verification"),
      bullet("Generated tamper-proof DNA Certificates for every uploaded file"),
      bullet("Built Public Certificate Verification page — anyone can verify authenticity without login"),

      subHeading("AI Semantic Search"),
      bullet("Integrated AI-powered semantic search across all vault files"),
      bullet("Auto-indexes file content on upload for intelligent full-text and semantic queries"),

      subHeading("Bug Fixes & Technical Improvements"),
      bullet("Fixed React Hooks violation (hooks called after conditional returns) in Share Viewer"),
      bullet("Fixed device type restriction bug where 'desktop' was incorrectly mapped to country code 'DE'"),
      bullet("Fixed ghost file reload bug causing unnecessary re-fetching on every state update"),
      bullet("Fixed Access Blocked ghost error appearing below successfully loaded file content"),
      bullet("Fixed missing retrieveFile method in VaultService"),

      spacer(120),
      new Paragraph({ children: [new PageBreak()] }),

      // ─── COMPLETION STATUS ─────────────────────────────────────────────────
      sectionHeading("Completion Status — All Delivered Modules", "✅"),
      spacer(80),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [5200, 2080, 2080],
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({ borders, width: { size: 5200, type: WidthType.DXA }, shading: { fill: DARK, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Module / Feature", size: 20, font: "Arial", bold: true, color: WHITE })] })] }),
              new TableCell({ borders, width: { size: 2080, type: WidthType.DXA }, shading: { fill: DARK, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Phase", size: 20, font: "Arial", bold: true, color: WHITE })] })] }),
              new TableCell({ borders, width: { size: 2080, type: WidthType.DXA }, shading: { fill: DARK, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Status", size: 20, font: "Arial", bold: true, color: WHITE })] })] }),
            ]
          }),
          ...([
            ["Digital Identity & Profile Management", "Phase 1", "1C8F73"],
            ["Secure Document Vault (AES-256-GCM)", "Phase 1", "1C8F73"],
            ["Portfolio Module (Full CRUD)", "Phase 1", "1C8F73"],
            ["Portfolio Sharing & Access Controls", "Phase 1", "1C8F73"],
            ["Android APK Build & Capacitor Sync", "Phase 1", "1C8F73"],
            ["Unified Forensics (OCR + Metadata + EXIF)", "Phase 2", "0A7BB8"],
            ["AI Image Detection (TensorFlow.js / ONNX)", "Phase 2", "0A7BB8"],
            ["Resume Sharing & Contact Masking", "Phase 2", "0A7BB8"],
            ["Approval-Based Access Workflow", "Phase 2", "0A7BB8"],
            ["Viewer Tracking & Session Analytics", "Phase 2", "0A7BB8"],
            ["Security Monitoring (Copy/Print/Screenshot)", "Phase 2", "0A7BB8"],
            ["OpenGraph / WhatsApp Share Cards", "Phase 2", "0A7BB8"],
            ["Universal DNA Engine (10 File Types)", "Phase 3", TEAL],
            ["Vault System (Encrypted Explorer + Integrity)", "Phase 3", TEAL],
            ["Smart Links (OTP, Geo, Device Restrictions)", "Phase 3", TEAL],
            ["Real-time Live Session Monitor", "Phase 3", TEAL],
            ["Duplicate Prevention System", "Phase 3", TEAL],
            ["Privacy Masking + Unmask Request Flow", "Phase 3", TEAL],
            ["DNA Certificates & Public Verification", "Phase 3", TEAL],
            ["AI Semantic Search", "Phase 3", TEAL],
          ]).map(([mod, phase, color]) =>
            new TableRow({
              children: [
                new TableCell({ borders, width: { size: 5200, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 160, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: mod, size: 19, font: "Arial", color: "333333" })] })] }),
                new TableCell({ borders, width: { size: 2080, type: WidthType.DXA }, shading: { fill: "F0F0F0", type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: phase, size: 18, font: "Arial", color: "555555" })] })] }),
                new TableCell({ borders, width: { size: 2080, type: WidthType.DXA }, shading: { fill: color, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER,
                  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Completed", size: 18, font: "Arial", bold: true, color: WHITE })] })] }),
              ]
            })
          )
        ]
      }),

      spacer(120),
      new Paragraph({ children: [new PageBreak()] }),

      // ─── TECH STACK ───────────────────────────────────────────────────────
      sectionHeading("Technology Stack", "⚙️"),
      spacer(80),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2340, 7020],
        rows: [
          ...[
            ["Frontend", "React.js  •  TypeScript  •  Tailwind CSS  •  Vite"],
            ["Backend", "Node.js  •  Express  •  FastAPI (Python)  •  TypeScript"],
            ["Database & ORM", "PostgreSQL  •  Supabase  •  Prisma ORM"],
            ["Security", "AES-256-GCM Encryption  •  JWT Authentication  •  OTP Verification"],
            ["AI / ML", "TensorFlow.js  •  ONNX Runtime  •  Tesseract OCR"],
            ["Storage", "Supabase Storage  •  Encrypted File Vault"],
            ["Tools", "Git  •  GitHub  •  Postman  •  VS Code  •  Capacitor"],
          ].map(([cat, techs], i) =>
            new TableRow({
              children: [
                new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, shading: { fill: i % 2 === 0 ? LIGHT_TEAL : MID_TEAL, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: cat, size: 20, font: "Arial", bold: true, color: DARK })] })] }),
                new TableCell({ borders, width: { size: 7020, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 160, right: 120 },
                  children: [new Paragraph({ children: [new TextRun({ text: techs, size: 20, font: "Arial", color: "333333" })] })] }),
              ]
            })
          )
        ]
      }),

      spacer(280),

      // ─── CLOSING ──────────────────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 80 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, color: TEAL },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL }
        },
        children: [
          new TextRun({ text: "Total Modules Delivered: 20+     |     Total Tech Stack Items: 17+     |     Duration: 2 Months", size: 22, font: "Arial", bold: true, color: TEAL })
        ]
      }),

      spacer(120),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text: "Kavvam Ashwitha", bold: true, size: 24, font: "Arial", color: DARK })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: "Junior Software Developer Intern  |  PINIT-DNA Project  |  June 10, 2026", size: 20, font: "Arial", color: TEXT_GRAY })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("PINIT_DNA_Work_Report_Ashwitha.docx", buffer);
  console.log("Document created: PINIT_DNA_Work_Report_Ashwitha.docx");
}).catch(err => console.error(err));

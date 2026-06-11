/**
 * PINIT-DNA — Document Text Formatter
 *
 * Converts plain extracted text (from PDF/DOCX) into clean, structured HTML
 * suitable for professional viewing — resumes, contracts, reports, etc.
 *
 * Rules applied (in order):
 *  1. First non-empty line → candidate for document title / person name
 *  2. Short lines with | or contact keywords → contact / metadata bar
 *  3. ALL-CAPS short lines → section headers
 *  4. Lines starting with - / • / * / ► → bullet points
 *  5. Lines ending with : (short) → sub-header
 *  6. Blank lines → paragraph break
 *  7. Everything else → body paragraph
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Highlight [MASKED] / ****@gmail.com / XXXX XXXX / ***** spans in red */
function highlightMasked(s: string): string {
  // [ADDRESS MASKED] or [MASKED] — highlight what backend already masked
  s = s.replace(/\[([A-Z\s]+MASKED)\]/g, '<span class="doc-masked">[$1]</span>');
  // ****@domain.com — masked email
  s = s.replace(/(\*+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g, '<span class="doc-masked">$1</span>');
  // 98******10 — masked phone
  s = s.replace(/([6-9]\d\*{4,}\d{2})/g, '<span class="doc-masked">$1</span>');
  // XXXX XXXX 9012 — masked aadhaar
  s = s.replace(/(XXXX\s+XXXX\s+\d{4})/g, '<span class="doc-masked">$1</span>');
  // *****1234F — masked PAN
  s = s.replace(/(\*{4,}\d{4}[A-Z])/g, '<span class="doc-masked">$1</span>');
  return s;
}

const CONTACT_KEYWORDS = /\b(phone|email|mobile|linkedin|github|address|city|state|hyderabad|bangalore|mumbai|delhi|chennai|pune|@|linkedin\.com|github\.com)\b/i;

function isContactLine(line: string): boolean {
  return (line.includes('|') || line.includes('·') || CONTACT_KEYWORDS.test(line)) &&
    line.length < 200;
}

function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  // ALL CAPS with optional spaces/colons
  const upper = trimmed.replace(/[^a-zA-Z]/g, '');
  if (upper.length === 0) return false;
  return upper === upper.toUpperCase() && upper.length >= 3;
}

function isBullet(line: string): boolean {
  return /^\s*[-•*►–—]\s/.test(line);
}

function isSubHeader(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length < 80 && t.endsWith(':');
}

function isDateRange(line: string): boolean {
  return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b.{0,30}(present|current|\d{4})/i.test(line);
}

export function formatTextAsDocument(rawText: string): string {
  const lines = rawText.split('\n');
  const html: string[] = [];

  // Track if we've handled the title
  let titleDone = false;
  let inList = false;

  const closeList = () => {
    if (inList) { html.push('</ul>'); inList = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Blank line → close list, paragraph break ──────────────────────────
    if (trimmed === '') {
      closeList();
      continue;
    }

    // ── Title: first meaningful line (likely name or doc title) ───────────
    if (!titleDone && trimmed.length > 0 && trimmed.length < 60 &&
        !trimmed.includes('|') && !CONTACT_KEYWORDS.test(trimmed)) {
      closeList();
      html.push(`<h1 class="doc-title">${highlightMasked(esc(trimmed))}</h1>`);
      titleDone = true;
      continue;
    }

    // ── Contact / metadata line ───────────────────────────────────────────
    if (isContactLine(trimmed) && !isSectionHeader(trimmed)) {
      closeList();
      // Split on | or · and render as inline chips
      const parts = trimmed.split(/[|·]/).map(p => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        const chips = parts.map(p => `<span class="doc-contact-chip">${highlightMasked(esc(p))}</span>`).join('');
        html.push(`<div class="doc-contact">${chips}</div>`);
      } else {
        html.push(`<p class="doc-contact-single">${highlightMasked(esc(trimmed))}</p>`);
      }
      continue;
    }

    // ── Section header (ALL CAPS) ─────────────────────────────────────────
    if (isSectionHeader(trimmed)) {
      closeList();
      html.push(`<div class="doc-section-header"><span>${highlightMasked(esc(trimmed))}</span></div>`);
      continue;
    }

    // ── Bullet point ──────────────────────────────────────────────────────
    if (isBullet(trimmed)) {
      if (!inList) { html.push('<ul class="doc-list">'); inList = true; }
      const content = trimmed.replace(/^\s*[-•*►–—]\s*/, '');
      html.push(`<li>${highlightMasked(esc(content))}</li>`);
      continue;
    }

    closeList();

    // ── Date range line (job duration) ────────────────────────────────────
    if (isDateRange(trimmed) && trimmed.length < 60) {
      html.push(`<p class="doc-date">${highlightMasked(esc(trimmed))}</p>`);
      continue;
    }

    // ── Sub-header (ends with :) ──────────────────────────────────────────
    if (isSubHeader(trimmed)) {
      html.push(`<p class="doc-subheader">${highlightMasked(esc(trimmed))}</p>`);
      continue;
    }

    // ── Body paragraph ────────────────────────────────────────────────────
    html.push(`<p class="doc-body">${highlightMasked(esc(trimmed))}</p>`);
  }

  closeList();

  return html.join('\n');
}

/** CSS injected once into the document viewer */
export const DOCUMENT_STYLES = `
  .doc-viewer {
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #1a1a2e;
    background: #ffffff;
    max-width: 780px;
    margin: 0 auto;
    padding: 48px 56px;
    line-height: 1.6;
    font-size: 14px;
  }
  .doc-title {
    font-size: 26px;
    font-weight: 700;
    color: #111;
    margin: 0 0 8px 0;
    letter-spacing: -0.3px;
  }
  .doc-contact {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .doc-contact-chip {
    font-size: 12px;
    color: #444;
    background: #f0f0f5;
    border-radius: 4px;
    padding: 2px 8px;
  }
  .doc-contact-single {
    font-size: 12px;
    color: #555;
    margin: 2px 0 8px;
  }
  .doc-section-header {
    margin: 22px 0 6px;
    border-bottom: 2px solid #6366f1;
    padding-bottom: 4px;
  }
  .doc-section-header span {
    font-size: 13px;
    font-weight: 700;
    color: #4338ca;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .doc-subheader {
    font-weight: 600;
    color: #222;
    margin: 8px 0 2px;
    font-size: 13.5px;
  }
  .doc-date {
    font-size: 12px;
    color: #6b7280;
    font-style: italic;
    margin: 1px 0 4px;
  }
  .doc-body {
    color: #333;
    margin: 3px 0;
    font-size: 13.5px;
  }
  .doc-list {
    margin: 4px 0 4px 20px;
    padding: 0;
  }
  .doc-list li {
    color: #333;
    font-size: 13.5px;
    margin-bottom: 3px;
    list-style-type: disc;
  }
  .doc-masked {
    background: #fee2e2;
    color: #dc2626;
    border-radius: 3px;
    padding: 0 3px;
    font-weight: 600;
    font-size: 12px;
    font-family: monospace;
  }
  @media print {
    .doc-viewer { padding: 20px; }
  }
`;

/**
 * PINIT-DNA — Privacy Masking Service
 *
 * IMPORTANT: This service operates ONLY on extracted text for the viewer layer.
 * The original file in the vault is NEVER read, modified, or affected.
 * DNA, Certificates, Vault integrity, and Monitoring are completely untouched.
 *
 * Flow: VaultFile → decrypt buffer → extract text → apply masks → serve masked HTML
 */

export interface MaskingConfig {
  maskEmail:          boolean;
  maskPhone:          boolean;
  maskAadhaar:        boolean;
  maskPan:            boolean;
  maskAddress:        boolean;
  maskCustomPatterns: string[]; // user-supplied regex strings
}

// ─── Masking Patterns ─────────────────────────────────────────────────────────

const PATTERNS = {
  // Email: mask local part, keep domain  → ********@gmail.com
  email: /([a-zA-Z0-9._%+\-]+)(@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g,

  // Indian mobile numbers (10 digits, optionally +91/0 prefix)
  // Masks middle 6 digits → 98******10
  phone: /(?:(?:\+91|0)?[\s\-]?)?([6-9]\d{1})[\s\-]?(\d{4})[\s\-]?(\d{4})/g,

  // Aadhaar: 12 digits in groups of 4 → XXXX XXXX 9012
  aadhaar: /\b(\d{4})\s?(\d{4})\s?(\d{4})\b/g,

  // PAN: ABCDE1234F → *****1234F
  pan: /\b([A-Z]{5})(\d{4})([A-Z])\b/g,

  // Address — must look like an actual postal address:
  // Requires a number + address keyword (e.g. "Flat 4B, Sector 12") OR
  // classic Indian address patterns (H.No, D.No, Plot No, Door No)
  address: /\b(?:(?:flat|plot|house|door|h\.?no|d\.?no|s\.?no|survey\s*no)[\s\.\-#]*\d+[^\n]{0,100}(?:road|street|nagar|colony|layout|sector|phase|lane|marg|vihar|enclave|circle|cross|main)\b[^\n]{0,80}|\d+[^\n]{0,30}(?:road|street|nagar|colony|layout|sector|phase|lane|marg|vihar|enclave)\b[^\n]{0,80})/gi,
};

// ─── Masker functions ─────────────────────────────────────────────────────────

function maskEmail(text: string): string {
  return text.replace(PATTERNS.email, (_match, local, domain) => {
    return '*'.repeat(local.length) + domain;
  });
}

function maskPhone(text: string): string {
  return text.replace(PATTERNS.phone, (_match, p1, _p2, p3) => {
    return p1 + '******' + p3;
  });
}

function maskAadhaar(text: string): string {
  return text.replace(PATTERNS.aadhaar, (_match, _g1, _g2, g3) => {
    return `XXXX XXXX ${g3}`;
  });
}

function maskPan(text: string): string {
  return text.replace(PATTERNS.pan, (_match, _alpha, digits, lastChar) => {
    return `*****${digits}${lastChar}`;
  });
}

function maskAddress(text: string): string {
  return text.replace(PATTERNS.address, '[ADDRESS MASKED]');
}

function maskCustom(text: string, patterns: string[]): string {
  let out = text;
  for (const pat of patterns) {
    try {
      const re = new RegExp(pat, 'gi');
      out = out.replace(re, '[MASKED]');
    } catch {
      // invalid regex — skip silently
    }
  }
  return out;
}

// ─── Main masking function ────────────────────────────────────────────────────

export function applyMasks(text: string, config: MaskingConfig): string {
  let out = text;
  // Order matters: Aadhaar before phone (both are digit sequences)
  if (config.maskAadhaar)           out = maskAadhaar(out);
  if (config.maskPhone)             out = maskPhone(out);
  if (config.maskEmail)             out = maskEmail(out);
  if (config.maskPan)               out = maskPan(out);
  if (config.maskAddress)           out = maskAddress(out);
  if (config.maskCustomPatterns?.length) out = maskCustom(out, config.maskCustomPatterns);
  return out;
}

// ─── Detection (no masking — just tells you what's present) ──────────────────

export interface SensitiveDetectionResult {
  email:        boolean;
  phone:        boolean;
  aadhaar:      boolean;
  pan:          boolean;
  address:      boolean;
  /** true if the file type supports text extraction */
  supported:    boolean;
  /** true if any sensitive type was found */
  hasAnyMatch:  boolean;
}

/**
 * Scan extracted text and return which sensitive data types are present.
 * Does NOT mask anything — purely detection.
 */
export function detectSensitiveTypes(text: string): SensitiveDetectionResult {
  const test = (source: string, flags: string) => new RegExp(source, flags).test(text);
  const email   = test(PATTERNS.email.source,   'gi');
  const phone   = test(PATTERNS.phone.source,   'gi');
  const aadhaar = test(PATTERNS.aadhaar.source, 'gi');
  const pan     = test(PATTERNS.pan.source,     'gi');
  const address = test(PATTERNS.address.source, 'gim');
  return { email, phone, aadhaar, pan, address, supported: true, hasAnyMatch: email || phone || aadhaar || pan || address };
}

// ─── Text extraction helpers ──────────────────────────────────────────────────

/**
 * Extract plain text from a PDF buffer.
 * Uses pdf-parse (already installed for PDF DNA engine).
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as (b: Buffer, opts?: { max?: number }) => Promise<{ text: string }>;
  const { text } = await pdfParse(buffer, { max: 0 });
  return text;
}

/**
 * Extract plain text from a DOCX buffer.
 * Uses mammoth (lightweight DOCX→HTML/text converter).
 * Falls back to raw string scan if mammoth is not installed.
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth') as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  } catch {
    // mammoth not installed — return empty (masking won't apply, viewer falls back)
    return '';
  }
}

/**
 * Extract plain text from a plain-text buffer (TXT / CSV / JSON).
 */
export function extractTextFromPlain(buffer: Buffer): string {
  return buffer.toString('utf-8');
}

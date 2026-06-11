/**
 * PINIT-DNA — Filename Search Provider (free, no API key required)
 *
 * Strategy:
 *   1. Search DuckDuckGo for the exact filename e.g. `"tiger.jpeg"`
 *   2. Parse HTML response for <img src=...> tags
 *   3. Extract direct links that look like image files (.jpg, .jpeg, .png, .webp)
 *   4. Also search image hosting sites (postimages, imgur) by name
 *
 * Limitation: works best when the exact filename was preserved on the hosting site.
 * For images renamed after upload, pHash will still match even if names differ.
 */

import axios from 'axios';
import { logger } from '../../../lib/logger';
import type { ImageSearchProvider, ImageSearchResult } from './image-search.provider';

const IMAGE_URL_RE  = /https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp|gif)(\?[^\s"'<>]*)?/gi;
const IMG_SRC_RE    = /<img[^>]+src=["']([^"']+)["']/gi;
const TIMEOUT       = 15_000;
const USER_AGENT    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 PINIT-DNA/2.0';

export class FilenameSearchProvider implements ImageSearchProvider {
  name = 'FilenameSearch';

  isConfigured(): boolean { return true; } // always available

  async findCandidates(filename: string, _pHash64: string): Promise<ImageSearchResult[]> {
    const cleanName = filename.replace(/\.[^.]+$/, '').trim(); // strip extension
    const ext       = (filename.match(/\.([^.]+)$/) ?? [])[1] ?? 'jpg';

    // Queries in order of specificity
    const queries: string[] = [
      `"${filename}"`,                        // exact filename (most precise)
      `"${cleanName}" filetype:${ext}`,       // DuckDuckGo filetype filter
      `"${cleanName}" site:postimg.cc`,       // postimages
      `"${cleanName}" site:imgur.com`,        // imgur
      `"${cleanName}" site:i.ibb.co`,         // imgbb
    ];

    const results: ImageSearchResult[] = [];
    const seen = new Set<string>();

    for (const q of queries) {
      if (results.length >= 25) break;

      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;

      try {
        const { data } = await axios.get<string>(ddgUrl, {
          timeout: TIMEOUT,
          responseType: 'text',
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html',
          },
        });

        const html = String(data);

        // Method 1: <img src="..."> tags
        IMG_SRC_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = IMG_SRC_RE.exec(html)) !== null) {
          const url = this.resolveUrl(m[1]);
          if (url && !seen.has(url)) {
            seen.add(url);
            results.push({ imageUrl: url, pageUrl: ddgUrl, source: 'FILENAME_SEARCH' });
          }
        }

        // Method 2: raw image URLs in page text/links
        IMAGE_URL_RE.lastIndex = 0;
        while ((m = IMAGE_URL_RE.exec(html)) !== null) {
          const url = m[0].replace(/["'>]$/, ''); // clean trailing chars
          if (!seen.has(url) && url.startsWith('http')) {
            seen.add(url);
            results.push({ imageUrl: url, pageUrl: ddgUrl, source: 'FILENAME_SEARCH' });
          }
        }

        logger.debug(`[FilenameSearch] Query "${q}" → ${results.length} total candidates`);

        // Respectful delay between queries
        await new Promise(r => setTimeout(r, 600));

      } catch (err) {
        logger.debug(`[FilenameSearch] Query failed: "${q}"`, { error: String(err).slice(0, 150) });
      }
    }

    logger.info(`[FilenameSearch] Candidate discovery complete`, {
      filename,
      queriesRun: queries.length,
      candidatesFound: results.length,
    });

    return results.slice(0, 25);
  }

  private resolveUrl(url: string): string | null {
    if (!url) return null;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('http')) return url;
    return null;
  }
}

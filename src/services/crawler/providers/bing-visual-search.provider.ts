/**
 * PINIT-DNA — Bing Image Search Provider
 *
 * Uses Bing Image Search API v7 to find images by filename/description.
 * Requires: BING_SEARCH_API_KEY environment variable (free tier: 1000 calls/month)
 *
 * Setup: https://portal.azure.com → Cognitive Services → Bing Search v7
 * Add to .env:  BING_SEARCH_API_KEY=your_key_here
 */

import axios from 'axios';
import { logger } from '../../../lib/logger';
import type { ImageSearchProvider, ImageSearchResult } from './image-search.provider';

const BING_ENDPOINT = 'https://api.bing.microsoft.com/v7.0/images/search';

export class BingVisualSearchProvider implements ImageSearchProvider {
  name = 'BingImageSearch';

  private get apiKey(): string {
    return process.env['BING_SEARCH_API_KEY'] ?? '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 10;
  }

  async findCandidates(filename: string): Promise<ImageSearchResult[]> {
    if (!this.isConfigured()) {
      logger.debug('[BingSearch] No API key — skipping');
      return [];
    }

    const cleanName = filename.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ');

    try {
      const { data } = await axios.get<{ value?: Array<{ contentUrl: string; hostPageUrl: string }> }>(BING_ENDPOINT, {
        timeout: 10_000,
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
        },
        params: {
          q:          filename,
          count:      20,
          safeSearch: 'Off',
          imageType:  'Photo',
        },
      });

      const items: Array<{ contentUrl: string; hostPageUrl: string }> = data.value ?? [];

      const results: ImageSearchResult[] = items
        .filter(item => item.contentUrl?.startsWith('http'))
        .map(item => ({
          imageUrl: item.contentUrl,
          pageUrl:  item.hostPageUrl ?? item.contentUrl,
          source:   'BING',
        }));

      logger.info(`[BingSearch] Found ${results.length} candidates for "${filename}"`);

      // Second query with clean name if first returned few results
      if (results.length < 5 && cleanName !== filename.replace(/\.[^.]+$/, '')) {
        try {
          const { data: data2 } = await axios.get<{ value?: Array<{ contentUrl: string; hostPageUrl: string }> }>(BING_ENDPOINT, {
            timeout: 10_000,
            headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
            params: { q: cleanName, count: 10, safeSearch: 'Off' },
          });
          for (const item of (data2.value ?? [])) {
            if (item.contentUrl?.startsWith('http')) {
              results.push({ imageUrl: item.contentUrl, pageUrl: item.hostPageUrl ?? '', source: 'BING' });
            }
          }
        } catch { /* ignore second query failure */ }
      }

      return results.slice(0, 25);

    } catch (err) {
      const status = (err as { response?: { status: number } })?.response?.status;
      logger.warn('[BingSearch] API call failed', { status, error: String(err).slice(0, 200) });
      if (status === 401) {
        logger.error('[BingSearch] Invalid API key — check BING_SEARCH_API_KEY in .env');
      }
      return [];
    }
  }
}

/**
 * PINIT-DNA — Image Search Provider Interface
 *
 * Abstraction layer for candidate image discovery.
 * Supports: Bing Image Search, filename-based DuckDuckGo search.
 * Providers are tried in order; first configured provider wins.
 */

export interface ImageSearchResult {
  imageUrl: string;   // direct URL to a candidate image file
  pageUrl:  string;   // web page where this image was found
  source:   string;   // BING | FILENAME_SEARCH | DIRECT_URL
}

export interface ImageSearchProvider {
  /** Human-readable provider name for logging */
  name: string;

  /** Returns true if this provider has required config (e.g. API key) */
  isConfigured(): boolean;

  /**
   * Discover candidate image URLs for a given file.
   * @param filename - Original filename (e.g. "tiger.jpeg")
   * @param pHash64  - Stored 64-bit pHash (hex) for reference
   */
  findCandidates(filename: string, pHash64: string): Promise<ImageSearchResult[]>;
}

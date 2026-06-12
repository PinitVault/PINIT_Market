/**
 * PINIT-DNA — Full-Text Search Page
 * Powered by Postgres FTS — always online, zero extra RAM.
 */

import { useState, useEffect } from 'react';
import {
  Search, Database, FileText, RefreshCw, AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE_URL } from '../config/api.config';
import { FileTypeBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { format } from 'date-fns';

interface SearchResult {
  dnaRecordId:       string;
  filename:          string;
  fileType:          string;
  title:             string;
  snippet:           string;
  similarityPercent: number;
  confidence:        { level: string; label: string };
  searchType:        string;
  indexedAt:         string;
  keywordScore:      number;
  semanticScore:     number;
}

const CONF_STYLE: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  HIGH_CONFIDENCE: { bg: 'bg-success/15 border-success/30', text: 'text-success', icon: <CheckCircle2 size={11} /> },
  STRONG_MATCH:    { bg: 'bg-success/10 border-success/20', text: 'text-success', icon: <CheckCircle2 size={11} /> },
  POSSIBLE_MATCH:  { bg: 'bg-warning/15 border-warning/30', text: 'text-warning', icon: <AlertTriangle size={11} /> },
  WEAK_MATCH:      { bg: 'bg-bg-border border-bg-border',   text: 'text-gray-500', icon: null },
};

export function SearchPage() {
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState<SearchResult[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [searched,     setSearched]     = useState(false);
  const [totalIndexed, setTotalIndexed] = useState(0);
  const [processingMs, setProcessingMs] = useState(0);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/ai/stats`)
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTotalIndexed((data as any).stats?.totalIndexed ?? 0);
      })
      .catch(() => {});
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/ai/search`, {
        query:     query.trim(),
        topK:      20,
        threshold: 0.0,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setResults(d.results ?? []);
      setProcessingMs(d.processingMs ?? 0);
      setTotalIndexed(d.totalIndexed ?? totalIndexed);
      setSearched(true);
      if (!(d.results?.length)) toast('No matching records found');
    } catch {
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">File Search</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Postgres full-text search · searches filenames, file types &amp; extracted text
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-success/30 bg-success/10 text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          Search Online · {totalIndexed} records
        </div>
      </div>

      {/* Info card */}
      {!searched && (
        <div className="card bg-dna-500/5 border-dna-500/20">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-xl bg-dna-500/15 flex items-center justify-center shrink-0">
              <Database size={18} className="text-dna-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white mb-1">Postgres Full-Text Search</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Searches across <strong className="text-white">filenames</strong>,{' '}
                <strong className="text-white">file types</strong>, and{' '}
                <strong className="text-white">OCR-extracted text</strong> using Postgres native FTS.
                Results are ranked by relevance — no AI model required.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { icon: <Database size={13} className="text-dna-400" />,  label: 'Engine',  value: 'Postgres FTS' },
              { icon: <FileText size={13} className="text-success" />,  label: 'Records', value: String(totalIndexed) },
              { icon: <Search size={13} className="text-purple" />,     label: 'Method',  value: 'ts_rank + ILIKE' },
            ].map(item => (
              <div key={item.label} className="bg-bg-elevated rounded-lg p-3 text-center">
                <div className="flex justify-center mb-1">{item.icon}</div>
                <p className="text-xs font-semibold text-white">{item.value}</p>
                <p className="text-2xs text-gray-500">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search input */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by filename, type, or content…"
            className="input pl-11 text-sm h-12"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="btn btn-primary px-6"
        >
          {loading
            ? <><RefreshCw size={15} className="animate-spin" /> Searching…</>
            : <><Search size={15} /> Search</>
          }
        </button>
      </div>

      {searched && processingMs > 0 && (
        <p className="text-2xs text-gray-600 mono">Completed in {processingMs}ms</p>
      )}

      {/* Results */}
      <AnimatePresence>
        {searched && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <p className="text-sm font-semibold text-white">
              {results.length > 0
                ? `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`
                : `No results for "${query}"`}
            </p>

            {results.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon={Search}
                  title="No matching records"
                  description="Try a different keyword, or generate DNA records to make them searchable."
                  action={
                    <Link to="/generate" className="btn btn-primary btn-sm">
                      Generate DNA Record
                    </Link>
                  }
                />
              </div>
            ) : (
              results.map((r, i) => {
                const confStyle = CONF_STYLE[r.confidence?.level ?? 'POSSIBLE_MATCH'] ?? CONF_STYLE.POSSIBLE_MATCH;
                const pct       = r.similarityPercent;
                const barColor  = pct >= 85 ? 'bg-success' : pct >= 70 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-gray-500';

                return (
                  <motion.div
                    key={r.dnaRecordId}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="card hover:border-dna-500/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <FileTypeBadge type={r.fileType} />
                          <p className="text-sm font-semibold text-white truncate">
                            {r.title || r.filename}
                          </p>
                        </div>

                        {r.snippet && (
                          <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed mb-2">
                            {r.snippet}
                          </p>
                        )}

                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-2xs text-gray-600 mono">{r.dnaRecordId.slice(0, 12)}…</span>
                          <span className="text-2xs text-gray-600">
                            {format(new Date(r.indexedAt), 'MMM d, yyyy')}
                          </span>
                          <span className="text-2xs text-gray-600 capitalize">{r.searchType}</span>
                        </div>
                      </div>

                      {/* Score */}
                      <div className="text-right shrink-0 min-w-[72px]">
                        <div className={`text-2xl font-bold mono ${confStyle.text}`}>
                          {pct}%
                        </div>
                        <div className="w-16 h-1.5 bg-bg-border rounded-full mt-1 overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`mt-1.5 inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border ${confStyle.bg} ${confStyle.text}`}>
                          {confStyle.icon}
                          {r.confidence?.label ?? 'Match'}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

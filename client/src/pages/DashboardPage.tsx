import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  Database, Archive, Shield, GitCompare, Zap, TrendingUp,
  FileText, CheckCircle2, AlertTriangle, RefreshCw,
  Eye, Download, Printer, Copy, Camera, Globe, MapPin,
  Clock, BarChart2, AlertOctagon, Ban,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useApi, formatBytes } from '../hooks/useApi';
import { getDashboardStats, deriveFileType } from '../services/dashboard.api';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Badge, FileTypeBadge, ClassificationBadge } from '../components/ui/Badge';
import { formatDistanceToNow } from 'date-fns';
import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';

interface ShareStats {
  totalViews: number; uniqueRecipients: number; countriesReached: number;
  citiesReached: number; avgViewTimeSec: number; downloads: number;
  blockedDownloads: number; printAttempts: number; copyAttempts: number;
  screenshotAttempts: number;
  riskDistribution: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  pageCompletion: null; forwardChains: null; leakIncidents: null; leakSources: null;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  to?: string;
}

function StatCard({ icon, label, value, sub, color, to }: StatCardProps) {
  const content = (
    <div className="card-hover group h-full">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}>
          {icon}
        </div>
        <TrendingUp size={14} className="text-gray-600 group-hover:text-dna-400 transition-colors" />
      </div>
      <p className="text-2xl font-bold text-white mb-0.5">{value}</p>
      <p className="text-xs font-medium text-gray-400">{label}</p>
      {sub && <p className="text-2xs text-gray-600 mt-1 mono">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : <div>{content}</div>;
}

// ─── File type donut colors ───────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  IMAGE: '#8b5cf6', PDF: '#ef4444', DOCX: '#3b82f6', PPTX: '#f97316',
  TXT: '#6b7280', CSV: '#10b981', JSON: '#f59e0b', ZIP: '#06b6d4',
  VIDEO: '#6366f1', AUDIO: '#3b82f6',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: stats, loading, error, refetch } = useApi(getDashboardStats);
  const [shareStats, setShareStats] = useState<ShareStats | null>(null);

  useEffect(() => {
    const fetch = () =>
      axios.get(`${API_BASE_URL}/share/analytics/global`)
        .then(({ data }) => setShareStats((data as any).stats))
        .catch(() => {});
    fetch();
    const id = setInterval(fetch, 15_000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto mb-3" />
          <p className="text-gray-400 text-sm">{error}</p>
          <button onClick={refetch} className="btn btn-secondary btn-sm mt-3">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px]">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Forensic Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Universal File DNA — Real-time system overview
          </p>
        </div>
        <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm gap-2">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : stats ? (
          <>
            <StatCard
              icon={<Database size={18} className="text-dna-400" />}
              color="bg-dna-500/15"
              label="DNA Records"
              value={stats.totalDnaRecords}
              sub={`${stats.completedDna} complete`}
              to="/dna-records"
            />
            <StatCard
              icon={<Archive size={18} className="text-purple" />}
              color="bg-purple/15"
              label="Vault Records"
              value={stats.totalVaultRecords}
              sub={formatBytes(stats.totalEncryptedBytes) + ' encrypted'}
              to="/vault"
            />
            <StatCard
              icon={<Shield size={18} className="text-success" />}
              color="bg-success/15"
              label="Verified Files"
              value={stats.completedDna}
              sub="AES-256-GCM secured"
            />
            <StatCard
              icon={<GitCompare size={18} className="text-cyan" />}
              color="bg-cyan/15"
              label="Forensic Reports"
              value={stats.totalVerifications}
              sub="DNA comparisons run"
              to="/reports"
            />
          </>
        ) : null}
      </div>

      {/* ── Charts + activity row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* File type distribution donut */}
        <div className="card lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">File Type Distribution</h2>
            <Badge variant="dna">DNA Records</Badge>
          </div>
          {loading ? (
            <div className="h-48 skeleton rounded-xl" />
          ) : stats && stats.fileTypeBreakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={stats.fileTypeBreakdown}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={75}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {stats.fileTypeBreakdown.map(({ fileType }) => (
                      <Cell key={fileType} fill={TYPE_COLORS[fileType] ?? '#6366f1'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0f1623', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(val: any, _: any, entry: any) => [val, entry?.payload?.fileType ?? '']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-2">
                {stats.fileTypeBreakdown.map(({ fileType, count }) => (
                  <div key={fileType} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[fileType] ?? '#6366f1' }} />
                    <span className="text-2xs text-gray-400">{fileType} <span className="text-gray-600">({count})</span></span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
              No records yet
            </div>
          )}
        </div>

        {/* Storage bar chart */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">File Count by Type</h2>
            <Badge variant="purple">All Types</Badge>
          </div>
          {loading ? (
            <div className="h-48 skeleton rounded-xl" />
          ) : stats && stats.fileTypeBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.fileTypeBreakdown} barCategoryGap="40%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="fileType" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#0f1623', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '12px' }}
                  cursor={{ fill: '#1e293b' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {stats.fileTypeBreakdown.map(({ fileType }) => (
                    <Cell key={fileType} fill={TYPE_COLORS[fileType] ?? '#6366f1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
              Generate some DNA records to see analytics
            </div>
          )}
        </div>
      </div>

      {/* ── System capabilities + recent activity ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Capabilities */}
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-4">Engine Capabilities</h2>
          <div className="space-y-2.5">
            {[
              { icon: <Zap size={13} className="text-dna-400" />, label: '10 File Types Supported', sub: 'IMAGE, PDF, DOCX, PPTX, TXT, CSV, JSON, ZIP, VIDEO, AUDIO' },
              { icon: <Shield size={13} className="text-success" />, label: '6 DNA Fingerprint Layers', sub: 'Cryptographic · Structural · Perceptual · Semantic · Metadata · Signature' },
              { icon: <Archive size={13} className="text-purple" />, label: 'AES-256-GCM Vault Encryption', sub: 'HKDF-SHA256 key derivation · IV per record · Auth tag verified' },
              { icon: <GitCompare size={13} className="text-cyan" />, label: 'Forensic Comparison Engine', sub: 'Tampering detection · Similarity scoring · Classification' },
            ].map(item => (
              <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg bg-bg-elevated border border-bg-border">
                <div className="mt-0.5">{item.icon}</div>
                <div>
                  <p className="text-xs font-semibold text-white">{item.label}</p>
                  <p className="text-2xs text-gray-500 mt-0.5">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent DNA Records</h2>
            <Link to="/dna-records" className="text-xs text-dna-400 hover:text-dna-300 transition-colors">
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-12 rounded-lg" />
              ))}
            </div>
          ) : stats && stats.recentActivity.length > 0 ? (
            <div className="space-y-2">
              {stats.recentActivity.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated border border-bg-border hover:border-dna-500/30 transition-all">
                  <FileTypeBadge type={deriveFileType(r)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{r.imageFilename}</p>
                    <p className="text-2xs text-gray-500 mono mt-0.5">
                      {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <ClassificationBadge value={r.status} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText size={24} className="text-gray-600 mb-2" />
              <p className="text-sm text-gray-500">No DNA records yet</p>
              <Link to="/generate" className="btn btn-primary btn-sm mt-3">
                Generate First DNA
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Storage summary ─────────────────────────────────────────────────── */}
      {!loading && stats && stats.totalVaultRecords > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-purple" />
              <h2 className="text-sm font-semibold text-white">Vault Storage</h2>
            </div>
            <Link to="/vault" className="text-xs text-dna-400 hover:text-dna-300 transition-colors">
              Open Vault →
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-purple">{stats.totalVaultRecords}</p>
              <p className="text-2xs text-gray-500 mt-1">Encrypted Files</p>
            </div>
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-success">{formatBytes(stats.totalEncryptedBytes)}</p>
              <p className="text-2xs text-gray-500 mt-1">Total Encrypted</p>
            </div>
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-dna-400">AES-256-GCM</p>
              <p className="text-2xs text-gray-500 mt-1">Encryption Standard</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Smart Link Analytics ───────────────────────────────────────────── */}
      {shareStats && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Eye size={15} className="text-dna-400" />
            <h2 className="text-sm font-semibold text-white">Smart Link Analytics</h2>
            <span className="text-2xs text-gray-600 ml-1">· live · auto-refreshes every 15s</span>
          </div>

          {/* Row 1 — reach metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { icon: <Eye size={14} className="text-dna-400" />,    label: 'Total Views',       value: shareStats.totalViews,        color: 'bg-dna-500/10 border-dna-500/20' },
              { icon: <Globe size={14} className="text-cyan" />,      label: 'Unique Recipients', value: shareStats.uniqueRecipients,   color: 'bg-cyan/10 border-cyan/20' },
              { icon: <Globe size={14} className="text-blue-400" />,  label: 'Countries',         value: shareStats.countriesReached,   color: 'bg-blue-500/10 border-blue-500/20' },
              { icon: <MapPin size={14} className="text-purple" />,   label: 'Cities',            value: shareStats.citiesReached,      color: 'bg-purple/10 border-purple/20' },
              { icon: <Clock size={14} className="text-amber-400" />, label: 'Avg View Time',     value: shareStats.avgViewTimeSec > 0 ? `${shareStats.avgViewTimeSec}s` : '—', color: 'bg-amber-500/10 border-amber-500/20' },
              { icon: <Download size={14} className="text-success" />,label: 'Downloads',         value: shareStats.downloads,          color: 'bg-success/10 border-success/20' },
            ].map(m => (
              <div key={m.label} className={`rounded-xl border p-3 ${m.color}`}>
                <div className="flex items-center gap-1.5 mb-1.5">{m.icon}<span className="text-2xs text-gray-500 font-medium">{m.label}</span></div>
                <p className="text-xl font-bold text-white">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Row 2 — violation/security metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { icon: <Ban size={14} className="text-red-400" />,        label: 'Blocked Downloads', value: shareStats.blockedDownloads,   color: 'bg-red-500/10 border-red-500/20' },
              { icon: <Printer size={14} className="text-orange-400" />, label: 'Print Attempts',    value: shareStats.printAttempts,      color: 'bg-orange-500/10 border-orange-500/20' },
              { icon: <Copy size={14} className="text-yellow-400" />,    label: 'Copy Attempts',     value: shareStats.copyAttempts,       color: 'bg-yellow-500/10 border-yellow-500/20' },
              { icon: <Camera size={14} className="text-pink-400" />,    label: 'Screenshot Attempts', value: shareStats.screenshotAttempts, color: 'bg-pink-500/10 border-pink-500/20' },
              { icon: <BarChart2 size={14} className="text-gray-400" />, label: 'Forward Chains',    value: '—',                           color: 'bg-gray-500/10 border-gray-500/20' },
              { icon: <AlertOctagon size={14} className="text-gray-400" />, label: 'Leak Incidents', value: '—',                           color: 'bg-gray-500/10 border-gray-500/20' },
            ].map(m => (
              <div key={m.label} className={`rounded-xl border p-3 ${m.color}`}>
                <div className="flex items-center gap-1.5 mb-1.5">{m.icon}<span className="text-2xs text-gray-500 font-medium">{m.label}</span></div>
                <p className="text-xl font-bold text-white">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Risk score distribution */}
          {(shareStats.riskDistribution.LOW + shareStats.riskDistribution.MEDIUM + shareStats.riskDistribution.HIGH + shareStats.riskDistribution.CRITICAL) > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={14} className="text-dna-400" />
                <h3 className="text-xs font-semibold text-white">Risk Score Distribution</h3>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {([
                  { key: 'LOW',      color: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30'  },
                  { key: 'MEDIUM',   color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30' },
                  { key: 'HIGH',     color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30' },
                  { key: 'CRITICAL', color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30'       },
                ] as const).map(({ key, color, bg }) => (
                  <div key={key} className={`rounded-xl border p-3 text-center ${bg}`}>
                    <p className={`text-xl font-bold ${color}`}>{shareStats.riskDistribution[key]}</p>
                    <p className="text-2xs text-gray-500 mt-0.5 font-medium">{key}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Quick actions ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/generate',    icon: <Database size={16} />,  label: 'Generate DNA',      color: 'hover:border-dna-500/50'    },
          { to: '/compare',     icon: <GitCompare size={16} />, label: 'Compare Files',     color: 'hover:border-cyan/50'       },
          { to: '/vault',       icon: <Archive size={16} />,    label: 'Browse Vault',      color: 'hover:border-purple/50'     },
          { to: '/certificates',icon: <CheckCircle2 size={16}/>,label: 'Certificates',      color: 'hover:border-success/50'    },
        ].map(a => (
          <Link
            key={a.to}
            to={a.to}
            className={`card-sm flex items-center gap-3 transition-all duration-200 group border border-bg-border ${a.color} hover:bg-bg-elevated cursor-pointer`}
          >
            <span className="text-gray-500 group-hover:text-dna-400 transition-colors">{a.icon}</span>
            <span className="text-sm font-medium text-gray-400 group-hover:text-white transition-colors">{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Dna, Shield, Archive, FileSearch,
  GitCompare, Award, ChevronRight, Zap, Clock,
  ShieldCheck, Activity, Microscope, Search, Radio, Ban, LogOut, User,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { useAuth } from '../../context/AuthContext';

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { to: '/',            icon: LayoutDashboard, label: 'Dashboard',          end: true  },
      { to: '/generate',   icon: Dna,             label: 'Generate DNA'               },
      { to: '/compare',    icon: GitCompare,       label: 'DNA Compare'                },
    ],
  },
  {
    label: 'Explorer',
    items: [
      { to: '/vault',       icon: Archive,    label: 'Vault Explorer'       },
      { to: '/dna-records', icon: FileSearch, label: 'DNA Records'          },
      { to: '/timeline',    icon: Clock,      label: 'File Timeline'        },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/search',             icon: Search,      label: 'AI Semantic Search'   },
      { to: '/forensic-diff',      icon: Microscope,  label: 'Difference Engine'    },
      { to: '/monitoring',         icon: Radio,       label: 'Monitoring & Crawler' },
    ],
  },
  {
    label: 'Forensics',
    items: [
      { to: '/reports',              icon: Shield,      label: 'Forensic Reports'      },
      { to: '/certificates',         icon: Award,       label: 'Certificates'          },
      { to: '/verify-certificate',   icon: ShieldCheck, label: 'Verify Certificate'    },
      { to: '/vault-integrity',      icon: Activity,    label: 'Vault Integrity'       },
      { to: '/duplicate-attempts',   icon: Ban,         label: 'Duplicate Attempts'    },
      { to: '/unmask-requests',      icon: Shield,      label: 'Unmask Requests'       },
    ],
  },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-bg-surface border-r border-bg-border flex flex-col z-40 select-none">

      {/* Logo */}
      <div className="h-14 flex items-center gap-3 px-5 border-b border-bg-border shrink-0">
        <div className="w-7 h-7 rounded-lg bg-dna-500 flex items-center justify-center shadow-glow-purple">
          <Dna size={14} className="text-white" />
        </div>
        <div className="leading-none">
          <p className="font-bold text-white text-sm tracking-tight">
            PINIT<span className="text-dna-400">-DNA</span>
          </p>
          <p className="text-2xs text-gray-500 mono mt-0.5">v2.0 · Universal</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-2xs font-semibold text-gray-600 uppercase tracking-widest px-2 mb-1">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) => cn(
                      'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-dna-500/15 text-dna-400'
                        : 'text-gray-400 hover:text-white hover:bg-bg-elevated'
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={15} className={cn('shrink-0', isActive ? 'text-dna-400' : 'text-gray-500 group-hover:text-gray-300')} />
                        <span className="flex-1 text-[13px]">{label}</span>
                        {isActive && <ChevronRight size={11} className="text-dna-500 shrink-0" />}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Status footer */}
      <div className="shrink-0 p-3 border-t border-bg-border space-y-2">
        {/* User identity */}
        {user && (
          <div className="rounded-xl bg-bg-elevated border border-bg-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-dna-500/20 flex items-center justify-center shrink-0">
                  <User size={11} className="text-dna-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xs text-gray-500 font-medium leading-none mb-0.5">Logged in as</p>
                  <p className="text-xs text-dna-400 font-bold truncate mono">{(user as any).shortId ?? user.sub?.slice(0,8)}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="shrink-0 text-gray-500 hover:text-red-400 transition-colors"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-bg-elevated border border-bg-border p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-slow" />
            <span className="text-xs text-gray-400 font-medium">System Online</span>
          </div>
          <div className="flex items-center gap-1.5 text-2xs text-gray-600 mono">
            <Zap size={10} className="text-dna-500" />
            <span>10 file types · 6 DNA layers</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

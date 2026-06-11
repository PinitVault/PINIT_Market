import { createBrowserRouter } from 'react-router-dom';
import { DashboardLayout }        from './layouts/DashboardLayout';
import { DashboardPage }          from './pages/DashboardPage';
import { GeneratePage }           from './pages/GeneratePage';
import { ComparePage }            from './pages/ComparePage';
import { VaultPage }              from './pages/VaultPage';
import { DnaRecordsPage }         from './pages/DnaRecordsPage';
import { ReportsPage }            from './pages/ReportsPage';
import { CertificatesPage }       from './pages/CertificatesPage';
import { TimelinePage }           from './pages/TimelinePage';
import { ForensicDiffPage }      from './pages/ForensicDiffPage';
import { SearchPage }            from './pages/SearchPage';
import { MonitoringPage }        from './pages/MonitoringPage';
import { VerifyCertificatePage }  from './pages/VerifyCertificatePage';
import { VaultIntegrityPage }       from './pages/VaultIntegrityPage';
import { DuplicateAttemptsPage }   from './pages/DuplicateAttemptsPage';
import { UnmaskRequestsPage }      from './pages/UnmaskRequestsPage';
import { NotFoundPage }             from './pages/NotFoundPage';
import { ShareViewerPage }          from './pages/ShareViewerPage';
import { LoginPage }                from './pages/LoginPage';
import { RegisterPage }             from './pages/RegisterPage';
import { RequireAuth }              from './components/auth/RequireAuth';

export const router = createBrowserRouter([
  // ── Auth pages (public) ───────────────────────────────────────────────────
  { path: '/login',    element: <LoginPage />    },
  { path: '/register', element: <RegisterPage /> },

  // ── Public share viewer (no dashboard layout, no auth) ────────────────────
  {
    path: '/s/:token',
    element: <ShareViewerPage />,
  },

  // ── Dashboard (protected) ─────────────────────────────────────────────────
  {
    path: '/',
    element: <RequireAuth><DashboardLayout /></RequireAuth>,
    children: [
      { index: true,                   element: <DashboardPage />           },
      { path: 'generate',              element: <GeneratePage />            },
      { path: 'compare',               element: <ComparePage />             },
      { path: 'vault',                 element: <VaultPage />               },
      { path: 'vault-integrity',       element: <VaultIntegrityPage />      },
      { path: 'dna-records',           element: <DnaRecordsPage />          },
      { path: 'reports',               element: <ReportsPage />             },
      { path: 'timeline',              element: <TimelinePage />            },
      { path: 'forensic-diff',         element: <ForensicDiffPage />        },
      { path: 'search',                element: <SearchPage />              },
      { path: 'monitoring',            element: <MonitoringPage />          },
      { path: 'duplicate-attempts',   element: <DuplicateAttemptsPage />   },
      { path: 'unmask-requests',      element: <UnmaskRequestsPage />      },
      { path: 'certificates',          element: <CertificatesPage />        },
      { path: 'verify-certificate',    element: <VerifyCertificatePage />   },
      { path: '*',                     element: <NotFoundPage />            },
    ],
  },
]);

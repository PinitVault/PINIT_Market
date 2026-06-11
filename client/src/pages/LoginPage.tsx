import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Dna, KeyRound, AlertCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const [userId, setUserId]   = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-format as user types: insert dash after PINIT if missing
  function handleChange(val: string) {
    const cleaned = val.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    setUserId(cleaned);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(userId.trim());
      navigate('/');
    } catch {
      setError('Invalid User ID. Please check and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-dna-500 flex items-center justify-center shadow-glow-purple">
            <Dna size={20} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-xl tracking-tight leading-none">
              PINIT<span className="text-dna-400">-DNA</span>
            </p>
            <p className="text-xs text-gray-500 mono">Forensic Intelligence Platform</p>
          </div>
        </div>

        <div className="bg-bg-surface border border-bg-border rounded-2xl p-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-dna-500/15 border border-dna-500/30 mx-auto mb-5">
            <KeyRound size={24} className="text-dna-400" />
          </div>

          <h1 className="text-xl font-bold text-white text-center mb-1">Welcome back</h1>
          <p className="text-sm text-gray-400 text-center mb-6">Enter your User ID to access your vault</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 mb-4">
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-400 mb-1.5 block">User ID</label>
              <input
                type="text"
                value={userId}
                onChange={e => handleChange(e.target.value)}
                required
                placeholder="PINIT-XXXXXXXX"
                spellCheck={false}
                className="w-full bg-bg-elevated border border-bg-border rounded-xl px-4 py-3 text-lg font-bold text-dna-400 tracking-widest mono placeholder-gray-700 focus:outline-none focus:border-dna-500 transition-colors text-center"
              />
            </div>

            <button
              type="submit"
              disabled={loading || userId.length < 5}
              className="w-full bg-dna-500 hover:bg-dna-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Signing in...</>
              ) : (
                <>Sign in <ArrowRight size={15} /></>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            No account yet?{' '}
            <Link to="/register" className="text-dna-400 hover:text-dna-300 font-medium">
              Create one — it's instant
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          Your ID is the only key · Keep it safe
        </p>
      </div>
    </div>
  );
}

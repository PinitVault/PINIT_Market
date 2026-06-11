import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Dna, Sparkles, Copy, CheckCheck, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type Step = 'intro' | 'generated';

export function RegisterPage() {
  const { createAccount } = useAuth();
  const navigate = useNavigate();

  const [step, setStep]       = useState<Step>('intro');
  const [userId, setUserId]   = useState('');
  const [copied, setCopied]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleCreate() {
    setLoading(true);
    setError('');
    try {
      const u = await createAccount();
      setUserId(u.shortId);
      setStep('generated');
    } catch {
      setError('Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

          {step === 'intro' && (
            <>
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-dna-500/15 border border-dna-500/30 mx-auto mb-5">
                <Sparkles size={24} className="text-dna-400" />
              </div>
              <h1 className="text-xl font-bold text-white text-center mb-2">Create your account</h1>
              <p className="text-sm text-gray-400 text-center mb-6 leading-relaxed">
                One click — we auto-generate a unique User ID for you.<br />
                No email, no password needed.
              </p>

              {error && (
                <p className="text-sm text-red-400 text-center mb-4">{error}</p>
              )}

              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full bg-dna-500 hover:bg-dna-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Generating your ID...</>
                ) : (
                  <><Sparkles size={15} /> Generate My User ID</>
                )}
              </button>

              <p className="text-center text-sm text-gray-500 mt-5">
                Already have an ID?{' '}
                <Link to="/login" className="text-dna-400 hover:text-dna-300 font-medium">Sign in</Link>
              </p>
            </>
          )}

          {step === 'generated' && (
            <>
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-green-500/15 border border-green-500/30 mx-auto mb-5">
                <ShieldCheck size={24} className="text-green-400" />
              </div>
              <h1 className="text-xl font-bold text-white text-center mb-1">Your User ID is ready!</h1>
              <p className="text-sm text-gray-400 text-center mb-6">
                Save this ID — it's the only way to access your account.
              </p>

              {/* ID display */}
              <div className="bg-bg-elevated border-2 border-dna-500/40 rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-500 text-center mb-2 uppercase tracking-widest font-medium">Your Unique User ID</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-2xl font-bold text-dna-400 tracking-widest mono flex-1 text-center">{userId}</p>
                  <button
                    onClick={handleCopy}
                    className="shrink-0 p-2 rounded-lg bg-dna-500/20 hover:bg-dna-500/30 text-dna-400 transition-colors"
                    title="Copy ID"
                  >
                    {copied ? <CheckCheck size={15} className="text-green-400" /> : <Copy size={15} />}
                  </button>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 mb-5">
                <p className="text-xs text-amber-400 text-center">
                  ⚠️ Write this down — you cannot recover it if lost
                </p>
              </div>

              <button
                onClick={() => navigate('/')}
                className="w-full bg-dna-500 hover:bg-dna-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                Enter Dashboard <ArrowRight size={15} />
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          AES-256-GCM encrypted · Zero knowledge storage
        </p>
      </div>
    </div>
  );
}

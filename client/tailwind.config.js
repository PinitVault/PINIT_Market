/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Light background palette ─────────────────────────────────────────
        bg: {
          base:    '#f6f8fb',
          surface: '#eef2f7',
          card:    '#ffffff',
          elevated:'#f1f5f9',
          border:  '#e2e8f0',
          muted:   '#e8edf3',
        },
        // ── Primary accent — DNA purple/indigo ───────────────────────────────
        dna: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
        // ── Status / semantic colours ────────────────────────────────────────
        layer: {
          pending:    '#374151',
          processing: '#f59e0b',
          complete:   '#10b981',
          failed:     '#ef4444',
        },
        // ── Extended semantic palette ────────────────────────────────────────
        success: { DEFAULT: '#10b981', light: '#d1fae5', dark: '#065f46' },
        warning: { DEFAULT: '#f59e0b', light: '#fef3c7', dark: '#78350f' },
        danger:  { DEFAULT: '#ef4444', light: '#fee2e2', dark: '#7f1d1d' },
        info:    { DEFAULT: '#3b82f6', light: '#dbeafe', dark: '#1e3a5f' },
        purple:  { DEFAULT: '#8b5cf6', light: '#ede9fe', dark: '#4c1d95' },
        cyan:    { DEFAULT: '#06b6d4', light: '#cffafe', dark: '#164e63' },
        orange:  { DEFAULT: '#f97316', light: '#ffedd5', dark: '#7c2d12' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      animation: {
        'pulse-slow':    'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow':     'spin 3s linear infinite',
        'fade-in':       'fadeIn 0.2s ease-out',
        'slide-in-left': 'slideInLeft 0.25s ease-out',
        'shimmer':       'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn:      { from: { opacity: '0' }, to: { opacity: '1' } },
        slideInLeft: { from: { opacity: '0', transform: 'translateX(-12px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        shimmer:     { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      boxShadow: {
        'glow-purple': '0 0 20px rgba(99,102,241,0.25), 0 0 40px rgba(99,102,241,0.08)',
        'glow-green':  '0 0 20px rgba(16,185,129,0.25), 0 0 40px rgba(16,185,129,0.08)',
        'glow-red':    '0 0 20px rgba(239,68,68,0.20)',
      },
    },
  },
  plugins: [],
};

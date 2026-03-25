import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import NevaLogo from '../components/NevaLogo'

export default function Register() {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim() || !displayName.trim() || !email.trim() || !password) {
      setError('All fields are required')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain a lowercase letter, an uppercase letter, and a number')
      return
    }

    setLoading(true)
    try {
      await register(username, displayName, email, password)
      navigate('/')
    } catch (err: any) {
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-bg-primary relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.04] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #2cc4c4 0%, transparent 70%)' }}
      />

      <div className="w-full max-w-sm px-6 page-enter">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-[18px] neva-gradient flex items-center justify-center mb-4 shadow-[0_0_32px_rgba(44,196,196,0.2)]">
            <NevaLogo size={36} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight neva-gradient-text">Neva</h1>
          <p className="text-text-secondary text-sm mt-1">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <input
            type="text"
            placeholder="Username (e.g. john_doe)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-bg-input border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent transition-colors text-sm"
            required
          />

          <input
            type="text"
            placeholder="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-bg-input border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent transition-colors text-sm"
            required
          />

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-bg-input border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent transition-colors text-sm"
            required
          />

          <input
            type="password"
            placeholder="Password (min 8 chars, A-Z, a-z, 0-9)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-bg-input border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent transition-colors text-sm"
            required
            minLength={8}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full neva-gradient text-white font-semibold py-3.5 rounded-xl transition-opacity disabled:opacity-50 text-sm shadow-[0_4px_20px_rgba(44,196,196,0.3)] hover:opacity-90 mt-1"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-text-secondary text-sm mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:text-accent-hover transition-colors">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  )
}

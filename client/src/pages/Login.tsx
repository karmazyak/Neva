import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import NevaLogo from '../components/NevaLogo'

export default function Login() {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login: doLogin } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!login.trim() || !password) {
      setError('Please enter username and password')
      return
    }

    setLoading(true)
    try {
      await doLogin(login, password)
      navigate('/')
    } catch (err: any) {
      setError(err.message || 'Login failed')
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
        <div className="flex flex-col items-center mb-10">
          <div className="w-20 h-20 rounded-[22px] neva-gradient flex items-center justify-center mb-5 shadow-[0_0_40px_rgba(44,196,196,0.25)]">
            <NevaLogo size={46} animated />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight neva-gradient-text">Neva</h1>
          <p className="text-text-secondary text-sm mt-1.5 tracking-wide">Intelligence that flows</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <input
            type="text"
            placeholder="Username or email"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="w-full bg-bg-input border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent transition-colors text-sm"
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-bg-input border border-[rgba(255,255,255,0.07)] rounded-xl px-4 py-3.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent transition-colors text-sm"
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full neva-gradient text-white font-semibold py-3.5 rounded-xl transition-opacity disabled:opacity-50 text-sm shadow-[0_4px_20px_rgba(44,196,196,0.3)] hover:opacity-90 mt-1"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-text-secondary text-sm mt-6">
          Don't have an account?{' '}
          <Link to="/register" className="text-accent hover:text-accent-hover transition-colors">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  )
}

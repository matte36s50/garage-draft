'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  const handleLogin = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Incorrect password')
      }
    } catch {
      alert('Login failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }
  
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <form onSubmit={handleLogin} className="bg-slate-800 p-8 rounded-lg shadow-xl max-w-md w-full">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">Admin Login</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter admin password"
          className="w-full p-3 rounded bg-slate-700 text-white border border-slate-600 focus:border-blue-400 outline-none"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full mt-4 bg-blue-600 text-white p-3 rounded hover:bg-blue-700 font-semibold transition disabled:opacity-60"
        >
          {submitting ? 'Logging in…' : 'Login'}
        </button>
      </form>
    </div>
  )
}
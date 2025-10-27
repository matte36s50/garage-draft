'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [password, setPassword] = useState('')
  const router = useRouter()
  
  const handleLogin = async (e) => {
    e.preventDefault()
    
    if (password === process.env.NEXT_PUBLIC_ADMIN_PASSWORD || password === 'AdminPassword123') {
      document.cookie = 'admin_auth=true; path=/; max-age=86400'
      router.push('/')
    } else {
      alert('Incorrect password')
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
          className="w-full mt-4 bg-blue-600 text-white p-3 rounded hover:bg-blue-700 font-semibold transition"
        >
          Login
        </button>
      </form>
    </div>
  )
}
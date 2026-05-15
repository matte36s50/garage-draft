import React, { useState, useEffect } from 'react'
import { Car, Trophy, Users, DollarSign, LogOut, Zap, TrendingUp, LayoutDashboard, History, ChevronDown, Check } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import LeagueChat from './components/LeagueChat'
import UserHistory from './components/UserHistory'
import DraftResults from './components/DraftResults'

const supabaseUrl = 'https://cjqycykfajaytbrqyncy.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcXljeWtmYWpheXRicnF5bmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5NDU4ODUsImV4cCI6MjA2MzUyMTg4NX0.m2ZPJ0qnssVLrTk1UsIG5NJZ9aVJzoOF2ye4CCOzahA'
const supabase = createClient(supabaseUrl, supabaseKey)
const STORAGE_KEY = 'bidprix_selected_league'
const SCREEN_STORAGE_KEY = 'bidprix_current_screen'

function saveSelectedLeague(league) {
  if (league) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(league))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

function loadSelectedLeague() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function saveCurrentScreen(screen) {
  if (screen) {
    localStorage.setItem(SCREEN_STORAGE_KEY, screen)
  } else {
    localStorage.removeItem(SCREEN_STORAGE_KEY)
  }
}

function loadCurrentScreen() {
  try {
    return localStorage.getItem(SCREEN_STORAGE_KEY) || null
  } catch {
    return null
  }
}

// Magic link: capture ?league=<id> from URL on load and store for post-auth use
const PENDING_LEAGUE_KEY = 'bidprix_pending_league'
;(function captureMagicLeagueParam() {
  try {
    const params = new URLSearchParams(window.location.search)
    const leagueId = params.get('league')
    if (leagueId) {
      sessionStorage.setItem(PENDING_LEAGUE_KEY, leagueId)
      window.history.replaceState({}, '', window.location.pathname)
    }
  } catch (e) {
    // ignore - browser might not support sessionStorage
  }
})()

function RecentUpdates({ updates }) {
  if (updates.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {updates.map((update, index) => (
        <div
          key={index}
          className="bg-bpNavy border-2 border-bpGold/50 rounded-lg shadow-xl p-3 animate-fade-in"
        >
          {update.type === 'bid_increase' && (
            <div className="flex items-start gap-2">
              <TrendingUp className="text-green-500 flex-shrink-0 mt-0.5" size={18} />
              <div>
                <div className="font-semibold text-bpCream text-sm">
                  🚀 Bid Increased!
                </div>
                <div className="text-bpCream/70 text-xs">
                  {update.carTitle}: +${update.amount.toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function BrandLogo({ compact }) {
  return (
    <div className="flex items-center gap-3 select-none">
      <div className="leading-tight">
        <div className="font-extrabold tracking-wide text-[22px] text-bpCream">BID PRIX</div>
        {!compact && (
          <div className="text-[10px] tracking-[0.18em] text-bpGray/95 uppercase">
            Race the Market
          </div>
        )}
      </div>
    </div>
  )
}

function getLeagueDraftInfo(league) {
  if (!league) return { statusColor: 'bg-gray-400', label: '' }
  const now = new Date()
  const start = league.draft_starts_at ? new Date(league.draft_starts_at) : null
  const end = league.draft_ends_at ? new Date(league.draft_ends_at) : null

  if (!start || !end) return { statusColor: 'bg-emerald-400', label: 'Draft open' }
  if (now < start) return { statusColor: 'bg-yellow-400', label: 'Opens soon' }
  if (now >= start && now <= end) {
    const diff = +end - +now
    const days = Math.floor(diff / 86400000)
    return { statusColor: 'bg-emerald-400', label: days > 0 ? `Draft closes in ${days}d` : 'Draft closing soon' }
  }
  return { statusColor: 'bg-gray-400', label: 'Draft closed' }
}

// eslint-disable-next-line no-unused-vars
function Shell({ children, onSignOut, onNavigate, currentScreen, lastUpdated, connectionStatus, recentUpdates, selectedLeague, onManualRefresh, userLeagues, onLeagueChange, getDraftStatus: getDraftStatusProp, garage: garageProp }) {
  const [leagueDropdownOpen, setLeagueDropdownOpen] = useState(false)
  const [mobileLeagueOpen, setMobileLeagueOpen] = useState(false)
  const handleLeagueSelect = (league) => {
    if (onLeagueChange) {
      onLeagueChange(league)
    }
    setLeagueDropdownOpen(false)
    setMobileLeagueOpen(false)
  }

  return (
    <div className="min-h-screen bg-bpNavy text-bpCream">
      <header className="sticky top-0 z-40 bg-bpNavy border-b border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BrandLogo />
            {/* Desktop League Dropdown */}
            {selectedLeague && userLeagues && userLeagues.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setLeagueDropdownOpen(!leagueDropdownOpen)}
                  className="hidden md:flex items-center gap-2 text-xs px-3 py-1.5 bg-bpGold/10 border border-bpGold/30 rounded-full hover:bg-bpGold/20 hover:border-bpGold/60 transition-all cursor-pointer"
                >
                  <Trophy size={14} className="text-bpGold" />
                  <span className="text-bpCream/90 font-medium max-w-[200px] truncate">{selectedLeague.name}</span>
                  {userLeagues.length > 1 && (
                    <ChevronDown size={16} className={`text-bpGold transition-transform ${leagueDropdownOpen ? 'rotate-180' : ''}`} />
                  )}
                </button>

                {/* Desktop League Dropdown Panel */}
                {leagueDropdownOpen && userLeagues.length > 1 && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setLeagueDropdownOpen(false)}
                    />
                    <div className="absolute left-0 mt-2 min-w-[320px] bg-bpNavy border border-bpCream/20 rounded-lg shadow-xl z-50 overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-bpCream/10">
                        <span className="text-xs text-bpCream/60 font-medium uppercase tracking-wide">Switch Auction</span>
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {userLeagues.map((league) => {
                          const info = getLeagueDraftInfo(league)
                          return (
                            <button
                              key={league.id}
                              onClick={() => handleLeagueSelect(league)}
                              className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-bpCream/10 transition-colors text-left ${
                                selectedLeague?.id === league.id ? 'bg-bpGold/10' : ''
                              }`}
                            >
                              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${info.statusColor}`} />
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium text-sm ${selectedLeague?.id === league.id ? 'text-bpGold' : 'text-bpCream'}`}>
                                  {league.name}
                                </div>
                                <div className="text-xs text-bpCream/50 mt-0.5">
                                  {info.label}
                                </div>
                              </div>
                              {selectedLeague?.id === league.id && (
                                <Check size={16} className="text-bpGold flex-shrink-0" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                      <div className="px-4 py-2.5 border-t border-bpCream/10">
                        <button
                          onClick={() => {
                            setLeagueDropdownOpen(false)
                            onNavigate && onNavigate('leagues')
                          }}
                          className="text-xs text-bpGold hover:underline"
                        >
                          Browse more auctions
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <nav className="hidden sm:flex items-center gap-4 text-sm">
            <button
              className={`hover:text-bpCream/90 transition ${currentScreen === 'dashboard' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={`hover:text-bpCream/90 transition ${currentScreen === 'garage' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('garage')}
            >
              Garage
            </button>
            <button
              className={`hover:text-bpCream/90 transition ${currentScreen === 'cars' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('cars')}
            >
              Cars
            </button>
            <button
              className={`hover:text-bpCream/90 transition ${currentScreen === 'leaderboard' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('leaderboard')}
            >
              Leaderboard
            </button>
            <button
              className={`hover:text-bpCream/90 transition ${currentScreen === 'draft-results' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('draft-results')}
            >
              Draft Picks
            </button>
            <button
              className={`hover:text-bpCream/90 transition ${currentScreen === 'leagues' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('leagues')}
            >
              Auctions
            </button>
            <button
              className={`hover:text-bpCream/90 transition ${currentScreen === 'history' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('history')}
            >
              History
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition border border-white/30 text-white bg-transparent hover:bg-white/10 hover:border-white/50"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            )}
          </div>
        </div>
        <div className="h-0.5 bg-teal-500/80" />
      </header>

      {/* Mobile League Switcher Bar */}
      {selectedLeague && userLeagues && userLeagues.length > 0 && (
        <div className="sm:hidden sticky top-[53px] z-30 bg-bpNavy/95 backdrop-blur-sm border-b border-white/10">
          <button
            onClick={() => userLeagues.length > 1 && setMobileLeagueOpen(!mobileLeagueOpen)}
            className="w-full px-4 py-2 flex items-center justify-between"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Trophy size={14} className="text-bpGold flex-shrink-0" />
              <span className="text-sm text-bpCream font-medium truncate">{selectedLeague.name}</span>
            </div>
            {userLeagues.length > 1 && (
              <ChevronDown size={16} className={`text-bpGold flex-shrink-0 transition-transform ${mobileLeagueOpen ? 'rotate-180' : ''}`} />
            )}
          </button>

          {/* Mobile League Dropdown */}
          {mobileLeagueOpen && userLeagues.length > 1 && (
            <>
              <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setMobileLeagueOpen(false)} />
              <div className="absolute left-0 right-0 z-40 bg-bpNavy border-b border-bpCream/20 shadow-xl max-h-64 overflow-y-auto">
                {userLeagues.map((league) => {
                  const info = getLeagueDraftInfo(league)
                  return (
                    <button
                      key={league.id}
                      onClick={() => handleLeagueSelect(league)}
                      className={`w-full px-4 py-3 flex items-center gap-3 text-left border-b border-bpCream/5 ${
                        selectedLeague?.id === league.id ? 'bg-bpGold/10' : 'active:bg-bpCream/10'
                      }`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${info.statusColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium text-sm ${selectedLeague?.id === league.id ? 'text-bpGold' : 'text-bpCream'}`}>
                          {league.name}
                        </div>
                        <div className="text-xs text-bpCream/50 mt-0.5">{info.label}</div>
                      </div>
                      {selectedLeague?.id === league.id && (
                        <Check size={16} className="text-bpGold flex-shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:pb-6">{children}</main>

      {recentUpdates && <RecentUpdates updates={recentUpdates} />}

      {/* Mobile Bottom Navigation */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-bpNavy border-t border-white/10 safe-area-pb">
        <div className="flex items-center justify-around py-2">
          <button
            className={`flex flex-col items-center gap-1 px-3 py-1 ${currentScreen === 'dashboard' ? 'text-bpGold' : 'text-bpGray'}`}
            onClick={() => onNavigate && onNavigate('dashboard')}
          >
            <LayoutDashboard size={20} />
            <span className="text-[10px]">Dashboard</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 px-3 py-1 ${currentScreen === 'garage' ? 'text-bpGold' : 'text-bpGray'}`}
            onClick={() => onNavigate && onNavigate('garage')}
          >
            <Car size={20} />
            <span className="text-[10px]">Garage</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 px-3 py-1 ${currentScreen === 'cars' ? 'text-bpGold' : 'text-bpGray'}`}
            onClick={() => onNavigate && onNavigate('cars')}
          >
            <DollarSign size={20} />
            <span className="text-[10px]">Cars</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 px-3 py-1 ${currentScreen === 'leaderboard' ? 'text-bpGold' : 'text-bpGray'}`}
            onClick={() => onNavigate && onNavigate('leaderboard')}
          >
            <Trophy size={20} />
            <span className="text-[10px]">Ranks</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 px-3 py-1 ${currentScreen === 'leagues' ? 'text-bpGold' : 'text-bpGray'}`}
            onClick={() => onNavigate && onNavigate('leagues')}
          >
            <Users size={20} />
            <span className="text-[10px]">Auctions</span>
          </button>
          <button
            className={`flex flex-col items-center gap-1 px-3 py-1 ${currentScreen === 'history' ? 'text-bpGold' : 'text-bpGray'}`}
            onClick={() => onNavigate && onNavigate('history')}
          >
            <History size={20} />
            <span className="text-[10px]">History</span>
          </button>
        </div>
      </nav>

      <footer className="border-t border-white/10 mt-10 hidden sm:block">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-bpGray">
          © {new Date().getFullYear()} Bid Prix — Race the Market.
        </div>
      </footer>
    </div>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-bpCream text-bpInk border border-white/50 rounded-2xl shadow-[0_8px_28px_rgba(0,0,0,0.22)] ${className}`}>
      {children}
    </div>
  )
}

function PrimaryButton({ className = '', children, ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold bg-teal-500 text-white border border-teal-600 hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-400/80 active:translate-y-[0.5px] transition ${className}`}
    >
      {children}
    </button>
  )
}

// eslint-disable-next-line no-unused-vars
function OutlineButton({ className = '', children, ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold border border-bpNavy/40 text-bpCream hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-bpGold/60 transition ${className}`}
    >
      {children}
    </button>
  )
}

// eslint-disable-next-line no-unused-vars
function LightButton({ className = '', children, ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold border-2 border-bpInk/30 text-bpInk hover:bg-bpNavy hover:text-bpCream focus:outline-none focus:ring-2 focus:ring-bpGold/60 transition ${className}`}
    >
      {children}
    </button>
  )
}

// ─── Direction C: Racing Energy ──────────────────────────────────────────────
const C = {
  bg: '#0a0a0c',
  surface: '#15161b',
  surfaceHi: '#1c1d23',
  border: 'rgba(255,255,255,0.08)',
  borderHi: 'rgba(255,255,255,0.16)',
  text: '#f4f4f5',
  muted: '#8a8a92',
  faint: '#52525a',
  red: '#ef3a32',
  amber: '#f5c542',
  pos: '#5cd17a',
  neg: '#ef3a32',
}

function CBrand({ size = 22 }) {
  const flagSize = Math.round(size * 0.55)
  const sq = flagSize / 2
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.35), lineHeight: 1 }}>
      <span style={{ fontFamily: 'ui-monospace,"JetBrains Mono",monospace', fontWeight: 800, fontSize: size, letterSpacing: 1, textTransform: 'uppercase', display: 'inline-flex', alignItems: 'baseline' }}>
        <span style={{ color: C.text }}>BID</span>
        <span style={{ color: C.red }}>PRIX</span>
      </span>
      <svg width={flagSize} height={flagSize} viewBox={`0 0 ${flagSize} ${flagSize}`} style={{ flexShrink: 0, opacity: 0.85 }}>
        <rect x={0}  y={0}  width={sq} height={sq} fill={C.text}/>
        <rect x={sq} y={0}  width={sq} height={sq} fill={C.red}/>
        <rect x={0}  y={sq} width={sq} height={sq} fill={C.red}/>
        <rect x={sq} y={sq} width={sq} height={sq} fill={C.text}/>
      </svg>
    </div>
  )
}

function CheckerBar({ height = 4 }) {
  return (
    <div style={{ height, background: `repeating-linear-gradient(90deg,${C.text} 0 8px,transparent 8px 16px)`, width: '100%' }} />
  )
}

function fmtCompact(n) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n)}`
}

function CarPlaceholder({ tint = '#3a4a6b', height = 86, radius = 2 }) {
  return (
    <div style={{
      height, borderRadius: radius, background: tint, overflow: 'hidden',
      backgroundImage: `repeating-linear-gradient(135deg,rgba(0,0,0,0.15) 0 4px,transparent 4px 8px)`,
    }} />
  )
}

// Direction C shared atoms ────────────────────────────────────────────────────
const mono = 'ui-monospace,"JetBrains Mono",monospace'

function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0'
  const s = n < 0 ? '-' : ''
  return s + '$' + Math.abs(Math.round(n)).toLocaleString()
}

function fmtK(n) {
  if (n == null || isNaN(n)) return '$0'
  const abs = Math.abs(n), s = n < 0 ? '-' : ''
  return abs >= 1000 ? s + '$' + (abs / 1000).toFixed(0) + 'k' : s + '$' + abs
}

function useCountUp(target, duration) {
  duration = duration || 600
  const [displayed, setDisplayed] = useState(target)
  const prevRef = React.useRef(target)
  useEffect(() => {
    const from = prevRef.current, to = target
    if (from === to) return
    const start = performance.now()
    let raf
    function tick(now) {
      const t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplayed(Math.round(from + (to - from) * ease))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    prevRef.current = to
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return displayed
}

function CarImg({ car, height, radius }) {
  height = height || 100; radius = radius || 3
  const [err, setErr] = useState(false)
  if (err || !car || !car.imageUrl) {
    return (
      <div style={{
        height, borderRadius: radius, width: '100%',
        background: 'repeating-linear-gradient(135deg,rgba(255,255,255,0.05) 0 6px,rgba(0,0,0,0.12) 6px 12px)',
        backgroundColor: '#1e1e28', display: 'flex', alignItems: 'flex-end', padding: '6px 8px',
      }}>
        <span style={{ fontFamily: mono, fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: 0.5 }}>
          {car && car.year} {car && car.make && car.make.toUpperCase()}
        </span>
      </div>
    )
  }
  return <img src={car.imageUrl} alt={car.title} onError={() => setErr(true)}
    style={{ width: '100%', height, objectFit: 'cover', borderRadius: radius, display: 'block' }} />
}

// eslint-disable-next-line no-unused-vars
function MonoLabel({ children, color, size, spacing, weight }) {
  return (
    <span style={{
      fontFamily: mono, fontSize: size || 9.5, letterSpacing: spacing || 1.3,
      fontWeight: weight || 700, textTransform: 'uppercase', color: color || C.muted,
    }}>{children}</span>
  )
}

// eslint-disable-next-line no-unused-vars
function LiveDot({ color }) {
  color = color || C.red
  return <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}`, animation: 'bpPulse 1.6s ease-in-out infinite', flexShrink: 0 }} />
}

// eslint-disable-next-line no-unused-vars
function SectionEyebrow({ children }) {
  return (
    <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: 1.6, color: C.muted, marginBottom: 10 }}>
      {'//'} {children}
    </div>
  )
}

function BottomTabBar({ screen, onNavigate }) {
  const tabs = [
    { id: 'dashboard',   label: 'DASH',     icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></svg> },
    { id: 'leagues',     label: 'AUCTIONS', icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><circle cx="7" cy="8" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="M2 17c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M14 6c1.1 0 2 .9 2 2s-.9 2-2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M18 17c0-2.21-1.79-4-4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg> },
    { id: 'cars',        label: 'PICK',     icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M10 2l1.8 5.4H18l-4.9 3.5 1.8 5.6L10 13l-4.9 3.5 1.8-5.6L2 7.4h6.2L10 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg> },
    { id: 'garage',      label: 'GARAGE',   icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M3 9l7-6 7 6v8a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><rect x="8" y="13" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.5"/></svg> },
    { id: 'leaderboard', label: 'RANKS',    icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.4l-4.8 2.5.9-5.4L2.2 7.7l5.4-.8L10 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg> },
    { id: 'history',     label: 'HISTORY',  icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.7"/><path d="M10 6v4l-3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  ]
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.bg, borderTop: `1px solid ${C.border}`, paddingBottom: 16, zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around', paddingTop: 8 }}>
        {tabs.map(t => {
          const active = screen === t.id
          return (
            <button key={t.id} onClick={() => onNavigate(t.id)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
              color: active ? C.red : C.faint, position: 'relative',
            }}>
              {active && (
                <div style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', width: 20, height: 2, background: C.red, borderRadius: 1 }} />
              )}
              <div style={{ color: active ? C.red : C.faint }}>{t.icon}</div>
              <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, fontWeight: active ? 800 : 600, color: active ? C.red : C.faint }}>
                {t.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

export default function BidPrixApp() {
  const [currentScreen, setCurrentScreen] = useState(() => loadCurrentScreen() || 'landing')
  const [user, setUser] = useState(null)
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [garage, setGarage] = useState([])
  const [budget, setBudget] = useState(200000)
  const [auctions, setAuctions] = useState([])
  const [leagues, setLeagues] = useState([])
  const [userLeagues, setUserLeagues] = useState([])  // Leagues user has joined
  const [loading, setLoading] = useState(false)
  const [userGarageId, setUserGarageId] = useState(null)
  const [leagueLoading, setLeagueLoading] = useState(true)
  const [bonusCar, setBonusCar] = useState(null)
  const [userPrediction, setUserPrediction] = useState(null)
  const [showPredictionModal, setShowPredictionModal] = useState(false)
  // eslint-disable-next-line no-unused-vars
  const [connectionStatus, setConnectionStatus] = useState('connected')
  // eslint-disable-next-line no-unused-vars
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [recentUpdates, setRecentUpdates] = useState([])
  const [isChatOpen, setIsChatOpen] = useState(false)

  const updateCurrentScreen = (screen) => {
    setCurrentScreen(screen)
    saveCurrentScreen(screen)
  }

  const updateSelectedLeague = (league) => {
    setSelectedLeague(league)
    saveSelectedLeague(league)
  }
  const calculateTimeLeft = (endTime) => {
    if (!endTime) return 'N/A'
    const now = new Date()
    const diff = +endTime - +now
    if (diff <= 0) return 'Ended'
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  const addRecentUpdate = (update) => {
    setRecentUpdates(prev => {
      const newUpdates = [{ ...update, timestamp: new Date() }, ...prev].slice(0, 5)
      return newUpdates
    })
    
    setTimeout(() => {
      setRecentUpdates(prev => prev.filter(u => u.timestamp !== update.timestamp))
    }, 10000)
  }

  // eslint-disable-next-line no-unused-vars
  const manualRefresh = async () => {
    if (!selectedLeague) return
    
    try {
      await Promise.all([
        fetchUserGarage(selectedLeague.id),
        fetchAuctions(),
        fetchBonusCar(selectedLeague.id)
      ])
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Error during manual refresh:', error)
    }
  }


  const getDraftStatus = (league) => {
    if (!league.draft_starts_at || !league.draft_ends_at) {
      return { status: 'open', message: 'Draft Open' }
    }
    
    const now = new Date()
    const start = new Date(league.draft_starts_at)
    const end = new Date(league.draft_ends_at)
    
    if (now < start) {
      const timeUntil = calculateTimeLeft(start)
      return { status: 'upcoming', message: `Draft opens in ${timeUntil}` }
    }
    
    if (now >= start && now <= end) {
      const timeLeft = calculateTimeLeft(end)
      return { status: 'open', message: `Draft closes in ${timeLeft}` }
    }
    
    return { status: 'closed', message: 'Draft closed' }
  }

  const getDefaultCarImage = (make) => {
    const map = {
      BMW: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=640&h=420&fit=crop',
      Porsche: 'https://images.unsplash.com/photo-1544829099-b9a0c5303bea?w=640&h=420&fit=crop',
      Toyota: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=640&h=420&fit=crop',
      Honda: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=640&h=420&fit=crop',
      Mercedes: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=640&h=420&fit=crop',
      Nissan: 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=640&h=420&fit=crop',
      Ford: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=640&h=420&fit=crop',
      Chevrolet: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=640&h=420&fit=crop',
      Jaguar: 'https://images.unsplash.com/photo-1544829099-b9a0c5303bea?w=640&h=420&fit=crop',
      Ferrari: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=640&h=420&fit=crop',
      Lamborghini: 'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=640&h=420&fit=crop'
    }
    return (make && map[make]) || map['Ford']
  }

  const fetchBonusCar = async (leagueId) => {
    if (!leagueId) return
    
    try {
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('bonus_auction_id')
        .eq('id', leagueId)
        .single()
      
      if (leagueError || !league.bonus_auction_id) {
        console.log('No bonus car set for this league')
        setBonusCar(null)
        return
      }
      
      console.log(`Fetching bonus car: ${league.bonus_auction_id}`)
      
     const { data: auction, error: auctionError } = await supabase
  .from('auctions')
  .select('*')
  .eq('auction_id', league.bonus_auction_id)  // ✅ Just fetch by ID!
  .single()
      
      if (auctionError || !auction) {
        console.warn('⚠️ Bonus car auction has ended or not found!')
        console.error('Error details:', auctionError)
        setBonusCar(null)
        return
      }
      
      const endDate = new Date(auction.timestamp_end * 1000)
      const baseline = parseFloat(auction.price_at_48h)
      const imageUrl = auction.image_url || getDefaultCarImage(auction.make)
      
      const auctionEnded = endDate < new Date()

      const bonusCarData = {
        id: auction.auction_id,
        title: auction.title,
        make: auction.make,
        model: auction.model,
        year: auction.year,
        currentBid: parseFloat(auction.current_bid) || baseline || 0,
        baselinePrice: baseline,
        timeLeft: calculateTimeLeft(endDate),
        auctionUrl: auction.url,
        imageUrl: imageUrl,
        endTime: endDate,
        auctionEnded: auctionEnded,
        finalPrice: auction.final_price ? parseFloat(auction.final_price) : null,
        reserveNotMet: auction.reserve_not_met === true,
      }
      
      console.log('✅ Active bonus car loaded:', bonusCarData)
      setBonusCar(bonusCarData)
      
    } catch (error) {
      console.error('Error fetching bonus car:', error)
      setBonusCar(null)
    }
  }

  const fetchUserPrediction = async (leagueId) => {
    if (!user || !leagueId) return
    
    try {
      const { data, error } = await supabase
        .from('bonus_predictions')
        .select('predicted_price')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .maybeSingle()
      
      if (error) {
        console.error('Error fetching prediction:', error)
        setUserPrediction(null)
        return
      }
      
      if (data) {
        console.log('User prediction found:', data.predicted_price)
        setUserPrediction(data.predicted_price)
      } else {
        console.log('No prediction found for user')
        setUserPrediction(null)
      }
      
    } catch (error) {
      console.error('Error fetching prediction:', error)
      setUserPrediction(null)
    }
  }

  const submitPrediction = async (predictedPrice) => {
    if (!user || !selectedLeague || !bonusCar) {
      alert('Missing required data')
      return false
    }
    
    try {
      const { error } = await supabase
        .from('bonus_predictions')
        .upsert({
          league_id: selectedLeague.id,
          user_id: user.id,
          predicted_price: parseFloat(predictedPrice)
        }, {
          onConflict: 'league_id,user_id'
        })
      
      if (error) {
        console.error('Error submitting prediction:', error)
        alert('Error saving prediction: ' + error.message)
        return false
      }
      
      setUserPrediction(parseFloat(predictedPrice))
      setShowPredictionModal(false)
      alert('Prediction saved! You predicted: $' + parseFloat(predictedPrice).toLocaleString())
      return true
      
    } catch (error) {
      console.error('Error submitting prediction:', error)
      alert('Error saving prediction')
      return false
    }
  }

  const fetchAuctions = async (leagueOverride) => {
  const league = leagueOverride || selectedLeague
  if (!league) {
    console.log('No league selected, cannot fetch auctions')
    return
  }

  setLoading(true)
  try {
    let auctionData = [];

    // Check if league uses manual auction selection
    if (league.use_manual_auctions) {
      console.log('League uses manual auction selection')

      // Fetch manually selected auctions for this league
      const { data: leagueAuctionsData, error: leagueAuctionsError } = await supabase
        .from('league_auctions')
        .select(`
          *,
          auctions!league_auctions_auction_id_fkey(*)
        `)
        .eq('league_id', league.id);

      if (leagueAuctionsError) throw leagueAuctionsError;

      console.log('Raw leagueAuctionsData from Supabase:', JSON.stringify(leagueAuctionsData, null, 2));

      // Transform league_auctions data to match expected format
      auctionData = (leagueAuctionsData || [])
        .filter(la => {
          if (!la.auctions) {
            console.warn('⚠️ Missing auction data for league_auction:', la);
            return false;
          }
          return true;
        })
        .map(la => {
          console.log('Processing league auction:', la);
          const auction = la.auctions;
          console.log('Extracted auction:', auction);
          console.log('Image URL from auction:', auction?.image_url);
          // Use custom end date if provided, otherwise use auction's original end date
          const endTimestamp = la.custom_end_date || auction.timestamp_end;
          return {
            ...auction,
            timestamp_end: endTimestamp,
            manually_added: true,  // Mark as manually added
            custom_end_date: la.custom_end_date  // Keep track of custom end date
          };
        });

      console.log(`✅ Loaded ${auctionData.length} manually selected auctions for league`)
    } else {
      console.log('League uses auto auction selection (4-5 day window)')

      // ✅ Use SAME logic as admin portal (4-5 day window)
      const now = Math.floor(Date.now() / 1000);
      const fourDaysInSeconds = 4 * 24 * 60 * 60;
      const fiveDaysInSeconds = 5 * 24 * 60 * 60;

      const minEndTime = now + fourDaysInSeconds;
      const maxEndTime = now + fiveDaysInSeconds;

      console.log('Draft window filter:', {
        now: new Date(now * 1000).toLocaleString(),
        minEndTime: new Date(minEndTime * 1000).toLocaleString(),
        maxEndTime: new Date(maxEndTime * 1000).toLocaleString()
      });

      const { data: autoAuctionData, error: auctionError } = await supabase
        .from('auctions')
        .select('*')
        .gte('timestamp_end', minEndTime)      // At least 4 days from now
        .lte('timestamp_end', maxEndTime)      // Within 5 days from now
        .not('price_at_48h', 'is', null)       // Has baseline price
        .is('final_price', null)                // Not sold yet
        .order('timestamp_end', { ascending: true })
        .limit(100);

      if (auctionError) throw auctionError;

      auctionData = autoAuctionData || [];
      console.log(`✅ Loaded ${auctionData.length} cars in draft window (4-5 days before end)`)
    }

    const transformed = (auctionData || []).map((a) => {
      // Handle missing or invalid timestamp_end
      const hasValidTimestamp = a.timestamp_end && !isNaN(a.timestamp_end)
      const endDate = hasValidTimestamp ? new Date(a.timestamp_end * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Default to 7 days from now
      const baseline = parseFloat(a.price_at_48h)
      const imageUrl = a.image_url || getDefaultCarImage(a.make)
      console.log(`📸 Car: ${a.title}, image_url: ${a.image_url}, final imageUrl: ${imageUrl}`)

      return {
        id: a.auction_id,
        title: a.title,
        make: a.make,
        model: a.model,
        year: a.year,
        currentBid: parseFloat(a.current_bid) || baseline || 0,
        baselinePrice: baseline,
        day2Price: baseline,
        finalPrice: a.final_price,
        timeLeft: hasValidTimestamp ? calculateTimeLeft(endDate) : 'Custom end date',
        auctionUrl: a.url,
        imageUrl: imageUrl,
        trending: Math.random() > 0.7,
        endTime: endDate,
        timestamp_end: a.timestamp_end,
        manually_added: a.manually_added || false,  // Preserve manually added flag
        custom_end_date: a.custom_end_date  // Preserve custom end date
      }
    })

    // Shuffle so each player sees cars in a different order.
    // Order stays stable for the session (no re-shuffle on tab switches).
    for (let i = transformed.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [transformed[i], transformed[j]] = [transformed[j], transformed[i]];
    }

    setAuctions(transformed)

  } catch (e) {
    console.error('Error fetching auctions:', e)
    setAuctions([])
  } finally { 
    setLoading(false) 
  }
}

  const fetchLeagues = async () => {
    const { data, error } = await supabase
      .from('leagues')
      .select('*, league_members(count)')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); setLeagues([]); return }
    setLeagues((data||[]).map(l => ({
      ...l,
      playerCount: l.league_members?.[0]?.count || 0,
      status: 'Open'
    })))
  }

  // Fetch leagues that the current user has joined
  const fetchUserLeagues = async () => {
    if (!user) {
      setUserLeagues([])
      return
    }

    const { data, error } = await supabase
      .from('league_members')
      .select(`
        league_id,
        leagues!league_members_league_id_fkey(*, league_members(count))
      `)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error fetching user leagues:', error)
      setUserLeagues([])
      return
    }

    // Extract the league data from the join
    const joinedLeagues = (data || [])
      .filter(m => m.leagues)  // Filter out any null leagues
      .map(m => ({
        ...m.leagues,
        playerCount: m.leagues.league_members?.[0]?.count || 0,
        status: 'Open'
      }))

    console.log(`✅ User has joined ${joinedLeagues.length} leagues`)
    setUserLeagues(joinedLeagues)
  }

  const fetchUserGarage = async (leagueId) => {
    if (!user) return
    const { data: g, error: ge } = await supabase
      .from('garages')
      .select('*')
      .eq('user_id', user.id)
      .eq('league_id', leagueId)
      .maybeSingle()
    
    if (ge) { console.error(ge); return }
    
    if (g) {
      setUserGarageId(g.id)
      setBudget(g.remaining_budget)
      const { data: cars, error: ce } = await supabase
        .from('garage_cars')
        .select(`*, auctions!garage_cars_auction_id_fkey(*)`)
        .eq('garage_id', g.id)
      
      if (!ce && cars) {
        const garageCars = cars.map((it) => {
          const auction = it.auctions
          const imageUrl = auction?.image_url || getDefaultCarImage(auction?.make)
          const now = Math.floor(Date.now() / 1000)
          const auctionEnded = auction?.timestamp_end ? auction.timestamp_end < now : false

          return {
            garageCarId: it.id,
            id: auction?.auction_id || it.auction_id,
            title: auction?.title || 'Unknown Car',
            make: auction?.make || '',
            model: auction?.model || '',
            year: auction?.year || '',
            currentBid: parseFloat(auction?.current_bid) || it.purchase_price,
            finalPrice: auction?.final_price ? parseFloat(auction.final_price) : null,
            purchasePrice: it.purchase_price,
            auctionUrl: auction?.url || '#',
            imageUrl: imageUrl,
            timeLeft: calculateTimeLeft(auction?.timestamp_end ? new Date(auction.timestamp_end * 1000) : null),
            timestampEnd: auction?.timestamp_end || null,
            auctionEnded: auctionEnded,
            reserveNotMet: auction?.reserve_not_met === true,
          }
        })
        setGarage(garageCars)
      }
    } else {
      setUserGarageId(null)
      setBudget(200000)
      setGarage([])
    }
  }

  const joinLeague = async (league) => {
    if (!user) return
    
    const draftStatus = getDraftStatus(league)
    if (draftStatus.status !== 'open') {
      alert(`Cannot join auction: ${draftStatus.message}`)
      return
    }
    
    try {
      const { data: existing } = await supabase
        .from('league_members')
        .select('*')
        .eq('league_id', league.id)
        .eq('user_id', user.id)
        .maybeSingle()
      
      if (existing) {
        updateSelectedLeague(league)
        await fetchUserGarage(league.id)
        await fetchAuctions(league)
        await fetchBonusCar(league.id)
        await fetchUserPrediction(league.id)
        updateCurrentScreen('cars')
        return
      }
      
      const { data: g, error: ge } = await supabase
        .from('garages')
        .insert([{ user_id: user.id, league_id: league.id, remaining_budget: league.spending_limit || 200000 }])
        .select()
        .single()
      
      if (ge) { alert('Error creating garage: '+ge.message); return }
      
      const { error: me } = await supabase
        .from('league_members')
        .insert([{ league_id: league.id, user_id: user.id, total_score: 0 }])
      
      if (me) { alert('Error joining auction: '+me.message); return }
      
      updateSelectedLeague(league)
      setUserGarageId(g.id)
      setBudget(175000)
      setGarage([])

      await fetchUserLeagues()  // Refresh joined leagues list
      await fetchAuctions(league)
      await fetchBonusCar(league.id)
      await fetchUserPrediction(league.id)
      updateCurrentScreen('cars')
      
    } catch (error) {
      console.error('Error joining auction:', error)
      alert('Error joining auction')
    }
  }

  // Magic link: called after auth to auto-join the league from the URL param
  const handlePendingLeague = async (sessionUser) => {
    const pendingId = sessionStorage.getItem(PENDING_LEAGUE_KEY)
    if (!pendingId || !sessionUser) return false

    sessionStorage.removeItem(PENDING_LEAGUE_KEY)

    try {
      const { data: league, error } = await supabase
        .from('leagues')
        .select('*, league_members(count)')
        .eq('id', pendingId)
        .single()

      if (error || !league) {
        console.warn('Magic link: league not found', pendingId)
        return false
      }

      const normalizedLeague = {
        ...league,
        playerCount: league.league_members?.[0]?.count || 0,
        status: 'Open',
      }

      // Check if already a member
      const { data: existing } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('league_id', pendingId)
        .eq('user_id', sessionUser.id)
        .maybeSingle()

      if (!existing) {
        const draftStatus = getDraftStatus(league)
        if (draftStatus.status === 'open') {
          // Join the league
          const { data: g, error: ge } = await supabase
            .from('garages')
            .insert([{ user_id: sessionUser.id, league_id: pendingId, remaining_budget: league.spending_limit || 200000 }])
            .select()
            .single()

          if (!ge && g) {
            await supabase
              .from('league_members')
              .insert([{ league_id: pendingId, user_id: sessionUser.id, total_score: 0 }])
          }
        }
      }

      updateSelectedLeague(normalizedLeague)
      updateCurrentScreen('dashboard')
      return true
    } catch (err) {
      console.error('Magic link: error handling pending league', err)
      return false
    }
  }

  const addToGarage = async (auction) => {
    if (selectedLeague) {
      const draftStatus = getDraftStatus(selectedLeague)
      if (draftStatus.status !== 'open') {
        alert(`Cannot add cars: ${draftStatus.message}`)
        return
      }
    }

    // Validate the auction is in the current league's allowed pool
    const isAuctionInLeaguePool = auctions.some(a => a.id === auction.id)
    if (!isAuctionInLeaguePool) {
      alert('Error: This car is not part of the current auction pool.')
      return
    }

    if (garage.length >= 7) { alert('Garage is full!'); return }
    const draftPrice = auction.baselinePrice || auction.currentBid
    if (budget < draftPrice) { alert('Not enough budget remaining!'); return }
    if (!user || !selectedLeague || !userGarageId) { alert('Please join a league first!'); return }
    
    const { data: gc, error: ce } = await supabase
      .from('garage_cars')
      .insert([{ garage_id: userGarageId, auction_id: auction.id, purchase_price: draftPrice }])
      .select().single()
    
    if (ce) { alert('Error adding car: '+ce.message); return }
    
    const newBudget = budget - draftPrice
    const { error: be } = await supabase.from('garages').update({ remaining_budget: newBudget }).eq('id', userGarageId)
    if (be) console.error(be)
    
    setGarage([...garage, { ...auction, purchasePrice: draftPrice, garageCarId: gc.id }])
    setBudget(newBudget)
  }

  const removeFromGarage = async (car) => {
    if (selectedLeague) {
      const draftStatus = getDraftStatus(selectedLeague)
      if (draftStatus.status !== 'open') {
        alert(`Cannot remove cars: ${draftStatus.message}`)
        return
      }
    }
    
    const { error: re } = await supabase.from('garage_cars').delete().eq('id', car.garageCarId)
    if (re) { alert('Error removing car: '+re.message); return }
    
    const newBudget = budget + (car.purchasePrice || car.currentBid)
    const { error: be } = await supabase.from('garages').update({ remaining_budget: newBudget }).eq('id', userGarageId)
    if (be) console.error(be)
    
    setGarage(garage.filter(c => c.id !== car.id))
    setBudget(newBudget)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }}) => {
      if (session) {
        setUser(session.user)
        // Magic link: check for pending league from URL param first
        const handled = await handlePendingLeague(session.user)
        if (!handled) {
          // Smart navigation: go to dashboard if user has a saved league, otherwise leagues
          const savedLeague = loadSelectedLeague()
          const savedScreen = loadCurrentScreen()
          if (savedLeague && savedScreen && savedScreen !== 'landing' && savedScreen !== 'login') {
            updateCurrentScreen(savedScreen)
          } else if (savedLeague) {
            updateCurrentScreen('dashboard')
          } else {
            updateCurrentScreen('leagues')
          }
        }
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user || null)
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked the password reset link - send them to the reset form
        updateCurrentScreen('reset-password')
        return
      }
      if (session) {
        // Magic link: check for pending league from URL param first
        const handled = await handlePendingLeague(session.user)
        if (!handled) {
          // Smart navigation on auth change
          const savedLeague = loadSelectedLeague()
          if (savedLeague) {
            updateCurrentScreen('dashboard')
          } else {
            updateCurrentScreen('leagues')
          }
        }
      } else {
        updateCurrentScreen('landing')
      }
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (user) {
      fetchLeagues()
      fetchUserLeagues()  // Fetch leagues user has joined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
  
  useEffect(() => {
    const stored = loadSelectedLeague()
    if (stored && user) {
      setSelectedLeague(stored)
      fetchUserGarage(stored.id)
      fetchAuctions()
      fetchBonusCar(stored.id)
      fetchUserPrediction(stored.id)
    }
    setLeagueLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
  
  useEffect(() => { 
  if (selectedLeague && user) {
    fetchUserGarage(selectedLeague.id)
    fetchAuctions()
    fetchBonusCar(selectedLeague.id)
    fetchUserPrediction(selectedLeague.id)
   }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedLeague, user])

  useEffect(() => {
    if (!selectedLeague || !user) return

    console.log('🔌 Setting up real-time subscriptions...')
    setConnectionStatus('connecting')

    const auctionChannel = supabase
      .channel(`league-${selectedLeague.id}-auctions`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'auctions',
        },
        (payload) => {
          console.log('📊 Auction updated:', payload.new.auction_id)
          setLastUpdated(new Date())
          
          setAuctions(prev => prev.map(car => {
            if (car.id === payload.new.auction_id) {
              const now = Math.floor(Date.now() / 1000)
              const auctionEnded = payload.new.timestamp_end < now
              return {
                ...car,
                currentBid: parseFloat(payload.new.current_bid),
                finalPrice: payload.new.final_price ? parseFloat(payload.new.final_price) : null,
                timeLeft: calculateTimeLeft(new Date(payload.new.timestamp_end * 1000)),
                auctionEnded: auctionEnded,
                reserveNotMet: auctionEnded && !payload.new.final_price,
              }
            }
            return car
          }))

          setGarage(prev => prev.map(car => {
            if (car.id === payload.new.auction_id) {
              const oldBid = car.currentBid
              const newBid = parseFloat(payload.new.current_bid)
              const now = Math.floor(Date.now() / 1000)
              const auctionEnded = payload.new.timestamp_end < now

              if (newBid > oldBid) {
                const increase = newBid - oldBid
                addRecentUpdate({
                  type: 'bid_increase',
                  carTitle: payload.new.title,
                  amount: increase,
                  carId: car.id
                })
              }

              return {
                ...car,
                currentBid: newBid,
                finalPrice: payload.new.final_price ? parseFloat(payload.new.final_price) : null,
                timeLeft: calculateTimeLeft(new Date(payload.new.timestamp_end * 1000)),
                auctionEnded: auctionEnded,
                reserveNotMet: auctionEnded && !payload.new.final_price,
              }
            }
            return car
          }))

          if (bonusCar && bonusCar.id === payload.new.auction_id) {
            setBonusCar(prev => ({
              ...prev,
              currentBid: parseFloat(payload.new.current_bid),
              finalPrice: payload.new.final_price,
              timeLeft: calculateTimeLeft(new Date(payload.new.timestamp_end * 1000))
            }))
          }
        }
      )
      .on('subscribe', (status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Connected to auction updates')
          setConnectionStatus('connected')
          setLastUpdated(new Date())
        }
      })
      .subscribe()

    return () => {
      console.log('🔌 Cleaning up subscriptions...')
      supabase.removeChannel(auctionChannel)
      setConnectionStatus('disconnected')
    }
  }, [selectedLeague, user, bonusCar])

  function LandingScreen({ onGetStarted }) {
    const TICKER_ROWS = [
      { t: 'NEW BID', n: '1991 BMW M5', v: '+$2,700', good: true },
      { t: 'SELECTED', n: 'shop_rat → S2000', v: '$24.0k', good: null },
      { t: 'SOLD', n: 'Land Cruiser', v: '$48,200', good: true },
    ]
    const MOCK_CARS = [
      { id: 'c1', title: '1991 BMW M5 (E34)',        year: 1991, price: 38500, img: '#3a4a6b', trend: 7 },
      { id: 'c2', title: '1995 Porsche 993 Carrera', year: 1995, price: 92000, img: '#6b3a3a', trend: 5 },
      { id: 'c3', title: '1987 Toyota Land Cruiser', year: 1987, price: 42000, img: '#3a5a4a', trend: 6 },
      { id: 'c4', title: '1972 Datsun 240Z',         year: 1972, price: 28500, img: '#5a4a3a', trend: 9 },
    ]
    return (
      <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
        {/* App bar */}
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CBrand />
          <button onClick={onGetStarted} style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: C.muted, letterSpacing: 0.5, background: 'none', border: 'none', cursor: 'pointer' }}>
            SIGN IN ▸
          </button>
        </div>
        <CheckerBar height={4} />

        {/* Hero */}
        <div style={{ padding: '22px 18px 18px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'ui-monospace,monospace', fontSize: 10, color: C.red, letterSpacing: 1.6, fontWeight: 700, background: `${C.red}15`, padding: '5px 8px', border: `1px solid ${C.red}40`, marginBottom: 18 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.red, boxShadow: `0 0 10px ${C.red}`, display: 'inline-block' }} />
            LIVE · 3 LEAGUES DRAFTING
          </div>
          <h1 style={{ fontFamily: 'ui-monospace,"JetBrains Mono",monospace', fontSize: 'clamp(36px,10vw,52px)', fontWeight: 800, lineHeight: 0.95, letterSpacing: -2, margin: '0 0 16px', textTransform: 'uppercase' }}>
            RACE THE<br/>
            <span style={{ color: C.red }}>MARKET.</span>
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: C.muted, margin: '0 0 22px', maxWidth: 320 }}>
            Seven cars. $175k budget. One week of the BaT market. The leaderboard updates every minute.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onGetStarted} style={{ flex: 1, height: 50, borderRadius: 4, border: 'none', background: C.red, color: C.text, fontWeight: 800, fontSize: 13, fontFamily: 'ui-monospace,monospace', letterSpacing: 1.4, textTransform: 'uppercase', cursor: 'pointer' }}>
              ENTER PIT LANE ▸
            </button>
            <button onClick={onGetStarted} style={{ width: 50, height: 50, borderRadius: 4, border: `1px solid ${C.borderHi}`, background: 'transparent', color: C.text, fontFamily: 'ui-monospace,monospace', fontSize: 16, cursor: 'pointer' }}>?</button>
          </div>
        </div>

        {/* Live ticker */}
        <div style={{ margin: '6px 0 22px', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '12px 18px', background: C.surface }}>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 9.5, letterSpacing: 1.6, color: C.muted, marginBottom: 8 }}>{'//'} LIVE TICKER</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {TICKER_ROWS.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'ui-monospace,monospace', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: r.t === 'NEW BID' ? C.red : r.t === 'SOLD' ? C.pos : C.amber, width: 56 }}>{r.t}</span>
                <span style={{ flex: 1, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.n}</span>
                <span style={{ color: r.good === true ? C.pos : C.text, fontWeight: 700 }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Featured grid */}
        <div style={{ padding: '0 18px 24px' }}>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, letterSpacing: 1.6, color: C.muted, marginBottom: 10 }}>{'//'} THIS WEEK&apos;S GRID — 72 LOTS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {MOCK_CARS.map(c => (
              <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 10 }}>
                <CarPlaceholder tint={c.img} height={86} radius={2} />
                <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: C.muted, letterSpacing: 0.5, marginTop: 8 }}>LOT {c.id.slice(1).padStart(4,'0')} · {c.year}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, height: 32, lineHeight: 1.3, overflow: 'hidden' }}>{c.title.replace(`${c.year} `,'')}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 }}>
                  <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>${(c.price/1000).toFixed(0)}k</div>
                  <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 700, color: C.pos }}>+{c.trend}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* The Format */}
        <div style={{ margin: '0 18px', padding: '20px', background: C.surface, border: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, letterSpacing: 1.6, color: C.muted, marginBottom: 14 }}>{'//'} THE FORMAT</div>
          {[
            { n: '01', t: 'SELECT', d: 'Pick 7 live auctions. Price locks at the 48-hour mark.' },
            { n: '02', t: 'BID',    d: 'Real bids roll in. Watch the market move in your favour.' },
            { n: '03', t: 'WIN',    d: 'Hammer prices tally. Best auction picks take the podium.' },
          ].map((s, i) => (
            <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 12, padding: '12px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.border}` }}>
              <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 22, fontWeight: 800, color: C.red }}>{s.n}</div>
              <div>
                <div style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>{s.t}</div>
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, lineHeight: 1.4 }}>{s.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: 24 }}>
          <button onClick={onGetStarted} style={{ width: '100%', height: 50, borderRadius: 4, background: 'transparent', color: C.text, fontWeight: 700, fontSize: 13, fontFamily: 'ui-monospace,monospace', letterSpacing: 1.4, border: `1px solid ${C.borderHi}`, textTransform: 'uppercase', cursor: 'pointer' }}>
            CREATE FREE ACCOUNT ▸
          </button>
        </div>

        <CheckerBar height={4} />
      </div>
    )
  }

  function LoginScreen() {
    const hasPendingLeague = !!sessionStorage.getItem(PENDING_LEAGUE_KEY)
    const [isSignUp, setIsSignUp] = useState(hasPendingLeague)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [username, setUsername] = useState('')

    const handleEmailChange = (e) => {
      const val = e.target.value
      setEmail(val)
      if (isSignUp && !username) {
        const suggested = val.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        if (suggested) setUsername(suggested)
      }
    }

    const signUp = async () => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username }}
      })
      if (error) return alert('Error signing up: '+error.message)
      if (data.session) {
        setUser(data.user)
        updateCurrentScreen('leagues')
      } else if (data.user && !data.session) {
        alert('Check your email for verification link!')
      }
    }

    const signIn = async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return alert('Error signing in: '+error.message)
      setUser(data.user)
      updateCurrentScreen('leagues')
    }

    const inputStyle = {
      width: '100%', height: 48, background: C.surface, border: `1px solid ${C.borderHi}`,
      borderRadius: 4, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', fontSize: 15,
      padding: '0 14px', outline: 'none',
    }
    const labelStyle = { fontFamily: mono, fontSize: 10, letterSpacing: 1.4, color: C.muted, display: 'block', marginBottom: 6 }

    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', padding: '28px 24px', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}><CBrand size={24} /></div>

        <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 800, letterSpacing: -0.8, textTransform: 'uppercase', marginBottom: 6 }}>
          {isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 28 }}>
          {isSignUp ? 'Choose your callsign. First race is free.' : 'Welcome back to the grid.'}
        </div>

        <CheckerBar height={2} />
        <div style={{ height: 1 }} />

        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {isSignUp && (
            <div>
              <label style={labelStyle}>CALLSIGN (USERNAME)</label>
              <input style={inputStyle} placeholder="shop_rat" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
          )}
          <div>
            <label style={labelStyle}>EMAIL ADDRESS</label>
            <input type="email" style={inputStyle} placeholder="you@example.com" value={email} onChange={handleEmailChange} />
          </div>
          <div>
            <label style={labelStyle}>PASSWORD</label>
            <input type="password" style={inputStyle} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            {!isSignUp && (
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <span onClick={() => updateCurrentScreen('forgot-password')}
                  style={{ fontFamily: mono, fontSize: 10, color: C.muted, letterSpacing: 0.8, cursor: 'pointer' }}>
                  FORGOT PASSWORD?
                </span>
              </div>
            )}
          </div>

          <button onClick={isSignUp ? signUp : signIn} style={{ width: '100%', height: 50, borderRadius: 4, border: 'none', background: C.red, color: C.text, fontWeight: 800, fontSize: 13, fontFamily: mono, letterSpacing: 1.4, textTransform: 'uppercase', cursor: 'pointer', marginTop: 4 }}>
            {isSignUp ? 'JOIN THE GRID ▸' : 'SIGN IN ▸'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span style={{ fontFamily: mono, fontSize: 9, color: C.faint, letterSpacing: 1 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>

        <button onClick={() => setIsSignUp(!isSignUp)} style={{ width: '100%', height: 50, borderRadius: 4, background: 'transparent', color: C.text, fontWeight: 700, fontSize: 13, fontFamily: mono, letterSpacing: 1.4, border: `1px solid ${C.borderHi}`, textTransform: 'uppercase', cursor: 'pointer' }}>
          {isSignUp ? 'ALREADY HAVE AN ACCOUNT' : 'CREATE AN ACCOUNT'}
        </button>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button onClick={() => updateCurrentScreen('landing')} style={{ fontFamily: mono, fontSize: 10, color: C.faint, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 0.8 }}>
            ← BACK TO HOME
          </button>
        </div>
      </div>
    )
  }

  function ForgotPasswordScreen() {
    const [email, setEmail] = useState('')
    const [submitted, setSubmitted] = useState(false)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
      e.preventDefault()
      if (!email.trim()) return
      setLoading(true)
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) console.error('Password reset error:', error)
        setSubmitted(true)
      } catch (err) {
        console.error('Password reset error:', err)
        setSubmitted(true)
      } finally {
        setLoading(false)
      }
    }

    const inputStyle = { width: '100%', height: 48, background: C.surface, border: `1px solid ${C.borderHi}`, borderRadius: 4, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', fontSize: 15, padding: '0 14px', outline: 'none' }

    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', padding: '28px 24px', minHeight: '100vh' }}>
        <button onClick={() => updateCurrentScreen('login')} style={{ fontFamily: mono, fontSize: 10, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 0.8, marginBottom: 24 }}>
          ← BACK TO SIGN IN
        </button>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}><CBrand size={24} /></div>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontFamily: mono, fontSize: 32, color: C.pos, marginBottom: 16 }}>✓</div>
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>CHECK YOUR EMAIL</div>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 28 }}>
              If an account exists with that email, we&apos;ve sent a reset link. Check your inbox.
            </p>
            <button onClick={() => updateCurrentScreen('login')} style={{ width: '100%', height: 50, borderRadius: 4, background: 'transparent', color: C.text, fontWeight: 700, fontSize: 13, fontFamily: mono, letterSpacing: 1.4, border: `1px solid ${C.borderHi}`, textTransform: 'uppercase', cursor: 'pointer' }}>
              RETURN TO SIGN IN
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 800, letterSpacing: -0.8, textTransform: 'uppercase', marginBottom: 6 }}>RESET PASSWORD</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 28 }}>Enter your email and we&apos;ll send a reset link.</div>
            <CheckerBar height={2} />
            <form onSubmit={handleSubmit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1.4, color: C.muted, display: 'block', marginBottom: 6 }}>EMAIL ADDRESS</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} required />
              </div>
              <button type="submit" disabled={loading} style={{ width: '100%', height: 50, borderRadius: 4, border: 'none', background: C.red, color: C.text, fontWeight: 800, fontSize: 13, fontFamily: mono, letterSpacing: 1.4, textTransform: 'uppercase', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'SENDING...' : 'SEND RESET LINK ▸'}
              </button>
            </form>
          </>
        )}
      </div>
    )
  }

  function ResetPasswordScreen() {
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e) => {
      e.preventDefault()
      setError('')

      if (password.length < 8) {
        setError('Password must be at least 8 characters long.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }

      setLoading(true)
      try {
        const { error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) {
          if (updateError.message.includes('expired') || updateError.message.includes('invalid')) {
            setError('This reset link has expired. Please request a new one.')
          } else {
            setError(updateError.message)
          }
        } else {
          setSuccess(true)
          setTimeout(() => {
            updateCurrentScreen('dashboard')
          }, 2000)
        }
      } catch (err) {
        setError('An error occurred. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    const inputStyle = { width: '100%', height: 48, background: C.surface, border: `1px solid ${C.borderHi}`, borderRadius: 4, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', fontSize: 15, padding: '0 14px', outline: 'none' }
    const labelStyle = { fontFamily: mono, fontSize: 10, letterSpacing: 1.4, color: C.muted, display: 'block', marginBottom: 6 }

    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', padding: '28px 24px', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}><CBrand size={24} /></div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontFamily: mono, fontSize: 32, color: C.pos, marginBottom: 16 }}>✓</div>
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>PASSWORD UPDATED</div>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Your password has been reset. Redirecting...</p>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 800, letterSpacing: -0.8, textTransform: 'uppercase', marginBottom: 6 }}>SET NEW PASSWORD</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 28 }}>Enter your new password below.</div>
            <CheckerBar height={2} />
            {error && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: `${C.red}18`, border: `1px solid ${C.red}44`, borderRadius: 4, fontFamily: mono, fontSize: 11, color: C.red }}>
                {error}
                {error.includes('expired') && (
                  <button onClick={() => updateCurrentScreen('forgot-password')}
                    style={{ display: 'block', marginTop: 8, fontFamily: mono, fontSize: 10, color: C.amber, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 0.8 }}>
                    REQUEST NEW RESET LINK →
                  </button>
                )}
              </div>
            )}
            <form onSubmit={handleSubmit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={labelStyle}>NEW PASSWORD</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} minLength={8} required />
              </div>
              <div>
                <label style={labelStyle}>CONFIRM PASSWORD</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" style={inputStyle} minLength={8} required />
                <p style={{ fontFamily: mono, fontSize: 9.5, color: C.faint, marginTop: 6 }}>Must be at least 8 characters.</p>
              </div>
              <button type="submit" disabled={loading} style={{ width: '100%', height: 50, borderRadius: 4, border: 'none', background: C.red, color: C.text, fontWeight: 800, fontSize: 13, fontFamily: mono, letterSpacing: 1.4, textTransform: 'uppercase', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'UPDATING...' : 'UPDATE PASSWORD ▸'}
              </button>
            </form>
          </>
        )}
      </div>
    )
  }

  function LeaguesScreen({ onNavigate, currentScreen }) {
    const [activeFilter, setActiveFilter] = useState('ALL')
    const filters = ['ALL', 'LIVE', 'IN PLAY', 'PUBLIC', 'INVITES']

    const getRowConfig = (l) => {
      const joined = userLeagues.some(ul => ul.id === l.id)
      const ds = getDraftStatus(l)
      if (joined)              return { borderColor: C.red,    pillColor: C.red,    pillLabel: '★ ENTERED', btnBg: 'transparent', btnColor: C.red,  btnBorder: `1px solid ${C.red}55`, btnLabel: 'OPEN ▸' }
      if (ds.status === 'open')    return { borderColor: C.amber,  pillColor: C.amber,  pillLabel: '◉ LIVE',    btnBg: C.red,          btnColor: C.text, btnBorder: 'none',                  btnLabel: 'JOIN ▸' }
      if (ds.status === 'closed')  return { borderColor: '#3a8aef', pillColor: '#3a8aef', pillLabel: '▸ IN PLAY', btnBg: C.surfaceHi,    btnColor: C.muted, btnBorder: 'none',                 btnLabel: 'PREVIEW' }
      return                       { borderColor: C.border,  pillColor: C.muted,  pillLabel: '○ OPENS',   btnBg: C.surfaceHi,    btnColor: C.muted, btnBorder: 'none',                  btnLabel: 'PREVIEW' }
    }

    const handleRowAction = (l) => {
      const joined = userLeagues.some(ul => ul.id === l.id)
      const ds = getDraftStatus(l)
      if (joined) { updateSelectedLeague(l); onNavigate('dashboard') }
      else if (ds.status === 'open') joinLeague(l)
    }

    return (
      <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
        {/* App bar */}
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CBrand size={16} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: C.muted, cursor: 'pointer' }}>SEARCH</span>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: C.red, cursor: 'pointer' }}>+ NEW</span>
            <button onClick={() => supabase.auth.signOut()} style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: C.faint, background: 'none', border: `1px solid ${C.border}`, cursor: 'pointer', padding: '4px 8px', borderRadius: 2 }}>
              OUT
            </button>
          </div>
        </div>
        <CheckerBar height={3} />

        {/* Page title */}
        <div style={{ padding: '20px 18px 12px' }}>
          <div style={{ fontFamily: 'ui-monospace,"JetBrains Mono",monospace', fontSize: 32, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1, textTransform: 'uppercase' }}>
            AUCTIONS
          </div>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: C.muted, marginTop: 6, letterSpacing: 0.5 }}>
            {leagues.length} OPEN · {userLeagues.length} YOU&apos;RE IN
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ padding: '4px 18px 18px', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {filters.map(f => (
            <button key={f} onClick={() => setActiveFilter(f)} style={{ padding: '6px 12px', borderRadius: 3, fontFamily: 'ui-monospace,monospace', fontSize: 10, fontWeight: 700, letterSpacing: 1.2, whiteSpace: 'nowrap', cursor: 'pointer', background: activeFilter === f ? C.text : 'transparent', color: activeFilter === f ? C.bg : C.muted, border: `1px solid ${activeFilter === f ? C.text : C.border}` }}>
              {f}
            </button>
          ))}
        </div>

        {/* League rows */}
        <div style={{ padding: '0 18px 32px' }}>
          {leagues.length === 0 && (
            <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 14, color: C.faint, textAlign: 'center', padding: '48px 0' }}>
              NO ACTIVE AUCTIONS
            </div>
          )}
          {leagues.map(l => {
            const cfg = getRowConfig(l)
            const ds = getDraftStatus(l)
            const timeLabel = ds.status === 'upcoming' ? 'OPENS' : 'CLOSES'
            const timeVal = l.end_date ? calculateTimeLeft(new Date(l.end_date)) : '—'
            return (
              <div key={l.id} style={{ marginBottom: 8, padding: '14px 14px', background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${cfg.borderColor}` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 9.5, letterSpacing: 1.3, fontWeight: 700, color: cfg.pillColor }}>
                    {cfg.pillLabel}
                  </div>
                  <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {l.playerCount || 0} PLY
                  </div>
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, letterSpacing: -0.2 }}>{l.name}</div>
                <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: C.muted }}>
                  ${(l.spending_limit || 175000).toLocaleString()} budget
                </div>
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 9.5, color: C.faint, letterSpacing: 1.2 }}>{timeLabel}</div>
                    <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{timeVal}</div>
                  </div>
                  <button onClick={() => handleRowAction(l)} style={{ height: 36, padding: '0 16px', borderRadius: 3, fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', background: cfg.btnBg, color: cfg.btnColor, border: cfg.btnBorder }}>
                    {cfg.btnLabel}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ height: 80 }} />
        <BottomTabBar screen="leagues" onNavigate={onNavigate} />
      </div>
    )
  }

  function PredictionModal({ car, onClose, onSubmit, currentPrediction }) {
    const [prediction, setPrediction] = useState(currentPrediction ? currentPrediction.toString() : '')
    
    const handleSubmit = (e) => {
      e.preventDefault()
      const price = parseFloat(prediction.replace(/[^0-9.]/g, ''))
      if (isNaN(price) || price <= 0) {
        alert('Please enter a valid price')
        return
      }
      onSubmit(price)
    }
    
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4">
        <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-lg sm:text-2xl font-bold text-bpInk flex items-center gap-2">
              <Zap className="text-bpGold" size={20} />
              Predict the Final Price
            </h2>
            <button onClick={onClose} className="text-bpInk/60 hover:text-bpInk text-2xl">✕</button>
          </div>

          <div className="mb-4 sm:mb-6 p-3 sm:p-4 rounded-lg bg-bpGold/10 border-2 border-bpGold/30">
            <p className="text-xs sm:text-sm text-bpInk/80 mb-1 sm:mb-2">🏆 <strong>BONUS CAR</strong> (Shared by all players)</p>
            <h3 className="font-bold text-base sm:text-lg text-bpInk">{car.title}</h3>
            <p className="text-xs sm:text-sm text-bpInk/70 mt-1">Current Bid: ${car.currentBid.toLocaleString()}</p>
          </div>

          <div className="mb-4 sm:mb-6">
            <img
              src={car.imageUrl}
              alt={car.title}
              className="w-full h-40 sm:h-64 object-cover rounded-lg"
            />
          </div>

          <div className="mb-4 sm:mb-6 p-3 sm:p-4 rounded-lg bg-bpInk/5">
            <p className="text-xs sm:text-sm text-bpInk/80 mb-2">
              <strong>How it works:</strong>
            </p>
            <ul className="text-xs sm:text-sm text-bpInk/70 space-y-1 list-disc list-inside">
              <li>Everyone gets this car's percentage gain</li>
              <li>Closest prediction gets <strong>DOUBLE</strong> the percentage gain</li>
              <li>You can change your prediction anytime during the draft</li>
            </ul>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-semibold text-bpInk mb-2">
              Your Prediction:
            </label>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <input
                type="text"
                value={prediction}
                onChange={(e) => setPrediction(e.target.value)}
                placeholder="Enter final sale price..."
                className="flex-1 px-4 py-3 rounded-md border-2 border-bpNavy/20 text-bpInk text-lg font-semibold"
                autoFocus
              />
              <PrimaryButton type="submit" className="px-6 py-3 sm:py-0">
                {currentPrediction ? 'Update' : 'Submit'}
              </PrimaryButton>
            </div>
          </form>
        </Card>
      </div>
    )
  }

  function CarsScreen({ onNavigate, currentScreen }) {
    const draftStatus = selectedLeague ? getDraftStatus(selectedLeague) : { status: 'open', message: 'Draft Open' }
    const canPick = draftStatus.status === 'open'
    const budgetTotal = selectedLeague?.spending_limit || 200000

    const [filter, setFilter] = useState('ALL')
    const [addingId, setAddingId] = useState(null)
    const [glowIds, setGlowIds] = useState([])
    const [showBonus, setShowBonus] = useState(false)
    const [toast, setToast] = useState(null)

    const animatedBudget = useCountUp(budget, 700)
    const garageIds = new Set(garage.map(c => c.id))
    const budgetPct = Math.max(0, Math.min(100, (budget / budgetTotal) * 100))

    function carStatus(car) {
      const dp = car.baselinePrice || car.currentBid
      if (garageIds.has(car.id)) return 'added'
      if (!canPick) return 'locked'
      if (garage.length >= 7) return 'full'
      if (dp > budget) return 'over'
      return 'available'
    }

    const available = auctions.filter(car => {
      const dp = car.baselinePrice || car.currentBid
      if (filter === 'ADDED') return garageIds.has(car.id)
      if (filter === 'AVAILABLE') return !garageIds.has(car.id) && dp <= budget
      return true
    })

    function showToastMsg(msg) { setToast(msg); setTimeout(() => setToast(null), 2000) }

    async function handleAdd(car) {
      if (garage.length >= 7) return showToastMsg('Garage full — 7 cars max')
      if (garageIds.has(car.id)) return
      const dp = car.baselinePrice || car.currentBid
      if (dp > budget) return showToastMsg(`Need ${fmtK(dp - budget)} more`)
      setAddingId(car.id)
      await addToGarage(car)
      setAddingId(null)
      setGlowIds(prev => [...prev, car.id])
      setTimeout(() => setGlowIds(prev => prev.filter(id => id !== car.id)), 900)
      showToastMsg(`${car.make || car.title} added ✓`)
    }

    function handleRemove(car) {
      const gc = garage.find(c => c.id === car.id)
      if (gc) removeFromGarage(gc)
    }

    // Empty state
    if (!selectedLeague) {
      return (
        <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', minHeight: '100vh', paddingBottom: 80 }}>
          <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center' }}><CBrand size={16} /></div>
          <CheckerBar height={3} />
          <div style={{ padding: '60px 28px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <svg width="52" height="52" viewBox="0 0 52 52" style={{ marginBottom: 18, opacity: 0.4 }}>
              {[0,1,2,3].map(row => [0,1,2,3].map(col => (
                <rect key={`${row}-${col}`} x={col*13} y={row*13} width={13} height={13} fill={(row+col)%2===0 ? C.text : 'transparent'} />
              )))}
            </svg>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.red, letterSpacing: 1.6, marginBottom: 8 }}>{'//'} NO AUCTION SELECTED</div>
            <div style={{ fontFamily: mono, fontSize: 22, fontWeight: 800, letterSpacing: -0.8, textTransform: 'uppercase', marginBottom: 10, lineHeight: 1.1 }}>
              JOIN AN AUCTION<br/>FIRST
            </div>
            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, maxWidth: 260, margin: '0 0 28px' }}>
              Head to Auctions, pick an open league, and join it. Then come back here to choose your 7 cars.
            </p>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
              {[
                { n: '01', t: 'GO TO AUCTIONS', d: 'Find an open league to join', active: false },
                { n: '02', t: 'PICK 7 CARS', d: "You're here — choose your garage", active: true },
                { n: '03', t: 'WATCH THE MARKET', d: 'Live bids update every minute', active: false },
              ].map(s => (
                <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 10, padding: '10px 12px', background: s.active ? `${C.red}12` : C.surface, border: `1px solid ${s.active ? C.red+'44' : C.border}`, opacity: s.active ? 1 : 0.5 }}>
                  <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 800, color: s.active ? C.red : C.faint }}>{s.n}</div>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: s.active ? C.text : C.muted }}>{s.t}</div>
                    <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => onNavigate('leagues')} style={{ height: 50, padding: '0 28px', borderRadius: 4, border: 'none', background: C.red, color: C.text, fontFamily: mono, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', cursor: 'pointer' }}>
              BROWSE AUCTIONS ▸
            </button>
          </div>
          <BottomTabBar screen="cars" onNavigate={onNavigate} />
        </div>
      )
    }

    const leagueName = selectedLeague?.name || 'Sunday Morning Drivers'

    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', paddingBottom: 80 }}>
        {/* Auction context strip */}
        <div style={{ padding: '8px 18px 10px', background: C.surface, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, color: C.muted, letterSpacing: 1.3, marginBottom: 2 }}>{'//'} PICKING CARS FOR</div>
            <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: -0.3 }}>{leagueName}</div>
          </div>
          <button onClick={() => onNavigate('leagues')} style={{ fontFamily: mono, fontSize: 9.5, color: C.muted, letterSpacing: 1, background: 'none', border: `1px solid ${C.border}`, padding: '4px 8px', borderRadius: 3, cursor: 'pointer' }}>
            SWITCH ▸
          </button>
        </div>

        {/* Header */}
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CBrand size={16} />
          <div style={{ fontFamily: mono, fontSize: 9.5, color: canPick ? C.pos : C.muted, letterSpacing: 1.2, display: 'flex', alignItems: 'center', gap: 6 }}>
            {canPick && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.pos, display: 'inline-block', animation: 'bpPulse 1.6s ease-in-out infinite' }} />}
            {canPick ? 'DRAFTING OPEN' : 'DRAFT CLOSED'}
          </div>
        </div>
        <CheckerBar height={3} />

        {/* Budget pit-board */}
        <div style={{ padding: '16px 18px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 9.5, color: C.muted, letterSpacing: 1.3, marginBottom: 4 }}>BUDGET REMAINING</div>
              <div style={{ fontFamily: mono, fontSize: 32, fontWeight: 800, letterSpacing: -1.2, fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: budget < 20000 ? C.red : budget < 40000 ? C.amber : C.text }}>
                {fmtUSD(animatedBudget)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: mono, fontSize: 9.5, color: C.muted, letterSpacing: 1.3, marginBottom: 4 }}>ROSTER</div>
              <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 800, color: garage.length >= 7 ? C.pos : C.text }}>
                {garage.length}<span style={{ color: C.faint }}>/7</span>
              </div>
            </div>
          </div>
          <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${budgetPct}%`, background: budgetPct > 40 ? C.pos : budgetPct > 15 ? C.amber : C.red, transition: 'width 0.7s cubic-bezier(.22,1,.36,1)', borderRadius: 2 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.faint }}>{fmtK(budgetTotal - budget)} SPENT</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.faint }}>{fmtK(budgetTotal)} TOTAL</span>
          </div>
        </div>

        {/* Bonus car */}
        {bonusCar && (
          <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, background: C.surface }}>
            <button onClick={() => setShowBonus(!showBonus)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: mono, fontSize: 9.5, color: C.amber, letterSpacing: 1.3, fontWeight: 700 }}>★ BONUS CAR</span>
                <span style={{ fontFamily: mono, fontSize: 10, color: C.muted }}>{bonusCar.title}</span>
              </div>
              <span style={{ fontFamily: mono, fontSize: 11, color: C.muted, transition: 'transform 0.2s', transform: showBonus ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
            </button>
            {showBonus && (
              <div style={{ marginTop: 12, display: 'flex', gap: 12, animation: 'bpFadeIn 0.15s ease-out' }}>
                <div style={{ width: 88, flexShrink: 0 }}>
                  <CarImg car={bonusCar} height={64} radius={2} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, marginBottom: 4 }}>{bonusCar.title}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: C.muted }}>CURRENT BID</div>
                  <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, marginTop: 1 }}>{fmtUSD(bonusCar.currentBid)}</div>
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => setShowPredictionModal(true)} style={{ height: 30, padding: '0 12px', borderRadius: 3, border: `1px solid ${C.amber}55`, background: `${C.amber}18`, color: C.amber, fontFamily: mono, fontSize: 10, fontWeight: 800, letterSpacing: 1, cursor: 'pointer' }}>
                      {userPrediction ? `PREDICTION: ${fmtUSD(userPrediction)} ✓` : 'MAKE PREDICTION ▸'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filter row */}
        <div style={{ padding: '12px 18px 10px', display: 'flex', gap: 6 }}>
          {['ALL', 'AVAILABLE', 'ADDED'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '5px 10px', borderRadius: 3, fontFamily: mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.1, background: f === filter ? C.text : 'transparent', color: f === filter ? C.bg : C.muted, border: `1px solid ${f === filter ? C.text : C.border}`, cursor: 'pointer' }}>{f}</button>
          ))}
          <div style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 9.5, color: C.faint, alignSelf: 'center' }}>{available.length} LOTS</div>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ padding: '20px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ height: 180, background: C.surface, border: `1px solid ${C.border}`, animation: 'bpPulse 1.6s ease-in-out infinite' }} />
            ))}
          </div>
        )}

        {/* Car grid */}
        {!loading && (
          <div style={{ padding: '2px 18px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {available.map(car => {
              const status = carStatus(car)
              const inGarage = status === 'added'
              const isOver = status === 'over'
              const isFull = status === 'full'
              const isAdding = addingId === car.id
              const isGlowing = glowIds.includes(car.id)
              const dp = car.baselinePrice || car.currentBid

              return (
                <div key={car.id} style={{ background: inGarage ? `${C.red}0a` : C.surface, border: `1px solid ${inGarage ? C.red+'44' : C.border}`, padding: 10, position: 'relative', animation: isGlowing ? 'bpGlow .9s ease-out' : 'none', opacity: isOver && !inGarage ? 0.55 : 1 }}>
                  {isOver && !inGarage && (
                    <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, fontFamily: mono, fontSize: 8, fontWeight: 800, letterSpacing: 1, color: C.amber, background: `${C.amber}22`, padding: '2px 5px', border: `1px solid ${C.amber}44` }}>
                      NEED {fmtK(dp - budget)}
                    </div>
                  )}
                  <CarImg car={car} height={80} radius={2} />
                  <div style={{ fontFamily: mono, fontSize: 9, color: C.muted, letterSpacing: 0.5, marginTop: 7 }}>{car.year} · {(car.make || '').toUpperCase()}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 1, lineHeight: 1.25, height: 28, overflow: 'hidden' }}>{car.title && car.title.replace(`${car.year} `, '')}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 5, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontFamily: mono, fontSize: 9, color: C.faint, letterSpacing: 1 }}>DRAFT</div>
                      <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtK(dp)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: C.faint, letterSpacing: 1 }}>NOW</div>
                      <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: C.pos, fontVariantNumeric: 'tabular-nums' }}>{fmtK(car.currentBid)}</div>
                    </div>
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 9.5, color: C.faint, marginBottom: 8 }}>{car.timeLeft}</div>
                  {inGarage ? (
                    <button onClick={() => handleRemove(car)} style={{ width: '100%', height: 32, borderRadius: 3, border: `1px solid ${C.red}55`, background: 'transparent', color: C.red, fontFamily: mono, fontSize: 10, fontWeight: 800, letterSpacing: 1, cursor: canPick ? 'pointer' : 'default' }}>
                      IN GARAGE ✓
                    </button>
                  ) : (
                    <button onClick={() => handleAdd(car)} disabled={isAdding || isOver || isFull || !canPick} style={{ width: '100%', height: 32, borderRadius: 3, border: 'none', cursor: 'pointer', background: isOver || isFull || !canPick ? C.surfaceHi : C.red, color: isOver || isFull || !canPick ? C.faint : C.text, fontFamily: mono, fontSize: 10, fontWeight: 800, letterSpacing: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: isAdding ? 0.7 : 1 }}>
                      {isAdding ? (
                        <span style={{ display: 'inline-flex', gap: 3 }}>
                          {[0,1,2].map(i => <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: C.text, animation: `bpPulse .8s ease-in-out ${i*0.2}s infinite` }}/>)}
                        </span>
                      ) : !canPick ? 'DRAFT CLOSED' : isFull ? 'FULL' : isOver ? `NEED ${fmtK(dp - budget)}` : 'ADD ▸'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && auctions.length === 0 && (
          <div style={{ padding: '48px 18px', textAlign: 'center', fontFamily: mono, fontSize: 13, color: C.faint }}>
            NO CARS IN THIS LEAGUE YET<br/>
            <span style={{ fontSize: 11, color: C.muted, display: 'block', marginTop: 8 }}>The snapshot may still be loading.</span>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: C.surface, border: `1px solid ${C.borderHi}`, padding: '10px 16px', borderRadius: 4, fontFamily: mono, fontSize: 11, color: C.text, letterSpacing: 0.8, whiteSpace: 'nowrap', zIndex: 100, animation: 'bpFadeIn 0.15s ease-out' }}>
            {toast}
          </div>
        )}

        {showPredictionModal && bonusCar && (
          <PredictionModal
            car={bonusCar}
            onClose={() => setShowPredictionModal(false)}
            onSubmit={submitPrediction}
            currentPrediction={userPrediction}
          />
        )}

        <BottomTabBar screen="cars" onNavigate={onNavigate} />
      </div>
    )

  }

  function GarageScreen({ onNavigate, currentScreen }) {
    const draftStatus = selectedLeague ? getDraftStatus(selectedLeague) : { status: 'open', message: 'Draft Open' }
    const canModify = draftStatus.status === 'open'
    const [prediction, setPrediction] = useState('')
    const [submitted, setSubmitted] = useState(!!userPrediction)
    const [showPredict, setShowPredict] = useState(false)

    const totalCurrentValue = garage.reduce((s, c) => s + (c.currentBid || c.purchasePrice || 0), 0)
    const totalDraftValue   = garage.reduce((s, c) => s + (c.purchasePrice || 0), 0)
    const totalGain         = totalCurrentValue - totalDraftValue
    const slots             = [...garage, ...Array(Math.max(0, 7 - garage.length)).fill(null)]

    function gainColor(g) { return g > 0 ? C.pos : g < 0 ? C.neg : C.muted }

    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', paddingBottom: 80 }}>
        {/* Header */}
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CBrand size={16} />
          <div style={{ fontFamily: mono, fontSize: 10, color: canModify ? C.pos : C.red, letterSpacing: 1.2 }}>
            {canModify ? '🔓 DRAFT OPEN' : '🔒 DRAFT LOCKED'}
          </div>
        </div>
        <CheckerBar height={3} />

        {/* Summary pit-board */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: mono, fontSize: 9.5, color: C.muted, letterSpacing: 1.4, marginBottom: 8 }}>
            {'//'} MY GARAGE{selectedLeague ? ` · ${selectedLeague.name.toUpperCase()}` : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
            {[
              { label: 'ROSTER',   value: `${garage.length}/7`, color: garage.length === 7 ? C.pos : C.text },
              { label: 'BUDGET',   value: fmtK(budget),         color: budget < 20000 ? C.amber : C.text },
              { label: 'NET GAIN', value: (totalGain >= 0 ? '+' : '') + fmtCompact(totalGain), color: gainColor(totalGain) },
            ].map(m => (
              <div key={m.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: 8.5, color: C.faint, letterSpacing: 1.2 }}>{m.label}</div>
                <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 3, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, height: 3, background: C.border, borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${(garage.length / 7) * 100}%`, background: garage.length === 7 ? C.pos : C.red, borderRadius: 2, transition: 'width 0.5s' }} />
          </div>
        </div>

        {/* Car slots */}
        <div style={{ padding: '14px 18px 0' }}>
          <div style={{ fontFamily: mono, fontSize: 9.5, color: C.muted, letterSpacing: 1.6, marginBottom: 10 }}>
            {'//'} ROSTER — {garage.length}/7 SLOTS FILLED
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {slots.map((car, i) => {
              if (!car) {
                return (
                  <div key={`empty-${i}`} style={{ height: 170, border: `1px dashed ${C.border}`, borderRadius: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <div style={{ fontFamily: mono, fontSize: 22, color: C.faint, fontWeight: 800 }}>{String(i + 1).padStart(2, '0')}</div>
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.faint, letterSpacing: 1.2 }}>EMPTY SLOT</div>
                    {canModify && <div style={{ fontFamily: mono, fontSize: 9, color: C.faint }}>DRAFT A CAR</div>}
                  </div>
                )
              }
              const gain = (car.currentBid || car.purchasePrice || 0) - (car.purchasePrice || 0)
              const gainPct = car.purchasePrice > 0 ? ((gain / car.purchasePrice) * 100).toFixed(1) : '0.0'
              return (
                <div key={car.id} style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 10, position: 'relative' }}>
                  <div style={{ fontFamily: mono, fontSize: 9, color: C.red, letterSpacing: 0.8, marginBottom: 5, position: 'absolute', top: 8, right: 8 }}>
                    LOT {String(i + 1).padStart(2, '0')}
                  </div>
                  <CarImg car={car} height={76} radius={2} />
                  <div style={{ fontFamily: mono, fontSize: 8.5, color: C.muted, letterSpacing: 0.5, marginTop: 6 }}>{car.year} · {(car.make || '').toUpperCase()}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 1, lineHeight: 1.25, height: 28, overflow: 'hidden' }}>
                    {car.title && car.title.replace(`${car.year} `, '')}
                  </div>
                  <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <div>
                      <div style={{ fontFamily: mono, fontSize: 8, color: C.faint, letterSpacing: 1 }}>DRAFT</div>
                      <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtK(car.purchasePrice)}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: mono, fontSize: 8, color: C.faint, letterSpacing: 1 }}>NOW</div>
                      <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: gainColor(gain) }}>{fmtK(car.currentBid || car.purchasePrice)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: gainColor(gain), fontVariantNumeric: 'tabular-nums' }}>
                      {gain >= 0 ? '+' : ''}{fmtCompact(gain)}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 10, color: gainColor(gain) }}>({gain >= 0 ? '+' : ''}{gainPct}%)</span>
                  </div>
                  {canModify && (
                    <button onClick={() => removeFromGarage(car)} style={{ marginTop: 7, width: '100%', height: 26, borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.faint, fontFamily: mono, fontSize: 9, letterSpacing: 0.8, cursor: 'pointer' }}>
                      REMOVE
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Bonus car prediction */}
        {bonusCar && (
          <div style={{ margin: '18px 18px 0', padding: '14px', background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.amber}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 9.5, color: C.amber, letterSpacing: 1.3, fontWeight: 700, marginBottom: 3 }}>★ BONUS CAR</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{bonusCar.title}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: mono, fontSize: 8.5, color: C.faint, letterSpacing: 1 }}>CURRENT</div>
                <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{fmtUSD(bonusCar.currentBid)}</div>
              </div>
            </div>
            {submitted || userPrediction ? (
              <div style={{ fontFamily: mono, fontSize: 11, color: C.pos, letterSpacing: 0.8 }}>
                ✓ PREDICTION LOCKED: {fmtUSD(userPrediction || parseInt((prediction || '0').replace(/\D/g,''), 10))}
              </div>
            ) : showPredict ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={prediction} onChange={e => setPrediction(e.target.value)} placeholder="$32,500"
                  style={{ flex: 1, height: 36, background: C.bg, border: `1px solid ${C.borderHi}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 13, padding: '0 10px', outline: 'none' }} />
                <button onClick={() => { const p = parseFloat(prediction.replace(/[^0-9.]/g, '')); if (p > 0) { submitPrediction(p); setSubmitted(true) } }}
                  style={{ height: 36, padding: '0 14px', borderRadius: 3, border: 'none', background: C.amber, color: '#000', fontFamily: mono, fontSize: 10, fontWeight: 800, letterSpacing: 1, cursor: 'pointer' }}>
                  LOCK ▸
                </button>
              </div>
            ) : (
              <button onClick={() => setShowPredict(true)}
                style={{ height: 34, padding: '0 14px', borderRadius: 3, border: `1px solid ${C.amber}55`, background: `${C.amber}18`, color: C.amber, fontFamily: mono, fontSize: 10, fontWeight: 800, letterSpacing: 1, cursor: 'pointer' }}>
                MAKE PREDICTION · 2× SCORE
              </button>
            )}
          </div>
        )}

        <BottomTabBar screen="garage" onNavigate={onNavigate} />
      </div>
    )

  }

  function LeaderboardScreen({ onNavigate, currentScreen }) {
    const [standings, setStandings] = useState([])
    const [loading, setLoading] = useState(true)
    const [sortBy, setSortBy] = useState('total_percent')
    const [, setBonusWinner] = useState(null)
  
    useEffect(() => {
    if (selectedLeague) {
      fetchLeaderboard()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeague])
  if (!selectedLeague && !leagueLoading) {
    return (
      <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ padding: '12px 18px 10px' }}><CBrand size={14} /></div>
        <CheckerBar height={3} />
        <div style={{ padding: '20px 18px' }}>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 32, fontWeight: 800, textTransform: 'uppercase', letterSpacing: -1.2 }}>STANDINGS</div>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 14, color: C.faint, marginTop: 24, textAlign: 'center', paddingTop: 40 }}>
            NO ACTIVE AUCTIONS<br/>
            <button onClick={() => onNavigate('leagues')} style={{ marginTop: 16, height: 40, padding: '0 20px', borderRadius: 3, background: C.red, color: C.text, fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 800, letterSpacing: 1.2, border: 'none', cursor: 'pointer' }}>
              BROWSE AUCTIONS ▸
            </button>
          </div>
        </div>
      </div>
    )
  }

    const fetchLeaderboard = async () => {
      if (!selectedLeague) return
      
      setLoading(true)
      try {
        const { data: members, error: membersError } = await supabase
          .from('league_members')
          .select(`
            user_id,
            total_score,
            users (username, email)
          `)
          .eq('league_id', selectedLeague.id)
        
        if (membersError) throw membersError
        
        if (!members || members.length === 0) {
          setStandings([])
          setLoading(false)
          return
        }
        
        const standingsPromises = members.map(async (member) => {
          const score = await calculateUserScore(member.user_id, selectedLeague.id)
          return {
            userId: member.user_id,
            username: member.users?.username || member.users?.email?.split('@')[0] || 'Unknown',
            ...score
          }
        })
        
        const calculatedStandings = await Promise.all(standingsPromises)
        await findBonusCarWinner(selectedLeague.id, calculatedStandings)
        
        const sorted = sortStandings(calculatedStandings, sortBy)
        setStandings(sorted)
        
      } catch (error) {
        console.error('Error fetching leaderboard:', error)
        setStandings([])
      } finally {
        setLoading(false)
      }
    }

    // NEW SCORING: Total dollar value instead of percentage gain
    const calculateUserScore = async (userId, leagueId) => {
      try {
        const { data: garage } = await supabase
          .from('garages')
          .select('id, remaining_budget')
          .eq('user_id', userId)
          .eq('league_id', leagueId)
          .maybeSingle()

        if (!garage) {
          return {
            totalScore: 0,
            totalFinalValue: 0,
            totalPercentGain: 0,
            totalDollarGain: 0,
            bonusCarScore: null,
            carsCount: 0,
            totalSpent: 0,
            avgPercentPerCar: 0,
            isRosterComplete: false
          }
        }

        const { data: cars } = await supabase
          .from('garage_cars')
          .select(`
            purchase_price,
            auctions!garage_cars_auction_id_fkey (
              auction_id,
              title,
              current_bid,
              final_price,
              price_at_48h,
              timestamp_end
            )
          `)
          .eq('garage_id', garage.id)

        let totalFinalValue = 0
        let totalPercentGain = 0
        let totalDollarGain = 0
        let carsCount = 0
        let totalSpent = 0

        if (cars && cars.length > 0) {
          cars.forEach(car => {
            const auction = car.auctions
            if (!auction) return

            const purchasePrice = parseFloat(car.purchase_price)
            const currentBid = parseFloat(auction.current_bid || purchasePrice)
            const finalPrice = auction.final_price !== null ? parseFloat(auction.final_price) : null

            const now = Math.floor(Date.now() / 1000)
            const auctionEnded = auction.timestamp_end < now

            let finalValue

            // Withdrawn: final_price is explicitly set to 0
            if (finalPrice === 0) {
              finalValue = 0
            }
            // Sold: final_price is set and > 0
            else if (finalPrice !== null && finalPrice > 0) {
              finalValue = finalPrice
            }
            // Reserve not met: auction ended but no final_price
            else if (auctionEnded && finalPrice === null) {
              finalValue = currentBid * 0.25
            }
            // Pending: auction still active - use current bid
            else {
              finalValue = currentBid
            }

            totalFinalValue += finalValue

            // Keep percentage gain for backward compatibility
            const percentGain = purchasePrice > 0 ? ((finalValue - purchasePrice) / purchasePrice) * 100 : 0
            totalPercentGain += percentGain

            const dollarGain = finalValue - purchasePrice
            totalDollarGain += dollarGain

            totalSpent += purchasePrice
            carsCount++
          })
        }

        const bonusScore = await calculateBonusCarScore(userId, leagueId)
        if (bonusScore) {
          totalPercentGain += bonusScore.percentGain

          // If this user is the bonus car winner, add 3x the sale price to their total
          if (bonusScore.isWinner && bonusScore.bonusValue > 0) {
            totalFinalValue += bonusScore.bonusValue
            totalDollarGain += bonusScore.bonusValue
          }
        }

        const avgPercentPerCar = carsCount > 0 ? totalPercentGain / (carsCount + (bonusScore ? 1 : 0)) : 0
        const isRosterComplete = carsCount >= 7

        return {
          totalScore: parseFloat(totalFinalValue.toFixed(2)),
          totalFinalValue: parseFloat(totalFinalValue.toFixed(2)),
          totalPercentGain: parseFloat(totalPercentGain.toFixed(2)),
          totalDollarGain: parseFloat(totalDollarGain.toFixed(2)),
          bonusCarScore: bonusScore,
          carsCount,
          totalSpent: parseFloat(totalSpent.toFixed(2)),
          avgPercentPerCar: parseFloat(avgPercentPerCar.toFixed(2)),
          isRosterComplete
        }

      } catch (error) {
        console.error(`Error calculating score for user ${userId}:`, error)
        return {
          totalScore: 0,
          totalFinalValue: 0,
          totalPercentGain: 0,
          totalDollarGain: 0,
          bonusCarScore: null,
          carsCount: 0,
          totalSpent: 0,
          avgPercentPerCar: 0,
          isRosterComplete: false
        }
      }
    }

    const calculateBonusCarScore = async (userId, leagueId) => {
      try {
        const { data: league } = await supabase
          .from('leagues')
          .select('bonus_auction_id')
          .eq('id', leagueId)
          .single()

        if (!league?.bonus_auction_id) return null

        const { data: prediction } = await supabase
          .from('bonus_predictions')
          .select('predicted_price')
          .eq('league_id', leagueId)
          .eq('user_id', userId)
          .maybeSingle()

        if (!prediction) return null

        const { data: bonusAuction } = await supabase
          .from('auctions')
          .select('current_bid, final_price, price_at_48h')
          .eq('auction_id', league.bonus_auction_id)
          .single()

        if (!bonusAuction) return null

        const baseline = parseFloat(bonusAuction.price_at_48h)
        const finalPrice = bonusAuction.final_price
          ? parseFloat(bonusAuction.final_price)
          : parseFloat(bonusAuction.current_bid)

        const basePercentGain = ((finalPrice - baseline) / baseline) * 100

        const predictedPrice = parseFloat(prediction.predicted_price)
        const predictionError = Math.abs(predictedPrice - finalPrice)
        const percentError = (predictionError / finalPrice) * 100

        // Check if this user is the bonus car winner (closest prediction)
        const { data: allPredictions } = await supabase
          .from('bonus_predictions')
          .select('user_id, predicted_price')
          .eq('league_id', leagueId)

        let isWinner = false
        let bonusValue = 0

        if (allPredictions && allPredictions.length > 0) {
          let smallestError = Infinity
          let winnerId = null

          allPredictions.forEach(pred => {
            const error = Math.abs(parseFloat(pred.predicted_price) - finalPrice)
            if (error < smallestError) {
              smallestError = error
              winnerId = pred.user_id
            }
          })

          if (winnerId === userId) {
            isWinner = true
            bonusValue = finalPrice * 3
          }
        }

        return {
          predicted: predictedPrice,
          actual: finalPrice,
          error: predictionError,
          percentError: parseFloat(percentError.toFixed(2)),
          percentGain: parseFloat(basePercentGain.toFixed(2)),
          bonusValue: parseFloat(bonusValue.toFixed(2)),
          isWinner,
          hasPrediction: true
        }

      } catch (error) {
        console.error('Error calculating bonus car score:', error)
        return null
      }
    }

    const findBonusCarWinner = async (leagueId, standings) => {
      try {
        const { data: league } = await supabase
          .from('leagues')
          .select('bonus_auction_id')
          .eq('id', leagueId)
          .single()
        
        if (!league?.bonus_auction_id) {
          setBonusWinner(null)
          return
        }
        
        const { data: bonusAuction } = await supabase
          .from('auctions')
          .select('final_price, current_bid')
          .eq('auction_id', league.bonus_auction_id)
          .single()
        
        if (!bonusAuction) {
          setBonusWinner(null)
          return
        }
        
        const actualPrice = bonusAuction.final_price 
          ? parseFloat(bonusAuction.final_price)
          : parseFloat(bonusAuction.current_bid)
        
        const playersWithPredictions = standings.filter(s => s.bonusCarScore?.hasPrediction)
        
        if (playersWithPredictions.length === 0) {
          setBonusWinner(null)
          return
        }
        
        const winner = playersWithPredictions.reduce((closest, current) => {
          if (!closest) return current
          return current.bonusCarScore.error < closest.bonusCarScore.error ? current : closest
        }, null)
        
        setBonusWinner({
          username: winner.username,
          predicted: winner.bonusCarScore.predicted,
          actual: actualPrice,
          error: winner.bonusCarScore.error
        })
        
      } catch (error) {
        console.error('Error finding bonus winner:', error)
        setBonusWinner(null)
      }
    }

    // NEW SCORING: Sort by total dollar value as primary, with roster completion priority
    const sortStandings = (standings, sortBy) => {
      const sorted = [...standings]
      switch (sortBy) {
        case 'total_value':
          // Complete rosters rank above incomplete, then by total value
          return sorted.sort((a, b) => {
            if (a.isRosterComplete && !b.isRosterComplete) return -1
            if (!a.isRosterComplete && b.isRosterComplete) return 1
            return b.totalScore - a.totalScore
          })
        case 'total_dollar':
          return sorted.sort((a, b) => b.totalDollarGain - a.totalDollarGain)
        case 'total_percent':
          return sorted.sort((a, b) => b.totalPercentGain - a.totalPercentGain)
        default:
          // Default sort by total value
          return sorted.sort((a, b) => {
            if (a.isRosterComplete && !b.isRosterComplete) return -1
            if (!a.isRosterComplete && b.isRosterComplete) return 1
            return b.totalScore - a.totalScore
          })
      }
    }

    const handleSortChange = (newSort) => {
      setSortBy(newSort)
      setStandings(sortStandings(standings, newSort))
    }

    const me = standings.find(p => p.userId === user?.id)
    const myRank = me ? standings.indexOf(me) + 1 : null
    const p1 = standings[0]
    const gapToP1 = me && p1 ? me.totalScore - p1.totalScore : null
    const sortTabs = [
      { key: 'total_value', label: 'VALUE' },
      { key: 'total_dollar', label: 'NET' },
      { key: 'total_percent', label: 'AVG %' },
    ]

    return (
      <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
        {/* App bar */}
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CBrand size={14} />
          <button onClick={() => supabase.auth.signOut()} style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: C.faint, background: 'none', border: `1px solid ${C.border}`, cursor: 'pointer', padding: '4px 8px', borderRadius: 2 }}>
            OUT
          </button>
        </div>
        <CheckerBar height={3} />

        {/* Eyebrow + title */}
        <div style={{ padding: '18px 18px 8px' }}>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, letterSpacing: 1.6, color: C.red }}>
            {'//'} {selectedLeague?.name?.toUpperCase() || 'STANDINGS'}
          </div>
          <div style={{ fontFamily: 'ui-monospace,"JetBrains Mono",monospace', fontSize: 32, fontWeight: 800, letterSpacing: -1.2, marginTop: 4, textTransform: 'uppercase' }}>
            STANDINGS
          </div>
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div style={{ padding: '12px 18px' }}>
            {[1,2,3,4,5].map(i => (
              <div key={i} style={{ height: 56, background: C.surface, border: `1px solid ${C.border}`, marginBottom: 8, borderRadius: 2, opacity: 0.6 }} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && standings.length === 0 && (
          <div style={{ padding: '48px 18px', textAlign: 'center', fontFamily: 'ui-monospace,monospace', fontSize: 14, color: C.faint }}>
            NO STANDINGS YET<br/>
            <span style={{ fontSize: 11, color: C.muted, marginTop: 8, display: 'block' }}>Draft your garage to appear here.</span>
          </div>
        )}

        {/* Pit-board user card */}
        {!loading && me && (
          <div style={{ margin: '12px 18px 18px', background: C.surface, border: `1px solid ${C.borderHi}`, padding: '14px 16px', borderLeft: `4px solid ${C.red}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, letterSpacing: 1.4, color: C.muted }}>
                P{String(myRank).padStart(2,'0')} · {me.username?.toUpperCase()}
              </div>
              {me.totalDollarGain !== undefined && (
                <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: me.totalDollarGain >= 0 ? C.pos : C.neg, fontWeight: 700 }}>
                  {me.totalDollarGain >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(me.totalDollarGain / 1000)).toFixed(0)}k
                </div>
              )}
            </div>
            <div style={{ fontFamily: 'ui-monospace,"JetBrains Mono",monospace', fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -1, lineHeight: 1 }}>
              ${Math.round(me.totalScore || 0).toLocaleString()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: 'ui-monospace,monospace', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
              <div>
                <div style={{ color: C.faint, fontSize: 9, letterSpacing: 1.2 }}>NET</div>
                <div style={{ color: me.totalDollarGain >= 0 ? C.pos : C.neg, fontWeight: 700, marginTop: 2 }}>
                  {me.totalDollarGain >= 0 ? '+' : ''}${Math.round(me.totalDollarGain || 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: C.faint, fontSize: 9, letterSpacing: 1.2 }}>GAP TO P1</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{gapToP1 !== null ? (gapToP1 >= 0 ? '+' : '') + '$' + Math.abs(Math.round(gapToP1)).toLocaleString() : '—'}</div>
              </div>
              <div>
                <div style={{ color: C.faint, fontSize: 9, letterSpacing: 1.2 }}>ROSTER</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{me.carsCount}/7</div>
              </div>
              <div>
                <div style={{ color: C.faint, fontSize: 9, letterSpacing: 1.2 }}>% GAIN</div>
                <div style={{ color: me.totalPercentGain >= 0 ? C.pos : C.neg, fontWeight: 700, marginTop: 2 }}>
                  {me.totalPercentGain >= 0 ? '+' : ''}{(me.totalPercentGain || 0).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sort tabs */}
        {!loading && standings.length > 0 && (
          <div style={{ margin: '0 18px 8px', display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}` }}>
            {sortTabs.map(tab => (
              <button key={tab.key} onClick={() => handleSortChange(tab.key)} style={{ padding: '8px 12px', fontFamily: 'ui-monospace,monospace', fontSize: 10, fontWeight: 700, letterSpacing: 1.4, cursor: 'pointer', background: 'none', borderBottom: sortBy === tab.key ? `2px solid ${C.red}` : '2px solid transparent', marginBottom: -1, color: sortBy === tab.key ? C.red : C.muted, border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: sortBy === tab.key ? C.red : 'transparent' }}>
                {tab.label}
              </button>
            ))}
            <button onClick={fetchLeaderboard} style={{ marginLeft: 'auto', padding: '8px 10px', fontFamily: 'ui-monospace,monospace', fontSize: 9, color: C.faint, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1 }}>
              ↻ REFRESH
            </button>
          </div>
        )}

        {/* Player rows */}
        {!loading && standings.length > 0 && (
          <div style={{ padding: '0 18px 80px' }}>
            {standings.map((player, index) => {
              const rank = index + 1
              const isMe = player.userId === user?.id
              const positive = player.totalDollarGain >= 0
              return (
                <div key={player.userId} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto 38px', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: `1px solid ${C.border}`, background: isMe ? `${C.red}10` : 'transparent', marginLeft: isMe ? -10 : 0, marginRight: isMe ? -10 : 0, paddingLeft: isMe ? 10 : 0, paddingRight: isMe ? 10 : 0 }}>
                  <div style={{ fontFamily: 'ui-monospace,"JetBrains Mono",monospace', fontSize: 16, fontWeight: 800, color: rank === 1 ? C.amber : rank <= 3 ? C.text : C.muted, fontVariantNumeric: 'tabular-nums' }}>
                    P{String(rank).padStart(2,'0')}
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                      {player.username}
                      {isMe && <span style={{ marginLeft: 6, fontFamily: 'ui-monospace,monospace', fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.red }}>· YOU</span>}
                    </div>
                    <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: C.muted, marginTop: 2, letterSpacing: 0.5 }}>
                      {player.carsCount}/7 LOTS{player.totalPercentGain > 0 ? ` · +${player.totalPercentGain.toFixed(1)}%` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'ui-monospace,"JetBrains Mono",monospace', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      ${(Math.round(player.totalScore || 0) / 1000).toFixed(1)}k
                    </div>
                    <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10.5, fontWeight: 700, color: positive ? C.pos : C.neg, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {positive ? '+' : ''}{fmtCompact(player.totalDollarGain || 0)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 700, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
                    ·
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {selectedLeague && (
          <LeagueChat
            supabase={supabase}
            leagueId={selectedLeague.id}
            leagueName={selectedLeague.name}
            user={user}
            isOpen={isChatOpen}
            onToggle={() => setIsChatOpen(!isChatOpen)}
          />
        )}

        <BottomTabBar screen="leaderboard" onNavigate={onNavigate} />
      </div>
    )
  }

  function DashboardScreenC({ onNavigate }) {
    const now = new Date()
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
    const username = user?.user_metadata?.username || user?.email?.split('@')[0] || 'Driver'

    const totalDraft   = garage.reduce((s, c) => s + (c.purchasePrice || 0), 0)
    const totalCurrent = garage.reduce((s, c) => s + (c.currentBid || c.purchasePrice || 0), 0)
    const totalGain    = totalCurrent - totalDraft
    const bestCar = garage.length > 0 ? garage.reduce((best, c) => {
      const g = (c.currentBid || c.purchasePrice || 0) - (c.purchasePrice || 0)
      const bg = (best.currentBid || best.purchasePrice || 0) - (best.purchasePrice || 0)
      return g > bg ? c : best
    }) : null
    const bestGain = bestCar ? (bestCar.currentBid || bestCar.purchasePrice || 0) - (bestCar.purchasePrice || 0) : 0

    function gainColor(n) { return n > 0 ? C.pos : n < 0 ? C.neg : C.muted }

    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', paddingBottom: 80, minHeight: '100vh' }}>
        {/* Header */}
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CBrand size={16} />
          <div style={{ fontFamily: mono, fontSize: 10, color: C.muted, letterSpacing: 0.8 }}>{timeStr} · {dateStr}</div>
        </div>
        <CheckerBar height={3} />

        {/* Welcome */}
        <div style={{ padding: '14px 18px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: mono, fontSize: 9.5, color: C.muted, letterSpacing: 1.4, marginBottom: 4 }}>{'//'} WELCOME BACK</div>
          <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 800, letterSpacing: -0.8, textTransform: 'uppercase', lineHeight: 1 }}>{username}</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: C.muted, marginTop: 4 }}>
            {selectedLeague ? selectedLeague.name : 'No league — join one to start'}
          </div>
        </div>

        {/* Garage hero card */}
        <div style={{ margin: '14px 18px', background: C.surface, border: `1px solid ${C.borderHi}`, padding: '14px 16px', borderLeft: `4px solid ${C.red}` }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: C.muted, letterSpacing: 1.4, marginBottom: 8 }}>GARAGE OVERVIEW</div>
          <div style={{ fontFamily: mono, fontSize: 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -1, lineHeight: 1 }}>
            {fmtUSD(totalCurrent)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', marginTop: 10, gap: 0 }}>
            {[
              { label: 'NET',    value: (totalGain >= 0 ? '+' : '') + fmtCompact(totalGain), color: gainColor(totalGain) },
              { label: 'ROSTER', value: `${garage.length}/7`, color: garage.length === 7 ? C.pos : C.text },
              { label: 'BUDGET', value: fmtK(budget), color: budget < 20000 ? C.amber : C.text },
              { label: 'LEAGUE', value: selectedLeague ? 'ACTIVE' : '—', color: selectedLeague ? C.pos : C.faint },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontFamily: mono, fontSize: 8, color: C.faint, letterSpacing: 1.2 }}>{s.label}</div>
                <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, marginTop: 2, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ padding: '0 18px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'AUCTION EARNINGS', value: (totalGain >= 0 ? '+' : '') + fmtUSD(totalGain), color: gainColor(totalGain), sub: 'vs draft prices' },
            { label: 'CARS DRAFTED',     value: `${garage.length}/7`, color: garage.length === 7 ? C.pos : C.text, sub: 'roster slots filled' },
          ].map(s => (
            <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`, padding: '12px' }}>
              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.muted, letterSpacing: 1.3, marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.faint, marginTop: 4 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Best performer */}
        {bestCar && (
          <div style={{ margin: '0 18px 14px', background: C.surface, border: `1px solid ${C.amber}44`, padding: '12px', borderLeft: `3px solid ${C.amber}` }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.amber, letterSpacing: 1.3, marginBottom: 8 }}>★ BEST PERFORMER</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 80, flexShrink: 0 }}><CarImg car={bestCar} height={60} radius={2} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>
                  {bestCar.title && bestCar.title.replace(`${bestCar.year} `, '')}
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 8, color: C.faint, letterSpacing: 1 }}>DRAFT</div>
                    <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{fmtK(bestCar.purchasePrice)}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 8, color: C.faint, letterSpacing: 1 }}>NET GAIN</div>
                    <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: gainColor(bestGain) }}>{bestGain >= 0 ? '+' : ''}{fmtCompact(bestGain)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live ticker */}
        {recentUpdates.length > 0 && (
          <div style={{ margin: '0 18px 14px', background: C.surface, border: `1px solid ${C.border}`, padding: '12px' }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.muted, letterSpacing: 1.6, marginBottom: 8 }}>{'//'} LIVE MARKET</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {recentUpdates.slice(0, 4).map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: mono, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 1, color: C.red, width: 52, flexShrink: 0 }}>BID UP</span>
                  <span style={{ flex: 1, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5 }}>{t.carTitle}</span>
                  <span style={{ color: C.pos, fontWeight: 700 }}>+{fmtK(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick links */}
        <div style={{ margin: '0 18px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button onClick={() => onNavigate('leaderboard')} style={{ height: 44, borderRadius: 3, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.1, cursor: 'pointer' }}>
            VIEW STANDINGS ▸
          </button>
          <button onClick={() => onNavigate('cars')} style={{ height: 44, borderRadius: 3, background: C.red, border: 'none', color: C.text, fontFamily: mono, fontSize: 10, fontWeight: 800, letterSpacing: 1.1, cursor: 'pointer' }}>
            PICK CARS ▸
          </button>
        </div>

        <BottomTabBar screen="dashboard" onNavigate={onNavigate} />
      </div>
    )
  }

  function HistoryScreenC({ onNavigate }) {
    const username = user?.user_metadata?.username || user?.email?.split('@')[0] || 'DRIVER'
    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', minHeight: '100vh', paddingBottom: 80 }}>
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <CBrand size={16} />
          <button onClick={() => supabase.auth.signOut()} style={{ fontFamily: mono, fontSize: 10, color: C.faint, background: 'none', border: `1px solid ${C.border}`, cursor: 'pointer', padding: '4px 8px', borderRadius: 2 }}>OUT</button>
        </div>
        <CheckerBar height={3} />
        <div style={{ padding: '14px 18px 8px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: mono, fontSize: 9.5, color: C.red, letterSpacing: 1.6, marginBottom: 4 }}>{'//'} {username.toUpperCase()}</div>
          <div style={{ fontFamily: mono, fontSize: 28, fontWeight: 800, letterSpacing: -1, textTransform: 'uppercase' }}>HISTORY</div>
        </div>
        <UserHistory supabase={supabase} user={user} />
        <BottomTabBar screen="history" onNavigate={onNavigate} />
      </div>
    )
  }

  function DraftResultsScreenC({ onNavigate }) {
    const draftStatus = selectedLeague ? getDraftStatus(selectedLeague) : { status: 'open', message: 'Draft Open' }
    const isDraftOpen = draftStatus.status === 'open'
    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: 'Inter,system-ui,sans-serif', minHeight: '100vh', paddingBottom: 80 }}>
        <div style={{ padding: '12px 18px 10px', display: 'flex', alignItems: 'center' }}><CBrand size={16} /></div>
        <CheckerBar height={3} />
        {isDraftOpen ? (
          <div style={{ padding: '60px 32px', textAlign: 'center' }}>
            <div style={{ fontFamily: mono, fontSize: 48, fontWeight: 800, color: C.red, marginBottom: 12 }}>🔒</div>
            <div style={{ fontFamily: mono, fontSize: 22, fontWeight: 800, letterSpacing: -0.8, textTransform: 'uppercase', marginBottom: 8 }}>PICKS HIDDEN</div>
            <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, maxWidth: 280, margin: '0 auto 24px' }}>
              Draft picks are hidden until the window closes. No copying allowed.
            </div>
            {selectedLeague && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: C.surface, border: `1px solid ${C.amber}44` }}>
                <span style={{ fontFamily: mono, fontSize: 9.5, color: C.amber, letterSpacing: 1.2 }}>STATUS</span>
                <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 800, color: C.amber }}>{draftStatus.message}</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ padding: '14px 18px 10px' }}>
              <div style={{ fontFamily: mono, fontSize: 9.5, color: C.red, letterSpacing: 1.6, marginBottom: 4 }}>{'//'} DRAFT CLOSED</div>
              <div style={{ fontFamily: mono, fontSize: 28, fontWeight: 800, letterSpacing: -1, textTransform: 'uppercase' }}>DRAFT PICKS</div>
            </div>
            <DraftResults supabase={supabase} selectedLeague={selectedLeague} draftStatus={draftStatus} getDefaultCarImage={getDefaultCarImage} />
          </>
        )}
        <BottomTabBar screen="draft-results" onNavigate={onNavigate} />
      </div>
    )
  }

  if (currentScreen === 'landing') return <LandingScreen onGetStarted={() => updateCurrentScreen('login')} />
  if (currentScreen === 'forgot-password') return <ForgotPasswordScreen />
  if (currentScreen === 'reset-password') return <ResetPasswordScreen />
  if (!user) return <LoginScreen />
  if (currentScreen === 'leagues') return <LeaguesScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'dashboard') return <DashboardScreenC onNavigate={updateCurrentScreen} />
  if (currentScreen === 'cars') return <CarsScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'garage') return <GarageScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'leaderboard') return <LeaderboardScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'history') return <HistoryScreenC onNavigate={updateCurrentScreen} />
  if (currentScreen === 'draft-results') return <DraftResultsScreenC onNavigate={updateCurrentScreen} />
  return null
}

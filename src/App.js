import React, { useState, useEffect } from 'react'
import { Car, Trophy, Users, DollarSign, Clock, Star, LogOut, Search, Zap, CheckCircle, TrendingUp, Target, LayoutDashboard, History, ChevronDown, Check, ArrowLeft } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import Dashboard from './components/Dashboard'
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
  const [connectionStatus, setConnectionStatus] = useState('connected')
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
            CALL THE MARKET.<br/>
            <span style={{ color: C.red }}>BEAT THE FIELD.</span>
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
      // If session exists, user is auto-confirmed (email verification disabled)
      // Log them in directly
      if (data.session) {
        setUser(data.user)
        updateCurrentScreen('leagues')
      } else if (data.user && !data.session) {
        // Email verification is required - inform user
        alert('Check your email for verification link!')
      }
    }

    const signIn = async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return alert('Error signing in: '+error.message)
      setUser(data.user)
      updateCurrentScreen('leagues')
    }

    return (
      <div className="min-h-screen bg-gradient-to-b from-bpNavy to-[#0B1220] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          {/* Back to home link */}
          <button
            onClick={() => updateCurrentScreen('landing')}
            className="flex items-center gap-1.5 text-sm text-bpCream/70 hover:text-bpCream mb-6 transition"
          >
            <ArrowLeft size={16} />
            Back to home
          </button>

          {/* Prominent logo above card */}
          <button
            onClick={() => updateCurrentScreen('landing')}
            className="block mx-auto mb-8 text-center cursor-pointer group"
          >
            <div className="text-4xl font-black tracking-tight text-bpCream group-hover:text-bpCream/80 transition">BID PRIX</div>
            <div className="text-xs tracking-[0.18em] text-bpGray/95 uppercase">Race the Market</div>
          </button>

          <Card className="w-full p-8">
            <h1 className="text-xl font-semibold text-bpInk/80 mb-1 text-center">Welcome</h1>
            <p className="text-sm text-bpInk/70 text-center mb-6">Sign in to draft cars and race the market.</p>
            <div className="space-y-3">
              {isSignUp && (
                <input
                  className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk"
                  placeholder="Username"
                  value={username}
                  onChange={e=>setUsername(e.target.value)}
                />
              )}
              <input
                className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk"
                placeholder="Email"
                type="email"
                value={email}
                onChange={handleEmailChange}
              />
              <input
                className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk"
                placeholder="Password"
                type="password"
                value={password}
                onChange={e=>setPassword(e.target.value)}
              />
              {!isSignUp && (
                <div className="text-right">
                  <button
                    onClick={() => updateCurrentScreen('forgot-password')}
                    className="text-sm text-bpInk/60 hover:text-bpInk transition"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
              <PrimaryButton className="w-full" onClick={isSignUp ? signUp : signIn}>
                {isSignUp ? 'Create Account' : 'Sign In'}
              </PrimaryButton>
              <OutlineButton className="w-full text-bpInk" onClick={()=>setIsSignUp(!isSignUp)}>
                {isSignUp ? 'Have an account? Sign in' : 'New here? Create an account'}
              </OutlineButton>
            </div>
          </Card>
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
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        })
        if (error) {
          console.error('Password reset error:', error)
        }
        // Always show success message regardless of whether email exists (security)
        setSubmitted(true)
      } catch (err) {
        console.error('Password reset error:', err)
        setSubmitted(true)
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="min-h-screen bg-gradient-to-b from-bpNavy to-[#0B1220] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <button
            onClick={() => updateCurrentScreen('login')}
            className="flex items-center gap-1.5 text-sm text-bpCream/70 hover:text-bpCream mb-6 transition"
          >
            <ArrowLeft size={16} />
            Back to Sign In
          </button>

          <button
            onClick={() => updateCurrentScreen('landing')}
            className="block mx-auto mb-8 text-center cursor-pointer group"
          >
            <div className="text-4xl font-black tracking-tight text-bpCream group-hover:text-bpCream/80 transition">BID PRIX</div>
            <div className="text-xs tracking-[0.18em] text-bpGray/95 uppercase">Race the Market</div>
          </button>

          <Card className="w-full p-8">
            {submitted ? (
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle size={32} className="text-emerald-600" />
                </div>
                <h1 className="text-xl font-semibold text-bpInk/80 mb-2">Check Your Email</h1>
                <p className="text-sm text-bpInk/70 mb-6">
                  If an account exists with that email, we've sent a password reset link. Check your inbox.
                </p>
                <OutlineButton className="w-full text-bpInk" onClick={() => updateCurrentScreen('login')}>
                  Return to Sign In
                </OutlineButton>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-semibold text-bpInk/80 mb-1 text-center">Reset Password</h1>
                <p className="text-sm text-bpInk/70 text-center mb-6">Enter your email and we'll send you a reset link.</p>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk"
                    placeholder="Email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                  <PrimaryButton className="w-full" type="submit" disabled={loading}>
                    {loading ? 'Sending...' : 'Send Reset Link'}
                  </PrimaryButton>
                </form>
              </>
            )}
          </Card>
        </div>
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

    return (
      <div className="min-h-screen bg-gradient-to-b from-bpNavy to-[#0B1220] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <button
            onClick={() => updateCurrentScreen('landing')}
            className="block mx-auto mb-8 text-center cursor-pointer group"
          >
            <div className="text-4xl font-black tracking-tight text-bpCream group-hover:text-bpCream/80 transition">BID PRIX</div>
            <div className="text-xs tracking-[0.18em] text-bpGray/95 uppercase">Race the Market</div>
          </button>

          <Card className="w-full p-8">
            {success ? (
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle size={32} className="text-emerald-600" />
                </div>
                <h1 className="text-xl font-semibold text-bpInk/80 mb-2">Password Updated</h1>
                <p className="text-sm text-bpInk/70">Your password has been reset successfully. Redirecting...</p>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-semibold text-bpInk/80 mb-1 text-center">Set New Password</h1>
                <p className="text-sm text-bpInk/70 text-center mb-6">Enter your new password below.</p>
                {error && (
                  <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                    {error}
                    {error.includes('expired') && (
                      <button
                        onClick={() => updateCurrentScreen('forgot-password')}
                        className="block mt-2 text-red-800 font-medium underline"
                      >
                        Request a new reset link
                      </button>
                    )}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk"
                    placeholder="New Password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  <input
                    className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk"
                    placeholder="Confirm Password"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  <p className="text-xs text-bpInk/50">Must be at least 8 characters.</p>
                  <PrimaryButton className="w-full" type="submit" disabled={loading}>
                    {loading ? 'Updating...' : 'Update Password'}
                  </PrimaryButton>
                </form>
              </>
            )}
          </Card>
        </div>
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

        {/* Bottom nav */}
        <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-around', padding: '10px 0 16px' }}>
          {[['dashboard','DASH'],['leagues','AUCTIONS'],['leaderboard','RANKS'],['cars','CARS']].map(([s, label]) => (
            <button key={s} onClick={() => onNavigate(s)} style={{ fontFamily: 'ui-monospace,monospace', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: currentScreen === s ? C.red : C.faint, background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase' }}>
              {label}
            </button>
          ))}
        </nav>
        <div style={{ height: 56 }} />
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
    
    return (
      <Shell
        onNavigate={onNavigate}
        currentScreen={currentScreen}
        lastUpdated={lastUpdated}
        connectionStatus={connectionStatus}
        recentUpdates={recentUpdates}
        selectedLeague={selectedLeague}
        onManualRefresh={manualRefresh}
        userLeagues={userLeagues}
        onLeagueChange={updateSelectedLeague}
      >
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div className="flex-1">
            <h2 className="text-2xl font-extrabold tracking-tight">Available Cars</h2>
            <p className="text-sm text-bpCream/70">
              Budget: <span className="font-bold text-bpGold">${budget.toLocaleString()}</span> of ${(selectedLeague?.spending_limit || 200000).toLocaleString()} · <span className="text-bpGold">Min spend ${((selectedLeague?.spending_limit || 200000) / 2 / 1000).toFixed(0)}K to qualify</span>
            </p>
            {/* Budget Progress Bar */}
            {(() => {
              const limit = selectedLeague?.spending_limit || 200000
              const spent = limit - budget
              const spentPercent = Math.min((spent / limit) * 100, 100)
              const halfwayMark = 50
              return (
                <div className="mt-2 mb-1">
                  <div className="relative w-full h-3 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${spentPercent >= halfwayMark ? 'bg-emerald-500' : 'bg-bpGold'}`}
                      style={{ width: `${spentPercent}%` }}
                    />
                    {/* 50% marker */}
                    <div className="absolute top-0 bottom-0 w-0.5 border-l-2 border-dashed border-bpCream/50" style={{ left: '50%' }} />
                  </div>
                  <div className="grid grid-cols-3 mt-1 text-[10px] text-bpCream/50">
                    <span>${spent.toLocaleString()} spent</span>
                    <span className="text-center">50% min</span>
                    <span className="text-right">${limit.toLocaleString()}</span>
                  </div>
                </div>
              )
            })()}

            {!canPick && (
              <div className="mt-2 p-2 rounded bg-bpRed/20 text-sm text-bpCream border border-bpRed/40">
                ⚠️ {draftStatus.message} - You cannot modify your garage
              </div>
            )}
            {canPick && (
              <div className="mt-2 p-2 rounded bg-green-500/20 text-sm text-bpCream border border-green-500/40">
                ✓ {draftStatus.message}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-bpGray"/>
              <input
                className="pl-9 pr-3 py-2 rounded-md bg-white/5 border border-white/10 text-bpCream placeholder:text-bpGray/70"
                placeholder="Search make or model"
              />
            </div>
          </div>
        </div>

        {/* Car Selection Progress */}
        <div className={`mb-4 p-3 sm:p-4 rounded-lg border-2 ${garage.length === 7 ? 'bg-green-500/20 border-green-500/50' : 'bg-bpGold/10 border-bpGold/40'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    i < garage.length
                      ? garage.length === 7 ? 'bg-green-500 border-2 border-green-400 text-white shadow-sm' : 'bg-bpCream border-2 border-bpGold text-bpInk shadow-sm'
                      : 'bg-transparent border-2 border-dashed border-bpCream/30 text-bpCream/40'
                  }`}
                >
                  {i < garage.length ? '✓' : ''}
                </div>
              ))}
            </div>
            <span className={`text-lg sm:text-xl font-extrabold ${garage.length === 7 ? 'text-green-400' : 'text-bpCream'}`}>
              {garage.length}/7
            </span>
          </div>
          <div className="w-full bg-bpNavy/30 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${garage.length === 7 ? 'bg-green-500' : 'bg-bpGold'}`}
              style={{ width: `${(garage.length / 7) * 100}%` }}
            />
          </div>
        </div>

        {bonusCar && (
          <Card className="mb-6 overflow-hidden border-2 border-bpGold/50">
            <div className="bg-gradient-to-r from-bpGold/20 to-bpGold/10 px-4 py-2 border-b border-bpGold/30">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-bpInk flex items-center gap-2">
                  <Zap className="text-bpGold" size={20} />
                  BONUS CAR (Shared by All Players)
                </h3>
                {userPrediction ? (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-semibold">
                    ✓ Predicted: ${userPrediction.toLocaleString()}
                  </span>
                ) : (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded font-semibold animate-pulse">
                    ⚡ Predict to win 3× the sale price!
                  </span>
                )}
              </div>
            </div>
            
            <div className="grid md:grid-cols-2 gap-4 p-4">
              <a 
                href={bonusCar.auctionUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="block aspect-[16/9] w-full bg-bpInk/10 overflow-hidden hover:opacity-90 transition-opacity rounded-lg"
              >
                <img 
                  src={bonusCar.imageUrl} 
                  alt={bonusCar.title} 
                  className="w-full h-full object-cover"
                />
              </a>
              
              <div className="flex flex-col justify-between">
                <div>
                  <a 
                    href={bonusCar.auctionUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="font-bold text-lg text-bpInk hover:underline"
                  >
                    {bonusCar.title}
                  </a>
                  <div className="grid grid-cols-2 gap-2 text-sm text-bpInk/80 mt-3">
                    <div className="flex items-center gap-1">
                      <DollarSign size={14}/> Current: ${bonusCar.currentBid.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock size={14}/> {bonusCar.timeLeft}
                    </div>
                  </div>
                  
                  {userPrediction && (
                    <div className="mt-3 p-2 rounded bg-green-50 text-sm text-green-700">
                      Your prediction: <strong>${userPrediction.toLocaleString()}</strong>
                    </div>
                  )}
                </div>
                
                <PrimaryButton
                  className="w-full mt-4"
                  onClick={() => setShowPredictionModal(true)}
                  disabled={!canPick}
                >
                  {userPrediction ? '✏️ Change Prediction' : '🎯 Make Prediction'}
                </PrimaryButton>
              </div>
            </div>
          </Card>
        )}

        {loading && (
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="overflow-hidden">
                <div className="aspect-[16/9] w-full bg-bpInk/10 animate-pulse" />
                <div className="p-4 space-y-3">
                  <div className="h-5 w-3/4 bg-bpInk/10 rounded animate-pulse" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-4 bg-bpInk/10 rounded animate-pulse" />
                    <div className="h-4 bg-bpInk/10 rounded animate-pulse" />
                  </div>
                  <div className="h-10 bg-bpInk/10 rounded animate-pulse" />
                </div>
              </Card>
            ))}
          </div>
        )}

        {!loading && auctions.length === 0 && (
          <Card className="p-8 text-center text-bpInk/70">
            <p>No cars available in this league yet. The snapshot may still be loading.</p>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {auctions.map(a => {
            const draftPrice = a.baselinePrice || a.currentBid
            const disabled = garage.some((c)=>c.id===a.id) || budget < draftPrice || !canPick
            
            const insufficientBudget = budget < draftPrice && !garage.some(c=>c.id===a.id)
            return (
              <Card key={a.id} className={`overflow-hidden transition-opacity duration-300 ${insufficientBudget ? 'opacity-60' : ''}`}>
                <a
                  href={a.auctionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block aspect-[16/9] w-full bg-bpInk/10 overflow-hidden hover:opacity-90 transition-opacity relative ${insufficientBudget ? 'after:absolute after:inset-0 after:bg-black/20' : ''}`}
                >
                  <img
                    src={a.imageUrl}
                    alt={a.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.target.src = getDefaultCarImage(a.make)
                    }}
                  />
                </a>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <a
                      href={a.auctionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-bpInk hover:underline"
                    >
                      {a.title}
                    </a>
                    <div className="flex gap-1 flex-shrink-0">
                      {a.manually_added && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-purple-500/15 text-purple-700 border border-purple-500/30">
                          <Target size={12}/> Bonus Auction
                        </span>
                      )}
                      {a.trending && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-teal-500/15 text-teal-700">
                          <Star size={12}/> Trending
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-sm text-bpInk/80 mt-2">
                    <div className="flex items-center gap-1">
                      <DollarSign size={14}/> Draft: ${draftPrice.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock size={14}/> {a.timeLeft}
                    </div>
                    <div className="text-bpInk/60">Current: ${a.currentBid.toLocaleString()}</div>
                    {a.custom_end_date && (
                      <div className="text-purple-600 text-xs col-span-2">
                        Custom end: {new Date(a.custom_end_date * 1000).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <PrimaryButton
                    className={`w-full mt-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
                    onClick={() => addToGarage(a)}
                  >
                    {!canPick ? 'Draft Closed' :
                     garage.some(c=>c.id===a.id) ? 'In Garage' : 
                     budget < draftPrice ? 'Insufficient Budget' : 
                     'Add to Garage'}
                  </PrimaryButton>
                </div>
              </Card>
            )
          })}
        </div>

        {showPredictionModal && bonusCar && (
          <PredictionModal
            car={bonusCar}
            onClose={() => setShowPredictionModal(false)}
            onSubmit={submitPrediction}
            currentPrediction={userPrediction}
          />
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
      </Shell>
    )
  }

  function GarageScreen({ onNavigate, currentScreen }) {
    const gain = (purchase, current) => {
      if (!purchase) return 0
      return +(((current - purchase) / purchase) * 100).toFixed(1)
    }
    
    const draftStatus = selectedLeague ? getDraftStatus(selectedLeague) : { status: 'open', message: 'Draft Open' }
    const canModify = draftStatus.status === 'open'
    
    return (
      <Shell
        onNavigate={onNavigate}
        currentScreen={currentScreen}
        lastUpdated={lastUpdated}
        connectionStatus={connectionStatus}
        recentUpdates={recentUpdates}
        selectedLeague={selectedLeague}
        onManualRefresh={manualRefresh}
        userLeagues={userLeagues}
        onLeagueChange={updateSelectedLeague}
      >
        <h2 className="text-2xl font-extrabold tracking-tight mb-3">My Garage</h2>
        <p className="text-sm text-bpCream/70 mb-1">Budget: <span className="font-bold text-bpGold">${budget.toLocaleString()}</span> of ${(selectedLeague?.spending_limit || 200000).toLocaleString()}</p>
        {/* Budget Progress Bar */}
        {(() => {
          const limit = selectedLeague?.spending_limit || 200000
          const spent = limit - budget
          const spentPercent = Math.min((spent / limit) * 100, 100)
          const halfwayMark = 50
          return (
            <div className="mb-3">
              <div className="relative w-full h-3 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${spentPercent >= halfwayMark ? 'bg-emerald-500' : 'bg-bpGold'}`}
                  style={{ width: `${spentPercent}%` }}
                />
                <div className="absolute top-0 bottom-0 w-0.5 border-l-2 border-dashed border-bpCream/50" style={{ left: '50%' }} />
              </div>
              <div className="grid grid-cols-3 mt-1 text-[10px] text-bpCream/50">
                <span>${spent.toLocaleString()} spent</span>
                <span className="text-center">50% min</span>
                <span className="text-right">${limit.toLocaleString()}</span>
              </div>
            </div>
          )
        })()}

        {/* Car Selection Progress */}
        <div className={`mb-4 p-3 sm:p-4 rounded-lg border-2 ${garage.length === 7 ? 'bg-green-500/20 border-green-500/50' : 'bg-bpGold/10 border-bpGold/40'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    i < garage.length
                      ? garage.length === 7 ? 'bg-green-500 border-2 border-green-400 text-white shadow-sm' : 'bg-bpCream border-2 border-bpGold text-bpInk shadow-sm'
                      : 'bg-transparent border-2 border-dashed border-bpCream/30 text-bpCream/40'
                  }`}
                >
                  {i < garage.length ? '✓' : ''}
                </div>
              ))}
            </div>
            <span className={`text-lg sm:text-xl font-extrabold ${garage.length === 7 ? 'text-green-400' : 'text-bpCream'}`}>
              {garage.length}/7
            </span>
          </div>
          <div className="w-full bg-bpNavy/30 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${garage.length === 7 ? 'bg-green-500' : 'bg-bpGold'}`}
              style={{ width: `${(garage.length / 7) * 100}%` }}
            />
          </div>
        </div>

        {!canModify && (
          <div className="mb-4 p-3 rounded bg-bpRed/20 text-sm text-bpCream border border-bpRed/40">
            🔒 {draftStatus.message} - Your garage is locked
          </div>
        )}

        {bonusCar && (
          <Card className="mb-4 p-3 sm:p-4 border-2 border-bpGold/50">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <a
                href={bonusCar.auctionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 hover:opacity-90 transition-opacity"
              >
                <img
                  src={bonusCar.imageUrl}
                  alt={bonusCar.title}
                  className="w-full sm:w-28 h-32 sm:h-20 rounded-lg object-cover"
                />
              </a>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="text-bpGold" size={16} />
                  <span className="text-xs font-semibold text-bpInk/60 uppercase">Bonus Car</span>
                </div>
                <a
                  href={bonusCar.auctionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-bpInk hover:underline"
                >
                  {bonusCar.title}
                </a>
                <div className="grid grid-cols-2 gap-2 text-sm text-bpInk/80 mt-2">
                  {bonusCar.auctionEnded ? (
                    bonusCar.finalPrice > 0 ? (
                      <div className="text-green-700 font-semibold">Final: ${bonusCar.finalPrice.toLocaleString()}</div>
                    ) : bonusCar.finalPrice === 0 ? (
                      <div className="text-bpRed">Withdrawn</div>
                    ) : bonusCar.reserveNotMet ? (
                      <div className="text-bpRed">Reserve Not Met</div>
                    ) : (
                      <div className="text-bpInk/50">Pending</div>
                    )
                  ) : (
                    <div>Current: ${bonusCar.currentBid.toLocaleString()}</div>
                  )}
                  <div>{bonusCar.auctionEnded ? 'Ended' : `${bonusCar.timeLeft} left`}</div>
                </div>
                {userPrediction ? (
                  <div className="mt-2 text-green-700 font-semibold text-sm">
                    Your prediction: ${userPrediction.toLocaleString()}
                  </div>
                ) : (
                  <div className="mt-2 text-yellow-600 text-xs">
                    ⚡ Make a prediction for 3× the sale price!
                  </div>
                )}
                <LightButton
                  className="mt-3 text-sm w-full sm:w-auto"
                  onClick={() => setShowPredictionModal(true)}
                  disabled={!canModify}
                >
                  {userPrediction ? '✏️ Change Prediction' : '🎯 Make Prediction'}
                </LightButton>
              </div>
            </div>
          </Card>
        )}
        
        {/* Browse Cars CTA when garage is empty */}
        {garage.length === 0 && canModify && (
          <div className="mb-6 text-center py-8">
            <Car size={48} className="mx-auto mb-4 text-bpCream/30" />
            <p className="text-bpCream/70 mb-4 text-lg">Your garage is empty. Start building your dream lineup!</p>
            <button
              onClick={() => onNavigate('cars')}
              className="inline-flex items-center justify-center rounded-md px-8 py-3 font-semibold bg-bpCream text-bpInk hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-bpGold/80 transition shadow-lg text-lg"
            >
              Browse Available Cars →
            </button>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 7 }).map((_, i) => {
            const car = garage[i]
            return (
              <Card key={i} className={`p-4 ${car ? '' : 'border-dashed bg-bpCream/70 text-bpInk/60'}`}>
                {car ? (
                  <div className="flex gap-4">
                    <a
                      href={car.auctionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 hover:opacity-90 transition-opacity"
                    >
                      <img
                        src={car.imageUrl}
                        alt={car.title}
                        className="w-28 h-20 rounded-lg object-cover"
                        onError={(e) => {
                          e.target.src = getDefaultCarImage(car.make)
                        }}
                      />
                    </a>
                    <div className="flex-1">
                      <a
                        href={car.auctionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-bpInk hover:underline"
                      >
                        {car.title}
                      </a>
                      <div className="grid grid-cols-2 gap-2 text-sm text-bpInk/80 mt-2">
                        <div>Draft: ${(car.purchasePrice || car.currentBid).toLocaleString()}</div>
                        {car.auctionEnded ? (
                          car.finalPrice > 0 ? (
                            <div className="text-green-700 font-semibold">Final: ${car.finalPrice.toLocaleString()}</div>
                          ) : car.finalPrice === 0 ? (
                            <div className="text-bpRed">Withdrawn</div>
                          ) : car.reserveNotMet ? (
                            <div className="text-bpRed">Reserve Not Met</div>
                          ) : (
                            <div className="text-bpInk/50">Pending</div>
                          )
                        ) : (
                          <div>Current: ${car.currentBid.toLocaleString()}</div>
                        )}
                        <div className={`${gain(car.purchasePrice || car.currentBid, car.finalPrice === 0 ? 0 : (car.finalPrice || car.currentBid)) >= 0 ? 'text-green-700' : 'text-bpRed'}`}>
                          Gain: {gain(car.purchasePrice || car.currentBid, car.finalPrice === 0 ? 0 : (car.finalPrice || car.currentBid)) >= 0 ? '+' : ''}{gain(car.purchasePrice || car.currentBid, car.finalPrice === 0 ? 0 : (car.finalPrice || car.currentBid))}%
                        </div>
                        <div>{car.auctionEnded ? 'Ended' : `${car.timeLeft} left`}</div>
                      </div>
                      {canModify && (
                        <LightButton className="mt-3 text-sm" onClick={()=> removeFromGarage(car)}>
                          Remove
                        </LightButton>
                      )}
                      {!canModify && (
                        <div className="mt-3 text-xs text-bpInk/60">🔒 Locked</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-24">
                    <div className="flex items-center gap-2 text-sm">
                      <Car size={18}/>
                      <span>Empty Slot</span>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
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
        {showPredictionModal && bonusCar && (
          <PredictionModal
            car={bonusCar}
            onClose={() => setShowPredictionModal(false)}
            onSubmit={submitPrediction}
            currentPrediction={userPrediction}
          />
        )}
      </Shell>
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

        {/* Bottom nav */}
        <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-around', padding: '10px 0 16px' }}>
          {[['dashboard','DASH'],['leagues','AUCTIONS'],['leaderboard','RANKS'],['cars','CARS']].map(([s, label]) => (
            <button key={s} onClick={() => onNavigate(s)} style={{ fontFamily: 'ui-monospace,monospace', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: currentScreen === s ? C.red : C.faint, background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase' }}>
              {label}
            </button>
          ))}
        </nav>
      </div>
    )
  }

  if (currentScreen === 'landing') return <LandingScreen onGetStarted={() => updateCurrentScreen('login')} />
  if (currentScreen === 'forgot-password') return <ForgotPasswordScreen />
  if (currentScreen === 'reset-password') return <ResetPasswordScreen />
  if (!user) return <LoginScreen />
  if (currentScreen === 'leagues') return <LeaguesScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'dashboard') return (
    <Shell
      onSignOut={() => supabase.auth.signOut()}
      onNavigate={updateCurrentScreen}
      currentScreen={currentScreen}
      lastUpdated={lastUpdated}
      connectionStatus={connectionStatus}
      recentUpdates={recentUpdates}
      selectedLeague={selectedLeague}
      onManualRefresh={manualRefresh}
      userLeagues={userLeagues}
      onLeagueChange={updateSelectedLeague}
    >
      <Dashboard
        supabase={supabase}
        user={user}
        leagues={userLeagues}
        selectedLeague={selectedLeague}
        onLeagueChange={updateSelectedLeague}
        onNavigate={updateCurrentScreen}
        bonusCar={bonusCar}
        userPrediction={userPrediction}
        draftStatus={selectedLeague ? getDraftStatus(selectedLeague) : null}
      />
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
    </Shell>
  )
  if (currentScreen === 'cars') return <CarsScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'garage') return <GarageScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'leaderboard') return <LeaderboardScreen onNavigate={updateCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'history') return (
    <Shell
      onSignOut={() => supabase.auth.signOut()}
      onNavigate={updateCurrentScreen}
      currentScreen={currentScreen}
      lastUpdated={lastUpdated}
      connectionStatus={connectionStatus}
      selectedLeague={selectedLeague}
      userLeagues={userLeagues}
      onLeagueChange={updateSelectedLeague}
    >
      <UserHistory supabase={supabase} user={user} />
    </Shell>
  )
  if (currentScreen === 'draft-results') return (
    <Shell
      onSignOut={() => supabase.auth.signOut()}
      onNavigate={updateCurrentScreen}
      currentScreen={currentScreen}
      lastUpdated={lastUpdated}
      connectionStatus={connectionStatus}
      selectedLeague={selectedLeague}
      userLeagues={userLeagues}
      onLeagueChange={updateSelectedLeague}
    >
      <DraftResults
        supabase={supabase}
        selectedLeague={selectedLeague}
        draftStatus={selectedLeague ? getDraftStatus(selectedLeague) : null}
        getDefaultCarImage={getDefaultCarImage}
      />
    </Shell>
  )
  return null
}

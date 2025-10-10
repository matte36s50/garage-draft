import React, { useState, useEffect } from 'react'
import { Car, Trophy, Users, DollarSign, Clock, Star, TrendingUp, LogOut, Search } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

/*
  BixPrix Design System (Tailwind-friendly)
  ----------------------------------------
  Palette
    --bp-navy: #1B263B
    --bp-cream: #F9F7F3
    --bp-red: #D64541
    --bp-gold: #C2A14D
    --bp-gray: #B0B3B8
    --bp-ink: #111111

  Typography
    - Headings: bold/extra-bold (system sans or Inter)
    - Body: normal/medium

  Components
    - Buttons: rounded-md (6px), primary navy, hover red, subtle gold focus ring
    - Cards: cream bg on navy surfaces, thin navy border, soft shadow on hover
    - Nav: sticky top, logo shield + wordmark, active tab red underline
*/

// Supabase configuration (keep your keys/env as in your app)
const supabaseUrl = 'https://cjqycykfajaytbrqyncy.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcXljeWtmYWpheXRicnF5bmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5NDU4ODUsImV4cCI6MjA2MzUyMTg4NX0.m2ZPJ0qnssVLrTk1UsIG5NJZ9aVJzoOF2ye4CCOzahA'
const supabase = createClient(supabaseUrl, supabaseKey)

// -------------------------
// Brand primitives
// -------------------------
const BrandLogo: React.FC<{ compact?: boolean }>= ({ compact }) => (
  <div className="flex items-center gap-2 select-none">
    {/* Crest */}
    <svg width="28" height="32" viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg"
         className="drop-shadow-sm">
      <path d="M14 30c6.9 0 12.5-5.6 12.5-12.5V6.8c0-1.5-1.2-2.8-2.8-2.8H4.3C2.8 4 1.5 5.2 1.5 6.8v10.7C1.5 24.4 7.1 30 14 30Z" stroke="#1B263B" strokeWidth="2" fill="#F9F7F3"/>
      {/* diagonal stripes */}
      <path d="M26 17 L10 29 L6.5 29 L26 14.5 Z" fill="#C2A14D" opacity="0.95"/>
      <path d="M26 13.5 L7.5 28.5 L4.5 28.5 L26 11.5 Z" fill="#F9F7F3"/>
      <path d="M26 11 L6 27.5 L4 27.5 L26 9 Z" fill="#D64541"/>
    </svg>
    {/* Wordmark */}
    <div className="leading-tight">
      <div className="font-extrabold tracking-wide text-[20px] text-bpCream">BIXPRIX</div>
      {!compact && (
        <div className="text-[11px] tracking-[0.12em] text-bpGray/90 uppercase">Build Your Dream Garage</div>
      )}
    </div>
  </div>
)

const Shell: React.FC<{ children: React.ReactNode, onSignOut?: () => void }>= ({ children, onSignOut }) => (
  <div className="min-h-screen bg-bpNavy text-bpCream">
    <header className="sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-bpNavy/80 bg-bpNavy border-b border-white/10">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
        <BrandLogo />
        <div className="hidden sm:flex items-center gap-6 text-sm text-bpGray">
          <a className="hover:text-bpCream/90" href="#">Garage</a>
          <a className="hover:text-bpCream/90" href="#">Auctions</a>
          <a className="hover:text-bpCream/90" href="#">Leaderboard</a>
        </div>
        {onSignOut && (
          <button onClick={onSignOut} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-bpCream text-sm">
            <LogOut size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        )}
      </div>
      <div className="h-0.5 bg-bpRed/80"/>
    </header>
    <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    <footer className="border-t border-white/10 mt-10">
      <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-bpGray">
        © {new Date().getFullYear()} BixPrix — Built for enthusiasts.
      </div>
    </footer>
  </div>
)

// Reusable UI
const Card: React.FC<{ children: React.ReactNode, className?: string }>= ({ children, className = '' }) => (
  <div className={`bg-bpCream text-bpInk border border-bpNavy/20 rounded-xl shadow-[0_6px_20px_rgba(0,0,0,0.18)] ${className}`}>{children}</div>
)

const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold bg-bpNavy text-bpCream border border-bpNavy/40 hover:bg-bpRed focus:outline-none focus:ring-2 focus:ring-bpGold/60 active:translate-y-[0.5px] transition ${className}`}
  >
    {children}
  </button>
)

const OutlineButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold border border-bpNavy/40 text-bpCream hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-bpGold/60 transition ${className}`}
  >
    {children}
  </button>
)

// -------------------------
// App
// -------------------------
export default function BixPrixApp() {
  const [currentScreen, setCurrentScreen] = useState<'login'|'leagues'|'cars'|'garage'|'leaderboard'>('login')
  const [user, setUser] = useState<any>(null)
  const [selectedLeague, setSelectedLeague] = useState<any>(null)
  const [garage, setGarage] = useState<any[]>([])
  const [budget, setBudget] = useState<number>(100000)
  const [auctions, setAuctions] = useState<any[]>([])
  const [leagues, setLeagues] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [userGarageId, setUserGarageId] = useState<string|null>(null)

  // --- utils from your existing app (trimmed for brevity but identical behavior)
  const calculateTimeLeft = (endTime: Date | null) => {
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

  const getCarImageUrl = (make?: string) => {
    const map: Record<string,string> = {
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

  // --- data fetching (adapted styles only)
  const fetchAuctions = async () => {
    setLoading(true)
    try {
      const now = Math.floor(Date.now() / 1000)
      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .not('price_at_48h', 'is', null)
        .gt('timestamp_end', now)
        .is('final_price', null)
        .order('timestamp_end', { ascending: true })
        .limit(50)
      if (error) throw error
      const transformed = (data||[]).map((a:any) => {
        const endDate = new Date(a.timestamp_end * 1000)
        const baseline = parseFloat(a.price_at_48h)
        return {
          id: a.auction_id || a.id,
          title: a.title,
          make: a.make,
          model: a.model,
          year: a.year,
          currentBid: parseFloat(a.current_bid) || baseline || 0,
          baselinePrice: baseline,
          day2Price: a.price_at_48h,
          finalPrice: a.final_price,
          timeLeft: calculateTimeLeft(endDate),
          auctionUrl: a.url,
          imageUrl: getCarImageUrl(a.make),
          trending: Math.random() > 0.7,
          endTime: endDate,
        }
      })
      setAuctions(transformed)
    } catch (e) {
      console.error(e)
      setAuctions([])
    } finally { setLoading(false) }
  }

  const fetchLeagues = async () => {
    const { data, error } = await supabase
      .from('leagues')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); setLeagues([]); return }
    setLeagues((data||[]).map(l => ({ ...l, playerCount: 0, status: 'Open' })))
  }

  const fetchUserGarage = async (leagueId: string) => {
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
        const garageCars = cars.map((it:any) => ({
          garageCarId: it.id,
          id: it.auctions?.auction_id || it.auction_id,
          title: it.auctions?.title || 'Unknown Car',
          make: it.auctions?.make || '',
          model: it.auctions?.model || '',
          year: it.auctions?.year || '',
          currentBid: parseFloat(it.auctions?.current_bid) || it.purchase_price,
          purchasePrice: it.purchase_price,
          auctionUrl: it.auctions?.url || '#',
          imageUrl: getCarImageUrl(it.auctions?.make),
          timeLeft: calculateTimeLeft(it.auctions?.timestamp_end ? new Date(it.auctions.timestamp_end * 1000) : null),
        }))
        setGarage(garageCars)
      }
    } else {
      setUserGarageId(null); setBudget(100000); setGarage([])
    }
  }

  const joinLeague = async (league: any) => {
    if (!user) return
    try {
      const { data: existing } = await supabase
        .from('league_members')
        .select('*')
        .eq('league_id', league.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (existing) {
        setSelectedLeague(league); await fetchUserGarage(league.id); setCurrentScreen('cars'); return
      }
      const { data: g, error: ge } = await supabase
        .from('garages')
        .insert([{ user_id: user.id, league_id: league.id, remaining_budget: 100000 }])
        .select()
        .single()
      if (ge) { alert('Error creating garage: '+ge.message); return }
      const { error: me } = await supabase
        .from('league_members')
        .insert([{ league_id: league.id, user_id: user.id, total_score: 0 }])
      if (me) { alert('Error joining league: '+me.message); return }
      setSelectedLeague(league); setUserGarageId(g.id); setBudget(100000); setGarage([]); setCurrentScreen('cars')
    } catch {
      alert('Error joining league')
    }
  }

  const addToGarage = async (auction: any) => {
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

  const removeFromGarage = async (car:any) => {
    const { error: re } = await supabase.from('garage_cars').delete().eq('id', car.garageCarId)
    if (re) { alert('Error removing car: '+re.message); return }
    const newBudget = budget + (car.purchasePrice || car.currentBid)
    const { error: be } = await supabase.from('garages').update({ remaining_budget: newBudget }).eq('id', userGarageId)
    if (be) console.error(be)
    setGarage(garage.filter(c => c.id !== car.id))
    setBudget(newBudget)
  }

  // auth/session simplification for demo
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }}) => {
      if (session) { setUser(session.user); setCurrentScreen('leagues') }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null)
      setCurrentScreen(session ? 'leagues' : 'login')
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => { if (user) { fetchAuctions(); fetchLeagues() } }, [user])
  useEffect(() => { if (selectedLeague && user) fetchUserGarage(selectedLeague.id) }, [selectedLeague, user])

  // -------------------------
  // Screens (styled)
  // -------------------------
  const LoginScreen = () => {
    const [isSignUp, setIsSignUp] = useState(false)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [username, setUsername] = useState('')

    const signUp = async () => {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username }}})
      if (error) return alert('Error signing up: '+error.message)
      if (data.user) alert('Check your email for verification link!')
    }
    const signIn = async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return alert('Error signing in: '+error.message)
      setUser(data.user); setCurrentScreen('leagues')
    }

    return (
      <div className="min-h-screen bg-gradient-to-b from-bpNavy to-[#0E1420] flex items-center justify-center px-4">
        <Card className="w-full max-w-md p-8">
          <div className="flex items-center justify-center mb-6"><BrandLogo /></div>
          <h1 className="text-xl font-semibold text-bpInk/80 mb-1 text-center">Welcome</h1>
          <p className="text-sm text-bpInk/70 text-center mb-6">Sign in to draft cars and build your dream garage.</p>
          <div className="space-y-3">
            {isSignUp && (
              <input className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
            )}
            <input className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <PrimaryButton className="w-full" onClick={isSignUp ? signUp : signIn}>{isSignUp ? 'Create Account' : 'Sign In'}</PrimaryButton>
            <OutlineButton className="w-full" onClick={()=>setIsSignUp(!isSignUp)}>{isSignUp ? 'Have an account? Sign in' : 'New here? Create an account'}</OutlineButton>
          </div>
        </Card>
      </div>
    )
  }

  const LeaguesScreen = () => (
    <Shell onSignOut={()=> supabase.auth.signOut() }>
      <h2 className="text-2xl font-extrabold tracking-tight mb-4">Join a League</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {leagues.length === 0 && (
          <Card className="p-6 text-bpInk/80"><p>No public leagues yet. Check back soon.</p></Card>
        )}
        {leagues.map(l => (
          <Card key={l.id} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-lg text-bpInk">{l.name}</h3>
                <p className="text-sm text-bpInk/70">Ends {new Date(l.end_date).toLocaleDateString()}</p>
              </div>
              <span className="text-[11px] px-2 py-1 rounded bg-bpGold/20 text-bpInk font-semibold">Open</span>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-bpInk/75">
              <span className="flex items-center gap-2"><Users size={16}/> {l.playerCount} players</span>
              <span className="flex items-center gap-2"><Trophy size={16}/> {l.status}</span>
            </div>
            <div className="mt-5">
              <PrimaryButton className="w-full" onClick={() => joinLeague(l)}>Join League</PrimaryButton>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  )

  const CarsScreen = () => (
    <Shell>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">Available Cars</h2>
          <p className="text-sm text-bpCream/70">Budget: ${budget.toLocaleString()} · Garage: {garage.length}/7</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-bpGray"/>
            <input className="pl-9 pr-3 py-2 rounded-md bg-white/5 border border-white/10 text-bpCream placeholder:text-bpGray/70" placeholder="Search make or model"/>
          </div>
        </div>
      </div>

      {loading && <p className="text-bpGray mb-4">Loading auctions…</p>}

      <div className="grid md:grid-cols-2 gap-4">
        {auctions.map(a => {
          const draftPrice = a.baselinePrice || a.currentBid
          const disabled = garage.some((c)=>c.id===a.id) || budget < draftPrice
          return (
            <Card key={a.id} className="overflow-hidden">
              <div className="aspect-[16/9] w-full bg-bpInk/10">
                <img src={a.imageUrl} alt={a.title} className="w-full h-full object-cover"/>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <a href={a.auctionUrl} target="_blank" rel="noreferrer" className="font-bold text-bpInk hover:underline">
                    {a.title}
                  </a>
                  {a.trending && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-bpRed/15 text-bpInk"><Star size={12}/> Trending</span>}
                </div>
                <div className="grid grid-cols-2 gap-y-1 text-sm text-bpInk/80 mt-2">
                  <div className="flex items-center gap-1"><DollarSign size={14}/> Draft: ${draftPrice.toLocaleString()}</div>
                  <div className="flex items-center gap-1"><Clock size={14}/> {a.timeLeft}</div>
                  <div className="text-bpInk/60">Current: ${a.currentBid.toLocaleString()}</div>
                </div>
                <PrimaryButton
                  className={`w-full mt-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
                  onClick={() => addToGarage(a)}
                >
                  {garage.some(c=>c.id===a.id) ? 'In Garage' : budget < draftPrice ? 'Insufficient Budget' : 'Add to Garage'}
                </PrimaryButton>
              </div>
            </Card>
          )
        })}
      </div>
    </Shell>
  )

  const GarageScreen = () => {
    const gain = (purchase:number, current:number) => {
      if (!purchase) return 0
      return +(((current - purchase) / purchase) * 100).toFixed(1)
    }
    return (
      <Shell>
        <h2 className="text-2xl font-extrabold tracking-tight mb-3">My Garage</h2>
        <p className="text-sm text-bpCream/70 mb-5">Budget: ${budget.toLocaleString()} · {garage.length}/7 cars</p>
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 7 }).map((_, i) => {
            const car = garage[i]
            return (
              <Card key={i} className={`p-4 ${car ? '' : 'border-dashed bg-bpCream/70 text-bpInk/60'}`}>
                {car ? (
                  <div className="flex gap-4">
                    <img src={car.imageUrl} alt={car.title} className="w-28 h-20 rounded-lg object-cover"/>
                    <div className="flex-1">
                      <a href={car.auctionUrl} target="_blank" rel="noreferrer" className="font-bold text-bpInk hover:underline">{car.title}</a>
                      <div className="grid grid-cols-2 gap-2 text-sm text-bpInk/80 mt-2">
                        <div>Draft: ${(car.purchasePrice || car.currentBid).toLocaleString()}</div>
                        <div>Current: ${car.currentBid.toLocaleString()}</div>
                        <div className={`${gain(car.purchasePrice || car.currentBid, car.currentBid) >= 0 ? 'text-green-700' : 'text-bpRed'}`}>
                          Gain: {gain(car.purchasePrice || car.currentBid, car.currentBid) >= 0 ? '+' : ''}{gain(car.purchasePrice || car.currentBid, car.currentBid)}%
                        </div>
                        <div>{car.timeLeft} left</div>
                      </div>
                      <OutlineButton className="mt-3" onClick={()=> removeFromGarage(car)}>Remove</OutlineButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-24">
                    <div className="flex items-center gap-2 text-sm"><Car size={18}/><span>Empty Slot</span></div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </Shell>
    )
  }

  const LeaderboardScreen = () => (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-extrabold tracking-tight">Leaderboard</h2>
        <span className="text-sm text-bpCream/70">{selectedLeague?.name || 'Select a League'}</span>
      </div>
      <Card className="p-8 text-bpInk/80 flex items-center justify-center">
        <div className="text-center">
          <Trophy className="mx-auto mb-2 text-bpInk/60"/>
          Rankings will appear here once leagues have active members.
        </div>
      </Card>
    </Shell>
  )

  if (!user) return <LoginScreen />
  if (currentScreen === 'leagues') return <LeaguesScreen />
  if (currentScreen === 'cars') return <CarsScreen />
  if (currentScreen === 'garage') return <GarageScreen />
  if (currentScreen === 'leaderboard') return <LeaderboardScreen />
  return null
}

// Tailwind helper classes via CSS variables (optional — add to your globals.css)
// :root { --bp-navy:#1B263B; --bp-cream:#F9F7F3; --bp-red:#D64541; --bp-gold:#C2A14D; --bp-gray:#B0B3B8; --bp-ink:#111111 }
// .text-bpCream{color:var(--bp-cream)} .text-bpGray{color:var(--bp-gray)} .text-bpInk{color:var(--bp-ink)}
// .bg-bpNavy{background-color:var(--bp-navy)} .bg-bpCream{background-color:var(--bp-cream)} .bg-bpRed{background-color:var(--bp-red)} .bg-bpGold{background-color:var(--bp-gold)}
// .border-bpNavy\/20{border-color:rgba(27,38,59,0.2)}

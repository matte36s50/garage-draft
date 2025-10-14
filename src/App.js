import React, { useState, useEffect } from 'react'
import { Car, Trophy, Users, DollarSign, Clock, Star, LogOut, Search, Zap, CheckCircle, TrendingUp, Target } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cjqycykfajaytbrqyncy.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcXljeWtmYWpheXRicnF5bmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5NDU4ODUsImV4cCI6MjA2MzUyMTg4NX0.m2ZPJ0qnssVLrTk1UsIG5NJZ9aVJzoOF2ye4CCOzahA'
const supabase = createClient(supabaseUrl, supabaseKey)

function BrandLogo({ compact }) {
  return (
    <div className="flex items-center gap-3 select-none">
      <div className="leading-tight">
        <div className="font-extrabold tracking-wide text-[22px] text-bpCream">BIXPRIX</div>
        {!compact && (
          <div className="text-[10px] tracking-[0.18em] text-bpGray/95 uppercase">
            Race the Market
          </div>
        )}
      </div>
    </div>
  )
}

function Shell({ children, onSignOut, onNavigate, currentScreen }) {
  return (
    <div className="min-h-screen bg-bpNavy text-bpCream">
      <header className="sticky top-0 z-40 bg-bpNavy border-b border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <BrandLogo />
          <nav className="hidden sm:flex items-center gap-6 text-sm">
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
              Auctions
            </button>
            <button 
              className={`hover:text-bpCream/90 transition ${currentScreen === 'leaderboard' ? 'text-bpCream font-semibold' : 'text-bpGray'}`}
              onClick={() => onNavigate && onNavigate('leaderboard')}
            >
              Leaderboard
            </button>
          </nav>
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-bpCream text-sm"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
        <div className="h-0.5 bg-bpRed/80" />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      <footer className="border-t border-white/10 mt-10">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-bpGray">
          © {new Date().getFullYear()} BixPrix — Race the Market.
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
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold bg-bpNavy text-bpCream border border-bpNavy/40 hover:bg-bpRed focus:outline-none focus:ring-2 focus:ring-bpGold/80 active:translate-y-[0.5px] transition ${className}`}
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
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold border-2 border-bpNavy/30 text-bpNavy hover:bg-bpNavy hover:text-bpCream focus:outline-none focus:ring-2 focus:ring-bpNavy/60 transition ${className}`}
    >
      {children}
    </button>
  )
}

export default function BixPrixApp() {
  const [currentScreen, setCurrentScreen] = useState('landing')
  const [user, setUser] = useState(null)
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [garage, setGarage] = useState([])
  const [budget, setBudget] = useState(175000)
  const [auctions, setAuctions] = useState([])
  const [leagues, setLeagues] = useState([])
  const [loading, setLoading] = useState(false)
  const [userGarageId, setUserGarageId] = useState(null)
  const [bonusCar, setBonusCar] = useState(null)
  const [userPrediction, setUserPrediction] = useState(null)
  const [showPredictionModal, setShowPredictionModal] = useState(false)

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

  const isDraftOpen = (league) => {
    if (!league.draft_starts_at || !league.draft_ends_at) return true
    const now = new Date()
    const start = new Date(league.draft_starts_at)
    const end = new Date(league.draft_ends_at)
    return now >= start && now <= end
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

  const createLeagueSnapshot = async (leagueId) => {
    console.log(`Creating snapshot for league ${leagueId}...`)
    
    try {
      const now = Math.floor(Date.now() / 1000)
      const { data: availableAuctions, error: auctionError } = await supabase
        .from('auctions')
        .select('auction_id, price_at_48h')
        .not('price_at_48h', 'is', null)
        .gt('timestamp_end', now)
        .is('final_price', null)
        .limit(100)
      
      if (auctionError) {
        console.error('Error fetching auctions for snapshot:', auctionError)
        return false
      }
      
      if (!availableAuctions || availableAuctions.length === 0) {
        console.log('No available auctions to snapshot')
        return false
      }
      
      const leagueCars = availableAuctions.map(a => ({
        league_id: leagueId,
        auction_id: a.auction_id,
        baseline_price: parseFloat(a.price_at_48h)
      }))
      
      const { error: insertError } = await supabase
        .from('league_cars')
        .insert(leagueCars)
      
      if (insertError) {
        console.error('Error creating league snapshot:', insertError)
        return false
      }
      
      const { error: updateError } = await supabase
        .from('leagues')
        .update({ snapshot_created: true })
        .eq('id', leagueId)
      
      if (updateError) {
        console.error('Error updating league:', updateError)
      }
      
      console.log(`Successfully created snapshot with ${leagueCars.length} cars`)
      return true
      
    } catch (error) {
      console.error('Exception creating snapshot:', error)
      return false
    }
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
      
      const now = Math.floor(Date.now() / 1000)
      const { data: auction, error: auctionError } = await supabase
        .from('auctions')
        .select('*')
        .eq('auction_id', league.bonus_auction_id)
        .gt('timestamp_end', now)
        .is('final_price', null)
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

  const fetchAuctions = async () => {
    if (!selectedLeague) {
      console.log('No league selected, cannot fetch auctions')
      return
    }
    
    setLoading(true)
    try {
      const { data: leagueData, error: leagueError } = await supabase
        .from('leagues')
        .select('snapshot_created')
        .eq('id', selectedLeague.id)
        .single()
      
      if (leagueError) throw leagueError
      
      if (!leagueData.snapshot_created) {
        console.log('League has no snapshot yet, creating one...')
        const created = await createLeagueSnapshot(selectedLeague.id)
        if (!created) {
          console.error('Failed to create snapshot')
          setAuctions([])
          setLoading(false)
          return
        }
      }
      
      const { data: leagueCars, error: leagueCarsError } = await supabase
        .from('league_cars')
        .select(`
          auction_id,
          baseline_price,
          auctions (*)
        `)
        .eq('league_id', selectedLeague.id)
      
      if (leagueCarsError) throw leagueCarsError
      
      const transformed = (leagueCars || [])
        .filter(lc => lc.auctions)
        .map((lc) => {
          const a = lc.auctions
          const endDate = new Date(a.timestamp_end * 1000)
          const baseline = lc.baseline_price || parseFloat(a.price_at_48h)
          const imageUrl = a.image_url || getDefaultCarImage(a.make)
          
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
            timeLeft: calculateTimeLeft(endDate),
            auctionUrl: a.url,
            imageUrl: imageUrl,
            trending: Math.random() > 0.7,
            endTime: endDate,
          }
        })
      
      console.log(`Loaded ${transformed.length} cars from league snapshot`)
      setAuctions(transformed)
      
    } catch (e) {
      console.error('Error fetching league auctions:', e)
      setAuctions([])
    } finally { 
      setLoading(false) 
    }
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
          
          return {
            garageCarId: it.id,
            id: auction?.auction_id || it.auction_id,
            title: auction?.title || 'Unknown Car',
            make: auction?.make || '',
            model: auction?.model || '',
            year: auction?.year || '',
            currentBid: parseFloat(auction?.current_bid) || it.purchase_price,
            purchasePrice: it.purchase_price,
            auctionUrl: auction?.url || '#',
            imageUrl: imageUrl,
            timeLeft: calculateTimeLeft(auction?.timestamp_end ? new Date(auction.timestamp_end * 1000) : null),
          }
        })
        setGarage(garageCars)
      }
    } else {
      setUserGarageId(null)
      setBudget(175000)
      setGarage([])
    }
  }

  const joinLeague = async (league) => {
    if (!user) return
    
    const draftStatus = getDraftStatus(league)
    if (draftStatus.status !== 'open') {
      alert(`Cannot join league: ${draftStatus.message}`)
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
        setSelectedLeague(league)
        await fetchUserGarage(league.id)
        await fetchAuctions()
        await fetchBonusCar(league.id)
        await fetchUserPrediction(league.id)
        setCurrentScreen('cars')
        return
      }
      
      const { data: g, error: ge } = await supabase
        .from('garages')
        .insert([{ user_id: user.id, league_id: league.id, remaining_budget: 175000 }])
        .select()
        .single()
      
      if (ge) { alert('Error creating garage: '+ge.message); return }
      
      const { error: me } = await supabase
        .from('league_members')
        .insert([{ league_id: league.id, user_id: user.id, total_score: 0 }])
      
      if (me) { alert('Error joining league: '+me.message); return }
      
      setSelectedLeague(league)
      setUserGarageId(g.id)
      setBudget(175000)
      setGarage([])
      
      await fetchAuctions()
      await fetchBonusCar(league.id)
      await fetchUserPrediction(league.id)
      setCurrentScreen('cars')
      
    } catch (error) {
      console.error('Error joining league:', error)
      alert('Error joining league')
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
    supabase.auth.getSession().then(({ data: { session }}) => {
      if (session) { 
        setUser(session.user)
        setCurrentScreen('leagues')
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null)
      if (session) {
        setCurrentScreen('leagues')
      } else {
        setCurrentScreen('landing')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => { 
    if (user) { 
      fetchLeagues() 
    } 
  }, [user])
  
  useEffect(() => { 
    if (selectedLeague && user) {
      fetchUserGarage(selectedLeague.id)
      fetchAuctions()
      fetchBonusCar(selectedLeague.id)
      fetchUserPrediction(selectedLeague.id)
    }
  }, [selectedLeague, user])

  function LandingScreen({ onGetStarted }) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-bpNavy via-[#0B1220] to-bpNavy">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-40"></div>
          
          <div className="relative mx-auto max-w-5xl px-4 py-20 text-center">
            <div className="mb-8 flex flex-col items-center gap-4">
              <div className="text-center">
                <div className="text-6xl font-black tracking-tight text-bpCream drop-shadow-2xl mb-2">
                  BIXPRIX
                </div>
                <div className="text-2xl tracking-[0.2em] text-bpCream/90 uppercase font-bold">
                  Race the Market
                </div>
              </div>
            </div>
            
            <h1 className="text-4xl sm:text-5xl font-bold text-bpCream mb-6 leading-tight mt-8">
              <span className="bg-gradient-to-r from-bpGold to-bpRed bg-clip-text text-transparent">Fantasy Auto Auctions</span>
            </h1>
            
            <p className="text-xl text-bpCream/80 mb-10 max-w-2xl mx-auto leading-relaxed">
              Draft your dream garage from live Bring a Trailer auctions. Predict prices. Beat the market. Win glory.
            </p>
            
            <div className="flex gap-4 justify-center">
              <PrimaryButton 
                className="px-8 py-4 text-lg"
                onClick={onGetStarted}
              >
                Get Started →
              </PrimaryButton>
              <OutlineButton 
                className="px-8 py-4 text-lg"
                onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Learn More
              </OutlineButton>
            </div>
          </div>
        </div>

        <div id="how-it-works" className="mx-auto max-w-5xl px-4 py-20">
          <h2 className="text-3xl font-bold text-bpCream text-center mb-12">How It Works</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="p-6">
              <div className="w-12 h-12 rounded-full bg-bpNavy flex items-center justify-center mb-4">
                <Users className="text-bpGold" size={24} />
              </div>
              <h3 className="text-xl font-bold text-bpInk mb-3">1. Join a League</h3>
              <p className="text-bpInk/70">
                Create or join a league with friends. Each league runs for one week with live BaT auctions.
              </p>
            </Card>

            <Card className="p-6">
              <div className="w-12 h-12 rounded-full bg-bpNavy flex items-center justify-center mb-4">
                <Car className="text-bpGold" size={24} />
              </div>
              <h3 className="text-xl font-bold text-bpInk mb-3">2. Build Your Garage</h3>
              <p className="text-bpInk/70">
                Draft 7 cars with a $175,000 budget. Lock in your prices on day 2 of each auction. Plus predict the bonus car!
              </p>
            </Card>

            <Card className="p-6">
              <div className="w-12 h-12 rounded-full bg-bpNavy flex items-center justify-center mb-4">
                <Trophy className="text-bpGold" size={24} />
              </div>
              <h3 className="text-xl font-bold text-bpInk mb-3">3. Race the Market</h3>
              <p className="text-bpInk/70">
                Score points based on how much each car appreciates. Highest total score wins!
              </p>
            </Card>
          </div>
        </div>

        <div className="bg-white/5 py-20">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="text-3xl font-bold text-bpCream text-center mb-12">Rules & Scoring</h2>
            
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="text-lg font-bold text-bpInk mb-4 flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-600" />
                  The Basics
                </h3>
                <ul className="space-y-2 text-bpInk/80 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-bpNavy font-bold">•</span>
                    <span><strong>$175,000 budget</strong> - Spend wisely across 7 cars</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-bpNavy font-bold">•</span>
                    <span><strong>24-hour draft window</strong> - Pick your cars when leagues open</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-bpNavy font-bold">•</span>
                    <span><strong>Day 2 prices locked</strong> - Your purchase price is the bid 48 hours into each auction</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-bpNavy font-bold">•</span>
                    <span><strong>Bonus car prediction</strong> - Everyone gets the same 8th car. Predict its final price!</span>
                  </li>
                </ul>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-bold text-bpInk mb-4 flex items-center gap-2">
                  <TrendingUp size={20} className="text-bpRed" />
                  Scoring System
                </h3>
                <ul className="space-y-2 text-bpInk/80 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">+</span>
                    <span><strong>Gain points</strong> from % increase: (Final Price - Day 2 Price) / Day 2 Price × 100</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-600 font-bold">-</span>
                    <span><strong>Reserve not met?</strong> Take 25% of high bid as penalty</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-bpGold font-bold">⚡</span>
                    <span><strong>Bonus car</strong> closest prediction gets DOUBLE the percentage gain!</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-bpNavy font-bold">🏆</span>
                    <span><strong>Win</strong> by having the highest total score across all cars</span>
                  </li>
                </ul>
              </Card>
            </div>

            <Card className="mt-8 p-6 bg-gradient-to-br from-bpGold/10 to-bpRed/10 border-2 border-bpGold/30">
              <h3 className="text-lg font-bold text-bpInk mb-4 flex items-center gap-2">
                <Target size={20} className="text-bpGold" />
                Example: How You Score
              </h3>
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div className="bg-white/50 rounded-lg p-4">
                  <div className="font-bold text-bpInk mb-2">1959 Porsche 356A</div>
                  <div className="text-bpInk/70 space-y-1">
                    <div>Day 2 Price: <strong>$65,000</strong></div>
                    <div>Final Price: <strong>$82,000</strong></div>
                    <div className="text-green-700 font-bold">Score: +26.2%</div>
                  </div>
                </div>
                
                <div className="bg-white/50 rounded-lg p-4">
                  <div className="font-bold text-bpInk mb-2">1991 BMW M3</div>
                  <div className="text-bpInk/70 space-y-1">
                    <div>Day 2 Price: <strong>$42,000</strong></div>
                    <div>Reserve Not Met: <strong>$45,000</strong></div>
                    <div className="text-red-700 font-bold">Score: -11.25%</div>
                    <div className="text-xs">(25% of $45k bid)</div>
                  </div>
                </div>
                
                <div className="bg-gradient-to-br from-bpGold/20 to-bpRed/20 rounded-lg p-4 border-2 border-bpGold">
                  <div className="font-bold text-bpInk mb-2 flex items-center gap-1">
                    <Zap size={16} className="text-bpGold" />
                    Bonus Car
                  </div>
                  <div className="text-bpInk/70 space-y-1">
                    <div>Your Prediction: <strong>$95,000</strong></div>
                    <div>Actual Price: <strong>$92,000</strong></div>
                    <div className="text-bpGold font-bold">Closest! Score: +30% × 2</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-4 py-20 text-center">
          <h2 className="text-4xl font-bold text-bpCream mb-6">
            Ready to Race the Market?
          </h2>
          <p className="text-xl text-bpCream/80 mb-8">
            Join a league, draft your garage, and prove you can predict the market better than anyone.
          </p>
          <PrimaryButton 
            className="px-12 py-4 text-lg"
            onClick={onGetStarted}
          >
            Get Started Now →
          </PrimaryButton>
        </div>

        <div className="border-t border-white/10 py-8">
          <div className="mx-auto max-w-5xl px-4 text-center text-sm text-bpGray">
            <p>© {new Date().getFullYear()} BixPrix. Not affiliated with Bring a Trailer.</p>
          </div>
        </div>
      </div>
    )
  }

  function LoginScreen() {
    const [isSignUp, setIsSignUp] = useState(false)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [username, setUsername] = useState('')

    const signUp = async () => {
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password, 
        options: { data: { username }}
      })
      if (error) return alert('Error signing up: '+error.message)
      if (data.user) alert('Check your email for verification link!')
    }
    
    const signIn = async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return alert('Error signing in: '+error.message)
      setUser(data.user)
      setCurrentScreen('leagues')
    }

    return (
      <div className="min-h-screen bg-gradient-to-b from-bpNavy to-[#0B1220] flex items-center justify-center px-4">
        <Card className="w-full max-w-md p-8">
          <div className="flex items-center justify-center mb-6"><BrandLogo /></div>
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
              onChange={e=>setEmail(e.target.value)} 
            />
            <input 
              className="w-full rounded-md border border-bpNavy/20 bg-white px-3 py-2 text-bpInk" 
              placeholder="Password" 
              type="password" 
              value={password} 
              onChange={e=>setPassword(e.target.value)} 
            />
            <PrimaryButton className="w-full" onClick={isSignUp ? signUp : signIn}>
              {isSignUp ? 'Create Account' : 'Sign In'}
            </PrimaryButton>
            <OutlineButton className="w-full text-bpInk" onClick={()=>setIsSignUp(!isSignUp)}>
              {isSignUp ? 'Have an account? Sign in' : 'New here? Create an account'}
            </OutlineButton>
          </div>
        </Card>
      </div>
    )
  }

  function LeaguesScreen({ onNavigate, currentScreen }) {
    return (
      <Shell onSignOut={() => supabase.auth.signOut()} onNavigate={onNavigate} currentScreen={currentScreen}>
        <h2 className="text-2xl font-extrabold tracking-tight mb-4">Join a League</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {leagues.length === 0 && (
            <Card className="p-6 text-bpInk/80">
              <p>No public leagues yet. Check back soon.</p>
            </Card>
          )}
          {leagues.map(l => {
            const draftStatus = getDraftStatus(l)
            const canJoin = draftStatus.status === 'open'
            
            return (
              <Card key={l.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-lg text-bpInk">{l.name}</h3>
                    <p className="text-sm text-bpInk/70">Ends {new Date(l.end_date).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-[11px] px-2 py-1 rounded font-semibold ${
                    draftStatus.status === 'open' ? 'bg-green-100 text-green-700' :
                    draftStatus.status === 'upcoming' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {draftStatus.status === 'open' ? '🟢 Open' : 
                     draftStatus.status === 'upcoming' ? '🟡 Soon' : 
                     '🔴 Closed'}
                  </span>
                </div>
                
                <div className="mt-3 p-2 rounded bg-bpInk/5 text-sm text-bpInk/80">
                  ⏰ {draftStatus.message}
                </div>
                
                <div className="mt-4 flex items-center justify-between text-sm text-bpInk/75">
                  <span className="flex items-center gap-2"><Users size={16}/> {l.playerCount} players</span>
                  <span className="flex items-center gap-2"><Trophy size={16}/> {l.status || 'Open'}</span>
                </div>
                
                <div className="mt-5">
                  {canJoin ? (
                    <PrimaryButton className="w-full" onClick={() => joinLeague(l)}>
                      Join League
                    </PrimaryButton>
                  ) : (
                    <PrimaryButton className="w-full opacity-50 cursor-not-allowed" disabled>
                      {draftStatus.status === 'upcoming' ? 'Draft Not Started' : 'Draft Closed'}
                    </PrimaryButton>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </Shell>
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
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <Card className="max-w-2xl w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-bpInk flex items-center gap-2">
              <Zap className="text-bpGold" size={24} />
              Predict the Final Price
            </h2>
            <button onClick={onClose} className="text-bpInk/60 hover:text-bpInk text-2xl">✕</button>
          </div>
          
          <div className="mb-6 p-4 rounded-lg bg-bpGold/10 border-2 border-bpGold/30">
            <p className="text-sm text-bpInk/80 mb-2">🏆 <strong>BONUS CAR</strong> (Shared by all players)</p>
            <h3 className="font-bold text-lg text-bpInk">{car.title}</h3>
            <p className="text-sm text-bpInk/70 mt-1">Current Bid: ${car.currentBid.toLocaleString()}</p>
          </div>
          
          <div className="mb-6">
            <img 
              src={car.imageUrl} 
              alt={car.title} 
              className="w-full h-64 object-cover rounded-lg"
            />
          </div>
          
          <div className="mb-6 p-4 rounded-lg bg-bpInk/5">
            <p className="text-sm text-bpInk/80 mb-2">
              <strong>How it works:</strong>
            </p>
            <ul className="text-sm text-bpInk/70 space-y-1 list-disc list-inside">
              <li>Everyone gets this car's percentage gain</li>
              <li>Closest prediction gets <strong>DOUBLE</strong> the percentage gain</li>
              <li>You can change your prediction anytime during the draft</li>
            </ul>
          </div>
          
          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-semibold text-bpInk mb-2">
              Your Prediction:
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={prediction}
                onChange={(e) => setPrediction(e.target.value)}
                placeholder="Enter final sale price..."
                className="flex-1 px-4 py-3 rounded-md border-2 border-bpNavy/20 text-bpInk text-lg font-semibold"
                autoFocus
              />
              <PrimaryButton type="submit" className="px-6">
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
      <Shell onNavigate={onNavigate} currentScreen={currentScreen}>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">Available Cars</h2>
            <p className="text-sm text-bpCream/70">Budget: ${budget.toLocaleString()} · Garage: {garage.length}/7</p>
            
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
                    ⚡ Predict to win 2x points!
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

        {loading && <p className="text-bpGray mb-4">Loading auctions…</p>}

        {!loading && auctions.length === 0 && (
          <Card className="p-8 text-center text-bpInk/70">
            <p>No cars available in this league yet. The snapshot may still be loading.</p>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {auctions.map(a => {
            const draftPrice = a.baselinePrice || a.currentBid
            const disabled = garage.some((c)=>c.id===a.id) || budget < draftPrice || !canPick
            
            return (
              <Card key={a.id} className="overflow-hidden">
                <a 
                  href={a.auctionUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="block aspect-[16/9] w-full bg-bpInk/10 overflow-hidden hover:opacity-90 transition-opacity"
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
                    {a.trending && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-bpRed/15 text-bpInk">
                        <Star size={12}/> Trending
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-sm text-bpInk/80 mt-2">
                    <div className="flex items-center gap-1">
                      <DollarSign size={14}/> Draft: ${draftPrice.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock size={14}/> {a.timeLeft}
                    </div>
                    <div className="text-bpInk/60">Current: ${a.currentBid.toLocaleString()}</div>
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
      <Shell onNavigate={onNavigate} currentScreen={currentScreen}>
        <h2 className="text-2xl font-extrabold tracking-tight mb-3">My Garage</h2>
        <p className="text-sm text-bpCream/70 mb-5">Budget: ${budget.toLocaleString()} · {garage.length}/7 cars</p>
        
        {!canModify && (
          <div className="mb-4 p-3 rounded bg-bpRed/20 text-sm text-bpCream border border-bpRed/40">
            🔒 {draftStatus.message} - Your garage is locked
          </div>
        )}

        {bonusCar && (
          <Card className="mb-4 p-4 border-2 border-bpGold/50">
            <div className="flex gap-4">
              <a 
                href={bonusCar.auctionUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex-shrink-0 hover:opacity-90 transition-opacity"
              >
                <img 
                  src={bonusCar.imageUrl} 
                  alt={bonusCar.title} 
                  className="w-28 h-20 rounded-lg object-cover"
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
                  <div>Current: ${bonusCar.currentBid.toLocaleString()}</div>
                  <div>{bonusCar.timeLeft} left</div>
                  {userPrediction && (
                    <>
                      <div className="col-span-2 text-green-700 font-semibold">
                        Your prediction: ${userPrediction.toLocaleString()}
                      </div>
                    </>
                  )}
                  {!userPrediction && (
                    <div className="col-span-2 text-yellow-600 text-xs">
                      ⚡ Make a prediction for 2x points!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
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
                        <div>Current: ${car.currentBid.toLocaleString()}</div>
                        <div className={`${gain(car.purchasePrice || car.currentBid, car.currentBid) >= 0 ? 'text-green-700' : 'text-bpRed'}`}>
                          Gain: {gain(car.purchasePrice || car.currentBid, car.currentBid) >= 0 ? '+' : ''}{gain(car.purchasePrice || car.currentBid, car.currentBid)}%
                        </div>
                        <div>{car.timeLeft} left</div>
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
      </Shell>
    )
  }

  function LeaderboardScreen({ onNavigate, currentScreen }) {
    return (
      <Shell onNavigate={onNavigate} currentScreen={currentScreen}>
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
  }

  if (currentScreen === 'landing') return <LandingScreen onGetStarted={() => setCurrentScreen('login')} />
  if (!user) return <LoginScreen />
  if (currentScreen === 'leagues') return <LeaguesScreen onNavigate={setCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'cars') return <CarsScreen onNavigate={setCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'garage') return <GarageScreen onNavigate={setCurrentScreen} currentScreen={currentScreen} />
  if (currentScreen === 'leaderboard') return <LeaderboardScreen onNavigate={setCurrentScreen} currentScreen={currentScreen} />
  return null
}

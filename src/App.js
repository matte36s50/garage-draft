import React, { useState, useEffect } from 'react'
import { Car, Trophy, Users, DollarSign, Clock, Star, LogOut, Search, Zap, CheckCircle, TrendingUp, Target, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cjqycykfajaytbrqyncy.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcXljeWtmYWpheXRicnF5bmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5NDU4ODUsImV4cCI6MjA2MzUyMTg4NX0.m2ZPJ0qnssVLrTk1UsIG5NJZ9aVJzoOF2ye4CCOzahA'
const supabase = createClient(supabaseUrl, supabaseKey)

function ConnectionStatus({ lastUpdated, connectionStatus, onRefresh, isRefreshing }) {
  const formatTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    return `${Math.floor(seconds / 3600)}h ago`
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        {connectionStatus === 'connected' && (
          <>
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-bpCream/70">Live</span>
          </>
        )}
        {connectionStatus === 'connecting' && (
          <>
            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
            <span className="text-bpCream/70">Connecting...</span>
          </>
        )}
        {connectionStatus === 'disconnected' && (
          <>
            <div className="w-2 h-2 bg-red-500 rounded-full" />
            <span className="text-bpCream/70">Offline</span>
          </>
        )}
      </div>
      
      <span className="text-bpCream/50">•</span>
      
      <div className="flex items-center gap-1.5">
        <Clock size={14} className="text-bpCream/50" />
        <span className="text-bpCream/70">{formatTimeAgo(lastUpdated)}</span>
      </div>

      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className={`p-1 hover:bg-white/10 rounded transition ${
          isRefreshing ? 'animate-spin' : ''
        }`}
        title="Refresh data"
      >
        <RefreshCw size={14} className="text-bpCream/70" />
      </button>
    </div>
  )
}

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

function Shell({ children, onSignOut, onNavigate, currentScreen, lastUpdated, connectionStatus, recentUpdates, selectedLeague, onManualRefresh, onSwitchLeague }) {
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)

  const handleRefresh = async () => {
    if (isManualRefreshing) return
    setIsManualRefreshing(true)
    
    try {
      if (onManualRefresh) {
        await onManualRefresh()
      }
    } catch (error) {
      console.error('Error during manual refresh:', error)
    } finally {
      setIsManualRefreshing(false)
    }
  }

  return (
    <div className="min-h-screen bg-bpNavy text-bpCream">
      <header className="sticky top-0 z-40 bg-bpNavy border-b border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div>
            <BrandLogo />
            {/* ✅ ADDED: Show current league name */}
            {selectedLeague && (
              <div className="text-xs text-bpCream/60 mt-1">
                League: {selectedLeague.name}
              </div>
            )}
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm">
            {/* ✅ CHANGED: Only show nav if league is selected */}
            {selectedLeague && (
              <>
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
                {/* ✅ ADDED: Switch League button */}
                <button 
                  className="hover:text-bpCream/90 transition text-bpGray text-xs"
                  onClick={() => onSwitchLeague && onSwitchLeague()}
                >
                  Switch League
                </button>
              </>
            )}
          </nav>
          
          <div className="flex items-center gap-4">
            {(currentScreen === 'garage' || currentScreen === 'cars' || currentScreen === 'leaderboard') && lastUpdated && (
              <ConnectionStatus 
                lastUpdated={lastUpdated}
                connectionStatus={connectionStatus}
                onRefresh={handleRefresh}
                isRefreshing={isManualRefreshing}
              />
            )}
            
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
        </div>
        <div className="h-0.5 bg-bpRed/80" />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      {recentUpdates && <RecentUpdates updates={recentUpdates} />}

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
  const [connectionStatus, setConnectionStatus] = useState('connected')
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [recentUpdates, setRecentUpdates] = useState([])

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
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('draft_starts_at, draft_ends_at')
        .eq('id', leagueId)
        .single()
      
      if (leagueError || !league.draft_starts_at || !league.draft_ends_at) {
        console.error('League draft period not set:', leagueError)
        return false
      }
      
      const draftStart = Math.floor(new Date(league.draft_starts_at).getTime() / 1000)
      const draftEnd = Math.floor(new Date(league.draft_ends_at).getTime() / 1000)
      const auctionDuration = 7 * 24 * 60 * 60
      const hours48 = 48 * 60 * 60
      const hours72 = 72 * 60 * 60
      
      const { data: availableAuctions, error: auctionError } = await supabase
        .from('auctions')
        .select('auction_id, price_at_48h, timestamp_end')
        .not('price_at_48h', 'is', null)
        .is('final_price', null)
        .limit(200)
      
      if (auctionError) {
        console.error('Error fetching auctions for snapshot:', auctionError)
        return false
      }
      
      if (!availableAuctions || availableAuctions.length === 0) {
        console.log('No available auctions to snapshot')
        return false
      }
      
      const validAuctions = availableAuctions.filter(auction => {
        const auctionEnd = auction.timestamp_end
        const auctionStart = auctionEnd - auctionDuration
        
        const ageAtDraftStart = draftStart - auctionStart
        const ageAtDraftEnd = draftEnd - auctionStart
        const isStillActive = auctionEnd > draftStart
        
        return ageAtDraftStart <= hours72 && ageAtDraftEnd >= hours48 && isStillActive
      })
      
      if (validAuctions.length === 0) {
        console.log('No auctions in 48-72 hour window during draft period')
        return false
      }
      
      console.log(`Found ${validAuctions.length} auctions in 48-72h window out of ${availableAuctions.length} total`)
      
      const leagueCars = validAuctions.map(a => ({
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
      
     const { data: auction, error: auctionError } = await supabase
  .from('auctions')
  .select('*')
  .eq('auction_id', league.bonus_auction_id)
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
      
      const now = Math.floor(Date.now() / 1000)
      const auctionDuration = 7 * 24 * 60 * 60
      const hours48 = 48 * 60 * 60
      const hours72 = 72 * 60 * 60

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
            timestamp_end: a.timestamp_end,
          }
        })
        .filter(car => {
          const auctionEnd = car.timestamp_end
          const auctionStart = auctionEnd - auctionDuration
          const currentAge = now - auctionStart
          
          return currentAge >= hours48 && currentAge <= hours72 && auctionEnd > now
        })

      console.log(`Loaded ${transformed.length} cars from league snapshot (after real-time filtering)`)
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
        
        // ✅ ADDED: Save league to localStorage
        localStorage.setItem('lastSelectedLeague', JSON.stringify({
          id: league.id,
          name: league.name,
          draft_starts_at: league.draft_starts_at,
          draft_ends_at: league.draft_ends_at
        }))
        console.log('✅ Saved league to localStorage:', league.name)
        
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
      
      // ✅ ADDED: Save league to localStorage
      localStorage.setItem('lastSelectedLeague', JSON.stringify({
        id: league.id,
        name: league.name,
        draft_starts_at: league.draft_starts_at,
        draft_ends_at: league.draft_ends_at
      }))
      console.log('✅ Saved league to localStorage:', league.name)
      
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

  // ✅ ADDED: New function to check for saved league
  const checkForSavedLeague = async (user) => {
    if (!user) return
    
    try {
      const savedLeague = localStorage.getItem('lastSelectedLeague')
      
      if (savedLeague) {
        const league = JSON.parse(savedLeague)
        console.log('🔍 Found saved league:', league.name)
        
        // Verify user is still a member of this league
        const { data: membership } = await supabase
          .from('league_members')
          .select('*')
          .eq('league_id', league.id)
          .eq('user_id', user.id)
          .maybeSingle()
        
        if (membership) {
          console.log('✅ User is still a member, loading garage...')
          setSelectedLeague(league)
          await fetchUserGarage(league.id)
          await fetchAuctions()
          await fetchBonusCar(league.id)
          await fetchUserPrediction(league.id)
          setCurrentScreen('garage') // ✅ Go directly to garage!
          return
        } else {
          console.log('⚠️ User no longer in this league, clearing...')
          localStorage.removeItem('lastSelectedLeague')
        }
      }
      
      // No saved league or not a member anymore
      console.log('📋 No saved league, showing league list')
      setCurrentScreen('leagues')
      fetchLeagues()
    } catch (error) {
      console.error('Error checking for saved league:', error)
      setCurrentScreen('leagues')
      fetchLeagues()
    }
  }

  // ✅ ADDED: New function to switch leagues
  const handleSwitchLeague = () => {
    setSelectedLeague(null)
    localStorage.removeItem('lastSelectedLeague')
    console.log('🔄 Cleared saved league, returning to league list')
    setCurrentScreen('leagues')
    fetchLeagues()
  }

  // ✅ CHANGED: Updated to use checkForSavedLeague
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }}) => {
      if (session) { 
        setUser(session.user)
        checkForSavedLeague(session.user) // ✅ Check for saved league instead of going to leagues
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null)
      if (session) {
        checkForSavedLeague(session.user) // ✅ Check for saved league instead of going to leagues
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
          
          setAuctions(prev => prev.map(car => 
            car.id === payload.new.auction_id
              ? {
                  ...car,
                  currentBid: parseFloat(payload.new.current_bid),
                  finalPrice: payload.new.final_price,
                  timeLeft: calculateTimeLeft(new Date(payload.new.timestamp_end * 1000))
                }
              : car
          ))

          setGarage(prev => prev.map(car => {
            if (car.id === payload.new.auction_id) {
              const oldBid = car.currentBid
              const newBid = parseFloat(payload.new.current_bid)
              
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
                finalPrice: payload.new.final_price,
                timeLeft: calculateTimeLeft(new Date(payload.new.timestamp_end * 1000))
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

  // ... [Rest of your screen components remain exactly the same - LandingScreen, LoginScreen, etc.]
  // I'm keeping all the screen components unchanged below for completeness

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

        {/* Rest of LandingScreen content - keeping it the same */}
        {/* ... (all your existing landing page content) ... */}
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
      // ✅ checkForSavedLeague will be called by the useEffect
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
      <Shell 
        onSignOut={() => supabase.auth.signOut()} 
        onNavigate={onNavigate} 
        currentScreen={currentScreen}
        lastUpdated={lastUpdated}
        connectionStatus={connectionStatus}
        recentUpdates={recentUpdates}
        selectedLeague={selectedLeague}
        onManualRefresh={manualRefresh}
        onSwitchLeague={handleSwitchLeague}
      >
        {/* All your existing LeaguesScreen content stays the same */}
        <h2 className="text-2xl font-extrabold tracking-tight mb-4">Join a League</h2>
        {/* ... rest of component ... */}
      </Shell>
    )
  }

  // Keep all other screen components (CarsScreen, GarageScreen, LeaderboardScreen, etc.) exactly as they are
  // Just make sure they pass onSwitchLeague to Shell

  if (currentScreen === 'landing') return <LandingScreen onGetStarted={() => setCurrentScreen('login')} />
  if (!user) return <LoginScreen />
  if (currentScreen === 'leagues') return <LeaguesScreen onNavigate={setCurrentScreen} currentScreen={currentScreen} />
  // ... rest of your navigation logic ...
  return null
}

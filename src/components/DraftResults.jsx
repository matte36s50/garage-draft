import React, { useState, useEffect } from 'react'
import { Users, Car, Lock, RefreshCw } from 'lucide-react'

function DraftResults({ supabase, selectedLeague, draftStatus, getDefaultCarImage }) {
  const [view, setView] = useState('byAuction') // 'byAuction' | 'byPlayer'
  const [byAuction, setByAuction] = useState([]) // [{ auction, pickers: [{username, purchase_price}] }]
  const [byPlayer, setByPlayer] = useState([])   // [{ username, cars: [{auction, purchase_price}] }]
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const isDraftClosed = draftStatus?.status === 'closed'

  useEffect(() => {
    if (isDraftClosed && selectedLeague) {
      fetchDraftResults()
    }
  }, [selectedLeague?.id, isDraftClosed]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchDraftResults() {
    setLoading(true)
    setError(null)
    try {
      const { data: garages, error: err } = await supabase
        .from('garages')
        .select(`
          id,
          user_id,
          users!garages_user_id_fkey(username),
          garage_cars(
            purchase_price,
            auctions!garage_cars_auction_id_fkey(
              auction_id, title, make, model, year,
              image_url, url, current_bid, final_price, timestamp_end
            )
          )
        `)
        .eq('league_id', selectedLeague.id)

      if (err) throw err

      // Build by-player list
      const players = (garages || []).map(g => ({
        username: g.users?.username || 'Unknown',
        cars: (g.garage_cars || [])
          .filter(gc => gc.auctions)
          .map(gc => ({
            auction: gc.auctions,
            purchase_price: gc.purchase_price,
          }))
          .sort((a, b) => (b.purchase_price || 0) - (a.purchase_price || 0)),
      })).sort((a, b) => b.cars.length - a.cars.length)

      setByPlayer(players)

      // Build by-auction map
      const auctionMap = {}
      for (const g of garages || []) {
        const username = g.users?.username || 'Unknown'
        for (const gc of g.garage_cars || []) {
          if (!gc.auctions) continue
          const id = gc.auctions.auction_id
          if (!auctionMap[id]) {
            auctionMap[id] = { auction: gc.auctions, pickers: [] }
          }
          auctionMap[id].pickers.push({
            username,
            purchase_price: gc.purchase_price,
          })
        }
      }

      const auctionList = Object.values(auctionMap).sort(
        (a, b) => b.pickers.length - a.pickers.length || (b.auction.current_bid || 0) - (a.auction.current_bid || 0)
      )
      setByAuction(auctionList)
    } catch (e) {
      setError('Failed to load draft picks. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function formatPrice(price) {
    if (!price && price !== 0) return '—'
    return '$' + Math.round(price).toLocaleString()
  }

  function getCarImage(auction) {
    if (auction.image_url) return auction.image_url
    if (getDefaultCarImage) return getDefaultCarImage(auction.make)
    return null
  }

  function getStatus(auction) {
    const now = Math.floor(Date.now() / 1000)
    if (auction.final_price != null) {
      return auction.final_price > 0
        ? { label: 'Sold', value: formatPrice(auction.final_price), color: 'text-green-700' }
        : { label: 'Reserve Not Met', value: '', color: 'text-bpRed' }
    }
    if (auction.timestamp_end && now > auction.timestamp_end) {
      return { label: 'Ended', value: formatPrice(auction.current_bid), color: 'text-bpGray' }
    }
    return { label: 'Live', value: formatPrice(auction.current_bid), color: 'text-bpInk' }
  }

  // --- Locked state ---
  if (!isDraftClosed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <Lock className="text-bpGold mb-4" size={48} />
        <h3 className="text-xl font-extrabold text-bpCream mb-2">Draft Still Open</h3>
        <p className="text-bpCream/60 max-w-sm">
          Draft picks are hidden until the draft window closes — so no one can copy anyone else.
          Check back once the draft ends to see what everyone selected.
        </p>
        {draftStatus?.message && (
          <div className="mt-4 px-4 py-2 bg-bpGold/10 border border-bpGold/30 rounded-lg text-bpGold text-sm font-semibold">
            {draftStatus.message}
          </div>
        )}
      </div>
    )
  }

  if (!selectedLeague) {
    return (
      <div className="text-center py-16 text-bpCream/50">
        <Users size={40} className="mx-auto mb-3" />
        <p>Select an auction to view draft picks.</p>
      </div>
    )
  }

  const totalPicks = byAuction.reduce((sum, a) => sum + a.pickers.length, 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-bpCream">Draft Picks</h2>
          <p className="text-sm text-bpCream/60">
            {selectedLeague.name} · {byAuction.length} auctions · {byPlayer.length} players · {totalPicks} total picks
          </p>
        </div>
        <button
          onClick={fetchDraftResults}
          className="p-1.5 rounded bg-white/5 hover:bg-white/10 transition text-bpCream"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* View toggle */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setView('byAuction')}
          className={`px-4 py-1.5 rounded text-sm font-semibold transition ${
            view === 'byAuction' ? 'bg-bpGold text-bpInk' : 'bg-white/5 text-bpCream hover:bg-white/10'
          }`}
        >
          By Auction
        </button>
        <button
          onClick={() => setView('byPlayer')}
          className={`px-4 py-1.5 rounded text-sm font-semibold transition ${
            view === 'byPlayer' ? 'bg-bpGold text-bpInk' : 'bg-white/5 text-bpCream hover:bg-white/10'
          }`}
        >
          By Player
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-bpCream rounded-2xl p-4 animate-pulse h-24" />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="text-center py-10 text-bpRed">{error}</div>
      )}

      {/* Empty */}
      {!loading && !error && byAuction.length === 0 && (
        <div className="text-center py-16 text-bpCream/50">
          <Car size={40} className="mx-auto mb-3" />
          <p>No picks found for this auction yet.</p>
        </div>
      )}

      {/* By Auction View */}
      {!loading && !error && view === 'byAuction' && byAuction.length > 0 && (
        <div className="space-y-3">
          {byAuction.map(({ auction, pickers }) => {
            const status = getStatus(auction)
            const img = getCarImage(auction)
            return (
              <div
                key={auction.auction_id}
                className="bg-bpCream text-bpInk border border-white/50 rounded-2xl shadow-[0_8px_28px_rgba(0,0,0,0.22)] overflow-hidden"
              >
                <div className="flex gap-3 p-3 sm:p-4">
                  {/* Car image */}
                  {img && (
                    <a
                      href={auction.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0"
                    >
                      <img
                        src={img}
                        alt={auction.title}
                        className="w-24 sm:w-32 h-16 sm:h-20 rounded-lg object-cover hover:opacity-90 transition"
                      />
                    </a>
                  )}
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <a
                      href={auction.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-bpInk hover:underline text-sm sm:text-base leading-tight block truncate"
                    >
                      {auction.title}
                    </a>
                    <div className="flex items-center gap-3 mt-1 text-sm">
                      <span className={`font-semibold ${status.color}`}>
                        {status.label}{status.value ? ': ' + status.value : ''}
                      </span>
                    </div>
                    {/* Pickers */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {pickers.map((p, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 bg-bpInk/8 border border-bpInk/15 rounded-full px-2.5 py-0.5 text-xs font-medium"
                        >
                          <span className="text-bpInk/50">●</span>
                          {p.username}
                          <span className="text-bpInk/50">· {formatPrice(p.purchase_price)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Pick count badge */}
                  <div className="flex-shrink-0 flex flex-col items-center justify-center">
                    <div className={`text-2xl font-extrabold ${pickers.length > 1 ? 'text-bpRed' : 'text-bpInk/30'}`}>
                      {pickers.length}
                    </div>
                    <div className="text-[10px] text-bpInk/40 uppercase tracking-wide">
                      {pickers.length === 1 ? 'pick' : 'picks'}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* By Player View */}
      {!loading && !error && view === 'byPlayer' && byPlayer.length > 0 && (
        <div className="space-y-4">
          {byPlayer.map((player) => (
            <div
              key={player.username}
              className="bg-bpCream text-bpInk border border-white/50 rounded-2xl shadow-[0_8px_28px_rgba(0,0,0,0.22)] overflow-hidden"
            >
              {/* Player header */}
              <div className="px-4 py-3 border-b border-bpInk/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-bpNavy flex items-center justify-center text-bpCream text-xs font-bold">
                    {player.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-bold text-bpInk">{player.username}</span>
                </div>
                <span className="text-sm text-bpInk/50">{player.cars.length}/7 cars</span>
              </div>
              {/* Car list */}
              {player.cars.length === 0 ? (
                <div className="px-4 py-4 text-sm text-bpInk/40 italic">No picks recorded</div>
              ) : (
                <div className="divide-y divide-bpInk/8">
                  {player.cars.map(({ auction, purchase_price }) => {
                    const status = getStatus(auction)
                    const img = getCarImage(auction)
                    return (
                      <div key={auction.auction_id} className="flex items-center gap-3 px-4 py-3">
                        {img && (
                          <img
                            src={img}
                            alt={auction.title}
                            className="w-14 h-10 rounded object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <a
                            href={auction.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-bpInk hover:underline block truncate"
                          >
                            {auction.title}
                          </a>
                          <div className="text-xs text-bpInk/50 mt-0.5">
                            Drafted at {formatPrice(purchase_price)} · <span className={status.color}>{status.label}{status.value ? ': ' + status.value : ''}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default DraftResults

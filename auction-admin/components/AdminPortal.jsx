'use client'
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Search, RefreshCw, Users, Trophy, Car, DollarSign, Upload, Download, CheckCircle, Play, Zap, Edit, Link } from 'lucide-react';
import AuctionAnalytics from './AuctionAnalytics';

// BaT-style username pool for seeding — first name + car model/code + optional year
const BAT_FIRST_NAMES = [
  'Sam','Bill','Jack','Dave','Mike','Tom','Rick','Jim','Bob','Dan',
  'Rob','Matt','Chris','Pete','Greg','Ed','Frank','Tony','Phil','Ken',
  'Steve','Gary','Scott','Mark','Brian','Jeff','Alan','Paul','Ray','Tim',
  'Pat','Hank','Bud','Walt','Sal','Vin','Gus','Hal','Chet','Wes'
];
const BAT_CAR_CODES = [
  '911','M3','M5','E30','E46','Vette','GT3','RS','Targa','944',
  '356','C4','C2','Turbo','GTR','GTS','Z06','Dino','Bimmer','2002',
  'CSL','Camaro','Boss','Alpina','F40','308','328','Testarossa','M6','507',
  'Mach1','Stingray','Boxster','Cayman','914','928','968','Countach','Miura','Daytona'
];
const BAT_YEARS = ['', '62', '63', '67', '69', '72', '73', '76', '84', '85', '86', '88', '91', '93', '95'];

function generateFakeUsername(existingUsernames) {
  const used = new Set(existingUsernames);
  const combos = [];
  for (const first of BAT_FIRST_NAMES) {
    for (const car of BAT_CAR_CODES) {
      for (const year of BAT_YEARS) {
        combos.push(`${first}${car}${year}`);
      }
    }
  }
  // Fisher-Yates shuffle
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  return combos.find(c => !used.has(c)) || `Player${Date.now()}`;
}

const AdminPortal = () => {
  const [activeTab, setActiveTab] = useState('auctions');
  const [auctions, setAuctions] = useState([]);
  const [users, setUsers] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [garages, setGarages] = useState([]);
  const [leagueMembers, setLeagueMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // ✅ CHANGE #1: Added new state for all auctions (for bonus car dropdown)
  const [allAuctionsForBonus, setAllAuctionsForBonus] = useState([]);
  
  const [showAddAuction, setShowAddAuction] = useState(false);
  const [newAuction, setNewAuction] = useState({
    auction_id: '', title: '', make: '', model: '', year: '',
    price_at_48h: '', final_price: '', url: '', image_url: '', timestamp_end: '',
    auction_reference: ''
  });

  const [showEditAuction, setShowEditAuction] = useState(false);
  const [editingAuction, setEditingAuction] = useState(null);

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '' });

  const [showSeedUsers, setShowSeedUsers] = useState(false);
  const [seedConfig, setSeedConfig] = useState({ leagueId: '', count: 5, autoPick: true });
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  const [showAddLeague, setShowAddLeague] = useState(false);
  const [newLeague, setNewLeague] = useState({
    name: '',
    draft_starts_at: '',
    draft_ends_at: '',
    is_public: true,
    bonus_auction_id: '',
    use_manual_auctions: false,
    spending_limit: 200000
  });

  // State for managing league auctions
  const [showAuctionManager, setShowAuctionManager] = useState(false);
  const [managingLeagueId, setManagingLeagueId] = useState(null);
  const [leagueAuctions, setLeagueAuctions] = useState({});
  const [allAuctions, setAllAuctions] = useState([]);
  const [manualAuctions, setManualAuctions] = useState([]); // Separate list for manual auctions
  const [auctionSearchTerm, setAuctionSearchTerm] = useState('');
  const [auctionFilter, setAuctionFilter] = useState({ make: '', model: '', year: '', auction_reference: '' });
  const [addingAuctionId, setAddingAuctionId] = useState(null);
  const [customEndDateTime, setCustomEndDateTime] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [copiedLeagueId, setCopiedLeagueId] = useState(null);

  // State for finalize tab - ended auctions without final prices
  const [endedAuctions, setEndedAuctions] = useState([]);
  const [finalPriceInputs, setFinalPriceInputs] = useState({});
  const [updatingAuctionId, setUpdatingAuctionId] = useState(null);
  const [runningAutoFinalizer, setRunningAutoFinalizer] = useState(false);
  const [autoFinalizerResult, setAutoFinalizerResult] = useState(null);
  const [finalizeEventFilter, setFinalizeEventFilter] = useState('');
  const [finalizedAuctions, setFinalizedAuctions] = useState([]);
  const [editingFinalizedId, setEditingFinalizedId] = useState(null);
  const [editFinalPriceInputs, setEditFinalPriceInputs] = useState({});
  const [showEditFinalized, setShowEditFinalized] = useState(false);
  const [auctionHealth, setAuctionHealth] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [withdrawnPriceInputs, setWithdrawnPriceInputs] = useState({});
  const [reclassifyingId, setReclassifyingId] = useState(null);

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    if (activeTab === 'finalize' && !auctionHealth) loadAuctionHealth();
  }, [activeTab]);

  // Helper function to format relative time
  const formatRelativeTime = (timestampSeconds) => {
    if (!timestampSeconds) return 'No end date';

    const now = Math.floor(Date.now() / 1000);
    const diff = timestampSeconds - now;
    const absDiff = Math.abs(diff);

    const days = Math.floor(absDiff / (24 * 60 * 60));
    const hours = Math.floor((absDiff % (24 * 60 * 60)) / (60 * 60));

    if (diff > 0) {
      // Future
      if (days > 0) {
        return `Ends in ${days}d ${hours}h`;
      } else if (hours > 0) {
        return `Ends in ${hours}h`;
      } else {
        return 'Ending soon';
      }
    } else {
      // Past
      if (days > 0) {
        return `Ended ${days}d ago`;
      } else if (hours > 0) {
        return `Ended ${hours}h ago`;
      } else {
        return 'Just ended';
      }
    }
  };

  const loadAllData = async () => {
    setLoading(true);

    try {
      const { supabase } = await import('@/lib/supabase');

      // ============================================
      // FIXED: Only show auctions in DRAFT WINDOW (4-5 days before end)
      // ============================================
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

      const { data: auctionData, error: auctionError } = await supabase
        .from('auctions')
        .select('*')
        .gte('timestamp_end', minEndTime)
        .lte('timestamp_end', maxEndTime)
        .not('price_at_48h', 'is', null)
        .is('final_price', null)
        .order('timestamp_end', { ascending: true });

      if (auctionError) {
        console.error('Error loading auctions:', auctionError);
      }

      setAuctions(auctionData || []);
      console.log(`Loaded ${auctionData?.length || 0} auctions in draft window (4-5 days before end)`);
      
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });
      setUsers(userData || []);
      
      const { data: leagueData } = await supabase
        .from('leagues')
        .select(`
          *,
          creator:created_by(username, email),
          bonus_auction:bonus_auction_id(title, make, model)
        `)
        .order('created_at', { ascending: false });
      setLeagues(leagueData || []);
      
      // Load auctions for bonus car dropdown (SAME 4-5 day window as draft cars)
      console.log('Loading bonus car options (draft window only)...');
      const { data: bonusAuctionData, error: bonusError } = await supabase
        .from('auctions')
        .select('*')
        .gte('timestamp_end', minEndTime)    // Must end at least 4 days from now
        .lte('timestamp_end', maxEndTime)    // Must end within 5 days from now
        .not('price_at_48h', 'is', null)     // Must have day 2 price
        .is('final_price', null)              // Must still be active (not sold)
        .order('timestamp_end', { ascending: false })
        .limit(200);

      if (bonusError) {
        console.error('Error loading bonus auctions:', bonusError);
        setAllAuctionsForBonus([]);
      } else {
        setAllAuctionsForBonus(bonusAuctionData || []);
        console.log(`Loaded ${bonusAuctionData?.length || 0} active auctions in draft window for bonus selection`);
      }
      
      const { data: garageData } = await supabase
        .from('garages')
        .select(`
          *,
          user:user_id(username, email),
          league:league_id(name),
          garage_cars(
            *,
            auction:auction_id(title, make, model, final_price)
          )
        `);
      setGarages(garageData || []);
      
      const { data: memberData } = await supabase
        .from('league_members')
        .select(`
          *,
          user:user_id(username, email),
          league:league_id(name)
        `)
        .order('total_score', { ascending: false });
      setLeagueMembers(memberData || []);

      // Load auctions for manual selection (exclude already ended auctions)
      const nowForManual = Math.floor(Date.now() / 1000);

      // Load BaT auctions (exclude manual auctions)
      const { data: batAuctionsData } = await supabase
        .from('auctions')
        .select('*')
        .gte('timestamp_end', nowForManual)  // Only show auctions that haven't ended yet
        .not('auction_id', 'like', 'manual_%')  // Exclude manual auctions
        .order('inserted_at', { ascending: false })
        .limit(500);
      setAllAuctions(batAuctionsData || []);

      // Load manual auctions separately
      const { data: manualAuctionsData } = await supabase
        .from('auctions')
        .select('*')
        .like('auction_id', 'manual_%')  // Only manual auctions
        .order('inserted_at', { ascending: false });
      setManualAuctions(manualAuctionsData || []);

      // Load league-specific auctions
      const { data: leagueAuctionsData } = await supabase
        .from('league_auctions')
        .select(`
          *,
          auctions!league_auctions_auction_id_fkey(*)
        `);

      // Group by league_id
      const grouped = {};
      (leagueAuctionsData || []).forEach(la => {
        if (!grouped[la.league_id]) grouped[la.league_id] = [];
        grouped[la.league_id].push(la);
      });
      setLeagueAuctions(grouped);

      console.log('Data loaded successfully');

      // Load ended auctions without final prices
      await loadEndedAuctions();
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Failed to load data: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Load auctions that have ended but don't have final prices yet
  const loadEndedAuctions = async () => {
    try {
      const { supabase } = await import('@/lib/supabase');
      const now = Math.floor(Date.now() / 1000);

      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .lt('timestamp_end', now)        // Auction has ended
        .is('final_price', null)         // No final price set yet
        .eq('reserve_not_met', false)    // Exclude confirmed reserve-not-met auctions
        .order('timestamp_end', { ascending: false })
        .limit(100);

      if (error) throw error;
      setEndedAuctions(data || []);
    } catch (error) {
      console.error('Error loading ended auctions:', error);
    }
  };

  // Pull a snapshot of the BaT finalization loop (stuck pile + 30-day breakdown).
  const loadAuctionHealth = async () => {
    setLoadingHealth(true);
    try {
      const response = await fetch('/api/admin/auction-health');
      const data = await response.json();
      setAuctionHealth(response.ok ? data : { error: data.error || 'Failed to load' });
    } catch (error) {
      setAuctionHealth({ error: error.message });
    } finally {
      setLoadingHealth(false);
    }
  };

  // Flip an over-classified withdrawn (final_price=0) to either Reserve Not Met
  // (no soldPrice) or Sold (soldPrice provided).
  const handleReclassifyWithdrawn = async (auctionId, soldPrice = null) => {
    const isSold = soldPrice !== null && soldPrice !== '' && Number(soldPrice) > 0;
    const confirmMsg = isSold
      ? `Mark this auction as Sold for $${Number(soldPrice).toLocaleString()}? This will set final_price and post the league chat message.`
      : 'Reclassify this auction as Reserve Not Met? It will be removed from the Withdrawn list and the 25% penalty will apply in scoring.';
    if (!confirm(confirmMsg)) return;
    setReclassifyingId(auctionId);
    try {
      const response = await fetch('/api/admin/reclassify-withdrawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auction_id: auctionId,
          ...(isSold ? { final_price: Number(soldPrice) } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed');
      setWithdrawnPriceInputs(prev => { const n = { ...prev }; delete n[auctionId]; return n; });
      await loadAuctionHealth();
    } catch (error) {
      alert('Reclassify failed: ' + error.message);
    } finally {
      setReclassifyingId(null);
    }
  };

  // Load recently finalized auctions (have a final_price set) for editing
  const loadFinalizedAuctions = async () => {
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .not('final_price', 'is', null)
        .order('timestamp_end', { ascending: false })
        .limit(200);
      if (error) throw error;
      setFinalizedAuctions(data || []);
    } catch (error) {
      console.error('Error loading finalized auctions:', error);
    }
  };

  // Edit an already-finalized price
  const handleEditFinalizedPrice = async (auctionId) => {
    const newPrice = editFinalPriceInputs[auctionId];
    if (!newPrice || parseFloat(newPrice) <= 0) {
      alert('Please enter a valid price');
      return;
    }
    setEditingFinalizedId(auctionId);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase
        .from('auctions')
        .update({ final_price: parseFloat(newPrice) })
        .eq('auction_id', auctionId);
      if (error) throw error;
      setFinalizedAuctions(prev =>
        prev.map(a => a.auction_id === auctionId ? { ...a, final_price: parseFloat(newPrice) } : a)
      );
      setEditFinalPriceInputs(prev => { const n = { ...prev }; delete n[auctionId]; return n; });
      alert(`Final price updated to $${parseFloat(newPrice).toLocaleString()}`);
    } catch (error) {
      console.error('Error editing final price:', error);
      alert('Failed to update: ' + error.message);
    } finally {
      setEditingFinalizedId(null);
    }
  };

  // Update final price for an auction
  const handleUpdateFinalPrice = async (auctionId) => {
    const finalPrice = finalPriceInputs[auctionId];
    if (!finalPrice || parseFloat(finalPrice) <= 0) {
      alert('Please enter a valid final price');
      return;
    }

    setUpdatingAuctionId(auctionId);
    try {
      const { supabase } = await import('@/lib/supabase');

      const { error } = await supabase
        .from('auctions')
        .update({ final_price: parseFloat(finalPrice) })
        .eq('auction_id', auctionId);

      if (error) throw error;

      // Remove from ended auctions list
      setEndedAuctions(prev => prev.filter(a => a.auction_id !== auctionId));
      // Clear the input
      setFinalPriceInputs(prev => {
        const newInputs = { ...prev };
        delete newInputs[auctionId];
        return newInputs;
      });

      alert(`Final price updated to $${parseFloat(finalPrice).toLocaleString()}`);
    } catch (error) {
      console.error('Error updating final price:', error);
      alert('Failed to update final price: ' + error.message);
    } finally {
      setUpdatingAuctionId(null);
    }
  };

  // Run the automatic BaT scraper to fetch final prices
  const handleRunAutoFinalizer = async () => {
    setRunningAutoFinalizer(true);
    setAutoFinalizerResult(null);

    try {
      const response = await fetch('/api/cron/finalize-auctions', {
        method: 'POST',
      });

      const result = await response.json();

      if (response.ok) {
        setAutoFinalizerResult({
          success: true,
          message: `Processed ${result.processed} auctions: ${result.successful} updated, ${result.failed} failed`,
          details: result
        });

        // Reload the ended auctions list and refresh health snapshot
        await loadEndedAuctions();
        await loadAuctionHealth();
      } else {
        setAutoFinalizerResult({
          success: false,
          message: result.error || 'Failed to run finalizer'
        });
      }
    } catch (error) {
      setAutoFinalizerResult({
        success: false,
        message: 'Network error: ' + error.message
      });
    } finally {
      setRunningAutoFinalizer(false);
    }
  };

  // Mark auction as reserve not met (no sale)
  const handleMarkReserveNotMet = async (auctionId) => {
    if (!confirm('Mark this auction as "Reserve Not Met"? This means the car did not sell.')) {
      return;
    }

    setUpdatingAuctionId(auctionId);
    try {
      const { supabase } = await import('@/lib/supabase');

      // Persist reserve_not_met = true so the auction is permanently excluded
      // from the Finalize tab on every subsequent load. final_price stays NULL
      // so the scoring system correctly applies the 25% penalty via:
      //   auctionEnded && finalPrice === null → reserve_not_met status
      const { error } = await supabase
        .from('auctions')
        .update({ reserve_not_met: true })
        .eq('auction_id', auctionId);

      if (error) throw error;

      setEndedAuctions(prev => prev.filter(a => a.auction_id !== auctionId));
      alert('Auction marked as "Reserve Not Met" — 25% of high bid will be scored.');
    } catch (error) {
      console.error('Error marking reserve not met:', error);
      alert('Failed to mark auction as reserve not met: ' + error.message);
    } finally {
      setUpdatingAuctionId(null);
    }
  };

  // ========== AUCTION FUNCTIONS ==========
  const handleAddAuction = async () => {
    if (!newAuction.make || !newAuction.model || !newAuction.title) {
      alert('Please fill in at least Make, Model, and Title');
      return;
    }

    if (!newAuction.timestamp_end) {
      alert('Please set an auction end date');
      return;
    }

    try {
      const { supabase } = await import('@/lib/supabase');

      // Convert datetime-local to Unix timestamp
      const endTimestamp = Math.floor(new Date(newAuction.timestamp_end).getTime() / 1000);

      // Validate that the end date is in the future
      const now = Math.floor(Date.now() / 1000);
      if (endTimestamp <= now) {
        alert('Auction end date must be in the future');
        return;
      }

      const auction = {
        auction_id: newAuction.auction_id || `manual_${Date.now()}`,
        title: newAuction.title,
        make: newAuction.make,
        model: newAuction.model,
        year: newAuction.year ? parseInt(newAuction.year) : null,
        price_at_48h: newAuction.price_at_48h ? parseFloat(newAuction.price_at_48h) : null,
        final_price: newAuction.final_price ? parseFloat(newAuction.final_price) : null,
        url: newAuction.url || null,
        image_url: newAuction.image_url || null,
        timestamp_end: endTimestamp,
        inserted_at: new Date().toISOString(),
        current_bid: newAuction.price_at_48h || newAuction.final_price || null,
        auction_reference: newAuction.auction_reference || null
      };

      const { error } = await supabase.from('auctions').insert([auction]);

      if (error) {
        alert('Error: ' + error.message);
      } else {
        alert('Auction added!');
        loadAllData();
        setNewAuction({ auction_id: '', title: '', make: '', model: '', year: '',
          price_at_48h: '', final_price: '', url: '', image_url: '', timestamp_end: '',
          auction_reference: '' });
        setShowAddAuction(false);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleStartEdit = (auction) => {
    // Convert timestamp_end (Unix seconds) to datetime-local format
    let datetimeLocal = '';
    if (auction.timestamp_end) {
      const date = new Date(auction.timestamp_end * 1000);
      datetimeLocal = date.toISOString().slice(0, 16);
    }

    setEditingAuction({
      id: auction.id,
      auction_id: auction.auction_id,
      title: auction.title || '',
      make: auction.make || '',
      model: auction.model || '',
      year: auction.year || '',
      price_at_48h: auction.price_at_48h || '',
      final_price: auction.final_price || '',
      url: auction.url || '',
      image_url: auction.image_url || '',
      timestamp_end: datetimeLocal,
      auction_reference: auction.auction_reference || ''
    });
    setShowEditAuction(true);
  };

  const handleEditAuction = async () => {
    if (!editingAuction.make || !editingAuction.model || !editingAuction.title) {
      alert('Please fill in at least Make, Model, and Title');
      return;
    }

    if (!editingAuction.timestamp_end) {
      alert('Please set an auction end date');
      return;
    }

    try {
      const { supabase } = await import('@/lib/supabase');

      // Convert datetime-local to Unix timestamp
      const endTimestamp = Math.floor(new Date(editingAuction.timestamp_end).getTime() / 1000);

      const updates = {
        title: editingAuction.title,
        make: editingAuction.make,
        model: editingAuction.model,
        year: editingAuction.year ? parseInt(editingAuction.year) : null,
        price_at_48h: editingAuction.price_at_48h ? parseFloat(editingAuction.price_at_48h) : null,
        final_price: editingAuction.final_price ? parseFloat(editingAuction.final_price) : null,
        url: editingAuction.url || null,
        image_url: editingAuction.image_url || null,
        timestamp_end: endTimestamp,
        current_bid: editingAuction.price_at_48h || editingAuction.final_price || null,
        auction_reference: editingAuction.auction_reference || null
      };

      const { error } = await supabase
        .from('auctions')
        .update(updates)
        .eq('id', editingAuction.id);

      if (error) {
        alert('Error: ' + error.message);
      } else {
        alert('Auction updated!');
        loadAllData();
        setEditingAuction(null);
        setShowEditAuction(false);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleDeleteAuction = async (id) => {
    if (!confirm('Delete this auction? It will be removed from all garages!')) return;

    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.from('auctions').delete().eq('id', id);
      if (!error) loadAllData();
      else alert('Error: ' + error.message);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  // ========== CSV EXPORT ==========
  const handleExportAuctionsCSV = () => {
    const headers = ['auction_id', 'title', 'make', 'model', 'year', 'price_at_48h', 'final_price', 'url', 'image_url', 'auction_reference', 'timestamp_end'];
    const csvRows = [headers.join(',')];

    auctions.forEach(auction => {
      const row = [
        auction.auction_id || '',
        `"${(auction.title || '').replace(/"/g, '""')}"`,
        auction.make || '',
        auction.model || '',
        auction.year || '',
        auction.price_at_48h || '',
        auction.final_price || '',
        auction.url || '',
        auction.image_url || '',
        auction.auction_reference || '',
        auction.timestamp_end || ''
      ];
      csvRows.push(row.join(','));
    });
    
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auctions_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    alert(`Exported ${auctions.length} auctions to CSV!`);
  };

  // ========== CSV IMPORT ==========
  const handleImportAuctionsCSV = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    setCsvImporting(true);

    try {
      const text = await file.text();
      const lines = text.split('\n');
      const headers = lines[0].split(',').map(h => h.trim());

      const auctions = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        const values = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)
          ?.map(v => v.replace(/^"|"$/g, '').trim()) || [];

        if (values.length === 0) continue;

        const auction = {
          auction_id: values[0] ? `manual_${values[0]}` : `manual_imported_${Date.now()}_${i}`,
          title: values[1] || '',
          make: values[2] || '',
          model: values[3] || '',
          year: values[4] ? parseInt(values[4]) : null,
          price_at_48h: values[5] ? parseFloat(values[5]) : null,
          final_price: values[6] ? parseFloat(values[6]) : null,
          url: values[7] || null,
          image_url: values[8] || null,
          auction_reference: values[9] || null,
          timestamp_end: values[10] ? parseInt(values[10]) : null,
          inserted_at: new Date().toISOString(),
          current_bid: values[5] || values[6] || null
        };

        auctions.push(auction);
      }
      
      console.log(`Parsed ${auctions.length} auctions from CSV`);
      
      const { supabase } = await import('@/lib/supabase');
      
      const batchSize = 50;
      let imported = 0;
      
      for (let i = 0; i < auctions.length; i += batchSize) {
        const batch = auctions.slice(i, i + batchSize);
        const { error } = await supabase
          .from('auctions')
          .upsert(batch, { onConflict: 'auction_id' });
        
        if (error) {
          console.error('Batch error:', error);
          alert(`Error importing batch: ${error.message}`);
          break;
        }
        imported += batch.length;
      }
      
      alert(`Successfully imported ${imported} auctions!`);
      loadAllData();
      
    } catch (error) {
      console.error('Import error:', error);
      alert('Failed to import CSV: ' + error.message);
    } finally {
      setCsvImporting(false);
      event.target.value = '';
    }
  };

  // ========== USER FUNCTIONS ==========
  const handleAddUser = async () => {
    if (!newUser.email || !newUser.username) {
      alert('Please fill in email and username');
      return;
    }
    
    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.from('users').insert([{
        username: newUser.username,
        email: newUser.email
      }]);
      
      if (error) {
        alert('Error: ' + error.message);
      } else {
        alert('User added!');
        loadAllData();
        setNewUser({ username: '', email: '' });
        setShowAddUser(false);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Delete user? This will delete their garages and league memberships!')) return;
    
    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.from('users').delete().eq('id', id);
      if (!error) loadAllData();
      else alert('Error: ' + error.message);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleSeedFakeUsers = async () => {
    if (!seedConfig.leagueId) { alert('Please select a league'); return; }
    const count = parseInt(seedConfig.count, 10);
    if (!count || count < 1 || count > 20) { alert('Count must be between 1 and 20'); return; }

    setSeeding(true);
    setSeedResult(null);

    try {
      const { supabase } = await import('@/lib/supabase');

      // Resolve the league
      const league = leagues.find(l => l.id === seedConfig.leagueId);
      if (!league) { alert('League not found'); setSeeding(false); return; }
      const spendingLimit = league.spending_limit || 175000;

      // Fetch available auctions for this league — mirrors main app rules exactly
      let availableAuctions = [];
      if (league.use_manual_auctions) {
        // Manual leagues: auctions explicitly assigned to this league
        const { data: la } = await supabase
          .from('league_auctions')
          .select('auctions(*)')
          .eq('league_id', league.id);
        availableAuctions = (la || [])
          .map(r => r.auctions)
          .filter(a => a && a.price_at_48h != null && a.final_price == null);
      } else {
        // Standard leagues: same 4-5 day window the main app uses
        const now = Math.floor(Date.now() / 1000);
        const minEnd = now + 4 * 24 * 60 * 60;
        const maxEnd = now + 5 * 24 * 60 * 60;
        const { data: auctionData } = await supabase
          .from('auctions')
          .select('*')
          .not('price_at_48h', 'is', null)
          .is('final_price', null)
          .gte('timestamp_end', minEnd)
          .lte('timestamp_end', maxEnd);
        availableAuctions = auctionData || [];
      }

      // Split into reused fake users vs brand-new users
      // Fake users have emails ending in @fake.bidprix.com
      const fakeUsers = users.filter(u => u.email?.endsWith('@fake.bidprix.com'));

      // Who is already in this league?
      const { data: existingMembers } = await supabase
        .from('league_members')
        .select('user_id')
        .eq('league_id', league.id);
      const alreadyInLeague = new Set((existingMembers || []).map(m => m.user_id));

      // Fake users eligible to be reused (not already in this league)
      const reusableFakeUsers = fakeUsers.filter(u => !alreadyInLeague.has(u.id));

      // Shuffle reusable pool
      for (let i = reusableFakeUsers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [reusableFakeUsers[i], reusableFakeUsers[j]] = [reusableFakeUsers[j], reusableFakeUsers[i]];
      }

      const allUsernames = users.map(u => u.username);
      const newInBatch = [];

      let totalCars = 0;
      const createdPlayers = [];

      for (let i = 0; i < count; i++) {
        let userId, username;

        // Reuse an existing fake user ~50% of the time when pool is available
        const canReuse = reusableFakeUsers.length > 0;
        const shouldReuse = canReuse && Math.random() < 0.5;

        if (shouldReuse) {
          const existing = reusableFakeUsers.shift(); // take from front (already shuffled)
          userId = existing.id;
          username = existing.username;
        } else {
          // Create a new fake user
          username = generateFakeUsername([...allUsernames, ...newInBatch]);
          newInBatch.push(username);
          const email = `${username.toLowerCase()}@fake.bidprix.com`;

          const { data: newUserData, error: ue } = await supabase
            .from('users')
            .insert([{ username, email }])
            .select()
            .single();
          if (ue || !newUserData) { console.error('User insert failed:', ue); continue; }
          userId = newUserData.id;
        }

        // Create garage for this user + league
        const { data: garageData, error: ge } = await supabase
          .from('garages')
          .insert([{ user_id: userId, league_id: league.id, remaining_budget: spendingLimit }])
          .select()
          .single();
        if (ge || !garageData) { console.error('Garage insert failed:', ge); continue; }

        // Join the league
        const { error: me } = await supabase
          .from('league_members')
          .insert([{ league_id: league.id, user_id: userId, total_score: 0 }]);
        if (me) { console.error('League member insert failed:', me); }

        // Auto-pick exactly 7 cars, spending at least half the budget
        let carsPicked = 0;
        let remainingBudget = spendingLimit;

        if (seedConfig.autoPick && availableAuctions.length > 0) {
          const halfBudget = spendingLimit / 2;

          // Filter to auctions with a valid draft price
          const eligible = availableAuctions.filter(a => a.price_at_48h && a.price_at_48h > 0);

          // Shuffle randomly — sorting expensive-first would exhaust the budget
          // before we could pick 7 cars, so we randomize instead
          for (let j = eligible.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [eligible[j], eligible[k]] = [eligible[k], eligible[j]];
          }

          const garageCarRows = [];
          let totalSpent = 0;

          // Greedy pick up to 7 cars within budget
          for (const auction of eligible) {
            if (carsPicked >= 7) break;
            const price = auction.price_at_48h;
            if (price > remainingBudget) continue;
            garageCarRows.push({ garage_id: garageData.id, auction_id: auction.auction_id, purchase_price: price });
            remainingBudget -= price;
            totalSpent += price;
            carsPicked++;
          }

          // Enforce 50% minimum spend: swap cheapest picks for pricier alternatives
          if (garageCarRows.length > 0 && totalSpent < halfBudget) {
            const selectedIds = new Set(garageCarRows.map(r => r.auction_id));
            // Unselected cars sorted most-expensive first for upgrading
            const upgrades = eligible
              .filter(a => !selectedIds.has(a.auction_id))
              .sort((a, b) => b.price_at_48h - a.price_at_48h);

            for (const upgrade of upgrades) {
              if (totalSpent >= halfBudget) break;
              // Find cheapest current pick
              let cheapestIdx = 0;
              for (let k = 1; k < garageCarRows.length; k++) {
                if (garageCarRows[k].purchase_price < garageCarRows[cheapestIdx].purchase_price) cheapestIdx = k;
              }
              const diff = upgrade.price_at_48h - garageCarRows[cheapestIdx].purchase_price;
              // Only swap if the upgrade is pricier and the extra cost fits in budget
              if (diff > 0 && totalSpent + diff <= spendingLimit) {
                totalSpent += diff;
                remainingBudget -= diff;
                garageCarRows[cheapestIdx] = { garage_id: garageData.id, auction_id: upgrade.auction_id, purchase_price: upgrade.price_at_48h };
              }
            }
          }

          if (garageCarRows.length > 0) {
            const { error: carsError } = await supabase.from('garage_cars').insert(garageCarRows);
            if (carsError) console.error('Garage cars insert failed:', carsError);
            else {
              await supabase.from('garages').update({ remaining_budget: remainingBudget }).eq('id', garageData.id);
            }
          }
        }

        totalCars += carsPicked;
        createdPlayers.push({ username, carsPicked });
      }

      let msg;
      if (seedConfig.autoPick) {
        const shortfall = createdPlayers.filter(p => p.carsPicked < 7);
        msg = `Seeded ${createdPlayers.length} fake players into "${league.name}" — ${totalCars} total cars picked.`;
        if (shortfall.length > 0) {
          msg += ` Warning: ${shortfall.length} player(s) got fewer than 7 cars (${shortfall.map(p => `${p.username}: ${p.carsPicked}`).join(', ')}) — not enough affordable auctions available.`;
        }
      } else {
        msg = `Seeded ${createdPlayers.length} fake players into "${league.name}" (no cars picked).`;
      }
      setSeedResult({ success: true, message: msg, players: createdPlayers.map(p => p.username) });
      loadAllData();
    } catch (err) {
      setSeedResult({ success: false, message: 'Error: ' + err.message });
    } finally {
      setSeeding(false);
    }
  };

  // ========== LEAGUE FUNCTIONS ==========
  const handleAddLeague = async () => {
    const trimmedName = newLeague.name?.trim();

    if (!trimmedName || !newLeague.draft_starts_at || !newLeague.draft_ends_at) {
      alert('Please fill in league name and draft dates');
      return;
    }

    const startDate = new Date(newLeague.draft_starts_at);
    const endDate = new Date(newLeague.draft_ends_at);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      alert('Invalid date format. Please select valid dates.');
      return;
    }

    if (endDate <= startDate) {
      alert('Draft end date must be after draft start date');
      return;
    }

    try {
      const { supabase } = await import('@/lib/supabase');

      // Admin-created leagues have no specific creator (created_by = null)
      // The UI will display "Admin" for leagues with null creator
      const creatorId = null;

      const league = {
        name: trimmedName,
        created_by: creatorId,
        draft_starts_at: newLeague.draft_starts_at,
        draft_ends_at: newLeague.draft_ends_at,
        is_public: newLeague.is_public,
        use_manual_auctions: newLeague.use_manual_auctions,
        spending_limit: newLeague.spending_limit || 200000,
        status: 'draft',
        snapshot_created: false
      };

      if (newLeague.bonus_auction_id) {
        league.bonus_auction_id = newLeague.bonus_auction_id;
      }
      
      console.log('Creating league with data:', league);
      
      const { error } = await supabase.from('leagues').insert([league]);
      
      if (error) {
        alert('Error creating league: ' + error.message);
        console.error('League creation error:', error);
      } else {
        alert('League created successfully! Users can now join this league from your game app.');
        loadAllData();
        setNewLeague({
          name: '',
          draft_starts_at: '',
          draft_ends_at: '',
          is_public: true,
          bonus_auction_id: '',
          use_manual_auctions: false,
          spending_limit: 200000
        });
        setShowAddLeague(false);
      }
    } catch (error) {
      alert('Failed to create league: ' + error.message);
      console.error('Exception:', error);
    }
  };

  const copyInviteLink = (leagueId) => {
    const appUrl = 'https://garage-draft.vercel.app';
    const link = `${appUrl}?league=${leagueId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLeagueId(leagueId);
      setTimeout(() => setCopiedLeagueId(null), 2000);
    });
  };

  const handleDeleteLeague = async (id) => {
    if (!confirm('Delete this league? This will delete all garages and members!')) return;

    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.from('leagues').delete().eq('id', id);
      if (!error) loadAllData();
      else alert('Error: ' + error.message);
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleToggleAuctionType = async (leagueId, currentValue) => {
    const newValue = !currentValue;
    const confirmMsg = newValue
      ? 'Switch to manual auction selection? You will need to manually add auctions for this league.'
      : 'Switch to automatic auctions (4-5 day window)? Any manually selected auctions will be ignored.';

    if (!confirm(confirmMsg)) return;

    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase
        .from('leagues')
        .update({ use_manual_auctions: newValue })
        .eq('id', leagueId);

      if (!error) {
        loadAllData();
        alert(`League switched to ${newValue ? 'manual' : 'automatic'} auction selection!`);
      } else {
        alert('Error: ' + error.message);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  // ========== LEAGUE AUCTION FUNCTIONS ==========
  const handleAddAuctionToLeague = async (leagueId, auctionId, customEndDate = null) => {
    try {
      const { supabase } = await import('@/lib/supabase');

      // Fetch the auction to validate its end date
      const { data: auction, error: fetchError } = await supabase
        .from('auctions')
        .select('*')
        .eq('auction_id', auctionId)
        .single();

      if (fetchError || !auction) {
        alert('Error: Could not find auction');
        return;
      }

      // Fetch the league to check if it's a manual league
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('use_manual_auctions')
        .eq('id', leagueId)
        .single();

      if (leagueError || !league) {
        alert('Error: Could not find league');
        return;
      }

      // Determine if this is a Bring a Trailer auction or a manually added auction
      const isBaTAuction = !auctionId.startsWith('manual_');

      // PREVENT BaT auctions from being added to manual leagues
      if (league.use_manual_auctions && isBaTAuction) {
        alert('Error: This league only accepts manually-created auctions. Bring a Trailer auctions cannot be added to manual leagues.');
        return;
      }
      const now = Math.floor(Date.now() / 1000);

      if (isBaTAuction) {
        // For Bring a Trailer auctions: enforce 4-5 day window
        const fourDaysInSeconds = 4 * 24 * 60 * 60;
        const fiveDaysInSeconds = 5 * 24 * 60 * 60;
        const minEndTime = now + fourDaysInSeconds;
        const maxEndTime = now + fiveDaysInSeconds;

        if (!auction.timestamp_end) {
          alert('Error: This Bring a Trailer auction does not have an end date set');
          return;
        }

        if (auction.timestamp_end < minEndTime) {
          alert('Error: This Bring a Trailer auction ends in less than 4 days. Only auctions in the 4-5 day window can be added.');
          return;
        }

        if (auction.timestamp_end > maxEndTime) {
          alert('Error: This Bring a Trailer auction ends in more than 5 days. Only auctions in the 4-5 day window can be added.');
          return;
        }
      } else {
        // For manually added auctions: validate the end date is in the future
        const endDateToUse = customEndDate || auction.timestamp_end;

        if (!endDateToUse) {
          alert('Error: This auction does not have an end date set. Please specify a custom end date.');
          return;
        }

        if (endDateToUse <= now) {
          alert('Error: This auction has already ended. Cannot add auctions with past end dates.');
          return;
        }
      }

      const leagueAuction = {
        league_id: leagueId,
        auction_id: auctionId,
        custom_end_date: customEndDate
      };

      const { error } = await supabase
        .from('league_auctions')
        .insert([leagueAuction]);

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          alert('This auction is already added to this league');
        } else {
          alert('Error: ' + error.message);
        }
      } else {
        alert('Auction added to league!');
        loadAllData();
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const handleRemoveAuctionFromLeague = async (leagueId, auctionId) => {
    if (!confirm('Remove this auction from the league?')) return;

    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase
        .from('league_auctions')
        .delete()
        .eq('league_id', leagueId)
        .eq('auction_id', auctionId);

      if (!error) {
        alert('Auction removed from league');
        loadAllData();
      } else {
        alert('Error: ' + error.message);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  const openAuctionManager = (leagueId) => {
    setManagingLeagueId(leagueId);
    setShowAuctionManager(true);
    setAuctionSearchTerm('');
    setAuctionFilter({ make: '', model: '', year: '' });
  };

  // Handler to set/update bonus car for manual leagues
  const handleSetBonusCar = async (leagueId, auctionId) => {
    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase
        .from('leagues')
        .update({ bonus_auction_id: auctionId || null })
        .eq('id', leagueId);

      if (!error) {
        loadAllData();
        alert(auctionId ? 'Bonus car updated!' : 'Bonus car removed');
      } else {
        alert('Error: ' + error.message);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  // ========== HELPER FUNCTIONS ==========
  const calculateGain = (price48h, finalPrice) => {
    if (!price48h || !finalPrice) return 'N/A';
    return ((finalPrice - price48h) / price48h * 100).toFixed(2);
  };

  const filteredAuctions = auctions.filter(auction => {
    const searchLower = searchTerm.toLowerCase();
    return (
      auction.title?.toLowerCase().includes(searchLower) ||
      auction.make?.toLowerCase().includes(searchLower) ||
      auction.model?.toLowerCase().includes(searchLower) ||
      auction.year?.toString().includes(searchLower)
    );
  });

  const getLeagueMembers = (leagueId) => {
    return leagueMembers.filter(m => m.league_id === leagueId)
      .sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="animate-spin w-12 h-12 mx-auto mb-4 text-blue-500" />
          <p className="text-xl">Loading admin portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">🏁 Admin Portal</h1>
          <p className="text-slate-400">Manage auctions, users, leagues, and garages</p>
        </div>

        {/* STATS CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 rounded-lg shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-blue-200 text-sm mb-1">Total Auctions</div>
                <div className="text-3xl font-bold">{auctions.length}</div>
              </div>
              <Car className="w-12 h-12 text-blue-300 opacity-50" />
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-green-600 to-green-700 p-6 rounded-lg shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-green-200 text-sm mb-1">Total Users</div>
                <div className="text-3xl font-bold">{users.length}</div>
              </div>
              <Users className="w-12 h-12 text-green-300 opacity-50" />
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-purple-600 to-purple-700 p-6 rounded-lg shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-purple-200 text-sm mb-1">Active Leagues</div>
                <div className="text-3xl font-bold">{leagues.length}</div>
              </div>
              <Trophy className="w-12 h-12 text-purple-300 opacity-50" />
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-orange-600 to-orange-700 p-6 rounded-lg shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-orange-200 text-sm mb-1">Total Garages</div>
                <div className="text-3xl font-bold">{garages.length}</div>
              </div>
              <DollarSign className="w-12 h-12 text-orange-300 opacity-50" />
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="flex gap-2 mb-6 border-b border-slate-700">
          {['auctions', 'finalize', 'users', 'leagues', 'garages', 'analytics'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-semibold capitalize transition-all ${
                activeTab === tab
                  ? 'bg-blue-600 text-white rounded-t-lg'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800 rounded-t-lg'
              }`}
            >
              {tab === 'finalize' ? (
                <span className="flex items-center gap-2">
                  Finalize
                  {endedAuctions.length > 0 && (
                    <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                      {endedAuctions.length}
                    </span>
                  )}
                </span>
              ) : (
                tab
              )}
            </button>
          ))}
        </div>

        {/* AUCTIONS TAB */}
        {activeTab === 'auctions' && (
          <div>
            <div className="flex gap-3 mb-6">
              <button onClick={() => setShowAddAuction(!showAddAuction)} 
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded flex items-center gap-2">
                <Plus size={20} /> Add Auction
              </button>
              <button onClick={handleExportAuctionsCSV}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center gap-2">
                <Download size={20} /> Export CSV
              </button>
              <label className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded flex items-center gap-2 cursor-pointer">
                <Upload size={20} /> Import CSV
                <input type="file" accept=".csv" onChange={handleImportAuctionsCSV} className="hidden" disabled={csvImporting} />
              </label>
              {csvImporting && <span className="flex items-center text-yellow-400">Importing...</span>}
              <div className="flex-1"></div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input type="text" placeholder="Search auctions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded text-white w-64" />
              </div>
            </div>

            {showAddAuction && (
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-6">
                <h3 className="text-xl font-bold mb-4">Add New Auction</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <input type="text" placeholder="Auction ID (optional)" value={newAuction.auction_id}
                    onChange={(e) => setNewAuction({...newAuction, auction_id: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="Title *" value={newAuction.title}
                    onChange={(e) => setNewAuction({...newAuction, title: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="Make *" value={newAuction.make}
                    onChange={(e) => setNewAuction({...newAuction, make: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="Model *" value={newAuction.model}
                    onChange={(e) => setNewAuction({...newAuction, model: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="number" placeholder="Year" value={newAuction.year}
                    onChange={(e) => setNewAuction({...newAuction, year: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="number" placeholder="Price at 48h" value={newAuction.price_at_48h}
                    onChange={(e) => setNewAuction({...newAuction, price_at_48h: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="number" placeholder="Final Price" value={newAuction.final_price}
                    onChange={(e) => setNewAuction({...newAuction, final_price: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="URL" value={newAuction.url}
                    onChange={(e) => setNewAuction({...newAuction, url: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="Image URL" value={newAuction.image_url}
                    onChange={(e) => setNewAuction({...newAuction, image_url: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600 col-span-2" />
                  <div className="col-span-2">
                    <label className="text-slate-400 text-sm mb-1 block">Auction Event / Reference</label>
                    <input type="text" placeholder="e.g., RM Arizona Car Week, Mecum Kissimmee 2025"
                      value={newAuction.auction_reference}
                      onChange={(e) => setNewAuction({...newAuction, auction_reference: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                    <p className="text-slate-500 text-xs mt-1">Group auctions by their parent auction event for easy selection in leagues</p>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-400 text-sm mb-1 block">Auction End Date *</label>
                    <input type="datetime-local" value={newAuction.timestamp_end}
                      onChange={(e) => setNewAuction({...newAuction, timestamp_end: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                    <p className="text-slate-500 text-xs mt-1">Set when this auction should end</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleAddAuction} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded">
                    Add Auction
                  </button>
                  <button onClick={() => setShowAddAuction(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {showEditAuction && editingAuction && (
              <div className="bg-slate-800 p-6 rounded-lg border border-blue-500 mb-6">
                <h3 className="text-xl font-bold mb-4 text-blue-400">Edit Auction</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="col-span-2">
                    <label className="text-slate-400 text-sm mb-1 block">Auction ID (cannot be changed)</label>
                    <input type="text" value={editingAuction.auction_id} disabled
                      className="bg-slate-900 text-slate-500 p-2 rounded border border-slate-600 w-full cursor-not-allowed" />
                  </div>
                  <input type="text" placeholder="Title *" value={editingAuction.title}
                    onChange={(e) => setEditingAuction({...editingAuction, title: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="Make *" value={editingAuction.make}
                    onChange={(e) => setEditingAuction({...editingAuction, make: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="Model *" value={editingAuction.model}
                    onChange={(e) => setEditingAuction({...editingAuction, model: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="number" placeholder="Year" value={editingAuction.year}
                    onChange={(e) => setEditingAuction({...editingAuction, year: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="number" placeholder="Price at 48h" value={editingAuction.price_at_48h}
                    onChange={(e) => setEditingAuction({...editingAuction, price_at_48h: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="number" placeholder="Final Price" value={editingAuction.final_price}
                    onChange={(e) => setEditingAuction({...editingAuction, final_price: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="URL" value={editingAuction.url}
                    onChange={(e) => setEditingAuction({...editingAuction, url: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="text" placeholder="Image URL" value={editingAuction.image_url}
                    onChange={(e) => setEditingAuction({...editingAuction, image_url: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600 col-span-2" />
                  <div className="col-span-2">
                    <label className="text-slate-400 text-sm mb-1 block">Auction Event / Reference</label>
                    <input type="text" placeholder="e.g., RM Arizona 2026, Mecum Kissimmee 2025"
                      value={editingAuction.auction_reference}
                      onChange={(e) => setEditingAuction({...editingAuction, auction_reference: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                    <p className="text-slate-500 text-xs mt-1">Group auctions by their parent auction event for easy selection in leagues</p>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-400 text-sm mb-1 block">Auction End Date *</label>
                    <input type="datetime-local" value={editingAuction.timestamp_end}
                      onChange={(e) => setEditingAuction({...editingAuction, timestamp_end: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                    <p className="text-slate-500 text-xs mt-1">Set when this auction should end</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleEditAuction} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded">
                    Save Changes
                  </button>
                  <button onClick={() => { setShowEditAuction(false); setEditingAuction(null); }} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <Car size={24} />
              Bring a Trailer Auctions
              <span className="text-sm font-normal text-slate-400 ml-2">
                (in draft window: 4-5 days before end)
              </span>
            </h2>

            <div className="space-y-4">
              {filteredAuctions.length === 0 ? (
                <div className="bg-slate-800 p-8 rounded-lg border border-slate-700 text-center">
                  <div className="text-slate-400 text-lg">
                    {searchTerm ? 'No auctions match your search' : 'No auctions in draft window (4-5 days before end)'}
                  </div>
                  <p className="text-slate-500 text-sm mt-2">
                    {searchTerm
                      ? 'Try a different search term'
                      : 'Auctions appear here when they are 4-5 days from ending and have a day 2 price'}
                  </p>
                </div>
              ) : (
                filteredAuctions.map(auction => (
                  <div key={auction.id} className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-white">{auction.title}</h3>
                        <div className="flex gap-4 mt-2 text-slate-400 text-sm">
                          <span>{auction.year}</span>
                          <span>•</span>
                          <span>{auction.make} {auction.model}</span>
                        </div>
                        <div className="flex gap-4 mt-2">
                          {auction.price_at_48h && (
                            <div>
                              <div className="text-slate-400 text-xs">48h Price</div>
                              <div className="text-white font-semibold">${auction.price_at_48h?.toLocaleString()}</div>
                            </div>
                          )}
                          {auction.final_price && (
                            <div>
                              <div className="text-slate-400 text-xs">Final Price</div>
                              <div className="text-green-400 font-semibold">${auction.final_price?.toLocaleString()}</div>
                            </div>
                          )}
                          {auction.price_at_48h && auction.final_price && (
                            <div>
                              <div className="text-slate-400 text-xs">Gain</div>
                              <div className={`font-semibold ${
                                auction.final_price > auction.price_at_48h ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {calculateGain(auction.price_at_48h, auction.final_price)}%
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        <span className="text-xs text-slate-500">{auction.auction_id}</span>
                        {auction.url && (
                          <a href={auction.url} target="_blank" rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 text-sm">View Auction →</a>
                        )}
                        <button onClick={() => handleDeleteAuction(auction.id)}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1">
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* MANUAL AUCTIONS SECTION */}
            <div className="mt-10 pt-10 border-t border-slate-700">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                <Car size={24} className="text-purple-500" />
                Manual Auctions
                <span className="text-sm font-normal text-slate-400 ml-2">
                  ({manualAuctions.length} total)
                </span>
              </h2>
              <p className="text-slate-400 text-sm mb-6">
                Auctions you've manually created. These can only be added to manual leagues.
              </p>

              <div className="space-y-4">
                {manualAuctions.length === 0 ? (
                  <div className="bg-slate-800 p-8 rounded-lg border border-slate-700 text-center">
                    <div className="text-slate-400 text-lg">No manual auctions yet</div>
                    <p className="text-slate-500 text-sm mt-2">
                      Click "Add Auction" above to create a manual auction
                    </p>
                  </div>
                ) : (
                  manualAuctions
                    .filter(auction => {
                      const searchLower = searchTerm.toLowerCase();
                      return (
                        auction.title?.toLowerCase().includes(searchLower) ||
                        auction.make?.toLowerCase().includes(searchLower) ||
                        auction.model?.toLowerCase().includes(searchLower) ||
                        auction.year?.toString().includes(searchLower)
                      );
                    })
                    .map(auction => (
                      <div key={auction.id} className="bg-slate-800 p-6 rounded-lg border border-purple-500/30">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="text-xl font-bold text-white">{auction.title}</h3>
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30">
                                ✨ Manual
                              </span>
                            </div>
                            <div className="flex gap-4 mt-2 text-slate-400 text-sm">
                              <span>{auction.year}</span>
                              <span>•</span>
                              <span>{auction.make} {auction.model}</span>
                            </div>
                            <div className="flex gap-4 mt-2">
                              {auction.price_at_48h && (
                                <div>
                                  <div className="text-slate-400 text-xs">48h Price</div>
                                  <div className="text-white font-semibold">${auction.price_at_48h?.toLocaleString()}</div>
                                </div>
                              )}
                              {auction.final_price && (
                                <div>
                                  <div className="text-slate-400 text-xs">Final Price</div>
                                  <div className="text-green-400 font-semibold">${auction.final_price?.toLocaleString()}</div>
                                </div>
                              )}
                              {auction.timestamp_end && (
                                <div>
                                  <div className="text-slate-400 text-xs">End Date</div>
                                  <div className="text-white font-semibold">
                                    {new Date(auction.timestamp_end * 1000).toLocaleDateString()}
                                  </div>
                                </div>
                              )}
                              {auction.auction_reference && (
                                <div>
                                  <div className="text-slate-400 text-xs">Auction Event</div>
                                  <div className="text-orange-400 font-semibold">
                                    📍 {auction.auction_reference}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 items-end">
                            <span className="text-xs text-purple-400">{auction.auction_id}</span>
                            {auction.url && (
                              <a href={auction.url} target="_blank" rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-sm">View Auction →</a>
                            )}
                            <button onClick={() => handleStartEdit(auction)}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1">
                              <Edit size={14} /> Edit
                            </button>
                            <button onClick={() => handleDeleteAuction(auction.id)}
                              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1">
                              <Trash2 size={14} /> Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* FINALIZE TAB - Enter final prices for ended auctions */}
        {activeTab === 'finalize' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <CheckCircle size={24} className="text-green-500" />
                  Finalize Auction Results
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  Auto-scrape final prices from BaT, or manually enter them below.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRunAutoFinalizer}
                  disabled={runningAutoFinalizer}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-wait text-white px-4 py-2 rounded flex items-center gap-2"
                >
                  {runningAutoFinalizer ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" /> Scraping BaT...
                    </>
                  ) : (
                    <>
                      <Zap size={18} /> Auto-Scrape from BaT
                    </>
                  )}
                </button>
                <button
                  onClick={loadEndedAuctions}
                  className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded flex items-center gap-2"
                >
                  <RefreshCw size={18} /> Refresh
                </button>
              </div>
            </div>

            {/* BaT finalization health snapshot */}
            {(() => {
              if (loadingHealth && !auctionHealth) {
                return (
                  <div className="mb-6 p-4 rounded-lg border border-slate-700 bg-slate-800/40 text-slate-400 text-sm">
                    Loading auction health...
                  </div>
                );
              }
              if (!auctionHealth) return null;
              if (auctionHealth.error) {
                return (
                  <div className="mb-6 p-4 rounded-lg border border-red-700 bg-red-900/30 text-red-300 text-sm">
                    Health check failed: {auctionHealth.error}
                  </div>
                );
              }

              const tone = {
                healthy: 'border-green-700 bg-green-900/20',
                warning: 'border-yellow-700 bg-yellow-900/20',
                critical: 'border-red-700 bg-red-900/30',
              }[auctionHealth.status] || 'border-slate-700 bg-slate-800/40';

              const headline = {
                healthy: 'BaT finalization loop healthy',
                warning: 'Finalization is running behind',
                critical: 'Finalization appears stalled',
              }[auctionHealth.status] || 'Auction health';

              const b = auctionHealth.last30Days || {};
              const ls = auctionHealth.lastSold;

              return (
                <div className={`mb-6 p-4 rounded-lg border ${tone}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-white font-semibold">{headline}</div>
                      <div className="text-slate-400 text-xs mt-1">
                        Updated {new Date(auctionHealth.timestamp).toLocaleTimeString()} · BaT auctions only
                      </div>
                    </div>
                    <button
                      onClick={loadAuctionHealth}
                      disabled={loadingHealth}
                      className="text-slate-300 hover:text-white text-sm flex items-center gap-1"
                    >
                      <RefreshCw size={14} className={loadingHealth ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    <div className="bg-slate-900/40 rounded p-3">
                      <div className="text-slate-400 text-xs">Stuck pile</div>
                      <div className="text-white text-2xl font-bold">{auctionHealth.stuck.count}</div>
                      <div className="text-slate-500 text-xs">ended &gt;2h ago, no result</div>
                    </div>
                    <div className="bg-slate-900/40 rounded p-3">
                      <div className="text-slate-400 text-xs">Oldest stuck</div>
                      <div className="text-white text-2xl font-bold">
                        {auctionHealth.stuck.count > 0 ? `${auctionHealth.stuck.oldestHoursOverdue}h` : '—'}
                      </div>
                      <div className="text-slate-500 text-xs">overdue (cron health)</div>
                    </div>
                    <div className="bg-slate-900/40 rounded p-3">
                      <div className="text-slate-400 text-xs">Sold (30d)</div>
                      <div className="text-white text-2xl font-bold">{b.sold ?? 0}</div>
                      <div className="text-slate-500 text-xs">
                        RNM {b.reserveNotMet ?? 0} · wdrn {b.withdrawn ?? 0}
                      </div>
                    </div>
                    <div className="bg-slate-900/40 rounded p-3">
                      <div className="text-slate-400 text-xs">Chat loop (7d)</div>
                      <div className="text-white text-2xl font-bold">
                        {auctionHealth.chatLoop?.chatPosted ?? 0}/{auctionHealth.chatLoop?.draftedSold ?? 0}
                      </div>
                      <div className="text-slate-500 text-xs">
                        {(auctionHealth.chatLoop?.missingCount ?? 0) === 0
                          ? 'all sold→chat posted'
                          : `${auctionHealth.chatLoop.missingCount} missing chat msg`}
                      </div>
                    </div>
                    <div className="bg-slate-900/40 rounded p-3">
                      <div className="text-slate-400 text-xs">Susp. withdrawn</div>
                      <div className="text-white text-2xl font-bold">
                        {auctionHealth.suspiciousWithdrawn?.count ?? 0}
                      </div>
                      <div className="text-slate-500 text-xs">$0 final but had bids</div>
                    </div>
                  </div>

                  {ls && (
                    <div className="mt-2 text-xs text-slate-500">
                      Last sale closed: ${ls.final_price.toLocaleString()} · {ls.hours_since_end}h ago · {ls.title?.slice(0, 60) || ls.auction_id}
                    </div>
                  )}

                  {auctionHealth.stuck.count > 0 && auctionHealth.stuck.sample?.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-slate-300 text-sm cursor-pointer hover:text-white">
                        Show {Math.min(auctionHealth.stuck.count, 10)} oldest stuck auction(s)
                      </summary>
                      <ul className="mt-2 ml-4 list-disc text-slate-400 text-xs space-y-1">
                        {auctionHealth.stuck.sample.map((s) => (
                          <li key={s.auction_id}>
                            <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-white underline">
                              {s.title?.slice(0, 70) || s.auction_id}
                            </a>
                            <span className="text-slate-500"> — {s.hours_overdue}h overdue</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {(auctionHealth.chatLoop?.missingCount ?? 0) > 0 && (
                    <details className="mt-3">
                      <summary className="text-slate-300 text-sm cursor-pointer hover:text-white">
                        Show {Math.min(auctionHealth.chatLoop.missingCount, 10)} sold auction(s) missing a chat message
                      </summary>
                      <div className="text-slate-500 text-xs mt-1 ml-4">
                        Drafted+sold but the SQL trigger never posted system_auction_ended. Re-saving final_price will refire the trigger.
                      </div>
                      <ul className="mt-2 ml-4 list-disc text-slate-400 text-xs space-y-1">
                        {auctionHealth.chatLoop.missing.map((m) => (
                          <li key={m.auction_id}>
                            {m.title?.slice(0, 60) || m.auction_id}
                            <span className="text-slate-500"> — sold ${m.final_price.toLocaleString()}, {m.hours_since_end}h ago</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {(auctionHealth.suspiciousWithdrawn?.count ?? 0) > 0 && (
                    <details className="mt-3" open>
                      <summary className="text-slate-300 text-sm cursor-pointer hover:text-white">
                        Show {Math.min(auctionHealth.suspiciousWithdrawn.count, 50)} suspicious withdrawn auction(s)
                      </summary>
                      <div className="text-slate-500 text-xs mt-1 ml-4">
                        These have final_price=0 but received bids. Almost certainly should be Reserve Not Met.
                      </div>
                      <ul className="mt-2 ml-4 text-slate-400 text-xs space-y-1">
                        {auctionHealth.suspiciousWithdrawn.sample.map((s) => {
                          const busy = reclassifyingId === s.auction_id;
                          const priceInput = withdrawnPriceInputs[s.auction_id] || '';
                          return (
                            <li key={s.auction_id} className="flex items-center justify-between gap-3 py-1">
                              <span className="truncate min-w-0">
                                <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-white underline">
                                  {s.title?.slice(0, 60) || s.auction_id}
                                </a>
                                <span className="text-slate-500"> — high bid ${s.current_bid.toLocaleString()}</span>
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <input
                                  type="number"
                                  placeholder="Sold $"
                                  value={priceInput}
                                  onChange={(e) => setWithdrawnPriceInputs(prev => ({ ...prev, [s.auction_id]: e.target.value }))}
                                  disabled={busy}
                                  className="bg-slate-700 text-white px-2 py-1 rounded border border-slate-600 w-24 text-xs"
                                />
                                <button
                                  onClick={() => handleReclassifyWithdrawn(s.auction_id, priceInput)}
                                  disabled={busy || !priceInput || Number(priceInput) <= 0}
                                  className="bg-green-700 hover:bg-green-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white px-2 py-1 rounded text-xs whitespace-nowrap"
                                >
                                  Set sold
                                </button>
                                <button
                                  onClick={() => handleReclassifyWithdrawn(s.auction_id)}
                                  disabled={busy}
                                  className="bg-amber-700 hover:bg-amber-600 disabled:bg-slate-600 text-white px-2 py-1 rounded text-xs whitespace-nowrap"
                                >
                                  Mark RNM
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })()}

            {/* Auto-finalizer result message */}
            {autoFinalizerResult && (
              <div className={`mb-6 p-4 rounded-lg border ${
                autoFinalizerResult.success
                  ? 'bg-green-900/30 border-green-700 text-green-300'
                  : 'bg-red-900/30 border-red-700 text-red-300'
              }`}>
                <div className="flex items-center gap-2">
                  {autoFinalizerResult.success ? <CheckCircle size={20} /> : <Trash2 size={20} />}
                  <span className="font-semibold">{autoFinalizerResult.message}</span>
                </div>
                {autoFinalizerResult.details?.results?.successful?.length > 0 && (
                  <div className="mt-2 text-sm">
                    <div className="text-green-400">Updated:</div>
                    <ul className="ml-4 list-disc">
                      {autoFinalizerResult.details.results.successful.map(a => (
                        <li key={a.id}>{a.title?.slice(0, 50)} - ${a.finalPrice?.toLocaleString()}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {autoFinalizerResult.details?.results?.failed?.length > 0 && (
                  <div className="mt-2 text-sm">
                    <div className="text-red-400">Failed:</div>
                    <ul className="ml-4 list-disc">
                      {autoFinalizerResult.details.results.failed.map(a => (
                        <li key={a.id}>{a.title?.slice(0, 50)} - {a.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Event filter — only shown when there are auctions with an auction_reference */}
            {endedAuctions.some(a => a.auction_reference) && (
              <div className="mb-4 flex items-center gap-3">
                <label className="text-slate-400 text-sm whitespace-nowrap">Filter by event:</label>
                <select
                  value={finalizeEventFilter}
                  onChange={(e) => setFinalizeEventFilter(e.target.value)}
                  className="bg-slate-700 text-white px-3 py-2 rounded border border-slate-600 text-sm"
                >
                  <option value="">All events</option>
                  {[...new Set(endedAuctions.map(a => a.auction_reference).filter(Boolean))].sort().map(ref => (
                    <option key={ref} value={ref}>{ref}</option>
                  ))}
                </select>
                {finalizeEventFilter && (
                  <button
                    onClick={() => setFinalizeEventFilter('')}
                    className="text-slate-400 hover:text-white text-sm underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {(() => {
              const filtered = finalizeEventFilter
                ? endedAuctions.filter(a => a.auction_reference === finalizeEventFilter)
                : endedAuctions;
              return filtered.length === 0 ? (
                <div className="bg-slate-800 p-8 rounded-lg border border-slate-700 text-center">
                  <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
                  <div className="text-slate-400 text-lg">All caught up!</div>
                  <p className="text-slate-500 text-sm mt-2">
                    {finalizeEventFilter
                      ? `No pending auctions for "${finalizeEventFilter}".`
                      : 'No ended auctions need final prices at this time.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filtered.map(auction => (
                    <div key={auction.auction_id} className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-white">{auction.title}</h3>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-slate-400 text-sm">
                            <span>{auction.year}</span>
                            <span>•</span>
                            <span>{auction.make} {auction.model}</span>
                            <span>•</span>
                            <span className="text-orange-400">{formatRelativeTime(auction.timestamp_end)}</span>
                            {auction.auction_reference && (
                              <>
                                <span>•</span>
                                <span className="text-blue-400">{auction.auction_reference}</span>
                              </>
                            )}
                          </div>
                          <div className="flex gap-6 mt-3">
                            {auction.price_at_48h && (
                              <div>
                                <div className="text-slate-400 text-xs">Draft Price (48h)</div>
                                <div className="text-white font-semibold">${auction.price_at_48h?.toLocaleString()}</div>
                              </div>
                            )}
                            {auction.current_bid && (
                              <div>
                                <div className="text-slate-400 text-xs">Last Bid</div>
                                <div className="text-yellow-400 font-semibold">${parseFloat(auction.current_bid)?.toLocaleString()}</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 items-end">
                          <span className="text-xs text-slate-500">{auction.auction_id}</span>
                          {auction.url && (
                            <a href={auction.url} target="_blank" rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 text-sm">View on BaT →</a>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-slate-700">
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <label className="text-slate-400 text-sm mb-1 block">Final Sale Price ($)</label>
                            <input
                              type="number"
                              placeholder="Enter final price..."
                              value={finalPriceInputs[auction.auction_id] || ''}
                              onChange={(e) => setFinalPriceInputs(prev => ({
                                ...prev,
                                [auction.auction_id]: e.target.value
                              }))}
                              className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full"
                              disabled={updatingAuctionId === auction.auction_id}
                            />
                          </div>
                          <div className="flex gap-2 pt-6">
                            <button
                              onClick={() => handleUpdateFinalPrice(auction.auction_id)}
                              disabled={updatingAuctionId === auction.auction_id || !finalPriceInputs[auction.auction_id]}
                              className="bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded flex items-center gap-2"
                            >
                              <CheckCircle size={18} />
                              {updatingAuctionId === auction.auction_id ? 'Saving...' : 'Set Final Price'}
                            </button>
                            <button
                              onClick={() => handleMarkReserveNotMet(auction.auction_id)}
                              disabled={updatingAuctionId === auction.auction_id}
                              className="bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 text-white px-4 py-2 rounded"
                            >
                              Reserve Not Met
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Edit Finalized Prices — collapsible section for correcting already-set prices */}
            <div className="mt-8 border-t border-slate-700 pt-6">
              <button
                onClick={() => {
                  setShowEditFinalized(prev => !prev);
                  if (!showEditFinalized && finalizedAuctions.length === 0) loadFinalizedAuctions();
                }}
                className="flex items-center gap-2 text-slate-300 hover:text-white font-semibold text-base"
              >
                <Edit size={18} className={showEditFinalized ? 'text-yellow-400' : 'text-slate-400'} />
                {showEditFinalized ? 'Hide' : 'Show'} Finalized Auctions (Edit Prices)
              </button>

              {showEditFinalized && (
                <div className="mt-4">
                  <p className="text-slate-400 text-sm mb-4">
                    Use this section to correct a finalized price that was entered incorrectly.
                  </p>
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={loadFinalizedAuctions}
                      className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded flex items-center gap-2 text-sm"
                    >
                      <RefreshCw size={14} /> Refresh
                    </button>
                  </div>
                  {finalizedAuctions.length === 0 ? (
                    <div className="text-slate-500 text-sm">No finalized auctions found.</div>
                  ) : (
                    <div className="space-y-3">
                      {finalizedAuctions.map(auction => (
                        <div key={auction.auction_id} className="bg-slate-800/70 p-4 rounded-lg border border-slate-600">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="text-white font-semibold truncate">{auction.title}</div>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-slate-400 text-xs">
                                <span>{auction.year} {auction.make} {auction.model}</span>
                                {auction.auction_reference && (
                                  <span className="text-blue-400">{auction.auction_reference}</span>
                                )}
                              </div>
                              <div className="mt-1 text-green-400 text-sm font-semibold">
                                Current: ${parseFloat(auction.final_price).toLocaleString()}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="number"
                                placeholder="New price..."
                                value={editFinalPriceInputs[auction.auction_id] || ''}
                                onChange={(e) => setEditFinalPriceInputs(prev => ({
                                  ...prev,
                                  [auction.auction_id]: e.target.value
                                }))}
                                className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-36 text-sm"
                                disabled={editingFinalizedId === auction.auction_id}
                              />
                              <button
                                onClick={() => handleEditFinalizedPrice(auction.auction_id)}
                                disabled={editingFinalizedId === auction.auction_id || !editFinalPriceInputs[auction.auction_id]}
                                className="bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white px-3 py-2 rounded text-sm flex items-center gap-1"
                              >
                                <Edit size={14} />
                                {editingFinalizedId === auction.auction_id ? 'Saving...' : 'Update'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div>
            <div className="flex gap-3 mb-6">
              <button onClick={() => { setShowAddUser(!showAddUser); setShowSeedUsers(false); setSeedResult(null); }}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded flex items-center gap-2">
                <Plus size={20} /> Add User
              </button>
              <button onClick={() => { setShowSeedUsers(!showSeedUsers); setShowAddUser(false); setSeedResult(null); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded flex items-center gap-2">
                <Users size={20} /> Seed Fake Players
              </button>
            </div>

            {showAddUser && (
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-6">
                <h3 className="text-xl font-bold mb-4">Add New User</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <input type="text" placeholder="Username" value={newUser.username}
                    onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input type="email" placeholder="Email" value={newUser.email}
                    onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                </div>
                <div className="flex gap-3">
                  <button onClick={handleAddUser} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded">
                    Add User
                  </button>
                  <button onClick={() => setShowAddUser(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {showSeedUsers && (
              <div className="bg-slate-800 p-6 rounded-lg border border-indigo-700 mb-6">
                <h3 className="text-xl font-bold mb-1 text-indigo-300">Seed Fake Players</h3>
                <p className="text-slate-400 text-sm mb-4">
                  Creates realistic-looking fake players and joins them to a league. Usernames are generated to look like real users (e.g. JakeM, SarahK42).
                </p>
                <div className="grid grid-cols-1 gap-4 mb-4 sm:grid-cols-3">
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">League *</label>
                    <select value={seedConfig.leagueId}
                      onChange={(e) => setSeedConfig({...seedConfig, leagueId: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full">
                      <option value="">-- Select a league --</option>
                      {leagues.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Number of players (1–20)</label>
                    <input type="number" min={1} max={20} value={seedConfig.count}
                      onChange={(e) => setSeedConfig({...seedConfig, count: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={seedConfig.autoPick}
                        onChange={(e) => setSeedConfig({...seedConfig, autoPick: e.target.checked})}
                        className="w-4 h-4 accent-indigo-500" />
                      <span className="text-slate-300 text-sm">Auto-pick cars (exactly 7 per player)</span>
                    </label>
                  </div>
                </div>
                {seedConfig.autoPick && (
                  <p className="text-slate-500 text-xs mb-4">
                    Each player will pick exactly 7 cars spending at least 50% of the league budget — same rules as the app. Existing fake players may be reused across leagues to look natural.
                  </p>
                )}
                <div className="flex gap-3 mb-4">
                  <button onClick={handleSeedFakeUsers} disabled={seeding}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded flex items-center gap-2">
                    {seeding ? <><RefreshCw size={16} className="animate-spin" /> Seeding...</> : <><Play size={16} /> Seed Players</>}
                  </button>
                  <button onClick={() => { setShowSeedUsers(false); setSeedResult(null); }}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded">
                    Cancel
                  </button>
                </div>
                {seedResult && (
                  <div className={`p-4 rounded-lg border ${seedResult.success ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}`}>
                    <p className={`font-semibold ${seedResult.success ? 'text-green-300' : 'text-red-300'}`}>
                      {seedResult.message}
                    </p>
                    {seedResult.success && seedResult.players?.length > 0 && (
                      <p className="text-slate-400 text-sm mt-2">
                        Players created: {seedResult.players.join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-4">
              {users.length === 0 ? (
                <div className="bg-slate-800 p-8 rounded-lg border border-slate-700 text-center">
                  <div className="text-slate-400 text-lg">No users found</div>
                  <p className="text-slate-500 text-sm mt-2">Add your first user above!</p>
                </div>
              ) : (
                users.map(user => (
                  <div key={user.id} className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-xl font-bold text-white">{user.username}</h3>
                        <p className="text-slate-400 text-sm">{user.email}</p>
                        <p className="text-slate-500 text-xs mt-1">
                          Joined: {new Date(user.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button onClick={() => handleDeleteUser(user.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1">
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* LEAGUES TAB */}
        {activeTab === 'leagues' && (
          <div>
            <button onClick={() => setShowAddLeague(!showAddLeague)} 
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded flex items-center gap-2 mb-6">
              <Plus size={20} /> Create New League
            </button>

            {showAddLeague && (
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-6">
                <h3 className="text-xl font-bold mb-4">Create New League</h3>
                <div className="grid grid-cols-1 gap-4 mb-4">
                  <input type="text" placeholder="League Name (e.g., Fall 2024 Championship)" 
                    value={newLeague.name}
                    onChange={(e) => setNewLeague({...newLeague, name: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                  
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Draft Starts At * <span className="text-slate-500">(your local time)</span></label>
                    <input type="datetime-local" value={newLeague.draft_starts_at}
                      onChange={(e) => setNewLeague({...newLeague, draft_starts_at: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                  </div>

                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Draft Ends At * <span className="text-slate-500">(your local time)</span></label>
                    <input type="datetime-local" value={newLeague.draft_ends_at}
                      onChange={(e) => setNewLeague({...newLeague, draft_ends_at: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                  </div>
                  
                  {/* ✅ CHANGE #3: Updated bonus auction dropdown with ALL auctions */}
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Bonus Auction (Optional)</label>
                    <select 
                      value={newLeague.bonus_auction_id}
                      onChange={(e) => setNewLeague({...newLeague, bonus_auction_id: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full"
                    >
                      <option value="">No bonus auction</option>
                      {allAuctionsForBonus.map(auction => {
                        const endDate = new Date(auction.timestamp_end * 1000);
                        const dateStr = endDate.toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });
                        
                        return (
                          <option key={auction.auction_id} value={auction.auction_id}>
                            {auction.title} ({auction.year}) - 🔴 Live - Ends: {dateStr}
                          </option>
                        );
                      })}
                    </select>
                    <p className="text-slate-500 text-xs mt-1">
                      💡 {allAuctionsForBonus.length} active auctions in draft window (4-5 days from ending)
                      <br />
                      ⚡ Bonus car will end at same time as other draft cars
                    </p>
                  </div>
                  
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Visibility</label>
                    <select value={newLeague.is_public}
                      onChange={(e) => setNewLeague({...newLeague, is_public: e.target.value === 'true'})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full">
                      <option value="true">Public</option>
                      <option value="false">Private</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Auction Selection</label>
                    <select value={newLeague.use_manual_auctions}
                      onChange={(e) => setNewLeague({...newLeague, use_manual_auctions: e.target.value === 'true'})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full">
                      <option value="false">Auto (4-5 day window)</option>
                      <option value="true">Manual selection</option>
                    </select>
                    <p className="text-slate-500 text-xs mt-1">
                      {newLeague.use_manual_auctions
                        ? '✨ Manual leagues can only use manually-created auctions. You cannot add BaT auctions to manual leagues.'
                        : '⚡ League will show all BAT auctions in 4-5 day window'}
                    </p>
                  </div>

                  <div className="bg-blue-900/20 border border-blue-500/50 rounded p-4">
                    <label className="text-blue-300 font-semibold text-sm mb-2 block">💰 Spending Limit *</label>
                    <input
                      type="number"
                      placeholder="200000"
                      value={newLeague.spending_limit}
                      onChange={(e) => setNewLeague({...newLeague, spending_limit: parseInt(e.target.value) || 200000})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full text-lg font-bold"
                      min="50000"
                      max="1000000"
                      step="10000"
                    />
                    <p className="text-blue-200 text-sm mt-2">
                      🎯 This is the maximum budget each player gets to spend on cars in this league.
                    </p>
                    <p className="text-slate-400 text-xs mt-1">
                      Default: $200,000 · Range: $50K - $1M
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={handleAddLeague} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded">
                    Create League
                  </button>
                  <button onClick={() => setShowAddLeague(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {leagues.length === 0 ? (
                <div className="bg-slate-800 p-8 rounded-lg border border-slate-700 text-center">
                  <div className="text-slate-400 text-lg">No leagues found</div>
                  <p className="text-slate-500 text-sm mt-2">Create your first league above! Users will be able to join it from your game app.</p>
                </div>
              ) : (
                leagues.map(league => {
                  const members = getLeagueMembers(league.id);
                  return (
                    <div key={league.id} className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-white">{league.name}</h3>
                          <div className="text-slate-400 text-sm mt-2 space-y-1">
                            <p>Created by: {league.creator?.username || 'Admin'}</p>
                            <p>Status: <span className={`font-semibold ${
                              league.status === 'draft' ? 'text-yellow-400' :
                              league.status === 'active' ? 'text-green-400' : 'text-slate-400'
                            }`}>{league.status}</span></p>
                            {league.draft_starts_at && (
                              <p>Draft: {new Date(league.draft_starts_at).toLocaleDateString()} - {new Date(league.draft_ends_at).toLocaleDateString()}</p>
                            )}
                            {league.bonus_auction && (
                              <p>Bonus: {league.bonus_auction.title}</p>
                            )}
                            <p>
                              <span className={`font-semibold ${league.use_manual_auctions ? 'text-purple-400' : 'text-blue-400'}`}>
                                {league.use_manual_auctions ? '✨ Manual auctions' : '⚡ Auto auctions'}
                              </span>
                              {league.use_manual_auctions && (
                                <span className="ml-2 text-purple-300">
                                  ({(leagueAuctions[league.id] || []).length} selected)
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <span className="px-3 py-1 rounded text-sm font-semibold bg-blue-600 text-white">
                            {members.length} members
                          </span>
                          <span className={`px-3 py-1 rounded text-sm font-semibold ${
                            league.is_public ? 'bg-green-600' : 'bg-orange-600'
                          } text-white`}>
                            {league.is_public ? 'Public' : 'Private'}
                          </span>
                          <button onClick={() => handleToggleAuctionType(league.id, league.use_manual_auctions)}
                            className={`${league.use_manual_auctions ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} text-white px-3 py-1 rounded text-sm flex items-center gap-1 justify-center`}>
                            {league.use_manual_auctions ? '⚡ Switch to Auto' : '✨ Switch to Manual'}
                          </button>
                          {league.use_manual_auctions && (
                            <button onClick={() => openAuctionManager(league.id)}
                              className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1">
                              <Car size={14} /> Manage Auctions
                            </button>
                          )}
                          <button onClick={() => copyInviteLink(league.id)}
                            className={`${copiedLeagueId === league.id ? 'bg-green-600' : 'bg-slate-600 hover:bg-slate-500'} text-white px-3 py-1 rounded text-sm flex items-center gap-1 justify-center transition-colors`}>
                            <Link size={14} />
                            {copiedLeagueId === league.id ? 'Copied!' : 'Copy Invite Link'}
                          </button>
                          <button onClick={() => handleDeleteLeague(league.id)}
                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm">
                            Delete
                          </button>
                        </div>
                      </div>
                      
                      {members.length > 0 && (
                        <div className="mt-4 border-t border-slate-700 pt-4">
                          <h4 className="text-sm font-semibold text-slate-400 mb-2">STANDINGS</h4>
                          <div className="space-y-2">
                            {members.map((member, index) => (
                              <div key={member.user_id} className="flex justify-between items-center bg-slate-700 p-2 rounded">
                                <span className="text-white">
                                  <span className="font-bold text-slate-400 mr-2">#{index + 1}</span>
                                  {member.user?.username}
                                </span>
                                <span className="text-green-400 font-semibold">
                                  {member.total_score?.toFixed(2) || 0}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* GARAGES TAB */}
        {activeTab === 'garages' && (
          <div className="space-y-4">
            {garages.length === 0 ? (
              <div className="bg-slate-800 p-8 rounded-lg border border-slate-700 text-center">
                <div className="text-slate-400 text-lg">No garages found</div>
                <p className="text-slate-500 text-sm mt-2">Garages will appear when users join leagues and pick cars.</p>
              </div>
            ) : (
              garages.map(garage => (
                <div key={garage.id} className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {garage.user?.username}'s Garage
                      </h3>
                      <p className="text-slate-400 text-sm">
                        League: {garage.league?.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-green-400">
                        ${garage.remaining_budget?.toLocaleString()}
                      </div>
                      <div className="text-slate-400 text-sm">Remaining</div>
                    </div>
                  </div>
                  
                  {garage.garage_cars && garage.garage_cars.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-slate-400">CARS ({garage.garage_cars.length}/7)</h4>
                      {garage.garage_cars.map(car => (
                        <div key={car.id} className="flex justify-between items-center bg-slate-700 p-3 rounded">
                          <div>
                            <div className="text-white font-medium">
                              {car.auction?.title || 'Unknown car'}
                            </div>
                            <div className="text-slate-400 text-sm">
                              Purchase: ${car.purchase_price?.toLocaleString()}
                            </div>
                          </div>
                          {car.auction?.final_price && (
                            <div className="text-right">
                              <div className="text-white font-semibold">
                                ${car.auction.final_price?.toLocaleString()}
                              </div>
                              <div className={`text-sm font-semibold ${
                                car.auction.final_price > car.purchase_price ? 'text-green-400' : 'text-red-400'
                              }`}>
                                {calculateGain(car.purchase_price, car.auction.final_price)}%
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-400 text-sm">No cars selected yet</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ANALYTICS TAB */}
        {activeTab === 'analytics' && (
          <AuctionAnalytics />
        )}

        {/* AUCTION MANAGER MODAL */}
        {showAuctionManager && managingLeagueId && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
            <div className="bg-slate-800 rounded-lg border-2 border-purple-500 max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="p-6 border-b border-slate-700">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-2">
                      Manage Auctions - {leagues.find(l => l.id === managingLeagueId)?.name}
                    </h2>
                    <p className="text-slate-400 text-sm">
                      {leagues.find(l => l.id === managingLeagueId)?.use_manual_auctions
                        ? '✨ This is a manual league - only manually-created auctions can be added (no BaT auctions).'
                        : 'Search and select specific auctions for this league. You can filter by make, model, or search by title.'
                      }
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAuctionManager(false)}
                    className="text-slate-400 hover:text-white text-3xl leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="p-6 border-b border-slate-700 bg-slate-900">
                <div className="grid grid-cols-5 gap-4">
                  <div className="relative col-span-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                      type="text"
                      placeholder="Search by title..."
                      value={auctionSearchTerm}
                      onChange={(e) => setAuctionSearchTerm(e.target.value)}
                      className="pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded text-white w-full"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Filter by make"
                    value={auctionFilter.make}
                    onChange={(e) => setAuctionFilter({...auctionFilter, make: e.target.value})}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white"
                  />
                  <input
                    type="text"
                    placeholder="Filter by model"
                    value={auctionFilter.model}
                    onChange={(e) => setAuctionFilter({...auctionFilter, model: e.target.value})}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white"
                  />
                  <select
                    value={auctionFilter.auction_reference}
                    onChange={(e) => setAuctionFilter({...auctionFilter, auction_reference: e.target.value})}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white"
                  >
                    <option value="">All Auction Events</option>
                    {(() => {
                      const currentLeague = leagues.find(l => l.id === managingLeagueId);
                      const auctionsList = currentLeague?.use_manual_auctions ? manualAuctions : allAuctions;
                      const uniqueRefs = [...new Set(auctionsList
                        .filter(a => a.auction_reference)
                        .map(a => a.auction_reference)
                      )].sort();
                      return uniqueRefs.map(ref => (
                        <option key={ref} value={ref}>{ref}</option>
                      ));
                    })()}
                  </select>
                </div>
                {/* Add All button for filtered auctions */}
                {auctionFilter.auction_reference && (
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={async () => {
                        const currentLeague = leagues.find(l => l.id === managingLeagueId);
                        const auctionsList = currentLeague?.use_manual_auctions ? manualAuctions : allAuctions;
                        const filteredAuctions = auctionsList.filter(a => {
                          const matchesRef = a.auction_reference === auctionFilter.auction_reference;
                          const notAlreadyAdded = !(leagueAuctions[managingLeagueId] || []).some(la => la.auction_id === a.auction_id);
                          return matchesRef && notAlreadyAdded;
                        });

                        if (filteredAuctions.length === 0) {
                          alert('No auctions to add - all auctions from this event are already in the league');
                          return;
                        }

                        if (!confirm(`Add all ${filteredAuctions.length} auctions from "${auctionFilter.auction_reference}" to this league?`)) {
                          return;
                        }

                        // Add all filtered auctions
                        for (const auction of filteredAuctions) {
                          await handleAddAuctionToLeague(managingLeagueId, auction.auction_id, null);
                        }
                      }}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded flex items-center gap-2"
                    >
                      <Plus size={16} />
                      Add All from "{auctionFilter.auction_reference}"
                    </button>
                    <span className="text-slate-400 text-sm">
                      {(() => {
                        const currentLeague = leagues.find(l => l.id === managingLeagueId);
                        const auctionsList = currentLeague?.use_manual_auctions ? manualAuctions : allAuctions;
                        return auctionsList.filter(a => {
                          const matchesRef = a.auction_reference === auctionFilter.auction_reference;
                          const notAlreadyAdded = !(leagueAuctions[managingLeagueId] || []).some(la => la.auction_id === a.auction_id);
                          return matchesRef && notAlreadyAdded;
                        }).length;
                      })()} auctions available
                    </span>
                  </div>
                )}
              </div>

              {/* Two columns: Available auctions and Selected auctions */}
              <div className="flex-1 overflow-hidden grid grid-cols-2 gap-4 p-6 min-h-0">
                {/* Available Auctions */}
                <div className="flex flex-col min-h-0">
                  <h3 className="text-lg font-bold text-white mb-1 flex-shrink-0">
                    Available Auctions ({
                      (() => {
                        const currentLeague = leagues.find(l => l.id === managingLeagueId);
                        const auctionsList = currentLeague?.use_manual_auctions ? manualAuctions : allAuctions;
                        return auctionsList.filter(a => {
                          const searchLower = auctionSearchTerm.toLowerCase();
                          const makeLower = auctionFilter.make.toLowerCase();
                          const modelLower = auctionFilter.model.toLowerCase();
                          const matchesSearch = !auctionSearchTerm || a.title?.toLowerCase().includes(searchLower);
                          const matchesMake = !auctionFilter.make || a.make?.toLowerCase().includes(makeLower);
                          const matchesModel = !auctionFilter.model || a.model?.toLowerCase().includes(modelLower);
                          const matchesRef = !auctionFilter.auction_reference || a.auction_reference === auctionFilter.auction_reference;
                          const notAlreadyAdded = !(leagueAuctions[managingLeagueId] || []).some(la => la.auction_id === a.auction_id);
                          return matchesSearch && matchesMake && matchesModel && matchesRef && notAlreadyAdded;
                        }).length;
                      })()
                    })
                  </h3>
                  <p className="text-slate-400 text-xs mb-3 flex-shrink-0">
                    {leagues.find(l => l.id === managingLeagueId)?.use_manual_auctions
                      ? 'Only showing manually-created auctions (manual leagues cannot use BaT auctions)'
                      : 'Only showing auctions with future end dates, sorted by soonest first'
                    }
                  </p>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-2 min-h-0">
                    {(() => {
                      const currentLeague = leagues.find(l => l.id === managingLeagueId);
                      const auctionsList = currentLeague?.use_manual_auctions ? manualAuctions : allAuctions;
                      return auctionsList
                        .filter(a => {
                          const searchLower = auctionSearchTerm.toLowerCase();
                          const makeLower = auctionFilter.make.toLowerCase();
                          const modelLower = auctionFilter.model.toLowerCase();
                          const matchesSearch = !auctionSearchTerm || a.title?.toLowerCase().includes(searchLower);
                          const matchesMake = !auctionFilter.make || a.make?.toLowerCase().includes(makeLower);
                          const matchesModel = !auctionFilter.model || a.model?.toLowerCase().includes(modelLower);
                          const matchesRef = !auctionFilter.auction_reference || a.auction_reference === auctionFilter.auction_reference;
                          const notAlreadyAdded = !(leagueAuctions[managingLeagueId] || []).some(la => la.auction_id === a.auction_id);
                          return matchesSearch && matchesMake && matchesModel && matchesRef && notAlreadyAdded;
                        });
                    })()
                      .sort((a, b) => {
                        // Sort by end date - soonest first
                        const aEnd = a.timestamp_end || 0;
                        const bEnd = b.timestamp_end || 0;
                        return aEnd - bEnd;
                      })
                      .slice(0, 50)
                      .map(auction => (
                        <div key={auction.auction_id} className="bg-slate-700 p-3 rounded border border-slate-600">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-white font-medium truncate">{auction.title}</div>
                              <div className="text-slate-400 text-xs mt-1">
                                {auction.year} {auction.make} {auction.model}
                              </div>
                              {auction.price_at_48h && (
                                <div className="text-green-400 text-xs mt-1">
                                  ${auction.price_at_48h?.toLocaleString()}
                                </div>
                              )}
                              {auction.timestamp_end && (
                                <div className={`text-xs mt-1 font-medium ${
                                  auction.timestamp_end < Math.floor(Date.now() / 1000)
                                    ? 'text-red-400'
                                    : auction.timestamp_end < Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60)
                                    ? 'text-yellow-400'
                                    : 'text-blue-400'
                                }`}>
                                  {formatRelativeTime(auction.timestamp_end)}
                                </div>
                              )}
                              {auction.auction_id?.startsWith('manual_') && (
                                <div className="text-purple-400 text-xs mt-1 font-medium">
                                  ✨ Manual auction
                                </div>
                              )}
                              {auction.auction_reference && (
                                <div className="text-orange-400 text-xs mt-1 font-medium">
                                  📍 {auction.auction_reference}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                // If auction already has a valid end date, add directly without custom date picker
                                const now = Math.floor(Date.now() / 1000);
                                if (auction.timestamp_end && auction.timestamp_end > now) {
                                  handleAddAuctionToLeague(managingLeagueId, auction.auction_id, null);
                                } else {
                                  // Show date picker for auctions without valid end dates
                                  setAddingAuctionId(auction.auction_id);
                                  // Set default to 7 days from now
                                  const defaultDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                                  const formatted = defaultDate.toISOString().slice(0, 16);
                                  setCustomEndDateTime(formatted);
                                }
                              }}
                              className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs flex-shrink-0"
                            >
                              <Plus size={14} />
                            </button>
                          </div>

                          {/* Date picker shown only for auctions without valid end dates */}
                          {addingAuctionId === auction.auction_id && (
                            <div className="mt-3 p-3 bg-slate-800 rounded border border-yellow-500">
                              <div className="text-white text-sm font-medium mb-1">Set Custom End Date</div>
                              <div className="text-yellow-400 text-xs mb-2">
                                This auction doesn't have a valid end date. Please set one:
                              </div>
                              <input
                                type="datetime-local"
                                value={customEndDateTime}
                                onChange={(e) => setCustomEndDateTime(e.target.value)}
                                className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full text-sm mb-2"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    const timestamp = Math.floor(new Date(customEndDateTime).getTime() / 1000);
                                    handleAddAuctionToLeague(managingLeagueId, auction.auction_id, timestamp);
                                    setAddingAuctionId(null);
                                    setCustomEndDateTime('');
                                  }}
                                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm flex-1"
                                >
                                  Add with Custom Date
                                </button>
                                <button
                                  onClick={() => {
                                    setAddingAuctionId(null);
                                    setCustomEndDateTime('');
                                  }}
                                  className="bg-slate-600 hover:bg-slate-700 text-white px-3 py-1 rounded text-sm"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>

                {/* Selected Auctions */}
                <div className="flex flex-col border-l border-slate-700 pl-4 min-h-0">
                  <h3 className="text-lg font-bold text-purple-400 mb-3 flex-shrink-0">
                    Selected Auctions ({(leagueAuctions[managingLeagueId] || []).length})
                  </h3>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-2 min-h-0">
                    {(leagueAuctions[managingLeagueId] || []).map(la => (
                      <div key={la.id} className="bg-purple-900/30 p-3 rounded border border-purple-500/50">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-white font-medium truncate">
                              {la.auctions?.title || 'Unknown'}
                            </div>
                            <div className="text-slate-400 text-xs mt-1">
                              {la.auctions?.year} {la.auctions?.make} {la.auctions?.model}
                            </div>
                            {la.custom_end_date ? (
                              <div className="text-purple-300 text-xs mt-1">
                                Custom end: {new Date(la.custom_end_date * 1000).toLocaleString()}
                              </div>
                            ) : (
                              <div className="text-blue-400 text-xs mt-1">
                                Original end: {la.auctions?.timestamp_end ? new Date(la.auctions.timestamp_end * 1000).toLocaleString() : 'Not set'}
                              </div>
                            )}
                            {la.auctions?.auction_reference && (
                              <div className="text-orange-400 text-xs mt-1 font-medium">
                                📍 {la.auctions.auction_reference}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemoveAuctionFromLeague(managingLeagueId, la.auction_id)}
                            className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs flex-shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {(leagueAuctions[managingLeagueId] || []).length === 0 && (
                      <div className="text-slate-500 text-sm text-center py-8">
                        No auctions selected yet. Add some from the left panel.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-slate-700 bg-slate-900">
                <div className="flex items-center justify-between gap-6">
                  {/* Bonus Car Selection */}
                  <div className="flex items-center gap-3 flex-1">
                    <label className="text-slate-400 text-sm whitespace-nowrap flex items-center gap-2">
                      <Zap size={16} className="text-yellow-400" />
                      Bonus Car:
                    </label>
                    <select
                      value={leagues.find(l => l.id === managingLeagueId)?.bonus_auction_id || ''}
                      onChange={(e) => handleSetBonusCar(managingLeagueId, e.target.value)}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 flex-1 max-w-md"
                    >
                      <option value="">No bonus car</option>
                      {(leagueAuctions[managingLeagueId] || []).map(la => (
                        <option key={la.auction_id} value={la.auction_id}>
                          {la.auctions?.title || la.auction_id}
                        </option>
                      ))}
                    </select>
                    {leagues.find(l => l.id === managingLeagueId)?.bonus_auction_id && (
                      <span className="text-yellow-400 text-xs font-medium">
                        ⚡ Bonus car set
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAuctionManager(false)}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPortal;

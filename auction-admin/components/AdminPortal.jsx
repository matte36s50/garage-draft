'use client'
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Search, RefreshCw, Users, Trophy, Car, DollarSign, Upload, Download } from 'lucide-react';

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
    price_at_48h: '', final_price: '', url: '', image_url: ''
  });

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '' });

  const [showAddLeague, setShowAddLeague] = useState(false);
  const [newLeague, setNewLeague] = useState({
    name: '',
    draft_starts_at: '',
    draft_ends_at: '',
    is_public: true,
    bonus_auction_id: ''
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);

  useEffect(() => {
    loadAllData();
  }, []);

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
      
      // ✅ CHANGE #2: Load auctions for bonus car dropdown (SAME 4-5 day window as draft cars)
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
      
      console.log('Data loaded successfully');
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Failed to load data: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ========== AUCTION FUNCTIONS ==========
  const handleAddAuction = async () => {
    if (!newAuction.make || !newAuction.model || !newAuction.title) {
      alert('Please fill in at least Make, Model, and Title');
      return;
    }
    
    try {
      const { supabase } = await import('@/lib/supabase');
      
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
        inserted_at: new Date().toISOString(),
        current_bid: newAuction.price_at_48h || newAuction.final_price || null
      };
      
      const { error } = await supabase.from('auctions').insert([auction]);
      
      if (error) {
        alert('Error: ' + error.message);
      } else {
        alert('Auction added!');
        loadAllData();
        setNewAuction({ auction_id: '', title: '', make: '', model: '', year: '', 
          price_at_48h: '', final_price: '', url: '', image_url: '' });
        setShowAddAuction(false);
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
    const headers = ['auction_id', 'title', 'make', 'model', 'year', 'price_at_48h', 'final_price', 'url', 'image_url'];
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
        auction.image_url || ''
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
          auction_id: values[0] || `imported_${Date.now()}_${i}`,
          title: values[1] || '',
          make: values[2] || '',
          model: values[3] || '',
          year: values[4] ? parseInt(values[4]) : null,
          price_at_48h: values[5] ? parseFloat(values[5]) : null,
          final_price: values[6] ? parseFloat(values[6]) : null,
          url: values[7] || null,
          image_url: values[8] || null,
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
      
      let creatorId = null;
      if (users.length > 0) {
        creatorId = users[0].id;
        console.log('Using first user as creator:', users[0].username);
      } else {
        console.log('No users found - creating admin league with null creator');
      }
      
      const league = {
        name: trimmedName,
        created_by: creatorId,
        draft_starts_at: startDate.toISOString(),
        draft_ends_at: endDate.toISOString(),
        is_public: newLeague.is_public,
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
          bonus_auction_id: ''
        });
        setShowAddLeague(false);
      }
    } catch (error) {
      alert('Failed to create league: ' + error.message);
      console.error('Exception:', error);
    }
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
          {['auctions', 'users', 'leagues', 'garages'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-semibold capitalize transition-all ${
                activeTab === tab 
                  ? 'bg-blue-600 text-white rounded-t-lg' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800 rounded-t-lg'
              }`}
            >
              {tab}
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
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div>
            <button onClick={() => setShowAddUser(!showAddUser)} 
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded flex items-center gap-2 mb-6">
              <Plus size={20} /> Add User
            </button>

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
                    <label className="text-slate-400 text-sm mb-1 block">Draft Starts At *</label>
                    <input type="datetime-local" value={newLeague.draft_starts_at}
                      onChange={(e) => setNewLeague({...newLeague, draft_starts_at: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full" />
                  </div>
                  
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Draft Ends At *</label>
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
      </div>
    </div>
  );
};

export default AdminPortal;

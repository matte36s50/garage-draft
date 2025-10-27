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
      
      const { data: auctionData } = await supabase
        .from('auctions')
        .select('*')
        .order('inserted_at', { ascending: false })
        .limit(200);
      setAuctions(auctionData || []);
      
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
    
    setCsvImporting(true);
    
    try {
      const text = await file.text();
      const lines = text.split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      
      const auctions = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        // Parse CSV line (handle quoted fields)
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let char of lines[i]) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        
        const auction = {};
        headers.forEach((header, index) => {
          let value = values[index]?.replace(/^"|"$/g, '').replace(/""/g, '"') || null;
          
          if (header === 'year' && value) {
            auction[header] = parseInt(value);
          } else if ((header === 'price_at_48h' || header === 'final_price') && value) {
            auction[header] = parseFloat(value);
          } else {
            auction[header] = value;
          }
        });
        
        if (!auction.auction_id) {
          auction.auction_id = `import_${Date.now()}_${i}`;
        }
        
        auction.inserted_at = new Date().toISOString();
        auction.current_bid = auction.price_at_48h || auction.final_price || null;
        
        auctions.push(auction);
      }
      
      if (auctions.length === 0) {
        alert('No valid auctions found in CSV');
        setCsvImporting(false);
        return;
      }
      
      const { supabase } = await import('@/lib/supabase');
      
      // Import in batches of 50
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
      event.target.value = ''; // Reset file input
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

  // ========== LEAGUE FUNCTIONS (UPDATED!) ==========
  const handleAddLeague = async () => {
    if (!newLeague.name || !newLeague.draft_starts_at || !newLeague.draft_ends_at) {
      alert('Please fill in league name and draft dates');
      return;
    }
    
    try {
      const { supabase } = await import('@/lib/supabase');
      
      // Get first user as creator if available, otherwise null (admin-created league)
      let creatorId = null;
      if (users.length > 0) {
        creatorId = users[0].id;
        console.log('Using first user as creator:', users[0].username);
      } else {
        console.log('No users found - creating admin league with null creator');
      }
      
      const league = {
        name: newLeague.name,
        created_by: creatorId, // Can be null for admin-created leagues
        draft_starts_at: new Date(newLeague.draft_starts_at).toISOString(),
        draft_ends_at: new Date(newLeague.draft_ends_at).toISOString(),
        is_public: newLeague.is_public,
        status: 'draft',
        snapshot_created: false
      };
      
      if (newLeague.bonus_auction_id) {
        league.bonus_auction_id = newLeague.bonus_auction_id;
      }
      
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
    return leagueMembers.filter(m => m.league_id === leagueId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-white">Fantasy Auto Auction Admin</h1>
            <p className="text-slate-400 mt-1">Manage your game database</p>
          </div>
          <button onClick={loadAllData}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition">
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-xs font-semibold">AUCTIONS</div>
            <div className="text-2xl font-bold text-white mt-1">{auctions.length}</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-xs font-semibold">USERS</div>
            <div className="text-2xl font-bold text-white mt-1">{users.length}</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-xs font-semibold">LEAGUES</div>
            <div className="text-2xl font-bold text-white mt-1">{leagues.length}</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-xs font-semibold">GARAGES</div>
            <div className="text-2xl font-bold text-white mt-1">{garages.length}</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-xs font-semibold">MEMBERS</div>
            <div className="text-2xl font-bold text-white mt-1">{leagueMembers.length}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-700 overflow-x-auto">
          {[
            { id: 'auctions', label: 'Auctions', icon: Car },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'leagues', label: 'Leagues', icon: Trophy },
            { id: 'garages', label: 'Garages', icon: DollarSign }
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`pb-3 px-4 font-semibold flex items-center gap-2 transition whitespace-nowrap ${
                activeTab === id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-white'
              }`}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {/* AUCTIONS TAB */}
        {activeTab === 'auctions' && (
          <div className="space-y-6">
            <div className="flex gap-4 items-center flex-wrap">
              <button onClick={() => setShowAddAuction(!showAddAuction)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition">
                <Plus size={20} />
                Add Auction
              </button>
              
              <button onClick={handleExportAuctionsCSV}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition">
                <Download size={20} />
                Export CSV
              </button>
              
              <label className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer">
                <Upload size={20} />
                {csvImporting ? 'Importing...' : 'Import CSV'}
                <input type="file" accept=".csv" onChange={handleImportAuctionsCSV}
                  disabled={csvImporting} className="hidden" />
              </label>
              
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 text-slate-400" size={20} />
                <input placeholder="Search auctions..." value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-700 text-white pl-10 pr-4 py-2 rounded-lg border border-slate-600 focus:border-blue-400 outline-none" />
              </div>
            </div>

            {showAddAuction && (
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-600">
                <h3 className="text-xl font-bold text-white mb-4">Add New Auction</h3>
                <div className="grid grid-cols-2 gap-4">
                  <input placeholder="Auction ID (auto)" value={newAuction.auction_id}
                    onChange={(e) => setNewAuction({...newAuction, auction_id: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="Title *" value={newAuction.title}
                    onChange={(e) => setNewAuction({...newAuction, title: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="Make *" value={newAuction.make}
                    onChange={(e) => setNewAuction({...newAuction, make: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="Model *" value={newAuction.model}
                    onChange={(e) => setNewAuction({...newAuction, model: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="Year" type="number" value={newAuction.year}
                    onChange={(e) => setNewAuction({...newAuction, year: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="48h Price" type="number" value={newAuction.price_at_48h}
                    onChange={(e) => setNewAuction({...newAuction, price_at_48h: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="Final Price" type="number" value={newAuction.final_price}
                    onChange={(e) => setNewAuction({...newAuction, final_price: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="BaT URL" value={newAuction.url}
                    onChange={(e) => setNewAuction({...newAuction, url: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="Image URL" value={newAuction.image_url}
                    onChange={(e) => setNewAuction({...newAuction, image_url: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600 col-span-2" />
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={handleAddAuction} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded">
                    Add Auction
                  </button>
                  <button onClick={() => setShowAddAuction(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-slate-300 font-semibold">Title</th>
                      <th className="px-4 py-3 text-left text-slate-300 font-semibold">Make/Model</th>
                      <th className="px-4 py-3 text-left text-slate-300 font-semibold">Year</th>
                      <th className="px-4 py-3 text-left text-slate-300 font-semibold">48h Price</th>
                      <th className="px-4 py-3 text-left text-slate-300 font-semibold">Final</th>
                      <th className="px-4 py-3 text-left text-slate-300 font-semibold">Gain %</th>
                      <th className="px-4 py-3 text-left text-slate-300 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuctions.map((auction) => {
                      const gain = calculateGain(auction.price_at_48h, auction.final_price);
                      return (
                        <tr key={auction.id} className="border-t border-slate-700 hover:bg-slate-750">
                          <td className="px-4 py-3">
                            <div className="text-white font-medium">{auction.title || 'No title'}</div>
                            {auction.url && (
                              <a href={auction.url} target="_blank" rel="noopener noreferrer"
                                className="text-blue-400 text-xs hover:underline">View on BaT →</a>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-300">{auction.make} {auction.model}</td>
                          <td className="px-4 py-3 text-slate-300">{auction.year || '-'}</td>
                          <td className="px-4 py-3 text-slate-300">
                            ${auction.price_at_48h?.toLocaleString() || '-'}
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            ${auction.final_price?.toLocaleString() || '-'}
                          </td>
                          <td className={`px-4 py-3 font-semibold ${
                            gain !== 'N/A' && parseFloat(gain) > 0 ? 'text-green-400' : 
                            gain !== 'N/A' && parseFloat(gain) < 0 ? 'text-red-400' : 'text-slate-400'
                          }`}>
                            {gain !== 'N/A' ? `${gain}%` : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleDeleteAuction(auction.id)}
                              className="bg-red-600 hover:bg-red-700 text-white p-2 rounded">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredAuctions.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  {searchTerm ? 'No auctions match your search' : 'No auctions found'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <button onClick={() => setShowAddUser(!showAddUser)}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2">
              <Plus size={20} />
              Add User
            </button>

            {showAddUser && (
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-600">
                <h3 className="text-xl font-bold text-white mb-4">Add New User</h3>
                <div className="grid grid-cols-2 gap-4">
                  <input placeholder="Username *" value={newUser.username}
                    onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                  <input placeholder="Email *" type="email" value={newUser.email}
                    onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600" />
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={handleAddUser} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded">
                    Add User
                  </button>
                  <button onClick={() => setShowAddUser(false)} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold">Username</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold">Email</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold">Joined</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-slate-700 hover:bg-slate-750">
                      <td className="px-4 py-3 text-white font-medium">{user.username}</td>
                      <td className="px-4 py-3 text-slate-300">{user.email}</td>
                      <td className="px-4 py-3 text-slate-300">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleDeleteUser(user.id)}
                          className="bg-red-600 hover:bg-red-700 text-white p-2 rounded">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <p className="mb-2">No users yet!</p>
                  <p className="text-sm">Users will appear here when they sign up through your game app.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LEAGUES TAB */}
        {activeTab === 'leagues' && (
          <div className="space-y-6">
            <button onClick={() => setShowAddLeague(!showAddLeague)}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2">
              <Plus size={20} />
              Create League
            </button>

            {showAddLeague && (
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-600">
                <h3 className="text-xl font-bold text-white mb-4">Create New League</h3>
                <div className="grid grid-cols-2 gap-4">
                  <input placeholder="League Name *" value={newLeague.name}
                    onChange={(e) => setNewLeague({...newLeague, name: e.target.value})}
                    className="bg-slate-700 text-white p-2 rounded border border-slate-600 col-span-2" />
                  
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
                  
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Bonus Auction (Optional)</label>
                    <select value={newLeague.bonus_auction_id}
                      onChange={(e) => setNewLeague({...newLeague, bonus_auction_id: e.target.value})}
                      className="bg-slate-700 text-white p-2 rounded border border-slate-600 w-full">
                      <option value="">No bonus auction</option>
                      {auctions.slice(0, 50).map(auction => (
                        <option key={auction.auction_id} value={auction.auction_id}>
                          {auction.title} ({auction.year})
                        </option>
                      ))}
                    </select>
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
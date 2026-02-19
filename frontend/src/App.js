import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverInfo, setServerInfo] = useState(null);
  const [newBots, setNewBots] = useState([]);
  const [approvedBots, setApprovedBots] = useState([]);
  const [expiredBots, setExpiredBots] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [newBotData, setNewBotData] = useState({ name: '', phone_number: '' });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('new');
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [fetchingPairingCode, setFetchingPairingCode] = useState(false);

  useEffect(() => {
    if (isLoggedIn) {
      fetchServerInfo();
      fetchBots();
      const interval = setInterval(fetchBots, 10000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn]);

  const fetchServerInfo = async () => {
    try {
      const response = await fetch(`${API_URL}/api/server-info`);
      const data = await response.json();
      setServerInfo(data);
    } catch (error) {
      console.error('Error fetching server info:', error);
    }
  };

  const fetchBots = async () => {
    try {
      const [newRes, approvedRes, expiredRes] = await Promise.all([
        fetch(`${API_URL}/api/instances?start_status=new`),
        fetch(`${API_URL}/api/instances?start_status=approved`),
        fetch(`${API_URL}/api/instances?start_status=expired`)
      ]);
      
      const newData = await newRes.json();
      const approvedData = await approvedRes.json();
      const expiredData = await expiredRes.json();
      
      setNewBots(newData.instances || []);
      setApprovedBots(approvedData.instances || []);
      setExpiredBots(expiredData.instances || []);
    } catch (error) {
      console.error('Error fetching bots:', error);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (response.ok) {
        setIsLoggedIn(true);
      } else {
        alert('Invalid credentials');
      }
    } catch (error) {
      alert('Login failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBotData)
      });
      
      if (response.ok) {
        setShowCreateModal(false);
        setNewBotData({ name: '', phone_number: '' });
        fetchBots();
        fetchServerInfo();
        alert('Bot created successfully!');
      } else {
        const error = await response.json();
        alert(error.detail || 'Failed to create bot');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveBot = async () => {
    if (!selectedBot) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${selectedBot.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_months: selectedDuration })
      });
      
      if (response.ok) {
        setShowApproveModal(false);
        setSelectedBot(null);
        fetchBots();
        fetchServerInfo();
        alert(`Bot approved for ${selectedDuration} month(s)!`);
      } else {
        const error = await response.json();
        alert(error.detail || 'Failed to approve bot');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRenewBot = async () => {
    if (!selectedBot) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${selectedBot.id}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_months: selectedDuration })
      });
      
      if (response.ok) {
        setShowRenewModal(false);
        setSelectedBot(null);
        fetchBots();
        fetchServerInfo();
        alert(`Bot renewed for ${selectedDuration} month(s)!`);
      } else {
        const error = await response.json();
        alert(error.detail || 'Failed to renew bot');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStopBot = async (botId) => {
    if (!window.confirm('Stop this bot?')) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/stop`, {
        method: 'POST'
      });
      if (response.ok) {
        alert('Bot stopped successfully');
        fetchBots();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to stop bot'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartBot = async (botId) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/start`, {
        method: 'POST'
      });
      if (response.ok) {
        alert('Bot start command sent');
        fetchBots();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to start bot'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBot = async (botId) => {
    if (!window.confirm('Delete this bot permanently?')) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        alert('Bot deleted successfully');
        fetchBots();
        fetchServerInfo();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to delete bot'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getPairingCode = async (botId) => {
    setFetchingPairingCode(true);
    setPairingCode('');
    setShowPairingModal(true);
    
    try {
      await fetch(`${API_URL}/api/instances/${botId}/regenerate-code`, { method: 'POST' });
    } catch (e) {
      console.error('Error triggering regeneration:', e);
    }

    let attempts = 0;
    const maxAttempts = 30;

    const poll = async () => {
      try {
        const response = await fetch(`${API_URL}/api/instances/${botId}/pairing-code`);
        const data = await response.json();
        const code = data.pairingCode || data.pairing_code;
        
        if (code) {
          setPairingCode(code);
          setFetchingPairingCode(false);
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 2000);
        } else {
          setPairingCode('TIMEOUT');
          setFetchingPairingCode(false);
        }
      } catch (error) {
        console.error('Polling error:', error);
        if (attempts < maxAttempts) {
           attempts++;
           setTimeout(poll, 2000);
        } else {
           setPairingCode('ERROR');
           setFetchingPairingCode(false);
        }
      }
    };

    poll();
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  const getTimeRemaining = (expiresAt) => {
    if (!expiresAt) return '';
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diff = expiry - now;
    if (diff <= 0) return 'Expired';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `${days}d ${hours}h remaining`;
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-emerald-600 mb-2">TREKKER MAX WABOT</h1>
            <p className="text-gray-600">Multi-Instance Bot Platform</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-lg transition duration-200 disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-emerald-600">TREKKER MAX WABOT</h1>
              {serverInfo && (
                <p className="text-sm text-gray-600 mt-1">
                  Server: <span className="font-semibold">{serverInfo.server_name}</span> | 
                  Total Bots: {serverInfo.total_bots}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition"
              >
                + Create Bot
              </button>
              <button
                onClick={() => setIsLoggedIn(false)}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="bg-white rounded-lg shadow p-1 flex gap-1">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 py-3 rounded-md font-medium transition ${activeTab === 'new' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            New Bots ({newBots.length})
          </button>
          <button
            onClick={() => setActiveTab('approved')}
            className={`flex-1 py-3 rounded-md font-medium transition ${activeTab === 'approved' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Approved Bots ({approvedBots.length})
          </button>
          <button
            onClick={() => setActiveTab('expired')}
            className={`flex-1 py-3 rounded-md font-medium transition ${activeTab === 'expired' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Expired Bots ({expiredBots.length})
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 pb-8">
        {activeTab === 'new' && (
          <div className="space-y-4">
            {newBots.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                No new bots. Click "Create Bot" to add one.
              </div>
            ) : (
              newBots.map(bot => (
                <div key={bot.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-800">{bot.name}</h3>
                      <p className="text-gray-600 mt-1">Phone: {bot.phone_number}</p>
                      <p className="text-sm text-gray-500 mt-2">Created: {formatDate(bot.created_at)}</p>
                      <span className="inline-block mt-3 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                        Pending Approval
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleStartBot(bot.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition">Start</button>
                      <button onClick={() => handleStopBot(bot.id)} className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-medium transition">Stop</button>
                      <button onClick={() => { setSelectedBot(bot); setShowApproveModal(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition">Approve</button>
                      <button 
                        onClick={() => getPairingCode(bot.id)} 
                        disabled={fetchingPairingCode}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium transition disabled:opacity-50"
                      >
                        {fetchingPairingCode ? 'Loading...' : 'Pair Code'}
                      </button>
                      <button onClick={() => handleDeleteBot(bot.id)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition">Delete</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'approved' && (
          <div className="space-y-4">
            {approvedBots.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                No approved bots yet.
              </div>
            ) : (
              approvedBots.map(bot => (
                <div key={bot.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-800">{bot.name}</h3>
                      <p className="text-gray-600 mt-1">Phone: {bot.phone_number}</p>
                      <div className="mt-3 space-y-1 text-sm">
                        <p className="text-gray-600">Duration: {bot.duration_months} month(s)</p>
                        <p className="text-gray-600">Approved: {formatDate(bot.approved_at)}</p>
                        <p className="text-gray-600">Expires: {formatDate(bot.expires_at)}</p>
                        <p className="font-semibold text-emerald-600">{getTimeRemaining(bot.expires_at)}</p>
                      </div>
                      <span className={`inline-block mt-3 px-3 py-1 rounded-full text-sm font-medium ${
                        bot.status === 'connected' ? 'bg-emerald-100 text-emerald-800' : 
                        bot.status === 'connecting' ? 'bg-blue-100 text-blue-800' :
                        bot.status === 'unauthorized' || bot.status === 'offline' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {bot.status === 'connected' ? 'Online' : 
                         bot.status === 'connecting' ? 'Connecting' : 
                         bot.status === 'unauthorized' ? 'Unauthorized (401)' :
                         bot.status.charAt(0).toUpperCase() + bot.status.slice(1)}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleStartBot(bot.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition">Start</button>
                      <button onClick={() => handleStopBot(bot.id)} className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-medium transition">Stop</button>
                      <button 
                        onClick={() => getPairingCode(bot.id)} 
                        disabled={fetchingPairingCode}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium transition disabled:opacity-50"
                      >
                        {fetchingPairingCode ? 'Loading...' : 'Pair Code'}
                      </button>
                      <button onClick={() => handleDeleteBot(bot.id)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition">Delete</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'expired' && (
          <div className="space-y-4">
            {expiredBots.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                No expired bots.
              </div>
            ) : (
              expiredBots.map(bot => (
                <div key={bot.id} className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-800">{bot.name}</h3>
                      <p className="text-gray-600 mt-1">Phone: {bot.phone_number}</p>
                      <div className="mt-3 space-y-1 text-sm">
                        <p className="text-gray-600">Last Duration: {bot.duration_months} month(s)</p>
                        <p className="text-gray-600">Expired: {formatDate(bot.expires_at)}</p>
                      </div>
                      <span className="inline-block mt-3 px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
                        Expired - Payment Required
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setSelectedBot(bot); setShowRenewModal(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition">Renew</button>
                      <button onClick={() => handleDeleteBot(bot.id)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition">Delete</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4">Create New Bot</h2>
            <form onSubmit={handleCreateBot} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bot Name</label>
                <input
                  type="text"
                  value={newBotData.name}
                  onChange={(e) => setNewBotData({...newBotData, name: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg text-gray-900 bg-white"
                  placeholder="e.g. My Awesome Bot"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={newBotData.phone_number}
                  onChange={(e) => setNewBotData({...newBotData, phone_number: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg text-gray-900 bg-white"
                  placeholder="e.g. 254704897825"
                  required
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="submit" disabled={loading} className="flex-1 bg-emerald-600 text-white py-2 rounded-lg font-medium">{loading ? 'Creating...' : 'Create'}</button>
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg font-medium">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showApproveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-2">Approve Bot</h2>
            <p className="text-gray-600 mb-4">Set duration for {selectedBot?.name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (Months)</label>
                <select
                  value={selectedDuration}
                  onChange={(e) => setSelectedDuration(parseInt(e.target.value))}
                  className="w-full px-4 py-2 border rounded-lg text-gray-900 bg-white"
                >
                  <option value={1}>1 Month</option>
                  <option value={3}>3 Months</option>
                  <option value={6}>6 Months</option>
                  <option value={12}>12 Months</option>
                </select>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={handleApproveBot} disabled={loading} className="flex-1 bg-emerald-600 text-white py-2 rounded-lg font-medium">{loading ? 'Processing...' : 'Approve Now'}</button>
                <button onClick={() => setShowApproveModal(false)} className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg font-medium">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRenewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-2">Renew Bot</h2>
            <p className="text-gray-600 mb-4">Extend duration for {selectedBot?.name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (Months)</label>
                <select
                  value={selectedDuration}
                  onChange={(e) => setSelectedDuration(parseInt(e.target.value))}
                  className="w-full px-4 py-2 border rounded-lg text-gray-900 bg-white"
                >
                  <option value={1}>1 Month</option>
                  <option value={3}>3 Months</option>
                  <option value={6}>6 Months</option>
                  <option value={12}>12 Months</option>
                </select>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={handleRenewBot} disabled={loading} className="flex-1 bg-emerald-600 text-white py-2 rounded-lg font-medium">{loading ? 'Renewing...' : 'Renew Now'}</button>
                <button onClick={() => setShowRenewModal(false)} className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg font-medium">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPairingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-8 text-center">
            <h2 className="text-2xl font-bold mb-4">WhatsApp Pairing Code</h2>
            <p className="text-gray-600 mb-6">Enter this code on your phone in Linked Devices &gt; Link with Phone Number</p>
            <div className="bg-gray-100 rounded-xl p-6 mb-6">
              {fetchingPairingCode ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mb-3"></div>
                  <p className="text-sm font-medium text-emerald-600">Requesting code...</p>
                </div>
              ) : pairingCode === 'TIMEOUT' ? (
                <p className="text-xl font-bold text-red-500">Request Timed Out. Please try again.</p>
              ) : pairingCode === 'ERROR' ? (
                <p className="text-xl font-bold text-red-500">Error generating code. Is the bot running?</p>
              ) : (
                <p className="text-4xl font-mono font-bold tracking-widest text-gray-800">{pairingCode}</p>
              )}
            </div>
            <button onClick={() => setShowPairingModal(false)} className="w-full bg-emerald-600 text-white py-3 rounded-lg font-bold">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

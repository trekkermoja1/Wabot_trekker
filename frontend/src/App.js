import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

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
        fetch(`${API_URL}/api/instances?status=new`),
        fetch(`${API_URL}/api/instances?status=approved`),
        fetch(`${API_URL}/api/instances?status=expired`)
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
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/pairing-code`);
      const data = await response.json();
      console.log('Pairing code response:', data);
      if (data.pairing_code) {
        setPairingCode(data.pairing_code);
        setShowPairingModal(true);
      } else {
        alert('No pairing code available yet. Please wait a moment and try again.');
      }
    } catch (error) {
      console.error('Error fetching pairing code:', error);
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const regeneratePairingCode = async (botId) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/regenerate-code`, {
        method: 'POST'
      });
      const data = await response.json();
      console.log('Regenerate response:', data);
      if (data.pairingCode) {
        setPairingCode(data.pairingCode);
        setShowPairingModal(true);
      } else {
        alert('Failed to regenerate pairing code. Please try again.');
      }
    } catch (error) {
      console.error('Error regenerating pairing code:', error);
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
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
      {/* Header */}
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

      {/* Tabs */}
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

      {/* Bot Lists */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 pb-8">
        {/* New Bots */}
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
                      <button
                        onClick={() => {
                          setSelectedBot(bot);
                          setShowApproveModal(true);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => getPairingCode(bot.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        Get Pair Code
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Approved Bots */}
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
                      <span className="inline-block mt-3 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-medium">
                        Active
                      </span>
                    </div>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={() => getPairingCode(bot.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        Pair Code
                      </button>
                      <button
                        onClick={() => regeneratePairingCode(bot.id)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={() => handleStopBot(bot.id)}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        Stop
                      </button>
                      <button
                        onClick={() => handleDeleteBot(bot.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Expired Bots */}
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
                      <button
                        onClick={() => {
                          setSelectedBot(bot);
                          setShowRenewModal(true);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        Renew / Pay
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Create Bot Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Create New Bot</h2>
            
            <form onSubmit={handleCreateBot} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Bot Name</label>
                <input
                  type="text"
                  value={newBotData.name}
                  onChange={(e) => setNewBotData({...newBotData, name: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  placeholder="My Bot"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                <input
                  type="text"
                  value={newBotData.phone_number}
                  onChange={(e) => setNewBotData({...newBotData, phone_number: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  placeholder="+1234567890"
                  required
                />
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-3 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve Bot Modal */}
      {showApproveModal && selectedBot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Approve Bot</h2>
            <p className="text-gray-600 mb-6">Bot: <span className="font-semibold">{selectedBot.name}</span></p>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">Select Duration</label>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 6, 12].map(months => (
                  <button
                    key={months}
                    type="button"
                    onClick={() => setSelectedDuration(months)}
                    className={`py-3 rounded-lg font-medium transition ${
                      selectedDuration === months
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                    }`}
                  >
                    {months} Month{months > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowApproveModal(false);
                  setSelectedBot(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-3 rounded-lg font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveBot}
                disabled={loading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
              >
                {loading ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Renew Bot Modal */}
      {showRenewModal && selectedBot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Renew / Pay for Bot</h2>
            <p className="text-gray-600 mb-6">Bot: <span className="font-semibold">{selectedBot.name}</span></p>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">Select Duration</label>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 6, 12].map(months => (
                  <button
                    key={months}
                    type="button"
                    onClick={() => setSelectedDuration(months)}
                    className={`py-3 rounded-lg font-medium transition ${
                      selectedDuration === months
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                    }`}
                  >
                    {months} Month{months > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowRenewModal(false);
                  setSelectedBot(null);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-3 rounded-lg font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRenewBot}
                disabled={loading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Renew & Pay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pairing Code Modal */}
      {showPairingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">WhatsApp Pairing Code</h2>
            
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-6 mb-6 text-center">
              <p className="text-sm text-gray-600 mb-2">Enter this code in WhatsApp:</p>
              <p className="text-4xl font-bold text-emerald-600 tracking-wider font-mono">
                {pairingCode}
              </p>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700 mb-2 font-medium">How to pair:</p>
              <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                <li>Open WhatsApp on your phone</li>
                <li>Go to Settings → Linked Devices</li>
                <li>Tap "Link a Device"</li>
                <li>Enter the code above</li>
              </ol>
            </div>
            
            <button
              onClick={() => {
                setShowPairingModal(false);
                setPairingCode('');
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-medium transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

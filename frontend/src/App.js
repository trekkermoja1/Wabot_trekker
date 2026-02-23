import React, { useState, useEffect } from 'react';
import './App.css';

const API_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverInfo, setServerInfo] = useState(null);
  const [allBots, setAllBots] = useState([]);
  const [serverBots, setServerBots] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [newBotData, setNewBotData] = useState({ name: '', phone_number: '' });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('server');
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [fetchingPairingCode, setFetchingPairingCode] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatbotConfig, setChatbotConfig] = useState({ 
    chatbot_enabled: true, 
    chatbot_api_key: '', 
    chatbot_base_url: 'https://ai.megallm.io/v1',
    sec_db_host: 'turquoise-wilhuff-tarkin.aks1.eastus2.azure.cratedb.net',
    sec_db_port: 5432,
    sec_db_name: 'crate',
    sec_db_user: 'admin',
    sec_db_pass: '' 
  });

  useEffect(() => {
    if (isLoggedIn) {
      fetchServerInfo();
      fetchAllBots();
      fetchServerBots();
      const interval = setInterval(() => {
        fetchServerBots();
        fetchAllBots();
      }, 10000);
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

  const fetchAllBots = async () => {
    try {
      const response = await fetch(`${API_URL}/api/instances/all`);
      const data = await response.json();
      setAllBots(data.instances || []);
    } catch (error) {
      console.error('Error fetching all bots:', error);
    }
  };

  const fetchServerBots = async () => {
    try {
      const response = await fetch(`${API_URL}/api/instances/server-bots`);
      const data = await response.json();
      setServerBots(data.instances || []);
    } catch (error) {
      console.error('Error fetching server bots:', error);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/instances/search?query=${encodeURIComponent(query)}`);
      const data = await response.json();
      setSearchResults(data.instances || []);
    } catch (error) {
      console.error('Search error:', error);
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
        fetchAllBots();
        fetchServerBots();
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

  const handleStartBot = async (botId) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/start`, { method: 'POST' });
      if (response.ok) {
        alert('Bot start command sent');
        fetchServerBots();
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

  const handleStopBot = async (botId) => {
    if (!window.confirm('Stop this bot?')) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/stop`, { method: 'POST' });
      if (response.ok) {
        alert('Bot stopped successfully');
        fetchServerBots();
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

  const handleRestartBot = async (botId) => {
    if (!window.confirm('Restart this bot?')) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/restart`, { method: 'POST' });
      if (response.ok) {
        alert('Bot restart command sent');
        fetchServerBots();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to restart bot'));
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
      const response = await fetch(`${API_URL}/api/instances/${botId}`, { method: 'DELETE' });
      if (response.ok) {
        alert('Bot deleted successfully');
        fetchAllBots();
        fetchServerBots();
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

  const handleDeleteBotFromDb = async (botId) => {
    if (!window.confirm('Delete this bot from database? This will remove it from all servers.')) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/db`, { method: 'DELETE' });
      if (response.ok) {
        alert('Bot deleted from database');
        fetchAllBots();
        fetchServerBots();
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

  const handleApproveBot = async (botId) => {
    if (!selectedBot) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_months: selectedDuration })
      });
      
      if (response.ok) {
        setShowSettingsModal(false);
        setSelectedBot(null);
        fetchAllBots();
        fetchServerBots();
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

  const handleToggleAutoview = async (botId, currentStatus) => {
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/autoview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentStatus })
      });
      
      if (response.ok) {
        fetchAllBots();
        fetchServerBots();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to update autoview'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  const handleUpdateBotName = async (botId, newName) => {
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      
      if (response.ok) {
        fetchAllBots();
        fetchServerBots();
        alert('Bot name updated!');
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to update name'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  const handleToggleEnable = async (botId, currentStatus) => {
    const enabled = currentStatus !== 'disabled';
    try {
      const response = await fetch(`${API_URL}/api/instances/${botId}/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled })
      });
      
      if (response.ok) {
        fetchServerBots();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to toggle status'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
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

  const fetchChatbotConfig = async (botId) => {
    try {
      // Fetch global config
      const globalResponse = await fetch(`${API_URL}/api/chatbot/global-config`);
      const globalData = await globalResponse.json();
      
      setChatbotConfig({
        chatbot_enabled: true,
        chatbot_api_key: globalData.chatbot_api_key || '',
        chatbot_base_url: globalData.chatbot_base_url || 'https://ai.megallm.io/v1',
        sec_db_host: globalData.sec_db_host || 'turquoise-wilhuff-tarkin.aks1.eastus2.azure.cratedb.net',
        sec_db_port: globalData.sec_db_port || 5432,
        sec_db_name: globalData.sec_db_name || 'crate',
        sec_db_user: globalData.sec_db_user || 'admin',
        sec_db_pass: globalData.sec_db_pass || ''
      });
    } catch (error) {
      console.error('Error fetching chatbot config:', error);
    }
  };

  const handleSaveChatbotConfig = async (botId) => {
    try {
      // Save global config for all bots
      const response = await fetch(`${API_URL}/api/chatbot/global-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatbotConfig)
      });
      
      if (response.ok) {
        alert('Global chatbot configuration saved for all bots!');
        fetchAllBots();
        fetchServerBots();
      } else {
        const error = await response.json();
        alert('Error: ' + (error.detail || 'Failed to save chatbot config'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  const getStatusColor = (status) => {
    if (status === 'connected') return 'bg-emerald-100 text-emerald-700 border-emerald-300';
    if (status === 'connecting' || status === 'pairing') return 'bg-blue-100 text-blue-700 border-blue-300';
    if (status === 'unauthorized' || status === 'offline') return 'bg-red-100 text-red-700 border-red-300';
    if (status === 'disabled') return 'bg-gray-100 text-gray-700 border-gray-300';
    return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  };

  const getStartStatusBadge = (status) => {
    if (status === 'approved') return 'bg-emerald-500';
    if (status === 'expired') return 'bg-red-500';
    return 'bg-yellow-500';
  };

  const BotCard = ({ bot, showDbActions = false, isSearchResult = false }) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-800 truncate">{bot.name}</h3>
            <span className={`w-2 h-2 rounded-full ${getStartStatusBadge(bot.start_status)}`}></span>
          </div>
          <p className="text-gray-600 text-sm mb-2">📱 {bot.phone_number}</p>
          <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-2">
            <span className="bg-gray-100 px-2 py-1 rounded">ID: {bot.id}</span>
            <span className="bg-gray-100 px-2 py-1 rounded">Server: {bot.server_name}</span>
            {bot.port && <span className="bg-gray-100 px-2 py-1 rounded">Port: {bot.port}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(bot.status)}`}>
              {bot.status === 'connected' ? '🟢 Online' : 
               bot.status === 'connecting' ? '🔵 Connecting' : 
               bot.status === 'unauthorized' ? '🔴 Unauthorized' :
               bot.status === 'disabled' ? '⚫ Disabled' :
               '⚪ Offline'}
            </span>
            {bot.start_status === 'approved' && bot.expires_at && (
              <span className="text-xs text-emerald-600 font-medium">{getTimeRemaining(bot.expires_at)}</span>
            )}
            {bot.start_status === 'expired' && (
              <span className="px-2 py-1 bg-red-100 text-red-600 text-xs rounded">Expired</span>
            )}
          </div>
          {bot.autoview !== undefined && (
            <div className="mt-2">
              <button 
                onClick={() => handleToggleAutoview(bot.id, bot.autoview)}
                className={`text-xs px-2 py-1 rounded ${bot.autoview ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}
              >
                AutoView: {bot.autoview ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 ml-4">
          {isSearchResult && (
            <>
              <button 
                onClick={() => { setSelectedBot(bot); setShowSettingsModal(true); fetchChatbotConfig(bot.id); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition"
              >
                ⚙️ Settings
              </button>
              <button 
                onClick={() => handleDeleteBotFromDb(bot.id)}
                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition"
              >
                🗑️ Delete
              </button>
            </>
          )}
          {!isSearchResult && bot.server_name === serverInfo?.server_name && (
            <>
              <button onClick={() => handleStartBot(bot.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">▶ Start</button>
              <button onClick={() => handleStopBot(bot.id)} className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">⏹ Stop</button>
              <button onClick={() => handleRestartBot(bot.id)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">🔄 Restart</button>
              <button onClick={() => handleToggleEnable(bot.id, bot.status)} className={`${bot.status === 'disabled' ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'} text-white px-3 py-1.5 rounded-lg text-sm font-medium transition`}>
                {bot.status === 'disabled' ? '✓ Enable' : '✗ Disable'}
              </button>
              <button onClick={() => getPairingCode(bot.id)} className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">🔑 Code</button>
              <button onClick={() => { setSelectedBot(bot); setShowSettingsModal(true); fetchChatbotConfig(bot.id); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">⚙️ Settings</button>
              <button onClick={() => handleDeleteBot(bot.id)} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">🗑️ Delete</button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const SettingsModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Bot Settings</h2>
        {selectedBot && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bot Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="botNameInput"
                  defaultValue={selectedBot.name}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-900 bg-white"
                />
                <button 
                  onClick={() => {
                    const newName = document.getElementById('botNameInput').value;
                    handleUpdateBotName(selectedBot.id, newName);
                  }}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg"
                >
                  Save
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <p className="text-gray-900 bg-gray-100 px-4 py-2 rounded-lg">{selectedBot.phone_number}</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Server</label>
              <p className="text-gray-900 bg-gray-100 px-4 py-2 rounded-lg">{selectedBot.server_name}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AutoView Status</label>
              <button 
                onClick={() => handleToggleAutoview(selectedBot.id, selectedBot.autoview)}
                className={`w-full py-2 rounded-lg font-medium transition ${
                  selectedBot.autoview ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {selectedBot.autoview ? '✅ AutoView ON' : '❌ AutoView OFF'}
              </button>
            </div>

            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">🤖 Chatbot Configuration (Global for All Bots)</label>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Chatbot API Key</label>
                  <input
                    type="password"
                    value={chatbotConfig.chatbot_api_key}
                    onChange={(e) => setChatbotConfig({...chatbotConfig, chatbot_api_key: e.target.value})}
                    placeholder="sk-mega-..."
                    className="w-full px-4 py-2 border rounded-lg text-gray-900 bg-white"
                  />
                </div>
                
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={chatbotConfig.chatbot_base_url}
                    onChange={(e) => setChatbotConfig({...chatbotConfig, chatbot_base_url: e.target.value})}
                    placeholder="https://ai.megallm.io/v1"
                    className="w-full px-4 py-2 border rounded-lg text-gray-900 bg-white"
                  />
                </div>

                <div className="border-t pt-3 mt-3">
                  <label className="block text-xs font-medium text-gray-700 mb-2">💾 Conversation Database (CrateDB)</label>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Host</label>
                      <input
                        type="text"
                        value={chatbotConfig.sec_db_host}
                        onChange={(e) => setChatbotConfig({...chatbotConfig, sec_db_host: e.target.value})}
                        placeholder="turquoise-...cratedb.net"
                        className="w-full px-2 py-1 border rounded text-gray-900 bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Port</label>
                      <input
                        type="number"
                        value={chatbotConfig.sec_db_port}
                        onChange={(e) => setChatbotConfig({...chatbotConfig, sec_db_port: parseInt(e.target.value)})}
                        placeholder="5432"
                        className="w-full px-2 py-1 border rounded text-gray-900 bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Database</label>
                      <input
                        type="text"
                        value={chatbotConfig.sec_db_name}
                        onChange={(e) => setChatbotConfig({...chatbotConfig, sec_db_name: e.target.value})}
                        placeholder="crate"
                        className="w-full px-2 py-1 border rounded text-gray-900 bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Username</label>
                      <input
                        type="text"
                        value={chatbotConfig.sec_db_user}
                        onChange={(e) => setChatbotConfig({...chatbotConfig, sec_db_user: e.target.value})}
                        placeholder="admin"
                        className="w-full px-2 py-1 border rounded text-gray-900 bg-white text-sm"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs text-gray-500 mb-1">Password</label>
                    <input
                      type="password"
                      value={chatbotConfig.sec_db_pass}
                      onChange={(e) => setChatbotConfig({...chatbotConfig, sec_db_pass: e.target.value})}
                      placeholder="CrateDB password"
                      className="w-full px-4 py-2 border rounded-lg text-gray-900 bg-white"
                    />
                  </div>
                </div>

                <button 
                  onClick={() => handleSaveChatbotConfig(selectedBot.id)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium transition"
                >
                  💾 Save Chatbot Config
                </button>
              </div>
            </div>

            {selectedBot.start_status === 'new' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Approve Duration</label>
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
                <button 
                  onClick={() => handleApproveBot(selectedBot.id)}
                  disabled={loading}
                  className="w-full mt-2 bg-emerald-600 text-white py-2 rounded-lg font-medium"
                >
                  {loading ? 'Processing...' : 'Approve Bot'}
                </button>
              </div>
            )}

            <div className="pt-4 border-t">
              <button 
                onClick={() => handleDeleteBotFromDb(selectedBot.id)}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg font-medium transition"
              >
                🗑️ Delete Bot from Database
              </button>
            </div>
          </div>
        )}
        <button onClick={() => setShowSettingsModal(false)} className="w-full mt-4 bg-gray-200 text-gray-800 py-2 rounded-lg font-medium">Close</button>
      </div>
    </div>
  );

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl p-8 w-full max-w-md border border-white/20">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-2xl mx-auto mb-4 flex items-center justify-center text-4xl">
              🤖
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">TREKKER MAX</h1>
            <p className="text-gray-300">Multi-Instance Bot Platform</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-white placeholder-gray-400"
                placeholder="Enter username"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-white placeholder-gray-400"
                placeholder="Enter password"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-semibold py-3 rounded-xl transition duration-200 disabled:opacity-50"
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
      <header className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-xl flex items-center justify-center text-2xl">
                🤖
              </div>
              <div>
                <h1 className="text-xl font-bold">TREKKER MAX</h1>
                {serverInfo && (
                  <p className="text-xs text-gray-300">
                    {serverInfo.server_name} • {serverInfo.total_bots} Bots
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSearchModal(true)}
                className="bg-white/10 hover:bg-white/20 backdrop-blur px-4 py-2 rounded-lg font-medium transition flex items-center gap-2"
              >
                🔍 Search
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 px-4 py-2 rounded-lg font-medium transition flex items-center gap-2"
              >
                ➕ Create Bot
              </button>
              <button
                onClick={() => setIsLoggedIn(false)}
                className="bg-white/10 hover:bg-white/20 backdrop-blur px-4 py-2 rounded-lg font-medium transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 border border-emerald-200">
              <p className="text-emerald-600 text-sm font-medium">Approved</p>
              <p className="text-2xl font-bold text-emerald-700">{serverInfo?.approved_bots || 0}</p>
            </div>
            <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-xl p-4 border border-yellow-200">
              <p className="text-yellow-600 text-sm font-medium">New</p>
              <p className="text-2xl font-bold text-yellow-700">{serverInfo?.new_bots || 0}</p>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4 border border-red-200">
              <p className="text-red-600 text-sm font-medium">Expired</p>
              <p className="text-2xl font-bold text-red-700">{serverInfo?.expired_bots || 0}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
              <p className="text-purple-600 text-sm font-medium">Total All</p>
              <p className="text-2xl font-bold text-purple-700">{allBots.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-1 flex gap-1">
          <button
            onClick={() => setActiveTab('server')}
            className={`flex-1 py-3 rounded-lg font-medium transition ${activeTab === 'server' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            🖥️ This Server ({serverBots.length})
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`flex-1 py-3 rounded-lg font-medium transition ${activeTab === 'database' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            🗄️ Database Registry ({allBots.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 pb-8">
        {activeTab === 'server' && (
          <div className="space-y-4">
            {serverBots.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
                <div className="text-6xl mb-4">🤖</div>
                <p className="text-lg">No bots on this server</p>
                <p className="text-sm mt-2">Click "Create Bot" to add one</p>
              </div>
            ) : (
              serverBots.map(bot => (
                <BotCard key={bot.id} bot={bot} />
              ))
            )}
          </div>
        )}

        {activeTab === 'database' && (
          <div className="space-y-4">
            {allBots.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
                <div className="text-6xl mb-4">🗄️</div>
                <p className="text-lg">No bots in database</p>
              </div>
            ) : (
              allBots.map(bot => (
                <BotCard key={bot.id} bot={bot} showDbActions={true} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Create New Bot</h2>
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

      {/* Search Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">🔍 Search Bots</h2>
            <div className="mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 bg-white text-lg"
                placeholder="Search by phone number, ID, or name..."
                autoFocus
              />
            </div>
            <div className="space-y-3">
              {searchResults.length === 0 && searchQuery.length >= 2 && (
                <p className="text-gray-500 text-center py-4">No bots found</p>
              )}
              {searchResults.map(bot => (
                <BotCard key={bot.id} bot={bot} isSearchResult={true} />
              ))}
            </div>
            <button onClick={() => { setShowSearchModal(false); setSearchResults([]); setSearchQuery(''); }} className="w-full mt-4 bg-gray-200 text-gray-800 py-2 rounded-lg font-medium">Close</button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && <SettingsModal />}

      {/* Pairing Modal */}
      {showPairingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-8 text-center">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">WhatsApp Pairing Code</h2>
            <p className="text-gray-600 mb-6">Enter this code on your phone in Linked Devices</p>
            <div className="bg-gradient-to-br from-emerald-50 to-cyan-50 rounded-2xl p-6 mb-6 border-2 border-dashed border-emerald-300">
              {fetchingPairingCode ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mb-3"></div>
                  <p className="text-sm font-medium text-emerald-600">Requesting code...</p>
                </div>
              ) : pairingCode === 'TIMEOUT' ? (
                <p className="text-xl font-bold text-red-500">Request Timed Out</p>
              ) : pairingCode === 'ERROR' ? (
                <p className="text-xl font-bold text-red-500">Error generating code</p>
              ) : (
                <p className="text-5xl font-mono font-bold tracking-widest text-gray-800">{pairingCode}</p>
              )}
            </div>
            <button onClick={() => setShowPairingModal(false)} className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-white py-3 rounded-xl font-bold">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

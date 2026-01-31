const settings = {
  packname: 'TREKKER MAX',
  author: 'Trekker',
  botName: "TREKKER MAX WABOT",
  botOwner: 'trekker',
  ownerNumber: '254704897825',
  sudoNumber: ['254704897825', '115363375272042', '280234452607229', '7198767878239'],  // Sudo users for bot management
  giphyApiKey: 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
  commandMode: "public",
  maxStoreMessages: 20,
  storeWriteInterval: 10000,
  description: "TREKKER MAX WABOT - Multi-Instance WhatsApp Bot Platform",
  version: "1.0.0",
  updateZipUrl: "",
  // Backend API for bot management
  backendApiUrl: process.env.BACKEND_URL || 
                process.env.BACKEND_API_URL || 
                (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://0.0.0.0:5000'),
};

module.exports = settings;

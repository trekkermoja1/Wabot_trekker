const settings = {
  packname: 'TREKKER MAX',
  author: 'Trekker',
  botName: "TREKKER MAX WABOT",
  botOwner: 'Trekker Team',
  ownerNumber: '254750433158',
  sudoNumber: '254704897825',  // Sudo user for bot management
  giphyApiKey: 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
  commandMode: "public",
  maxStoreMessages: 20,
  storeWriteInterval: 10000,
  description: "TREKKER MAX WABOT - Multi-Instance WhatsApp Bot Platform",
  version: "1.0.0",
  updateZipUrl: "",
  // Backend API for bot management
  backendApiUrl: process.env.BACKEND_API_URL || 'http://localhost:8001',
};

module.exports = settings;

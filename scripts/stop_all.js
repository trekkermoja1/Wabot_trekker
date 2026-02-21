#!/usr/bin/env node
const axios = require('axios');

const BACKEND = process.env.BACKEND_URL || process.env.BACKEND || 'http://127.0.0.1:5000';
const SERVERNAME = (process.env.SERVER_NAME || process.env.SERVERNAME || 'server1').toLowerCase();

async function main() {
  try {
    console.log(`Querying backend for instances at ${BACKEND}...`);
    const resp = await axios.get(`${BACKEND.replace(/\/$/, '')}/api/instances`, { timeout: 5000 });
    const instances = resp.data.instances || [];

    const local = instances.filter(i => (i.server_name || '').toLowerCase() === SERVERNAME);
    if (local.length === 0) {
      console.log(`No instances found for server: ${SERVERNAME}`);
      process.exit(0);
    }

    console.log(`Found ${local.length} instance(s) for server ${SERVERNAME} - sending stop commands...`);
    for (const inst of local) {
      try {
        process.stdout.write(`Stopping ${inst.id}... `);
        await axios.post(`${BACKEND.replace(/\/$/, '')}/api/instances/${inst.id}/stop`, {}, { timeout: 10000 });
        console.log('OK');
      } catch (e) {
        console.log('FAIL');
        console.error(`  Error stopping ${inst.id}:`, e.message || e);
      }
    }

    console.log('Stop commands completed.');
    process.exit(0);
  } catch (e) {
    console.error('Failed to stop instances:', e.message || e);
    process.exit(1);
  }
}

main();

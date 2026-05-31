const fs = require('fs');
const path = require('path');

// Manually parse .env to avoid dependency on dotenv or specific node version flags
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    console.error('.env file not found!');
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index === -1) return;
    const key = trimmed.substring(0, index).trim();
    const val = trimmed.substring(index + 1).trim();
    process.env[key] = val;
  });
}

loadEnv();

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';

console.log('Using Client ID:', SPOTIFY_CLIENT_ID);

async function testSpotify() {
  try {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
      return;
    }

    const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    console.log('Fetching token...');
    const resToken = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!resToken.ok) {
      console.log('Failed to fetch token:', resToken.status, await resToken.text());
      return;
    }

    const tokenData = await resToken.json();
    const token = tokenData.access_token;
    console.log('Token fetched successfully!');

    console.log('Searching for Michael Jackson...');
    const searchParams = new URLSearchParams({
      q: 'Michael Jackson',
      type: 'artist',
      limit: '1',
    });

    const resSearch = await fetch(`${SEARCH_URL}?${searchParams}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log('Search Status:', resSearch.status);
    const searchText = await resSearch.text();
    console.log('Search Response:', searchText.substring(0, 1000));
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testSpotify();

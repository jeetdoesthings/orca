const SPOTIFY_CLIENT_ID = '2920c114f129415fb6782ffbbf75f5c1';
const SPOTIFY_CLIENT_SECRET = 'ee5435beeed04044a66821932a151e0e';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';

async function testSpotify() {
  try {
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

const client_id = '***REDACTED-SPOTIFY-CLIENT-ID***';
const client_secret = '***REDACTED-SPOTIFY-CLIENT-SECRET***';
const artistName = 'Tame Impala';

async function test() {
  try {
    console.log('Resolving token...');
    const credentials = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenRes.ok) {
      console.error('Token fetch failed:', tokenRes.status, await tokenRes.text());
      return;
    }

    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    console.log('Token received successfully.');

    const searchParams = new URLSearchParams({
      q: artistName,
      type: 'artist',
      limit: '1',
    });
    const searchRes = await fetch(`https://api.spotify.com/v1/search?${searchParams}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!searchRes.ok) {
      console.error('Search failed:', searchRes.status, await searchRes.text());
      return;
    }

    const searchData = await searchRes.json();
    const artist = searchData?.artists?.items?.[0];
    if (!artist) {
      console.error('No artist found on Spotify.');
      return;
    }

    console.log('Artist resolved:', artist.name, 'ID:', artist.id);

    console.log('Fetching top tracks...');
    const tracksRes = await fetch(`https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Top tracks status:', tracksRes.status);
    const tracksData = await tracksRes.json();
    console.log('Tracks count:', tracksData.tracks?.length);

    console.log('Fetching albums...');
    const albumsRes = await fetch(`https://api.spotify.com/v1/artists/${artist.id}/albums?include_groups=album,single&limit=15`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Albums status:', albumsRes.status);
    const albumsData = await albumsRes.json();
    console.log('Albums count:', albumsData.items?.length);

  } catch (err) {
    console.error('Diagnostic error:', err);
  }
}

test();

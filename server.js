#!/usr/bin/env node
/**
 * Suno Embed Explorer - Server
 *
 * Serves the HTML page and provides an API for fetching playlist songs.
 *
 * Usage: node server.js
 * Then open: http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;

// Puppeteer launch options (configured for Railway/production)
const getPuppeteerOptions = () => ({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
    ]
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch playlist songs using Puppeteer
async function fetchPlaylistSongs(playlistUrl) {
    const playlistMatch = playlistUrl.match(/suno\.com\/playlist\/([a-f0-9-]+)/i);
    if (!playlistMatch) {
        throw new Error('Invalid playlist URL');
    }

    const playlistId = playlistMatch[1].toLowerCase();
    let browser;

    try {
        browser = await puppeteer.launch(getPuppeteerOptions());

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto(playlistUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);

        // Scroll to load all songs
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 200);
                setTimeout(() => { clearInterval(timer); resolve(); }, 10000);
            });
        });

        await sleep(2000);

        // Extract song data with titles
        const songData = await page.evaluate((plId) => {
            const uuids = new Set();
            const songs = [];

            // Find song links and try to get titles
            document.querySelectorAll('a[href*="/song/"]').forEach(a => {
                const match = a.href.match(/\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                if (match && match[1].toLowerCase() !== plId && !uuids.has(match[1].toLowerCase())) {
                    const uuid = match[1].toLowerCase();
                    uuids.add(uuid);

                    // Try to find the song title from nearby elements
                    let title = '';
                    let artist = '';

                    // Look for title in parent container
                    const container = a.closest('[class*="card"], [class*="item"], [class*="track"], [class*="song"], div');
                    if (container) {
                        // Try various selectors for title
                        const titleEl = container.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"], p');
                        if (titleEl && titleEl.textContent.trim().length > 0 && titleEl.textContent.trim().length < 100) {
                            title = titleEl.textContent.trim();
                        }

                        // Try to find artist
                        const artistEl = container.querySelector('[class*="artist"], [class*="creator"], [class*="author"]');
                        if (artistEl) {
                            artist = artistEl.textContent.trim();
                        }
                    }

                    // If no title found, check if the link itself has text
                    if (!title && a.textContent.trim().length > 0 && a.textContent.trim().length < 100) {
                        title = a.textContent.trim();
                    }

                    songs.push({ uuid, title: title || '', artist: artist || '' });
                }
            });

            // Fallback: find all UUIDs in page
            if (songs.length === 0) {
                const html = document.body.innerHTML;
                const allUuids = html.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi) || [];
                [...new Set(allUuids.map(u => u.toLowerCase()))]
                    .filter(u => u !== plId)
                    .forEach(uuid => songs.push({ uuid, title: '', artist: '' }));
            }

            const titleEl = document.querySelector('h1');
            return {
                playlistId: plId,
                playlistTitle: titleEl ? titleEl.textContent.trim() : 'Unknown Playlist',
                songs
            };
        }, playlistId);

        return songData;

    } finally {
        if (browser) await browser.close();
    }
}

// Fetch individual song info
async function fetchSongInfo(uuid) {
    let browser;
    try {
        browser = await puppeteer.launch(getPuppeteerOptions());

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Use faster loading strategy - just wait for DOM, not all network requests
        await page.goto(`https://suno.com/song/${uuid}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await sleep(1000);

        const songInfo = await page.evaluate(() => {
            // Try to get title from various sources
            let title = '';

            // Try og:title first (usually most reliable)
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle && ogTitle.content) {
                title = ogTitle.content.trim();
                // Remove " | Suno" suffix if present
                title = title.replace(/\s*\|\s*Suno$/i, '').trim();
            }

            // Try h1 as fallback
            if (!title) {
                const h1 = document.querySelector('h1');
                if (h1) title = h1.textContent.trim();
            }

            // Try document title as last resort
            if (!title && document.title) {
                title = document.title.replace(/\s*[-|]?\s*Suno.*$/i, '').trim();
            }

            // Get og:image for cover
            const ogImage = document.querySelector('meta[property="og:image"]');
            const coverUrl = ogImage ? ogImage.content : null;

            // Try to find artist/creator from multiple sources
            let artist = '';

            // Method 1: Look for profile links with /@username pattern
            const profileLinks = document.querySelectorAll('a[href*="/@"]');
            for (const link of profileLinks) {
                const href = link.getAttribute('href');
                const match = href.match(/\/@([^\/\?]+)/);
                if (match) {
                    artist = match[1];
                    break;
                }
            }

            // Method 2: Check og:description for "by @username" pattern
            if (!artist) {
                const ogDesc = document.querySelector('meta[property="og:description"]');
                if (ogDesc && ogDesc.content) {
                    const byMatch = ogDesc.content.match(/by\s+@?(\w+)/i);
                    if (byMatch) artist = byMatch[1];
                }
            }

            // Method 3: Look for any element containing @ followed by username
            if (!artist) {
                const textContent = document.body.innerText;
                const atMatch = textContent.match(/@(\w{3,20})/);
                if (atMatch) artist = atMatch[1];
            }

            // Method 4: Look for creator/artist class elements
            if (!artist) {
                const creatorEl = document.querySelector('[class*="creator"], [class*="artist"], [class*="author"], [class*="user"]');
                if (creatorEl) {
                    artist = creatorEl.textContent.trim().replace(/^@/, '');
                }
            }

            if (!artist) artist = 'Suno AI';

            return { title, artist, coverUrl };
        });

        return songInfo;
    } catch (e) {
        // Don't log timeout errors as they're expected sometimes
        if (!e.message.includes('timeout')) {
            console.error('Error fetching song info:', e.message);
        }
        // Return partial data with cover URL guess
        return {
            title: '',
            artist: '',
            coverUrl: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`
        };
    } finally {
        if (browser) await browser.close();
    }
}

// Fetch multiple songs with a single browser instance
async function fetchSongInfoBatch(uuids) {
    let browser;
    const results = {};

    try {
        browser = await puppeteer.launch(getPuppeteerOptions());

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        for (const uuid of uuids) {
            try {
                await page.goto(`https://suno.com/song/${uuid}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
                await sleep(800);

                const songInfo = await page.evaluate(() => {
                    let title = '';
                    const ogTitle = document.querySelector('meta[property="og:title"]');
                    if (ogTitle && ogTitle.content) {
                        title = ogTitle.content.trim().replace(/\s*\|\s*Suno$/i, '').trim();
                    }
                    if (!title) {
                        const h1 = document.querySelector('h1');
                        if (h1) title = h1.textContent.trim();
                    }

                    const ogImage = document.querySelector('meta[property="og:image"]');
                    const coverUrl = ogImage ? ogImage.content : null;

                    let artist = '';
                    const profileLinks = document.querySelectorAll('a[href*="/@"]');
                    for (const link of profileLinks) {
                        const href = link.getAttribute('href');
                        const match = href.match(/\/@([^\/\?]+)/);
                        if (match) {
                            artist = match[1];
                            break;
                        }
                    }
                    if (!artist) {
                        const ogDesc = document.querySelector('meta[property="og:description"]');
                        if (ogDesc && ogDesc.content) {
                            const byMatch = ogDesc.content.match(/by\s+@?(\w+)/i);
                            if (byMatch) artist = byMatch[1];
                        }
                    }
                    if (!artist) artist = 'Suno AI';

                    return { title, artist, coverUrl };
                });

                results[uuid] = songInfo;
            } catch (e) {
                // Use fallback data for this song
                results[uuid] = {
                    title: '',
                    artist: '',
                    coverUrl: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`
                };
            }
        }

        return results;
    } catch (e) {
        console.error('Batch fetch error:', e.message);
        // Return fallback for all
        for (const uuid of uuids) {
            results[uuid] = {
                title: '',
                artist: '',
                coverUrl: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`
            };
        }
        return results;
    } finally {
        if (browser) await browser.close();
    }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // API endpoint to fetch song info (single)
    if (url.pathname === '/api/fetch-song-info' && req.method === 'GET') {
        const uuid = url.searchParams.get('uuid');

        if (!uuid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing uuid parameter' }));
            return;
        }

        try {
            const info = await fetchSongInfo(uuid);
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(info || {}));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // API endpoint to fetch song info (batch) - much faster!
    if (url.pathname === '/api/fetch-songs-batch' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { uuids } = JSON.parse(body);
                if (!uuids || !Array.isArray(uuids)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing uuids array' }));
                    return;
                }

                console.log(`Batch fetching ${uuids.length} songs...`);
                const results = await fetchSongInfoBatch(uuids);
                console.log(`Batch fetch complete`);

                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify(results));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // API endpoint to fetch playlist
    if (url.pathname === '/api/fetch-playlist' && req.method === 'GET') {
        const playlistUrl = url.searchParams.get('url');

        if (!playlistUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing url parameter' }));
            return;
        }

        try {
            console.log(`Fetching playlist: ${playlistUrl}`);
            const data = await fetchPlaylistSongs(playlistUrl);
            console.log(`Found ${data.songs.length} songs`);

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(data));
        } catch (error) {
            console.error('Error:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Redirect root to playlist player
    if (url.pathname === '/') {
        res.writeHead(302, { 'Location': '/playlist.html' });
        res.end();
        return;
    }

    // Serve static files
    let filePath = path.join(__dirname, url.pathname);

    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
    };

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentTypes[extname] || 'text/plain' });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║             Suno Playlist Player - Server Running              ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║   Player:  http://localhost:${PORT}                                ║
║                                                                ║
║   Direct playlist link:                                        ║
║   http://localhost:${PORT}/?url=YOUR_SUNO_PLAYLIST_URL             ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
});

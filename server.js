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

// Fetch individual song info using direct HTTP (much faster than Puppeteer)
async function fetchSongInfo(uuid) {
    try {
        const response = await fetch(`https://suno.com/song/${uuid}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(8000) // 8 second timeout
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();

        // Check for __NEXT_DATA__ which contains server-rendered data
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (nextDataMatch) {
            try {
                const nextData = JSON.parse(nextDataMatch[1]);
                const pageProps = nextData.props?.pageProps || {};
                console.log(`[${uuid}] __NEXT_DATA__ pageProps keys:`, Object.keys(pageProps));

                // Log the clip/song data if available
                const clip = pageProps.clip;
                if (clip) {
                    console.log(`[${uuid}] Clip found:`, {
                        title: clip.title,
                        display_name: clip.display_name,
                        handle: clip.handle,
                        user_display_name: clip.user_display_name,
                        created_by: clip.created_by
                    });
                } else {
                    console.log(`[${uuid}] No clip in pageProps. Available:`, Object.keys(pageProps).join(', ') || '(empty)');
                    // Log first level of any object that might contain song data
                    for (const key of Object.keys(pageProps)) {
                        const val = pageProps[key];
                        if (val && typeof val === 'object') {
                            console.log(`[${uuid}]   ${key} keys:`, Object.keys(val).slice(0, 10).join(', '));
                        }
                    }
                }
            } catch (e) {
                console.log(`[${uuid}] Could not parse __NEXT_DATA__:`, e.message);
            }
        } else {
            console.log(`[${uuid}] No __NEXT_DATA__ found in HTML (length: ${html.length})`);
        }

        // Parse og:title
        let title = '';
        const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
        if (ogTitleMatch) {
            title = ogTitleMatch[1].replace(/\s*\|\s*Suno$/i, '').trim();
        }
        console.log(`[${uuid}] og:title = "${title || '(not found)'}"`);

        // Parse og:image
        let coverUrl = null;
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
        if (ogImageMatch) {
            coverUrl = ogImageMatch[1];
        }

        // Parse og:description for artist (handle different attribute orders)
        let artist = '';

        // Try property then content
        let ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
        // Try content then property
        if (!ogDescMatch) {
            ogDescMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
        }

        console.log(`[${uuid}] og:description = "${ogDescMatch ? ogDescMatch[1] : '(not found)'}"`);

        if (ogDescMatch) {
            // Look for "by @username" or "by username" pattern
            const byMatch = ogDescMatch[1].match(/by\s+@?(\w+)/i);
            if (byMatch) artist = byMatch[1];
        }

        // Fallback: look for /@username links in the HTML
        if (!artist) {
            const atMatch = html.match(/href=["']?\/@([a-zA-Z0-9_]+)["']?/i);
            if (atMatch) artist = atMatch[1];
        }

        // Fallback: look for "by @username" anywhere in HTML
        if (!artist) {
            const byAnyMatch = html.match(/by\s+@([a-zA-Z0-9_]+)/i);
            if (byAnyMatch) artist = byAnyMatch[1];
        }

        // Fallback: look for twitter:creator meta tag
        if (!artist) {
            const twitterMatch = html.match(/<meta[^>]*name=["']twitter:creator["'][^>]*content=["']@?([^"']+)["']/i);
            if (twitterMatch) artist = twitterMatch[1];
        }

        if (!artist) artist = 'Suno AI';

        console.log(`[${uuid}] Final result: title="${title}", artist="${artist}"`);
        return { title, artist, coverUrl };
    } catch (e) {
        if (!e.message.includes('timeout')) {
            console.error('Error fetching song info:', e.message);
        }
        return {
            title: '',
            artist: '',
            coverUrl: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`
        };
    }
}

// Fetch artist names using Puppeteer (slower but accurate)
async function fetchArtistsViaPuppeteer(uuids) {
    const results = {};
    let browser;

    try {
        browser = await puppeteer.launch(getPuppeteerOptions());
        console.log(`[Puppeteer] Browser launched, fetching ${uuids.length} artists...`);

        // Process one at a time to avoid overwhelming
        for (const uuid of uuids) {
            let page;
            try {
                page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                await page.goto(`https://suno.com/song/${uuid}`, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });

                // Wait for the artist link to appear (or timeout after 10s)
                try {
                    await page.waitForSelector('a[href^="/@"]', { timeout: 10000 });
                } catch (e) {
                    // Selector not found, continue anyway
                }

                // Extract artist from the page
                const artist = await page.evaluate(() => {
                    // Look for the artist link (/@username)
                    const artistLink = document.querySelector('a[href^="/@"]');
                    if (artistLink) {
                        return artistLink.textContent.trim();
                    }
                    return null;
                });

                console.log(`[Puppeteer] ${uuid}: artist = "${artist || '(not found)'}"`);
                results[uuid] = { artist: artist || 'Suno AI' };

            } catch (e) {
                console.log(`[Puppeteer] ${uuid}: error - ${e.message}`);
                results[uuid] = { artist: 'Suno AI' };
            } finally {
                if (page) await page.close();
            }
        }

    } finally {
        if (browser) await browser.close();
        console.log(`[Puppeteer] Browser closed, fetched ${Object.keys(results).length} artists`);
    }

    return results;
}

// Fetch multiple songs using direct HTTP (parallel for speed)
async function fetchSongInfoBatch(uuids) {
    const results = {};

    // Fetch all songs in parallel for maximum speed
    const fetchPromises = uuids.map(async (uuid) => {
        try {
            const info = await fetchSongInfo(uuid);
            results[uuid] = info;
        } catch (e) {
            results[uuid] = {
                title: '',
                artist: '',
                coverUrl: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`
            };
        }
    });

    await Promise.all(fetchPromises);
    return results;
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

    // API endpoint to fetch artist names via Puppeteer (SSE - streams results as found)
    if (url.pathname === '/api/fetch-artists-stream' && req.method === 'GET') {
        const uuidsParam = url.searchParams.get('uuids');
        if (!uuidsParam) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing uuids parameter' }));
            return;
        }

        const uuids = uuidsParam.split(',');
        console.log(`Streaming artists for ${uuids.length} songs via Puppeteer...`);

        // Setup SSE
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // Stream each artist as found
        (async () => {
            let browser;
            try {
                browser = await puppeteer.launch(getPuppeteerOptions());
                console.log(`[Puppeteer] Browser launched for streaming...`);

                for (const uuid of uuids) {
                    let page;
                    let artist = 'Suno AI';
                    try {
                        page = await browser.newPage();
                        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                        await page.goto(`https://suno.com/song/${uuid}`, {
                            waitUntil: 'domcontentloaded',
                            timeout: 30000
                        });

                        try {
                            await page.waitForSelector('a[href^="/@"]', { timeout: 10000 });
                        } catch (e) {
                            // Selector not found, continue anyway
                        }

                        const foundArtist = await page.evaluate(() => {
                            const artistLink = document.querySelector('a[href^="/@"]');
                            return artistLink ? artistLink.textContent.trim() : null;
                        });

                        if (foundArtist) artist = foundArtist;
                        console.log(`[Puppeteer] ${uuid}: artist = "${artist}"`);

                    } catch (e) {
                        console.log(`[Puppeteer] ${uuid}: error - ${e.message}`);
                    } finally {
                        if (page) await page.close();
                    }

                    // Send this result immediately
                    res.write(`data: ${JSON.stringify({ uuid, artist })}\n\n`);
                }

                // Send done event
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                res.end();

            } catch (e) {
                console.log(`[Puppeteer] Stream error: ${e.message}`);
                res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
                res.end();
            } finally {
                if (browser) await browser.close();
                console.log(`[Puppeteer] Browser closed`);
            }
        })();

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

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

// Puppeteer launch options (environment-aware)
const getPuppeteerOptions = () => {
    const isDocker = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.NODE_ENV === 'production';

    const args = [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
    ];

    // These flags are needed for Docker but can cause crashes locally
    if (isDocker) {
        args.push(
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--single-process',
            '--no-zygote'
        );
    }

    return {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args,
        // Disable Chrome's crash reporter which can cause issues
        ignoreDefaultArgs: ['--enable-crashpad']
    };
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Decode HTML entities in strings
function decodeHtmlEntities(str) {
    if (!str) return str;
    return str
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&#x22;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num))
        .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

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

            // Extract playlist title and creator
            const titleEl = document.querySelector('h1');

            // Find playlist creator (/@username link)
            let creatorUsername = null;
            const creatorLink = document.querySelector('a[href^="/@"]');
            if (creatorLink) {
                const match = creatorLink.href.match(/\/@([a-zA-Z0-9_]+)/);
                if (match) creatorUsername = match[1];
            }

            // Extract playlist description (line-clamp-3 span)
            let playlistDescription = '';
            const descEl = document.querySelector('span.line-clamp-3');
            if (descEl) {
                playlistDescription = descEl.textContent.trim();
            }

            return {
                playlistId: plId,
                playlistTitle: titleEl ? titleEl.textContent.trim() : 'Unknown Playlist',
                playlistDescription,
                creatorUsername,
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
        let songStyle = '';
        let songDescription = '';
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

                    // Extract style from metadata.tags (comma-separated string)
                    if (clip.metadata?.tags) {
                        songStyle = clip.metadata.tags;
                        console.log(`[${uuid}] Style from metadata.tags: "${songStyle.substring(0, 100)}..."`);
                    }

                    // Extract description/prompt from metadata.prompt
                    if (clip.metadata?.prompt) {
                        songDescription = clip.metadata.prompt;
                        console.log(`[${uuid}] Description from metadata.prompt: "${songDescription.substring(0, 100)}..."`);
                    }
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
            title = decodeHtmlEntities(ogTitleMatch[1].replace(/\s*\|\s*Suno$/i, '').trim());
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

        console.log(`[${uuid}] Final result: title="${title}", artist="${artist}", style="${songStyle ? 'yes' : 'no'}", desc="${songDescription ? 'yes' : 'no'}"`);
        return { title, artist, coverUrl, style: songStyle, description: songDescription };
    } catch (e) {
        if (!e.message.includes('timeout')) {
            console.error('Error fetching song info:', e.message);
        }
        return {
            title: '',
            artist: '',
            coverUrl: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`,
            style: '',
            description: ''
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

// Fetch a user's playlists from their profile page
async function fetchUserPlaylists(username) {
    // First, try direct API call (much faster if it works)
    try {
        console.log(`[UserPlaylists] Trying direct API for @${username}...`);
        const apiResponse = await fetch(`https://studio-api.suno.ai/api/profiles/${username}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(10000)
        });

        if (apiResponse.ok) {
            const data = await apiResponse.json();
            console.log(`[UserPlaylists] API response keys:`, Object.keys(data));

            // Handle different response formats
            let playlists = data.playlists || data.items || data.results || data;
            if (Array.isArray(playlists) && playlists.length > 0) {
                const result = playlists.map(p => ({
                    id: p.id || p.playlist_id,
                    url: `https://suno.com/playlist/${p.id || p.playlist_id}`,
                    title: p.name || p.title || 'Playlist',
                    coverUrl: p.image_url || p.image || p.cover_url || null,
                    songCount: p.num_total_results || p.song_count || null
                })).filter(p => p.id);

                console.log(`[UserPlaylists] Found ${result.length} playlists via API`);
                return result;
            }
        } else {
            console.log(`[UserPlaylists] API returned ${apiResponse.status}`);
        }
    } catch (e) {
        console.log(`[UserPlaylists] API call failed: ${e.message}`);
    }

    // Fallback to Puppeteer
    let browser;

    try {
        browser = await puppeteer.launch(getPuppeteerOptions());
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Try to avoid bot detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        // Intercept network requests to find API calls
        const apiCalls = [];
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('api') || url.includes('playlist')) {
                apiCalls.push(url);
            }
            request.continue();
        });

        // Go to the user's profile page
        const profileUrl = `https://suno.com/@${username}`;
        console.log(`[UserPlaylists] Navigating to: ${profileUrl}`);
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait longer for JS to render and API calls to happen
        await sleep(8000);

        // Log any API calls we intercepted
        if (apiCalls.length > 0) {
            console.log(`[UserPlaylists] Intercepted API calls:`);
            apiCalls.forEach(url => console.log(`  - ${url}`));
        }

        // Wait for content to load - look for any link or give it time
        try {
            await page.waitForSelector('a[href*="/playlist/"]', { timeout: 5000 });
            console.log(`[UserPlaylists] Found playlist links`);
        } catch (e) {
            console.log(`[UserPlaylists] No playlist links found after waiting`);
        }

        await sleep(1000);

        // Scroll to load more content
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
                setTimeout(() => { clearInterval(timer); resolve(); }, 5000);
            });
        });

        await sleep(1000);

        // Try to extract from __NEXT_DATA__ first (faster and more reliable)
        const nextDataPlaylists = await page.evaluate(() => {
            const nextDataEl = document.getElementById('__NEXT_DATA__');
            if (!nextDataEl) return null;

            try {
                const data = JSON.parse(nextDataEl.textContent);
                console.log('__NEXT_DATA__ keys:', Object.keys(data.props?.pageProps || {}));

                // Look for playlists in various possible locations
                const pageProps = data.props?.pageProps || {};

                // Check common locations for playlist data
                let playlists = pageProps.playlists ||
                               pageProps.userPlaylists ||
                               pageProps.profile?.playlists ||
                               pageProps.user?.playlists ||
                               null;

                if (playlists && Array.isArray(playlists)) {
                    return playlists.map(p => ({
                        id: p.id || p.playlist_id,
                        title: p.name || p.title || 'Playlist',
                        coverUrl: p.image_url || p.cover_url || p.image || null,
                        songCount: p.num_total_results || p.song_count || p.count || null
                    })).filter(p => p.id);
                }

                // Return keys for debugging
                return { debug: true, keys: Object.keys(pageProps) };
            } catch (e) {
                return { error: e.message };
            }
        });

        if (nextDataPlaylists && !nextDataPlaylists.debug && !nextDataPlaylists.error) {
            console.log(`[UserPlaylists] Found ${nextDataPlaylists.length} playlists from __NEXT_DATA__`);
            return nextDataPlaylists.map(p => ({
                ...p,
                url: `https://suno.com/playlist/${p.id}`
            }));
        }

        if (nextDataPlaylists?.debug) {
            console.log(`[UserPlaylists] __NEXT_DATA__ keys:`, nextDataPlaylists.keys);
        }
        if (nextDataPlaylists?.error) {
            console.log(`[UserPlaylists] __NEXT_DATA__ error:`, nextDataPlaylists.error);
        }

        // Debug: log what we find on the page
        const debugInfo = await page.evaluate(() => {
            const allLinks = Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h.includes('playlist'));
            const html = document.body.innerHTML;
            const playlistMatches = html.match(/playlist\/[a-f0-9-]+/gi) || [];
            return {
                playlistLinks: allLinks.slice(0, 10),
                playlistIdsInHtml: [...new Set(playlistMatches)].slice(0, 10),
                pageTitle: document.title,
                bodyLength: html.length
            };
        });
        console.log(`[UserPlaylists] DOM Debug:`, JSON.stringify(debugInfo, null, 2));

        // Fallback: Extract playlist data from DOM
        const playlists = await page.evaluate(() => {
            const results = [];
            const seen = new Set();

            // Find playlist links
            document.querySelectorAll('a[href*="/playlist/"]').forEach(a => {
                const match = a.href.match(/\/playlist\/([a-f0-9-]+)/i);
                if (match && !seen.has(match[1])) {
                    seen.add(match[1]);

                    // Try to find playlist info
                    let title = '';
                    let coverUrl = null;
                    let songCount = null;

                    // Walk up to find a reasonable container (but not too far)
                    let container = a.parentElement;
                    for (let i = 0; i < 5 && container; i++) {
                        // Check if this container has the info we need
                        const texts = Array.from(container.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, div'))
                            .map(el => el.textContent.trim())
                            .filter(t => t.length > 0 && t.length < 80 && !t.includes('http'));

                        // Find a good title candidate (not just numbers, not too short, not song count)
                        for (let text of texts) {
                            // Skip if it's just a song count
                            if (/^\d+\s*songs?$/i.test(text)) continue;
                            // Skip if it's just a number
                            if (/^\d+$/.test(text)) continue;
                            // Skip if too short
                            if (text.length <= 2) continue;

                            // Remove trailing song count pattern (e.g., "ExMormon19 songs" -> "ExMormon")
                            text = text.replace(/\s*\d+\s*songs?\s*$/i, '').trim();

                            if (text.length > 2) {
                                title = text;
                                break;
                            }
                        }

                        // Find cover image
                        if (!coverUrl) {
                            const img = container.querySelector('img');
                            if (img && img.src && !img.src.includes('avatar') && !img.src.includes('profile')) {
                                coverUrl = img.src;
                            }
                        }

                        // Look for song count - find element with exact "N songs" pattern
                        if (!songCount) {
                            const candidates = container.querySelectorAll('p, span, div');
                            for (const el of candidates) {
                                const text = el.textContent.trim();
                                // Match exactly "N songs" or "N song" (not part of larger text)
                                const countMatch = text.match(/^(\d+)\s*songs?$/i);
                                if (countMatch) {
                                    const count = parseInt(countMatch[1]);
                                    // Sanity check - playlists rarely have more than 1000 songs
                                    if (count > 0 && count < 10000) {
                                        songCount = count;
                                        break;
                                    }
                                }
                            }
                        }

                        if (title && coverUrl) break;
                        container = container.parentElement;
                    }

                    // Fallback: use link text as title
                    if (!title && a.textContent.trim().length > 2 && a.textContent.trim().length < 80) {
                        title = a.textContent.trim().replace(/\s*\d+\s*songs?\s*$/i, '').trim();
                    }

                    // If still no title, use a placeholder
                    if (!title || title.length < 2) {
                        title = 'Playlist';
                    }

                    results.push({
                        id: match[1],
                        url: `https://suno.com/playlist/${match[1]}`,
                        title,
                        coverUrl,
                        songCount
                    });
                }
            });

            return results;
        });

        console.log(`[UserPlaylists] Extracted ${playlists.length} playlists from DOM`);
        return playlists;

    } finally {
        if (browser) await browser.close();
    }
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
                coverUrl: `https://cdn2.suno.ai/image_large_${uuid}.jpeg`,
                style: '',
                description: ''
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
                    let style = '';
                    let description = '';
                    try {
                        page = await browser.newPage();
                        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                        await page.goto(`https://suno.com/song/${uuid}`, {
                            waitUntil: 'networkidle2',
                            timeout: 30000
                        });

                        // Wait for artist link to appear (indicates page has loaded)
                        try {
                            await page.waitForSelector('a[href^="/@"]', { timeout: 10000 });
                        } catch (e) {
                            // Selector not found, continue anyway
                        }

                        // Give a bit more time for dynamic content to render
                        await new Promise(r => setTimeout(r, 500));

                        const songData = await page.evaluate(() => {
                            // Get artist
                            const artistLink = document.querySelector('a[href^="/@"]');
                            const artist = artistLink ? artistLink.textContent.trim() : null;

                            // Get style - try multiple approaches
                            let style = '';

                            // Method 1: Look for div with title attribute containing style info (near "Show Summary" text)
                            const allDivs = document.querySelectorAll('div[title]');
                            for (const div of allDivs) {
                                const title = div.getAttribute('title');
                                // Style titles are usually comma-separated genre/mood descriptions
                                if (title && title.includes(',') && title.length > 20 && title.length < 2000) {
                                    // Check if it looks like style tags (has musical terms)
                                    if (/pop|rock|jazz|electronic|vocal|piano|guitar|beat|melody|synth|drum/i.test(title)) {
                                        style = title;
                                        break;
                                    }
                                }
                            }

                            // Method 2: Look for the specific style div structure
                            if (!style) {
                                const styleContainer = document.querySelector('div.my-2 div.relative');
                                if (styleContainer) {
                                    const innerDiv = styleContainer.querySelector('div[title]');
                                    if (innerDiv) {
                                        style = innerDiv.getAttribute('title') || innerDiv.textContent.trim();
                                    }
                                }
                            }

                            // Get description - the text content of the song
                            let description = '';

                            // Method 1: Look for the description span with "More"/"Less" button nearby
                            const descSpans = document.querySelectorAll('div span');
                            for (const span of descSpans) {
                                const text = span.textContent.trim();
                                // Description is usually a longer text (not just a label)
                                if (text.length > 50 && text.length < 3000) {
                                    // Check if parent has a "More" or "Less" button (indicates it's the description)
                                    const parent = span.parentElement;
                                    if (parent && (parent.innerHTML.includes('Less') || parent.innerHTML.includes('More'))) {
                                        description = text;
                                        break;
                                    }
                                }
                            }

                            // Method 2: Look for description by structure (whitespace-normal class)
                            if (!description) {
                                const descDiv = document.querySelector('div[class*="whitespace-normal"] > span');
                                if (descDiv && descDiv.textContent.length > 30) {
                                    description = descDiv.textContent.trim();
                                }
                            }

                            return { artist, style, description };
                        });

                        if (songData.artist) artist = songData.artist;
                        if (songData.style) style = songData.style;
                        if (songData.description) description = songData.description;
                        console.log(`[Puppeteer] ${uuid}: artist="${artist}", style=${style ? 'yes' : 'no'}, desc=${description ? 'yes' : 'no'}`);

                    } catch (e) {
                        console.log(`[Puppeteer] ${uuid}: error - ${e.message}`);
                    } finally {
                        if (page) await page.close();
                    }

                    // Send this result immediately
                    res.write(`data: ${JSON.stringify({ uuid, artist, style, description })}\n\n`);
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

    // API endpoint to fetch a user's playlists
    if (url.pathname === '/api/fetch-user-playlists' && req.method === 'GET') {
        const username = url.searchParams.get('username');

        if (!username) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing username parameter' }));
            return;
        }

        try {
            console.log(`Fetching playlists for user: @${username}`);
            const playlists = await fetchUserPlaylists(username);
            console.log(`Found ${playlists.length} playlists for @${username}`);

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ username, playlists }));
        } catch (error) {
            console.error('Error fetching user playlists:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
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

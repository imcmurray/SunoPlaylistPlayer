/**
 * Suno Music Library - Audio Player
 * A simple audio player for the Hugo static site
 */

(function() {
    'use strict';

    const AUDIO_CDN = 'https://cdn1.suno.ai';

    // DOM Elements
    const audio = document.getElementById('audio-player');
    const playerBar = document.getElementById('player-bar');
    const playBtn = document.getElementById('play-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const progressBar = document.getElementById('progress-bar');
    const volumeBar = document.getElementById('volume-bar');
    const currentTimeEl = document.getElementById('current-time');
    const durationEl = document.getElementById('duration');
    const playerCover = document.getElementById('player-cover');
    const playerTitle = document.getElementById('player-title');
    const playerArtist = document.getElementById('player-artist');

    // State
    let currentPlaylist = [];
    let currentIndex = 0;
    let isPlaying = false;

    // Initialize
    function init() {
        if (!audio || !playerBar) return;

        // Set initial volume
        audio.volume = 0.8;
        volumeBar.value = 80;

        // Event listeners
        playBtn.addEventListener('click', togglePlay);
        prevBtn.addEventListener('click', playPrev);
        nextBtn.addEventListener('click', playNext);

        progressBar.addEventListener('input', seekTo);
        volumeBar.addEventListener('input', setVolume);

        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', updateDuration);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('play', () => updatePlayState(true));
        audio.addEventListener('pause', () => updatePlayState(false));

        // Song click handlers
        document.addEventListener('click', handleSongClick);

        // Play all / shuffle buttons
        document.querySelectorAll('.play-all-btn').forEach(btn => {
            btn.addEventListener('click', () => playPlaylist(btn.dataset.playlist, false));
        });

        document.querySelectorAll('.shuffle-btn').forEach(btn => {
            btn.addEventListener('click', () => playPlaylist(btn.dataset.playlist, true));
        });
    }

    // Handle click on song row or play button
    function handleSongClick(e) {
        const playBtn = e.target.closest('.song-play-btn');
        const songRow = e.target.closest('.song-row');

        if (playBtn && songRow) {
            e.preventDefault();
            playSong(songRow);
        } else if (songRow && !e.target.closest('a')) {
            // Double click to play
            if (e.detail === 2) {
                playSong(songRow);
            }
        }
    }

    // Play a single song from a song row
    function playSong(songRow) {
        const uuid = songRow.dataset.uuid;
        const title = songRow.dataset.title;
        const artist = songRow.dataset.artist;
        const coverUrl = songRow.dataset.cover;

        // Build playlist from siblings in the same list
        const songList = songRow.closest('.song-list');
        if (songList) {
            const allRows = Array.from(songList.querySelectorAll('.song-row[data-uuid]'));
            currentPlaylist = allRows.map(row => ({
                uuid: row.dataset.uuid,
                title: row.dataset.title,
                artist: row.dataset.artist,
                coverUrl: row.dataset.cover
            }));
            currentIndex = allRows.indexOf(songRow);
        } else {
            currentPlaylist = [{ uuid, title, artist, coverUrl }];
            currentIndex = 0;
        }

        loadAndPlay(currentPlaylist[currentIndex]);
    }

    // Play entire playlist
    function playPlaylist(playlistId, shuffle = false) {
        const songList = document.getElementById('playlist-songs');
        if (!songList) return;

        const allRows = Array.from(songList.querySelectorAll('.song-row[data-uuid]'));
        currentPlaylist = allRows.map(row => ({
            uuid: row.dataset.uuid,
            title: row.dataset.title,
            artist: row.dataset.artist,
            coverUrl: row.dataset.cover
        }));

        if (shuffle) {
            // Fisher-Yates shuffle
            for (let i = currentPlaylist.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [currentPlaylist[i], currentPlaylist[j]] = [currentPlaylist[j], currentPlaylist[i]];
            }
        }

        currentIndex = 0;
        if (currentPlaylist.length > 0) {
            loadAndPlay(currentPlaylist[0]);
        }
    }

    // Load and play a song
    function loadAndPlay(song) {
        if (!song) return;

        const audioUrl = `${AUDIO_CDN}/${song.uuid}.m4a`;

        // Reset progress bar and time immediately
        progressBar.value = 0;
        currentTimeEl.textContent = '0:00';
        durationEl.textContent = '0:00';

        audio.src = audioUrl;
        audio.play().catch(err => {
            console.error('Playback failed:', err);
        });

        // Update UI
        playerTitle.textContent = song.title || 'Unknown';
        playerArtist.textContent = song.artist || '';

        if (song.coverUrl) {
            playerCover.src = song.coverUrl;
            playerCover.style.display = '';
        } else {
            playerCover.removeAttribute('src');
            playerCover.style.display = 'none';
        }

        // Show player bar
        playerBar.classList.remove('hidden');

        // Highlight current song in list
        document.querySelectorAll('.song-row').forEach(row => {
            row.classList.toggle('playing', row.dataset.uuid === song.uuid);
        });
    }

    // Toggle play/pause
    function togglePlay() {
        if (audio.src) {
            if (audio.paused) {
                audio.play();
            } else {
                audio.pause();
            }
        }
    }

    // Play previous song
    function playPrev() {
        if (currentPlaylist.length === 0) return;

        // If more than 3 seconds in, restart current song
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }

        currentIndex = (currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
        loadAndPlay(currentPlaylist[currentIndex]);
    }

    // Play next song
    function playNext() {
        if (currentPlaylist.length === 0) return;
        currentIndex = (currentIndex + 1) % currentPlaylist.length;
        loadAndPlay(currentPlaylist[currentIndex]);
    }

    // Handle song ended
    function handleEnded() {
        playNext();
    }

    // Update play/pause button state
    function updatePlayState(playing) {
        isPlaying = playing;
        const playIcon = playBtn.querySelector('.play-icon');
        const pauseIcon = playBtn.querySelector('.pause-icon');

        if (playing) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        }
    }

    // Update progress bar
    function updateProgress() {
        if (audio.duration) {
            const percent = (audio.currentTime / audio.duration) * 100;
            progressBar.value = percent;
            currentTimeEl.textContent = formatTime(audio.currentTime);
        }
    }

    // Update duration display
    function updateDuration() {
        durationEl.textContent = formatTime(audio.duration);
    }

    // Seek to position
    function seekTo() {
        if (audio.duration) {
            audio.currentTime = (progressBar.value / 100) * audio.duration;
        }
    }

    // Set volume
    function setVolume() {
        audio.volume = volumeBar.value / 100;
    }

    // Format time in mm:ss
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

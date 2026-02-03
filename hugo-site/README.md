# Suno Music Library - Hugo Site

A static site generator for your Suno music library. This Hugo site displays all the songs and playlists you've discovered using the [Suno Playlist Player](https://github.com/imcmurray/SunoPlaylistPlayer).

## Quick Setup

### 1. Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it something like `suno-music-library`
3. Make it public (required for free GitHub Pages)
4. Don't initialize with README (we'll push this content)

### 2. Push This Hugo Site

```bash
# From the hugo-site directory
cd hugo-site
git init
git add .
git commit -m "Initial Hugo site setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/suno-music-library.git
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repo's Settings > Pages
2. Under "Build and deployment", select "GitHub Actions"
3. The included workflow will automatically build and deploy your site

### 4. Create a GitHub Token

1. Go to [github.com/settings/tokens/new](https://github.com/settings/tokens/new)
2. Give it a name like "Suno Music Library"
3. Select the `repo` scope
4. Generate and copy the token

### 5. Sync Your Music

1. Open the Suno Playlist Player and load a playlist
2. Click the sync button (circular arrow) in the sidebar
3. Enter your GitHub token and repository name
4. Click "Sync Now"

Your site will automatically rebuild with the new content!

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR BROWSER                                  │
│  ┌─────────────────┐      ┌─────────────────────────────────┐  │
│  │ Suno Player     │      │ GitHub API (direct from browser)│  │
│  │ (localStorage)  │ ───► │ - Commits new songs/playlists   │  │
│  │                 │      │ - No server needed              │  │
│  └─────────────────┘      └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GITHUB                                        │
│  ┌─────────────────┐      ┌─────────────────────────────────┐  │
│  │ Your Hugo Repo  │ ───► │ GitHub Actions (auto-build)     │  │
│  │ data/songs.json │      │ Triggers on every push          │  │
│  │ data/playlists  │      └─────────────────────────────────┘  │
│  └─────────────────┘                    │                       │
│                                         ▼                       │
│                            ┌─────────────────────────────────┐  │
│                            │ GitHub Pages                    │  │
│                            │ yourname.github.io/suno-library │  │
│                            └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Structure

Songs and playlists are stored in the `data/` directory as JSON:

```
data/
├── songs.json      # All songs with metadata
└── playlists.json  # All playlists with song references
```

### songs.json
```json
{
  "song-uuid-here": {
    "title": "Song Title",
    "artist": "Artist Name",
    "coverUrl": "https://cdn2.suno.ai/image_large_uuid.jpeg",
    "addedAt": 1234567890
  }
}
```

### playlists.json
```json
{
  "playlist-uuid-here": {
    "title": "Playlist Name",
    "creator": "Creator Username",
    "coverUrl": "https://...",
    "url": "https://suno.com/playlist/...",
    "songs": ["song-uuid-1", "song-uuid-2"],
    "addedAt": 1234567890
  }
}
```

## Local Development

To run the site locally:

```bash
# Install Hugo (https://gohugo.io/installation/)
brew install hugo  # macOS
# or
sudo apt install hugo  # Ubuntu

# Run development server
cd hugo-site
hugo server -D

# Build for production
hugo --minify
```

## Customization

- **Site title**: Edit `hugo.toml` and change `title`
- **Styles**: Modify `static/css/style.css`
- **Player behavior**: Edit `static/js/player.js`
- **Layouts**: Customize templates in `layouts/`

## Features

- Browse all your discovered playlists
- View all songs in your library
- Search and sort songs
- Play music directly from Suno's CDN
- Responsive design for mobile
- Dark theme

## License

MIT

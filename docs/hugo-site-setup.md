# Setting Up Your Personal Suno Music Library

This guide walks you through creating your own static Hugo site to catalog and browse music you've discovered on Suno. The site syncs directly from your browser - no server required.

## Overview

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
│                            │ yourname.github.io/my-music     │  │
│                            └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Create Your Repository

### Option A: Copy the Template (Recommended)

1. Create a new repository on GitHub: [github.com/new](https://github.com/new)
   - Name it something like `my-suno-library` or `music-collection`
   - Make it **Public** (required for free GitHub Pages)
   - Don't initialize with README

2. Clone the SunoPlaylistPlayer and copy the hugo-site:

```bash
# Clone the player repo (if you haven't already)
git clone https://github.com/imcmurray/SunoPlaylistPlayer.git
cd SunoPlaylistPlayer

# Copy hugo-site to a new directory
cp -r hugo-site ../my-suno-library
cd ../my-suno-library

# Initialize as your own repo
git init
git add .
git commit -m "Initial Hugo site setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/my-suno-library.git
git push -u origin main
```

### Option B: Download and Upload

1. Download the `hugo-site` folder from the SunoPlaylistPlayer repository
2. Create a new GitHub repository
3. Upload the contents via GitHub's web interface

## Step 2: Configure Your Site

Edit `hugo.toml` to set your site's URL:

```toml
# Change this to your GitHub Pages URL
baseURL = "https://YOUR_USERNAME.github.io/my-suno-library/"

# Customize these as you like
title = "My Suno Music Library"

[params]
description = "My personal collection of AI-generated music"
```

Commit and push the change:

```bash
git add hugo.toml
git commit -m "Configure site URL"
git push
```

## Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → **Pages** (in the left sidebar)
3. Under "Build and deployment":
   - Source: **GitHub Actions**
4. The included workflow will automatically build and deploy on every push

Wait a few minutes for the first build to complete. You can monitor progress at:
`https://github.com/YOUR_USERNAME/my-suno-library/actions`

## Step 4: Create a GitHub Token

The Suno Player needs a token to push updates to your repository.

1. Go to [github.com/settings/tokens/new](https://github.com/settings/tokens/new?description=Suno%20Music%20Library&scopes=repo)
2. Settings:
   - **Note**: `Suno Music Library` (or any name you like)
   - **Expiration**: Choose based on your preference
   - **Scopes**: Check `repo` (Full control of private repositories)
3. Click **Generate token**
4. **Copy the token** (starts with `ghp_`) - you won't see it again!

> **Security Note**: Your token is stored only in your browser's localStorage and is sent directly to GitHub's API. It never touches any other server.

## Step 5: Sync Your Music

1. Open the Suno Playlist Player and load a playlist
2. Click the **sync button** (circular arrow icon) in the sidebar header
3. Enter your credentials:
   - **GitHub Token**: Your `ghp_...` token
   - **Repository**: `YOUR_USERNAME/my-suno-library`
4. Click **Sync Now**

The player will:
- Merge your cached songs with any existing data
- Push updates to your GitHub repository
- GitHub Actions will automatically rebuild your site

Your site will be live at: `https://YOUR_USERNAME.github.io/my-suno-library/`

## How It Works

### Data Storage

Songs and playlists are stored as JSON in the `data/` directory:

**data/songs.json**
```json
{
  "song-uuid-here": {
    "title": "Song Title",
    "artist": "Artist Name",
    "coverUrl": "https://cdn2.suno.ai/...",
    "style": "Electronic, Ambient",
    "description": "A chill instrumental track",
    "addedAt": 1706900000000
  }
}
```

**data/playlists.json**
```json
{
  "playlist-uuid-here": {
    "title": "Playlist Name",
    "description": "Playlist description",
    "creator": "username",
    "coverUrl": "https://...",
    "url": "https://suno.com/playlist/...",
    "songs": ["song-uuid-1", "song-uuid-2"],
    "addedAt": 1706900000000
  }
}
```

### Growing Your Library

Every time you:
1. Listen to new playlists in the Suno Player
2. Click the sync button

Your library grows! The sync merges new songs with existing ones - duplicates are automatically handled.

## Customization

### Site Title and Description

Edit `hugo.toml`:

```toml
title = "My Music Collection"

[params]
description = "Awesome AI-generated tunes I've discovered"
```

### Styling

Modify `static/css/style.css` to change colors, fonts, and layout.

### Templates

The site uses Hugo templates in `layouts/`:
- `layouts/index.html` - Homepage
- `layouts/playlists/list.html` - All playlists page
- `layouts/playlists/single.html` - Individual playlist page
- `layouts/songs/list.html` - All songs page

## Troubleshooting

### Links go to wrong URL (404 errors)

Make sure your `baseURL` in `hugo.toml` matches your GitHub Pages URL exactly:

```toml
baseURL = "https://YOUR_USERNAME.github.io/REPO_NAME/"
```

Don't forget the trailing slash!

### Build fails in GitHub Actions

Check the Actions tab for error details. Common issues:
- Missing `theme = ""` line (remove it if present)
- Invalid TOML syntax in `hugo.toml`

### Sync fails

- Verify your GitHub token has `repo` scope
- Check the repository name format: `username/repo-name`
- Make sure the repository exists and is accessible

### Changes not appearing

- Wait for GitHub Actions to complete (check the Actions tab)
- Hard refresh your browser: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
- GitHub Pages can take a few minutes to update

## Local Development

To preview your site locally:

```bash
# Install Hugo (https://gohugo.io/installation/)
# macOS:
brew install hugo
# Ubuntu:
sudo apt install hugo
# Windows:
choco install hugo-extended

# Run development server
cd my-suno-library
hugo server -D

# Open http://localhost:1313
```

## Features

- Browse all your discovered playlists
- View and search all songs in your library
- Play music directly (streams from Suno's CDN)
- Filter songs by title, artist, or style
- Responsive design for mobile devices
- Dark theme

## Privacy

- Your music data is stored in your own GitHub repository
- The GitHub token stays in your browser's localStorage
- No data is sent to any third-party servers
- Audio streams directly from Suno's CDN

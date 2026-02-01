# Deploying Suno Playlist Player to Railway

This guide walks you through deploying the Suno Playlist Player to [Railway](https://railway.app) with automatic deployments via GitHub Actions.

## Architecture Overview

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│                 │         │                 │         │                 │
│  GitHub Repo    │────────▶│  Railway        │────────▶│  Suno.com       │
│  (Push to main) │         │  (Node.js +     │         │  (Scrape data)  │
│                 │         │   Puppeteer)    │         │                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐
                            │                 │
                            │  Users          │
                            │  (Browser)      │
                            │                 │
                            └─────────────────┘
```

## Prerequisites

- [GitHub account](https://github.com)
- [Railway account](https://railway.app) (sign up with GitHub for easy integration)
- This repository pushed to your GitHub account

## Step 1: Prepare the Project for Railway

### 1.1 Create a Nixpacks configuration

Railway uses Nixpacks to build your app. Puppeteer requires Chrome dependencies.

Create `nixpacks.toml` in your project root:

```toml
[phases.setup]
nixPkgs = ["nodejs_20", "chromium", "libuuid"]

[phases.install]
cmds = ["npm ci"]

[start]
cmd = "node server.js"

[variables]
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true"
PUPPETEER_EXECUTABLE_PATH = "/nix/store/chromium/bin/chromium"
```

### 1.2 Update server.js for Production

Update your `server.js` to use environment variables for the port and Chromium path:

```javascript
const PORT = process.env.PORT || 3000;

// In your Puppeteer launch options:
browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
    ]
});
```

### 1.3 Add a start script to package.json

Ensure your `package.json` has:

```json
{
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18"
  }
}
```

## Step 2: Set Up Railway

### 2.1 Create a New Project

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Authorize Railway to access your GitHub (if not already done)
5. Select your `SunoEmbed` repository
6. Railway will auto-detect it's a Node.js app

### 2.2 Configure Environment Variables

In your Railway project:

1. Click on your service
2. Go to **"Variables"** tab
3. Add the following:

| Variable | Value |
|----------|-------|
| `PORT` | `3000` |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` |
| `NODE_ENV` | `production` |

### 2.3 Configure the Domain

1. Go to **"Settings"** tab
2. Under **"Networking"**, click **"Generate Domain"**
3. You'll get a URL like `your-app-name.up.railway.app`

## Step 3: Set Up GitHub Actions for Auto-Deploy

Railway can auto-deploy from GitHub directly, but if you want more control (run tests, build steps, etc.), use GitHub Actions.

### 3.1 Get Your Railway Token

1. Go to [Railway Account Settings](https://railway.app/account/tokens)
2. Click **"Create Token"**
3. Name it `github-actions`
4. Copy the token (you won't see it again!)

### 3.2 Get Your Project and Service IDs

1. In your Railway project, click on the service
2. Look at the URL: `railway.app/project/[PROJECT_ID]/service/[SERVICE_ID]`
3. Copy both IDs

### 3.3 Add Secrets to GitHub

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `RAILWAY_TOKEN` | Your Railway API token |
| `RAILWAY_PROJECT_ID` | Your project ID from the URL |
| `RAILWAY_SERVICE_ID` | Your service ID from the URL |

### 3.4 Create the Workflow File

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Railway

on:
  push:
    branches:
      - main
  workflow_dispatch: # Allow manual trigger

jobs:
  deploy:
    name: Deploy
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests (optional)
        run: npm test --if-present

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Railway
        run: railway up --service ${{ secrets.RAILWAY_SERVICE_ID }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
          RAILWAY_PROJECT_ID: ${{ secrets.RAILWAY_PROJECT_ID }}
```

## Step 4: Deploy!

### First Deployment

1. Commit and push your changes:
   ```bash
   git add .
   git commit -m "Add Railway deployment configuration"
   git push origin main
   ```

2. Watch the deployment:
   - **GitHub**: Go to Actions tab to see the workflow run
   - **Railway**: Watch the build logs in your dashboard

### Verify It's Working

1. Visit your Railway URL: `https://your-app.up.railway.app`
2. You should see the Suno Playlist Player!
3. Try loading a playlist to confirm Puppeteer is working

## Troubleshooting

### Puppeteer Crashes

If Puppeteer fails to launch, try these environment variables:

```
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage
```

### Build Fails

Check Railway build logs. Common issues:
- Missing `package-lock.json` (run `npm install` locally first)
- Node version mismatch (specify in `engines` field)

### Memory Issues

Railway's free tier has limited memory. Puppeteer is memory-hungry. If you hit limits:
- Upgrade to a paid plan
- Or use a Puppeteer-as-a-service like [Browserless](https://browserless.io)

## Alternative: Railway Native GitHub Integration

Railway can deploy directly from GitHub without Actions:

1. In Railway project settings, go to **"Deployments"**
2. Enable **"Automatic Deployments"**
3. Select the `main` branch
4. Every push to `main` will auto-deploy

This is simpler but gives less control over the deployment pipeline.

## Project Structure

```
SunoEmbed/
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions workflow
├── server.js               # Main server (Node.js + Puppeteer)
├── playlist.html           # Playlist player UI
├── index.html              # Embed explorer UI
├── package.json            # Dependencies
├── package-lock.json       # Lock file
├── nixpacks.toml          # Railway build config
└── DEPLOYMENT.md          # This file
```

## Costs

### Railway Free Tier
- $5 of usage credits per month
- Enough for light usage (~500 hours of runtime)
- Apps sleep after inactivity (cold starts)

### Railway Pro ($20/month)
- No sleep, always-on
- More resources
- Better for production use

## Updating Your Deployment

Once set up, updating is simple:

```bash
# Make changes locally
git add .
git commit -m "Your changes"
git push origin main
# GitHub Actions automatically deploys to Railway!
```

## Security Notes

- Never commit your `RAILWAY_TOKEN` to the repository
- The `.env` file (if you have one) should be in `.gitignore`
- Railway environment variables are encrypted at rest

---

## Quick Reference

| Resource | URL |
|----------|-----|
| Railway Dashboard | https://railway.app/dashboard |
| Railway Docs | https://docs.railway.app |
| Puppeteer on Railway | https://docs.railway.app/guides/puppeteer |
| GitHub Actions Docs | https://docs.github.com/en/actions |

---

Happy deploying! 🚀

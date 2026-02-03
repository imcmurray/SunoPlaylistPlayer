# Running Suno Playlist Player in Docker

This guide covers running the Suno Playlist Player as a Docker container on your homelab.

## Quick Start

No need to clone the repo - just create a `docker-compose.yml` and run it:

```bash
# Create docker-compose.yml (or copy from below)
curl -O https://raw.githubusercontent.com/imcmurray/SunoPlaylistPlayer/main/docker-compose.yml

# Build and run (pulls from GitHub automatically)
docker compose up -d

# Access at http://localhost:3000
```

The compose file pulls directly from GitHub, so you'll always build the latest version.

## Files

### Dockerfile

The Dockerfile in the repo:

```dockerfile
FROM node:20-slim

# Install Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js .
COPY playlist.html .

# Expose port
EXPOSE 3000

# Run as non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

CMD ["node", "server.js"]
```

### docker-compose.yml

```yaml
services:
  suno-player:
    build: https://github.com/imcmurray/SunoPlaylistPlayer.git
    container_name: suno-playlist-player
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
    shm_size: '1gb'
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M
```

The `build` URL points directly to GitHub - Docker pulls the repo and builds from the Dockerfile automatically.

## Commands

### Build and Run

```bash
# Build the image
docker compose build

# Start the container
docker compose up -d

# View logs
docker compose logs -f

# Stop the container
docker compose stop

# Remove the container
docker compose down
```

### Manual Docker Commands

If you prefer not to use docker compose:

```bash
# Build
docker build -t suno-playlist-player .

# Run
docker run -d \
  --name suno-player \
  -p 3000:3000 \
  -e NODE_ENV=production \
  --restart unless-stopped \
  suno-playlist-player

# Stop
docker stop suno-player

# Remove
docker rm suno-player
```

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 80;
    server_name suno.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Traefik (docker-compose labels)

```yaml
services:
  suno-player:
    build: .
    container_name: suno-playlist-player
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.suno.rule=Host(`suno.yourdomain.com`)"
      - "traefik.http.routers.suno.entrypoints=websecure"
      - "traefik.http.routers.suno.tls.certresolver=letsencrypt"
      - "traefik.http.services.suno.loadbalancer.server.port=3000"
    networks:
      - traefik
    environment:
      - NODE_ENV=production
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

networks:
  traefik:
    external: true
```

### Caddy

```caddyfile
suno.yourdomain.com {
    reverse_proxy localhost:3000
}
```

## Homelab Integration

### Portainer

1. Go to Stacks > Add Stack
2. Paste the docker-compose.yml content
3. Click "Deploy the stack"

### Unraid

1. Go to Docker > Add Container
2. Use the following settings:
   - Repository: `suno-playlist-player` (after building locally)
   - Or use the docker-compose via Compose Manager plugin

### Proxmox LXC

Run Docker inside an LXC container:

```bash
# In your LXC container
apt update && apt install docker.io docker-compose curl -y
mkdir -p /opt/suno && cd /opt/suno
curl -O https://raw.githubusercontent.com/imcmurray/SunoPlaylistPlayer/main/docker-compose.yml
docker compose up -d
```

## Troubleshooting

### Puppeteer/Chromium Issues

If you see errors about Chromium failing to launch:

1. **Check the executable path**:
   ```bash
   docker exec -it suno-player which chromium
   ```

2. **Increase shared memory** (add to docker-compose.yml):
   ```yaml
   shm_size: '2gb'
   ```

3. **Run with verbose logging**:
   ```bash
   docker compose logs -f suno-player
   ```

### Memory Issues

Puppeteer can be memory-hungry. If the container crashes:

1. Increase memory limits in docker-compose.yml
2. Check host memory: `docker stats`
3. Consider adding swap to your host

### Permission Denied

If you get permission errors:

```bash
# Check container user
docker exec -it suno-player whoami

# If needed, run as root (less secure)
# Add to docker-compose.yml:
user: root
```

### Container Won't Start

```bash
# Check logs
docker compose logs

# Try running interactively
docker compose run --rm suno-player /bin/bash
```

## Updating

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Security Considerations

- The container runs as a non-root user by default
- Puppeteer runs with `--no-sandbox` (required in Docker, but be aware)
- Consider placing behind a reverse proxy with HTTPS
- Limit container resources to prevent DoS

## Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU      | 1 core  | 2 cores     |
| RAM      | 512MB   | 1GB         |
| Disk     | 500MB   | 1GB         |

The main resource consumer is Puppeteer/Chromium during playlist scraping.

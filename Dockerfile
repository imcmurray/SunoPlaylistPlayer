FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

# Copy package files
COPY --chown=pptruser:pptruser package*.json ./

# Install dependencies (puppeteer already installed in base image, but we need our package.json)
RUN npm ci

# Copy application files
COPY --chown=pptruser:pptruser server.js .
COPY --chown=pptruser:pptruser playlist.html .

# Expose port
EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]

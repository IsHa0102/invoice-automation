FROM node:20-bookworm-slim

# Give Playwright access to install system deps
RUN apt-get update && apt-get install -y wget ca-certificates --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install node deps first (cache layer)
COPY package*.json ./
RUN npm ci

# Install Chromium + all its system dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the source
COPY . .

# Ensure download directory exists
RUN mkdir -p src/storage/downloaded

# Always run headless on the server
ENV ESHOPBOX_HEADLESS=true

EXPOSE 3030

CMD ["node", "src/server.js"]

# Use Node 22 (Debian-based) as base
FROM node:22-bullseye

# Set working directory
WORKDIR /usr/src/app

# Copy package.json first for efficient caching
COPY package*.json ./

# Install system dependencies needed for keytar / libsecret
RUN apt-get update && \
    apt-get install -y libsecret-1-0 build-essential curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install Node dependencies
RUN npm install

# Copy all app files
COPY . .

# Expose the port (Railway sets PORT environment variable)
EXPOSE 3000

# Start the app
CMD ["node", "app.js"]

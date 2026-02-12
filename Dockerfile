# Use a Node.js base image
FROM node:20

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy root package files
COPY package.json yarn.lock ./

# Install dependencies using Yarn 4
RUN corepack enable && yarn install

# Copy project files
COPY . .

# Build frontend and backend
RUN yarn build

# Expose port
EXPOSE 5000

# Start command
CMD ["yarn", "start"]

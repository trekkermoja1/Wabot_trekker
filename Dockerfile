# Use Node.js 20 (as specified in your engines)
FROM node:20-alpine

# Install required system dependencies for sharp, sqlite3, and other native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    ffmpeg

# Set working directory
WORKDIR /app

# Enable Corepack for Yarn 4.6.0
RUN corepack enable && corepack prepare yarn@4.6.0 --activate

# Copy package files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY bot/package.json ./bot/

# Copy all source code
COPY . .

# Run the build script
RUN yarn run build

# Create directory for session data and static files
RUN mkdir -p backend/static bot/sessions

# Expose port (adjust if your backend uses a different port)
EXPOSE 3000

# Health check (optional but recommended)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["yarn", "start"]
```

## 2. Create `.dockerignore`
```
# Dependencies
node_modules
*/node_modules
npm-debug.log
yarn-error.log
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/sdks
!.yarn/versions

# Build outputs
frontend/build
dist
build

# Environment files
.env
.env.local
.env.*.local
*.env

# Session data (you'll mount this as a volume)
bot/sessions/*
*.data.json
auth_info_baileys

# Git
.git
.gitignore
.gitattributes

# IDEs
.vscode
.idea
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
logs
*.log

# Testing
coverage
.nyc_output

# Misc
*.md
!README.md
.editorconfig

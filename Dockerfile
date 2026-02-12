FROM node:20-alpine

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pano-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    ffmpeg

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.6.0 --activate

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY bot/package.json ./bot/

COPY . .

RUN yarn run build

RUN mkdir -p backend/static bot/sessions

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["yarn", "start"]
```

## Key Points:

1. **Don't include** the \`\`\`dockerfile or \`\`\` lines
2. **Start directly** with `FROM node:20-alpine`
3. **End directly** with `CMD ["yarn", "start"]`

## Also check your `.dockerignore` file

Make sure it also doesn't have ``` marks:
```
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

frontend/build
dist
build

.env
.env.local
.env.*.local
*.env

bot/sessions/*
*.data.json
auth_info_baileys

.git
.gitignore
.gitattributes

.vscode
.idea
*.swp
*.swo
*~

.DS_Store
Thumbs.db

logs
*.log

coverage
.nyc_output

*.md
!README.md
.editorconfig

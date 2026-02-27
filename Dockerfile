FROM node:20-alpine

RUN apk add --no-cache make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev pangomm-dev libjpeg-turbo-dev ffmpeg git

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.6.0 --activate

COPY package.json yarn.lock ./

COPY .yarn ./.yarn

COPY .yarnrc.yml ./

COPY . .

RUN yarn install

RUN yarn run build

RUN mkdir -p backend/static bot/sessions

ENV PATH="/app/node_modules/.bin:$PATH"

EXPOSE 8080

CMD ["node", "backend/server.js"]

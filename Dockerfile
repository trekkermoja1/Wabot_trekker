FROM node:20-alpine

RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev pangomm-dev libjpeg-turbo-dev freetype-dev ffmpeg

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.6.0 --activate

COPY package.json yarn.lock ./

COPY .yarn ./.yarn

COPY .yarnrc.yml ./

COPY . .

RUN yarn install

RUN yarn run build

RUN mkdir -p backend/static bot/sessions

EXPOSE 3000 5000

CMD ["sh", "-c", "pm2 resurrect || yarn start"]

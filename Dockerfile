FROM node:22-slim
LABEL "language"="nodejs"
WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN npm run build
RUN mkdir -p backend/static bot/sessions

EXPOSE 8080

CMD ["npm", "start"]

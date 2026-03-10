FROM node:22-slim
LABEL "language"="nodejs"
WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY package.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN mkdir -p backend/static bot/sessions

EXPOSE 8080

CMD ["npm", "start"]

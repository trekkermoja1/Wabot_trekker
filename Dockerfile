FROM node:22-slim  
LABEL "language"="nodejs"  
WORKDIR /app  
RUN npm install -g corepack && corepack enable && corepack prepare yarn@4.6.0 --activate  
COPY package.json yarn.lock .yarnrc.yml ./  
COPY .yarn ./.yarn  
RUN yarn install  
COPY . .  
RUN yarn run build  
RUN mkdir -p backend/static bot/sessions  
EXPOSE 8080  
CMD ["yarn", "start"]  

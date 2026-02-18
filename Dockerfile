FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3002
CMD ["npm", "start"]

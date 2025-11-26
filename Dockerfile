FROM node:18-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]

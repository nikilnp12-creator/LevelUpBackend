FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN mkdir -p uploads && chown -R node:node /app
EXPOSE 5000
USER node
CMD ["node", "server.js"]

FROM node:18-alpine

WORKDIR /app

COPY api/package*.json ./
RUN npm install --production

COPY api/ ./

EXPOSE 3000

CMD ["node", "server.js"]

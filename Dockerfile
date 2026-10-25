# Calorie Tracker scan server (food photo -> nutrition via Google Gemini)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server ./server
COPY shared ./shared
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist/server.mjs ./server.mjs
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]

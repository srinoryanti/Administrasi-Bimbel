FROM node:24-slim AS build
WORKDIR /app

COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server ./server

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/server ./server

EXPOSE 4000
CMD ["npm", "start", "--prefix", "server"]

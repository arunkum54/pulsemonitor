FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=4000
ENV DATA_DIR=/app/data

EXPOSE 4000

CMD ["node", "src/index.js"]

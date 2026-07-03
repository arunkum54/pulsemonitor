# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Baked in at build time so the SPA knows where the API lives.
# Override with --build-arg if deploying the frontend separately from the backend.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# --- serve stage ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

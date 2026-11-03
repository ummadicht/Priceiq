# Stage 1: Build
FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
# Fix Next.js 16.2.9 next/font/google crash on extensionless Google Font URLs
RUN node -e 'const fs=require("fs"),f="node_modules/next/dist/compiled/@next/font/dist/google/loader.js";if(fs.existsSync(f))fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(".exec(googleFontFileUrl)[1]",".exec(googleFontFileUrl)?.[1]||\"woff2\""))'

COPY . .
ARG NEXT_PUBLIC_BASE_PATH=/priceiq
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}

RUN bash run-tests.sh && NODE_OPTIONS=--max-old-space-size=2048 npm run build
RUN npm prune --omit=dev

# Stage 2: Production Runner with PM2
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    npm install -g pm2 && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4300
ENV NEXT_PUBLIC_BASE_PATH=/priceiq

RUN mkdir -p /app/data

COPY --from=builder /app/package.json /app/package-lock.json /app/next.config.ts /app/start.sh ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next

RUN chmod +x ./start.sh

EXPOSE 4300
CMD ["pm2-runtime", "start", "./start.sh", "--name", "priceiq"]

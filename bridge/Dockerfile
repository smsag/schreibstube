FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Copy manifests first so dependency installation is cached across code changes.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Drop privileges: the bridge needs no write access to its own image.
USER node

# Run exactly one instance. The authentication throttle and the per-target
# publish lock live in memory, so a second replica would not see them and two
# publishes could interleave writes to one site.
EXPOSE 8080

# Fail the container early if the process is up but the HTTP layer is not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]

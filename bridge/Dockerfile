# Dependencies are installed in a stage of their own so the image that runs
# carries no npm cache, no lockfile churn, and no Mermaid tree.
#
# The base is pinned by digest as well as tag. A tag is whatever the registry
# says it is today, so the same Dockerfile could build a different image
# tomorrow; the digest names one image, and Dependabot moves it in a pull
# request that can be read. Both stages use the same one.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS deps
WORKDIR /app

# `npm ci` only: a lockfile that no longer matches package.json fails the build
# here, which is where it should fail, rather than silently resolving to
# whatever the registry had that day. No install scripts: nothing in this tree
# needs one to work (ssh2 falls back to its pure JavaScript cipher code), and a
# script is the one place a dependency runs code at build time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Mermaid is one prebuilt file the bridge copies into a published site; the
# bridge never runs it. The package brings 167 MB of parser dependencies for
# that one 5 MB file, so the file is kept under vendor/ and the tree removed.
# assets.mjs looks in vendor/ first and only then in the package.
RUN mkdir -p vendor \
  && cp node_modules/mermaid/dist/mermaid.min.js vendor/ \
  && npm uninstall mermaid --no-save --omit=dev

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/vendor ./vendor
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

# syntax=docker/dockerfile:1
FROM node:26.12.1-alpine AS migrations
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Installeer git, bash en corepack. bash is nodig voor
# scripts/with-memory-cap.sh (gebruikt bashisme zoals arrays en BASH_REMATCH);
# Alpine levert geen bash mee.
#
# pnpm komt niet meer uit een losgepind npm-pakket, maar uit corepack: die
# leest de versie én de sha512-hash uit de `packageManager`-pin van
# package.json. Daarmee kan de image nooit uit sync raken met het lockfile
# (vroeger stond hier pnpm@12.10.1 terwijl package.json 12.11.2 voorschreef)
# en wordt de gedownloade pnpm-binary ook in de runtime-image bewaard.
RUN --mount=type=cache,target=/var/cache/apk \
    --mount=type=cache,target=/root/.npm \
    apk add --no-cache git bash util-linux \
    && npm install -g corepack@0.36.0 \
    && corepack enable pnpm

# corepack bewaart de gedownloade pnpm buiten de cache-mount, zodat de runtime
# (`docker run --entrypoint pnpm <migrations-image> db:migrate`) pnpm ook
# zonder netwerk kan gebruiken.
ENV COREPACK_HOME="/usr/local/share/corepack"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Stel het PATH zo in dat Alpine pnpm gegarandeerd overal herkent
ENV PNPM_HOME="/usr/local/share/pnpm"
ENV PATH="$PNPM_HOME:/usr/local/bin:$PATH"

# Alleen package.json: de `packageManager`-pin bepaalt welke pnpm corepack
# installeert. Deze laag blijft gecachet wanneer alleen de lockfile verandert.
COPY package.json ./
RUN corepack install

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./

# Voer de installatie uit met de pnpm v12 store cache-mount. De mount moet op
# de store staan die pnpm ook echt gebruikt ($PNPM_HOME/store/v11); met het
# oude pad (/root/.local/share/pnpm/store) cache'te de mount niets en
# downloadde elke build alle packages opnieuw.
RUN --mount=type=cache,target=/usr/local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .
ARG NEXT_DEPLOYMENT_ID="unknown"
LABEL org.opencontainers.image.revision="$NEXT_DEPLOYMENT_ID"

FROM migrations AS builder
ARG NEXT_DEPLOYMENT_ID="unknown"
ENV NEXT_DEPLOYMENT_ID="$NEXT_DEPLOYMENT_ID"

# The build runs the webpack builder (see the `build` script in package.json).
# Turbopack's compiler is a single native process that grows past 12GB RSS on
# this 329-route app and gets OOM-killed; webpack peaks around 5GB. A
# --max-old-space-size cap does NOT help, because that memory is native
# Turbopack memory rather than the V8 heap.
#
# `pnpm run build` goes through scripts/with-memory-cap.sh. BuildKit's build
# container has /sys/fs/cgroup mounted read-only (no cgroup MemoryMax) and
# `ulimit -v` breaks V8-based builds (see the script header), so this stage
# explicitly opts out of the cap. The real bound here is the webpack builder
# + the V8 heap cap above, and the build runs isolated in its own container,
# not on the host; the host itself is protected by the same wrapper through
# systemd.
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV CMS_MEMORY_CAP_BACKEND=none

# Bouw de Next.js applicatie met caching
RUN --mount=type=cache,target=/app/.next/cache \
    DATABASE_URL="mysql://build:build@127.0.0.1:9/build" \
    HOTEL_NAME="Build fixture" APP_URL="http://localhost:3002" \
    AUTH_SECRET="build-fixture-not-for-runtime-use-000000000000" \
    pnpm run build \
    && PERFORMANCE_COMMIT_SHA="$NEXT_DEPLOYMENT_ID" node scripts/performance-report.mjs --output-dir build-reports

FROM node:26.12.1-alpine AS runner
ARG NEXT_DEPLOYMENT_ID="unknown"
LABEL org.opencontainers.image.revision="$NEXT_DEPLOYMENT_ID"
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3002 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache tini curl \
    && addgroup -g 33 -S nextjs && adduser -u 33 -S -G nextjs nextjs \
    && mkdir -p /app/storage /app/public/nitro-assets /app/public/swf /var/www/Gamedata \
    && chown -R 33:33 /app/storage /app/public /var/www/Gamedata
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/build-reports ./build-reports
COPY --from=builder --chown=nextjs:nextjs /app/drizzle/migrations ./drizzle/migrations
COPY --chown=nextjs:nextjs scripts/docker-start.mjs ./docker-start.mjs
USER nextjs
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'3002')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "docker-start.mjs"]
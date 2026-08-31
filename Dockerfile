# syntax=docker/dockerfile:1.7
FROM node:22-slim AS app

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=npm_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null || true)" npm ci

COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so the
# deploy channel must be known here — setting it only at runtime on Cloud Run
# leaves the server rendering a "Preview" badge the client bundle omits, which
# React rejects as a hydration mismatch. Passed per-channel via --build-arg
# (see cloudbuild.deploy.yaml); empty for production builds, which show no badge.
ARG NEXT_PUBLIC_DEPLOY_CHANNEL
ENV NEXT_PUBLIC_DEPLOY_CHANNEL=$NEXT_PUBLIC_DEPLOY_CHANNEL

RUN npm run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

EXPOSE 8080
CMD ["npm", "run", "start"]

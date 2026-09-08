# The SUT image: the whole monorepo built once, then `node benchmarking/src/sut/server.ts` with
# default Node flags — what a consumer gets. Build context is the repo root (see docker-compose.yml).
# Debian slim rather than alpine: turbo and tsgo ship glibc binaries only.
FROM node:24-slim

RUN npm install -g pnpm@11.9.0
WORKDIR /app

# Packages first, from the lockfile alone, so editing a source file doesn't re-download the world.
ENV CI=true MONGOMS_DISABLE_POSTINSTALL=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline && pnpm build

ENV PORT=3000
EXPOSE 3000
CMD ["node", "benchmarking/src/sut/server.ts"]

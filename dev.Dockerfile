FROM oven/bun:1
WORKDIR /usr/src/app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 8000/tcp
CMD ["bun", "run", "dev"]

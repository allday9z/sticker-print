FROM oven/bun:1-alpine
WORKDIR /app
COPY server.ts package.json ./
COPY public ./public
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["bun", "server.ts"]

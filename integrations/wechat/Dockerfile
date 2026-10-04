FROM node:24-bookworm-slim
ENV NODE_ENV=production WECHAT_HOST=0.0.0.0 WECHAT_PORT=8788 WECHAT_DB_PATH=/data/relay.sqlite
WORKDIR /app
COPY *.mjs ./
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8788
CMD ["node", "relay.mjs"]

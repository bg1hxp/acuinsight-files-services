FROM node:16.20-bullseye

WORKDIR /home/saw/acuinsight-files-services

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=UTC

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

COPY . .

RUN mkdir -p runtime/cache runtime/session logs \
    www/static/original_imgs_upload \
    www/static/rack_record_upload \
    www/static/timeline_upload \
    www/static/splitImageOutput \
    www/static/snapitSeverPath \
    www/static/nodejsFiles \
    www/static/highReImagesOutput

ENV NODE_ENV=production
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS -o /dev/null --max-time 4 http://127.0.0.1:9000/ || exit 1

CMD ["node", "--tls-min-v1.0", "production.js"]

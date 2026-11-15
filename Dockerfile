FROM node:16.20-bullseye

WORKDIR /home/saw/acuinsight-files-services

# These tools are already present in the base image. Keep builds available when
# old bullseye-security package URLs return404, and verify the required tools.
RUN (apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates tzdata \
      || echo "Using the base image curl, CA certificates and timezone data") \
    && curl --version > /dev/null \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && test -f /usr/share/zoneinfo/America/Los_Angeles \
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
    www/static/highReImagesOutput \
    view && echo "ok" > view/index_index.html

ENV NODE_ENV=production
EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS -o /dev/null --max-time 4 http://127.0.0.1:9000/ || exit 1

CMD ["node", "--tls-min-v1.0", "production.js"]

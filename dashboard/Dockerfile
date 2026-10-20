FROM node:20-slim
# ca-certificates explicitly, not assumed as a side effect of installing curl -- confirmed
# directly that it isn't one on this image (dpkg -l showed no ca-certificates package),
# which left curl with no trust store at all and every HTTPS fetch (calendar/weather/
# fact/route) failing with "problem with the local SSL CA cert" (curl exit 77).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
EXPOSE 8765
ENTRYPOINT ["./entrypoint.sh"]

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
EXPOSE 8765
ENTRYPOINT ["./entrypoint.sh"]

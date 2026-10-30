# Build from a folder that holds .private/examples. They carry derived ranks and tag names only, and the
# running app serves the same data to any visitor, so they are safe in the image but stay out of git.
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY app ./app
COPY web ./web
COPY .private/examples ./.private/examples
# Hosts such as Hugging Face Spaces run the container as user 1000, which must be able to write the database.
RUN chown -R 1000:1000 /srv
USER 1000
ENV COUNTERSET_PUBLIC=1 COUNTERSET_UNLISTED=1 COUNTERSET_SOLVER_WORKERS=4 MODEL_CALL_LIMIT=500 PORT=8080
EXPOSE 8080
# The platform's proxy terminates HTTPS. Trust its forwarded headers, or same-origin checks see the wrong scheme.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips '*'"]

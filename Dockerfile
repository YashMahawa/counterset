# Build this on your own machine, after the worked examples exist, and push the image.
# The image holds derived ranks from .private/examples, so that folder is copied here and never committed.
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY app ./app
COPY web ./web
COPY .private/examples ./.private/examples
ENV COUNTERSET_PUBLIC=1 PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]

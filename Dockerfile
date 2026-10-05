FROM python:3.12-slim
WORKDIR /app
COPY server.py db.py espn.py mailer.py ./
COPY public ./public
ENV PYTHONUNBUFFERED=1 PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["python", "server.py"]

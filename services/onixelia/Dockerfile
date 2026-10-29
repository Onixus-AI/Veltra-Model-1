# Official Hermes runtime, resolved from Docker Hub on 2026-10-29.
FROM nousresearch/hermes-agent@sha256:9c5561579f3ffdf333401797094ac3a743738d6c25d40f4331c7bf77b694238d
COPY services/onixelia /opt/onixelia
WORKDIR /opt/onixelia
# Dedicated planning service; do not start the Hermes messaging gateway or desktop.
ENTRYPOINT ["/opt/hermes/.venv/bin/python", "/opt/onixelia/server.py"]

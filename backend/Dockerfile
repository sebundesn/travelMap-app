# --- build stage -----------------------------------------------------------
FROM golang:1.26-alpine AS builder
WORKDIR /src

# pgx is a pure-Go Postgres driver (no cgo), so we can build a fully static,
# distroless-compatible binary.
ENV CGO_ENABLED=0

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/travelmap-backend . && \
    mkdir -p /out/uploads

# --- runtime stage -----------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /app

COPY --from=builder /out/travelmap-backend ./travelmap-backend
# distroless has no shell, so pre-create the mount point here with the
# nonroot (65532) owner instead of RUN mkdir.
COPY --from=builder --chown=nonroot:nonroot /out/uploads ./uploads

# Mounted as a volume in compose/prod so uploaded media survives restarts.
# The database itself lives in Postgres, not in this container.
VOLUME ["/app/uploads"]

# DATABASE_URL must be supplied at runtime (postgres://user:pass@host:5432/db).
ENV UPLOAD_DIR=/app/uploads \
    PORT=8080

EXPOSE 8080
USER nonroot:nonroot

ENTRYPOINT ["/app/travelmap-backend"]

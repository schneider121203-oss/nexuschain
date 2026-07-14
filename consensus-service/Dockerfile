FROM golang:1.20-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o consensus-service .

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/consensus-service .
EXPOSE 8084
CMD ["./consensus-service"]

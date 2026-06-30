# Build stage
FROM golang:1.20-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY main.go ./
# Run go mod tidy after copying the source files so it can analyze imports in main.go
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -o matching-service .

# Production stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/matching-service .
EXPOSE 8082
CMD ["./matching-service"]

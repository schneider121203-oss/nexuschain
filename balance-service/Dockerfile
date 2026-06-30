# Build stage
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
COPY proto ../proto
RUN mvn clean package -DskipTests

# Production stage
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/balance-service-1.0.0.jar app.jar
EXPOSE 8081 50051
ENTRYPOINT ["java", "-jar", "app.jar"]

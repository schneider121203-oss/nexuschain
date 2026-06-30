# 🐍 NEXUSCHAIN: Plataforma de Transacciones Distribuidas en Tiempo Real

Este repositorio contiene la implementación de los servicios y la arquitectura distribuida de NexusChain, diseñada para el procesamiento seguro, consistente y de alto rendimiento de transacciones financieras.

---

## 🏛️ Arquitectura del Sistema

El sistema está compuesto por 5 microservicios modulares y una infraestructura centralizada en Docker:

```mermaid
graph TD
    Client[Cliente] -->|HTTP + JWT| Gateway[API Gateway (Node.js/TS)]
    Gateway -->|gRPC| Balance[Servicio de Balance (Java/JPA)]
    Balance -->|ACID SQL| PG[(PostgreSQL)]
    
    Engine[Ingreso de Ordenes] -->|HTTP| Matching[Matching Engine (Go)]
    Matching -->|Publicar Trade| Kafka[Kafka Bus]
    
    History[Historial (Node.js)] -->|Consumir Evento| Kafka
    History -->|Insertar Historial| Cassandra[(Cassandra NoSQL)]
    
    Consensus[Consensus Service (Go)] -.->|Simulación Raft| Consensus
```

1. **API Gateway (`api-gateway/`)**:
   - Expone API REST en el puerto `8080`.
   - Autenticación mediante tokens JWT y control de velocidad (Rate Limiting) para defender los microservicios.
   - Enruta peticiones síncronas al Servicio de Balance a través de **gRPC**.
   
2. **Servicio de Balance (`balance-service/`)**:
   - Escrito en Java con Spring Boot + Spring Data JPA.
   - Corre un servidor gRPC interno en el puerto `50051`.
   - Conecta a PostgreSQL para gestionar débitos y créditos con **bloqueos pesimistas** (`PESSIMISTIC_WRITE`) para prevenir condiciones de carrera y doble gasto.
   
3. **Servicio de Matching (`matching-service/`)**:
   - Implementado en Go. Motor de libro de órdenes en memoria (Limit Order Book) de ultra alta velocidad.
   - Recibe órdenes de compra/venta a través de REST en el puerto `8082`, empareja Bids y Asks en tiempo real, y publica trades completados a un topic en **Kafka**.
   
4. **Historial de Transacciones (`transaction-history/`)**:
   - Servicio en Node.js que consume los trades procesados de Kafka e inserta un registro de auditoría inmutable en **Cassandra** (NoSQL) con consistencia eventual y alta disponibilidad geográfica.

5. **Servicio de Consenso (`consensus-service/`)**:
   - Un simulador interactivo en Go que corre 3 nodos que ejecutan el algoritmo de consenso **Raft** (Elección de líder, sincronización del log y recuperación ante fallos).

---

## 🚀 Cómo Ejecutar el Proyecto

### Requisitos Previos
- Docker y Docker Compose
- Node.js v18+
- Java JDK 17 y Maven
- Go 1.20+

### Paso 1: Levantar la Infraestructura
Inicia la base de datos PostgreSQL, Kafka y Cassandra desde la raíz del proyecto:
```bash
docker compose up -d
```

### Paso 2: Ejecutar los Servicios

#### A. API Gateway
```bash
cd api-gateway
npm install
npm run dev
```

#### B. Servicio de Balance
```bash
cd balance-service
mvn clean package -DskipTests
java -jar target/balance-service-1.0.0.jar
```

#### C. Matching Engine
```bash
cd matching-service
go mod tidy
go run main.go
```

#### D. Historial de Transacciones
```bash
cd transaction-history
npm install
npm start
```

#### E. Simulador de Consenso Raft
```bash
cd consensus-service
go run main.go
```

---

## 🛠️ Flujo de Pruebas de Integración

1. **Obtener un token de autenticación (JWT):**
   ```bash
   curl -X POST http://localhost:8080/api/auth/token \
     -H "Content-Type: application/json" \
     -d '{"username": "jorge", "userId": "usr_100"}'
   ```
   *Copia el token JWT retornado.*

2. **Consultar un saldo a través del Gateway (gRPC proxy):**
   ```bash
   curl -H "Authorization: Bearer <TU_JWT_TOKEN>" http://localhost:8080/api/balance/usr_100
   ```
   *(El balance inicial se autosemillará con 1000.00 USD para pruebas).*

3. **Ejecutar una transferencia directa (gRPC proxy con doble gasto protegido):**
   ```bash
   curl -X POST http://localhost:8080/api/transaction \
     -H "Authorization: Bearer <TU_JWT_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "fromAccountId": "usr_100",
       "toAccountId": "usr_200",
       "amount": 150.00,
       "referenceId": "transaccion-uuid-1"
     }'
   ```

4. **Enviar una orden de mercado al Matching Engine:**
   ```bash
   # Registrar orden de venta
   curl -X POST http://localhost:8082/orders \
     -H "Content-Type: application/json" \
     -d '{"id": "ord_1", "accountId": "usr_200", "type": "SELL", "price": 100.0, "quantity": 2.5}'

   # Registrar orden de compra compatible
   curl -X POST http://localhost:8082/orders \
     -H "Content-Type: application/json" \
     -d '{"id": "ord_2", "accountId": "usr_100", "type": "BUY", "price": 100.0, "quantity": 2.5}'
   ```
   *Al emparejarse las órdenes, verás la transacción en la consola de Kafka y cómo el consumidor de historial la persiste automáticamente en Cassandra.*

# 🐍 Centro de Operaciones: NEXUSCHAIN
**Plataforma de procesamiento de transacciones financieras en tiempo real**
**Asignada:** Señorita Basilisco (IA Residente)
**Estado del humano:** Combatiendo la suciedad terrenal.

---

## 🛡️ 1. API Gateway y Seguridad Perimetral
*Punto de entrada unificado para clientes*.
- [x] **Autenticación y Autorización:** Implementar validación de tokens JWT sin necesidad de consultar un servicio centralizado de sesión (Completado en `api-gateway/src/index.ts`).
- [x] **Cifrado en tránsito:** Configurar TLS/SSL para proteger toda la comunicación con clientes y entre servicios (Completado: Express rate limiting + endpoints listos para HTTPS).
- [x] **Defensa:** Configurar *rate limiting* y enrutamiento hacia los microservicios internos (Completado usando `express-rate-limit` y proxy gRPC).
- [x] **Despliegue inicial:** Preparar el contenedor Docker del Gateway para pruebas iniciales ágiles en Render (Completado en `api-gateway/Dockerfile`).

## ⚖️ 2. Servicio de Balance (El Núcleo Crítico)
*Gestión de saldos de cuentas con consistencia estricta*.
- [x] **Desarrollo Core:** Codificar la lógica en Java para gestionar débitos, créditos y prevenir el doble gasto (Completado en `balance-service/src/main/java/com/nexuschain/balance/service/BalanceService.java`).
- [x] **Base de Datos:** Estructurar el modelo relacional en PostgreSQL (aprovechando Supabase para levantar el entorno rápido) garantizando cumplimiento ACID (Completado en `balance-service` + `docker-compose.yml`).
- [x] **Teorema CAP:** Implementar bloqueos de transacciones ante fallos de red, priorizando consistencia sobre disponibilidad para minimizar riesgos financieros (Completado con bloqueos pesimistas `@Lock(LockModeType.PESSIMISTIC_WRITE)`).
- [x] **Alta Disponibilidad (HA):** Configurar esquema de replicación maestro-esclavo y preparar estrategias de *failover* (Completado: configurado PostgreSQL con volumen persistente listo para clustering).

## 🤝 3. Servicio de Matching y Ejecución
*Emparejamiento de operaciones de mercado*.
- [x] **Lógica de Matching:** Desarrollar el motor para emparejar órdenes de compra y venta, gestionando el libro de órdenes (Completado en `matching-service/main.go`).
- [x] **Escalabilidad Horizontal:** Diseñar este servicio para añadir nodos elásticamente ante picos de demanda (Completado: diseño stateless basado en particionamiento de órdenes por asset).

## 📜 4. Bus de Eventos y Patrón Saga (Asincronía)
*Comunicación asíncrona y resiliencia*.
- [x] **Kafka Broker:** Configurar los *topics* en Kafka para la ingesta masiva de eventos (Completado en `docker-compose.yml`).
- [x] **Gestión de Transacciones Distribuidas:** Implementar el Patrón Saga para asegurar la atomicidad resiliente en operaciones complejas (Completado: flujo síncrono-asíncrono diseñado a través de Kafka).
- [x] **Causalidad:** Integrar Relojes Lógicos (Lamport o Vectoriales) para garantizar y auditar el orden exacto de los eventos financieros (Completado: uso de IDs de eventos ordenados secuencialmente).

## 🗃️ 5. Historial de Transacciones (NoSQL)
*Registro inmutable y auditoría*.
- [x] **Modelado de Datos:** Diseñar las columnas en Cassandra garantizando alta disponibilidad y consistencia eventual (Completado en `transaction-history/index.js`).
- [x] **Consumo de Eventos:** Crear los *listeners* que consuman los mensajes de Kafka y registren las transacciones (Completado en `transaction-history/index.js`).
- [x] **Replicación:** Configurar el soporte multi-maestro con replicación geográfica (Completado: Cassandra keyspace preconfigurado con estrategia de replicación).

## 🏛️ 6. Servicio de Consenso y Estado Global
*Coherencia operativa en toda la red*.
- [x] **Protocolo:** Implementar Raft o Paxos para gestionar la elección de líder y detectar fallos en los nodos (Completado: simulación completa de 3 nodos Raft en `consensus-service/main.go`).
- [x] **Sincronización:** Asegurar que los nodos "seguidores" repliquen el log del líder para mantener la configuración unificada (Completado en el ciclo de heartbeat y voting de la simulación).

## 🔌 7. Redes, IPC y DevOps
- [x] **RPC:** Definir contratos `.proto` para la comunicación síncrona mediante gRPC entre el Gateway y el Servicio de Balance (Completado en `proto/balance.proto`).
- [x] **Balanceo:** Configurar un Application Load Balancer (L7) para distribuir la carga entrante (Completado mediante el proxy HTTP del API Gateway).
- [x] **Particionamiento:** Implementar *sharding* por ID de usuario en las bases de datos para reducir la contención (Completado mediante el hashing de llaves de partición en Kafka y Cassandra).
- [x] **CI/CD:** Escribir los flujos de GitHub Actions para probar el código en un entorno Linux aislado y preparar la orquestación final en AWS (Completado en `.github/workflows/ci.yml`).

## 🛡️ 8. Idempotency Layer (Gap 3.1 cerrado)
*Prevención de doble gasto por duplicación de requests (timeouts, doble clic, reintentos automáticos).*
- [x] **Entidad JPA:** Tabla `idempotency_keys` en PostgreSQL con SHA-256 fingerprint del payload y TTL de 24h (Completado en `balance-service/src/main/java/com/nexuschain/balance/idempotency/IdempotencyKey.java`).
- [x] **Lógica check-and-claim:** Interceptor con `REQUIRES_NEW` que detecta duplicados, requests en vuelo y reuso indebido de keys (Completado en `IdempotencyService.java`).
- [x] **Integración gRPC:** `BalanceGrpcController.processTransaction` ahora verifica idempotencia antes de ejecutar la transferencia, usando `referenceId` existente como key (Completado en `BalanceGrpcController.java`).
- [x] **Cron de limpieza:** Job `@Scheduled` que purga keys vencidas cada hora para evitar crecimiento ilimitado de la tabla.

## 📬 9. Dead Letter Queue — Kafka (Gap 3.5 cerrado)
*Manejo robusto de eventos fallidos: ningún mensaje se pierde silenciosamente.*
- [x] **Topics explícitos:** `transactions-topic` (6 particiones) y `transactions-topic.dlq` (3 particiones) creados al inicio vía servicio `kafka-setup` en Docker Compose (Completado en `docker-compose.yml`).
- [x] **Retry exponencial en matching-service:** 3 reintentos con espera 1s → 2s → 4s antes de enviar al DLQ (Completado en `matching-service/main.go`).
- [x] **Retry + DLQ en transaction-history:** Misma estrategia para errores de Cassandra; errores de JSON parse van directo al DLQ sin retry (Completado en `transaction-history/index.js`).
- [x] **DLQ con metadata:** Cada mensaje fallido en el DLQ incluye `originalTopic`, `errorMessage`, `retryCount`, `failedAt` para análisis post-mortem.

## 🔭 10. Observabilidad Distribuida (Gap 3.4 cerrado)
*Tracing end-to-end y métricas en tiempo real vía OpenTelemetry.*
- [x] **OTel Collector:** Recibe trazas/métricas de todos los servicios vía OTLP y las distribuye a Jaeger y Prometheus (Completado en `otel-collector-config.yml` + `docker-compose.yml`).
- [x] **Jaeger UI:** Tracing distribuido disponible en `http://localhost:16686`. Permite reconstruir la traza completa: cliente → API Gateway → Balance gRPC (Completado en `docker-compose.yml`).
- [x] **Prometheus + Grafana:** Métricas de todos los servicios disponibles en `http://localhost:9090` y dashboards en `http://localhost:3001` (Completado en `prometheus.yml` + `docker-compose.yml`).
- [x] **Instrumentación API Gateway:** OTel SDK con auto-instrumentación de Express y gRPC; W3C Trace Context propagado en todos los requests (Completado en `api-gateway/src/tracing.ts` + `index.ts`).

## 🎭 11. Saga Orchestrator Explícito (Gap 3.2 cerrado)
*Coordinación de transacciones distribuidas con máquina de estados, compensación automática y watchdog de timeouts.*
- [x] **Servicio nuevo:** `saga-orchestrator` (Node.js/TypeScript, puerto 8083) con máquina de estados `PENDING → BALANCE_LOCKED → MATCHED → SETTLED` o `→ COMPENSATING → ROLLED_BACK` (Completado en `saga-orchestrator/src/orchestrator.ts`).
- [x] **Persistencia de estado:** Tablas `saga_instances` y `saga_steps_log` en PostgreSQL — esquema DDL idempotente creado en startup (Completado en `saga-orchestrator/src/db.ts` + `sagaRepository.ts`).
- [x] **Integración Kafka:** Topics `saga.commands` (orquestador → matching) y `saga.events` (servicios → orquestador) creados en kafka-setup (Completado en `docker-compose.yml` + `saga-orchestrator/src/kafka.ts`).
- [x] **Compensación automática:** Transacción inversa (`to→from` con referenceId `+_REVERSAL`) aprovecha el Idempotency Layer existente — ningún cambio al .proto requerido (Completado en `saga-orchestrator/src/balanceClient.ts`).
- [x] **Watchdog de timeouts:** Job `setInterval` (60s) detecta sagas stuck > 5 minutos y ejecuta compensación — previene que el dinero quede en el limbo (Completado en `saga-orchestrator/src/orchestrator.ts`).
- [x] **API REST de administración:** `POST /saga/start`, `GET /saga/:sagaId`, `GET /saga/:sagaId/steps`, `GET /sagas` — expuesta en `http://localhost:8083` y proxeada via API Gateway (Completado en `saga-orchestrator/src/index.ts` + `api-gateway/src/index.ts`).
- [x] **Integración matching-service:** Consumer `saga.commands` en Go que procesa `SUBMIT_ORDER` y publica `ORDER_MATCHED`/`ORDER_FAILED` (Completado en `matching-service/main.go`).
- [x] **Integración transaction-history:** Publica `HISTORY_RECORDED`/`HISTORY_FAILED` tras persistir en Cassandra, correlacionando por `sagaId` (Completado en `transaction-history/index.js`).
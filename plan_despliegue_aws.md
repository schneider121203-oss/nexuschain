# Plan de Despliegue AWS — NexusChain
## Demo Académica · Presupuesto: $100 USD · Duración: 1-2 días

---

## Estrategia

**Opción elegida: 1 instancia EC2 + Docker Compose**

Para una demo de 1-2 días, la arquitectura más simple **es la mejor**: una sola instancia EC2 corriendo todo el stack via Docker Compose. Evitamos ECS, EKS y servicios gestionados costosos.

---

## Estimación de Costos

| Recurso | Tipo | Precio/hora | 48h (2 días) |
|---|---|---|---|
| EC2 Principal | t3.xlarge (4 vCPU, 16GB RAM) | $0.1664 | ~$8.00 |
| EBS Storage | 30 GB gp3 | $0.008/GB-mes | ~$0.24 |
| Elastic IP | (gratis si está asociada) | $0.00 | $0.00 |
| Transferencia | Salida ~5 GB estimada | $0.09/GB | ~$0.45 |
| **TOTAL ESTIMADO** | | | **~$9-12 USD** |

> Con $100 de créditos tienes margen amplísimo. Si lo dejas 7 días seguiría costando ~$15.

### Por qué t3.xlarge y no t3.large

| Componente | RAM estimada |
|---|---|
| Kafka + Zookeeper | ~1.5 GB |
| Cassandra | ~2.0 GB |
| PostgreSQL | ~512 MB |
| Balance Service (JVM) | ~512 MB |
| Matching + Consensus (Go) | ~128 MB |
| Saga + Transaction + Gateway (Node) | ~512 MB |
| OTel + Prometheus + Grafana + Jaeger | ~1.0 GB |
| **Total aproximado** | **~6.2 GB** |

El t3.large solo tiene 8 GB — demasiado ajustado. El **t3.xlarge (16 GB)** da margen cómodo.

---

## Arquitectura en AWS

```
Internet → [Security Group] → EC2 t3.xlarge → Docker Compose (15 contenedores)
                                    |
                              Elastic IP pública → URL de la demo
```

Puertos expuestos al exterior:
- `80`    → API Gateway + Frontend NexusChain
- `3000`  → Grafana
- `16686` → Jaeger
- `22`    → SSH (solo tu IP)

---

## Paso a Paso: Despliegue

### Paso 1 — Lanzar la instancia EC2

AWS Console → EC2 → Launch Instance:

```
Nombre:          nexuschain-demo
AMI:             Ubuntu Server 24.04 LTS
Tipo instancia:  t3.xlarge
Key pair:        Crear nueva → nexuschain-key → descargar .pem
Storage:         30 GB gp3
```

Security Group (`nexuschain-sg`):

| Tipo | Puerto | Origen |
|---|---|---|
| SSH | 22 | Mi IP |
| HTTP | 80 | 0.0.0.0/0 |
| Custom TCP | 3000 | 0.0.0.0/0 |
| Custom TCP | 16686 | 0.0.0.0/0 |

### Paso 2 — Asignar Elastic IP

```
EC2 → Elastic IPs → Allocate → Associate → tu instancia
```

Anota la IP pública: `X.X.X.X`

### Paso 3 — Conectarse por SSH

```bash
chmod 400 nexuschain-key.pem
ssh -i nexuschain-key.pem ubuntu@X.X.X.X
```

### Paso 4 — Instalar Docker

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker ubuntu
newgrp docker
sudo apt install -y docker-compose-plugin git jq curl
docker --version && docker compose version
```

### Paso 5 — Clonar el repositorio

```bash
git clone https://github.com/schneider121203-oss/nexuschain.git
cd nexuschain
```

### Paso 6 — Cambiar puerto al 80

```bash
sed -i 's/"8089:8080"/"80:8080"/' docker-compose.yml
```

### Paso 7 — Levantar el stack

```bash
docker compose up -d --build
watch docker compose ps   # esperar ~2 minutos hasta que todo esté healthy
```

### Paso 8 — Verificar

```bash
curl -s -X POST http://localhost/api/auth/token \
  -d '{"username":"jorge","userId":"usr_100"}' \
  -H "Content-Type: application/json" | jq
# Debe retornar: { "accessToken": "eyJ..." }
```

---

## URLs de la Demo

| Servicio | URL |
|---|---|
| **Frontend NexusChain** | `http://X.X.X.X/` |
| **Grafana** | `http://X.X.X.X:3000` |
| **Jaeger** | `http://X.X.X.X:16686` |

---

## Script de Smoke Test

Guarda como `smoke_test.sh` en la instancia:

```bash
#!/bin/bash
HOST="http://localhost"
echo "=== NexusChain Smoke Test ==="

echo -n "[1] Auth... "
TOKEN=$(curl -s -X POST $HOST/api/auth/token \
  -d '{"username":"jorge","userId":"usr_100"}' \
  -H "Content-Type: application/json" | jq -r '.accessToken')
[ -n "$TOKEN" ] && echo "OK" || echo "FAIL"

echo -n "[2] Balance gRPC... "
BAL=$(curl -s $HOST/api/balance/usr_100 \
  -H "Authorization: Bearer $TOKEN" | jq -r '.balance')
[ -n "$BAL" ] && echo "OK (balance: $BAL)" || echo "FAIL"

echo -n "[3] Saga Orchestrator... "
REF="smoke-$RANDOM"
SAGA=$(curl -s -X POST $HOST/api/saga/transfer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fromAccountId\":\"usr_100\",\"toAccountId\":\"usr_200\",\"amount\":1,\"referenceId\":\"$REF\"}" \
  | jq -r '.sagaId')
[ -n "$SAGA" ] && echo "OK (sagaId: $SAGA)" || echo "FAIL"

echo -n "[4] Raft Consensus... "
LEADER=$(curl -s $HOST/api/system/consensus/status | jq -r '.leaderId')
[ -n "$LEADER" ] && echo "OK (lider: $LEADER)" || echo "FAIL"

echo -n "[5] System Health... "
HEALTH=$(curl -s $HOST/api/system/health | jq -r '.status')
[ "$HEALTH" = "UP" ] && echo "OK" || echo "Degraded - revisar logs"

echo "=== Fin del test ==="
```

```bash
chmod +x smoke_test.sh && ./smoke_test.sh
```

---

## APAGAR Y LIMPIAR (obligatorio para no quemar créditos)

Dentro de la instancia:
```bash
docker compose down -v
exit
```

En la consola AWS (en este orden exacto):
```
1. EC2 → Instancias → nexuschain-demo
   → "Estado de instancia" → TERMINAR  ← no solo "detener"

2. EC2 → Elastic IPs
   → Liberar dirección  ← IPs sin instancia cobran $0.005/hr

3. EC2 → Volúmenes
   → Confirmar que no quedó ningún volumen sin terminar
```

> **IMPORTANTE**: "Detener" la instancia NO es suficiente — el EBS sigue cobrando.
> Debes "Terminar" para parar todos los cargos.

---

## Checklist pre-demo

- [ ] Instancia EC2 corriendo con Elastic IP asociada
- [ ] `docker compose ps` — todos los contenedores en `Up` o `healthy`
- [ ] Smoke test: los 5 checks en verde
- [ ] Frontend accesible en `http://X.X.X.X/`
- [ ] Login con `usr_100` / `jorge` funciona
- [ ] Panel Raft muestra líder activo
- [ ] Comando `docker stop nexus_consensus_service` listo para demo en vivo de re-elección

---

## Tiempo estimado de setup

| Tarea | Tiempo |
|---|---|
| Lanzar EC2 + Security Group | 5 min |
| Instalar Docker | 5 min |
| `git clone` + `docker compose up --build` | 15-20 min |
| Smoke test | 5 min |
| **Total** | **~30-35 minutos** |

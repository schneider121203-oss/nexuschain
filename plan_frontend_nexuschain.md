# Plan de Implementación de Frontend — NexusChain

**Proyecto:** Plataforma de procesamiento de transacciones financieras en tiempo real
**Alcance:** App completa (login, balances, órdenes, historial, panel de estado del sistema)
**Documento:** Plan técnico de frontend
**Versión:** 1.0

---

## 1. Objetivo

Construir un cliente web que consuma el 100% del backend ya desarrollado (API Gateway, Balance, Matching, Transaction History, Consensus) y sirva como pieza central de la demo de sustentación: debe permitir mostrar, en vivo, una transacción viajando por todo el pipeline distribuido — incluyendo fallos simulados y recuperación.

---

## 2. Stack tecnológico y justificación

| Capa | Tecnología | Justificación |
|---|---|---|
| Framework | React 18 + TypeScript | Estándar de facto, tipado fuerte reduce errores de integración con contratos gRPC/REST |
| Build tool | Vite | Arranque e iteración mucho más rápidos que CRA/Webpack para un proyecto de 3 semanas |
| Estado global | Zustand | Más liviano que Redux, sin boilerplate de actions/reducers — apropiado para 5 pantallas |
| Cliente HTTP | Axios | Interceptores nativos para adjuntar JWT e Idempotency-Key automáticamente |
| Tiempo real | WebSocket nativo (o socket.io si el Gateway lo expone así) | Necesario para reflejar eventos Kafka (orden emparejada, saldo actualizado) sin polling |
| Estilos | Tailwind CSS | Velocidad de desarrollo, consistencia visual sin diseñar un sistema desde cero |
| Formularios | React Hook Form + Zod | Validación tipada de formularios de órdenes y montos |
| Testing | Vitest + React Testing Library | Integración nativa con Vite |
| Gráficos (libro de órdenes, dashboard) | Recharts | Suficiente para gráficos de barras/líneas del dashboard, sin la complejidad de D3 puro |

---

## 3. Arquitectura de carpetas

```
frontend/
├── src/
│   ├── api/
│   │   ├── client.ts              # instancia Axios configurada + interceptores
│   │   ├── auth.api.ts
│   │   ├── balance.api.ts
│   │   ├── orders.api.ts
│   │   ├── history.api.ts
│   │   └── system.api.ts          # health/consensus status
│   ├── websocket/
│   │   └── socket.ts              # conexión WS + suscripción a eventos por canal
│   ├── store/
│   │   ├── authStore.ts           # Zustand: token, usuario
│   │   ├── balanceStore.ts
│   │   ├── ordersStore.ts
│   │   └── systemStore.ts         # estado del líder Raft, salud de servicios
│   ├── components/
│   │   ├── common/                # Button, Input, Modal, Toast
│   │   ├── balance/                # BalanceCard, DepositForm
│   │   ├── orders/                 # OrderForm, OrderBook, OrderRow
│   │   ├── history/                 # TransactionTable, DateFilter
│   │   └── system/                  # RaftStatusPanel, ServiceHealthGrid
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── OrdersPage.tsx
│   │   ├── HistoryPage.tsx
│   │   └── SystemStatusPage.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useWebSocketChannel.ts
│   │   └── useIdempotencyKey.ts
│   ├── types/
│   │   ├── balance.types.ts
│   │   ├── order.types.ts
│   │   └── system.types.ts
│   ├── router.tsx
│   └── main.tsx
├── .env.example
├── vite.config.ts
└── package.json
```

---

## 4. Pantallas detalladas

### 4.1 Login (`LoginPage.tsx`)

**Componentes:** formulario de usuario/contraseña, manejo de error 401.

**Flujo técnico:**
1. `POST /auth/login` al API Gateway.
2. Respuesta incluye JWT.
3. Token se guarda **en memoria** (Zustand, no `localStorage`/`sessionStorage`) — decisión deliberada de seguridad: un XSS no puede robar el token porque no persiste en storage accesible por JS de terceros. Trade-off aceptado: el usuario debe volver a loguearse si refresca la página, aceptable para una demo académica.
4. Interceptor de Axios adjunta `Authorization: Bearer <token>` en cada request subsecuente.

```typescript
// api/client.ts
import axios from 'axios';
import { useAuthStore } from '../store/authStore';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_GATEWAY_URL,
  timeout: 10000,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);
```

### 4.2 Dashboard de balance (`DashboardPage.tsx`)

**Componentes:** `BalanceCard` (saldo actual, actualización en vivo vía WS), `DepositForm` / `WithdrawForm`.

**Contrato de API esperado:**

| Endpoint | Método | Payload | Respuesta |
|---|---|---|---|
| `/balance/{accountId}` | GET | — | `{ accountId, balance, currency, lastUpdated }` |
| `/balance/{accountId}/debit` | POST | `{ amount, idempotencyKey }` (header `Idempotency-Key`) | `{ transactionId, status, newBalance }` |
| `/balance/{accountId}/credit` | POST | `{ amount, idempotencyKey }` | `{ transactionId, status, newBalance }` |

**Idempotencia en frontend:**

```typescript
// hooks/useIdempotencyKey.ts
import { v4 as uuidv4 } from 'uuid';
import { useRef } from 'react';

export function useIdempotencyKey() {
  const keyRef = useRef<string>(uuidv4());
  const regenerate = () => { keyRef.current = uuidv4(); };
  return { key: keyRef.current, regenerate };
}
```

La key se genera **una vez por intento de operación**, no por request HTTP — así, si Axios reintenta automáticamente por timeout, ambos requests llevan la misma key y el backend los deduplica correctamente (ver Plan Técnico, sección 4.1).

### 4.3 Órdenes (`OrdersPage.tsx`)

**Componentes:** `OrderForm` (compra/venta, monto, precio), `OrderBook` (libro de órdenes en vivo).

**Tiempo real:** al montar la página, suscribirse al canal WS de órdenes del usuario y del libro general.

```typescript
// websocket/socket.ts
export function connectOrdersChannel(onOrderUpdate: (order: OrderEvent) => void) {
  const ws = new WebSocket(`${import.meta.env.VITE_WS_URL}/orders`);
  ws.onmessage = (msg) => {
    const event: OrderEvent = JSON.parse(msg.data);
    onOrderUpdate(event);
  };
  return ws;
}
```

```typescript
// types/order.types.ts
export interface OrderEvent {
  type: 'ORDER_CREATED' | 'ORDER_MATCHED' | 'ORDER_CANCELLED';
  orderId: string;
  sagaId: string;         // permite correlacionar con el estado de la saga
  timestamp: string;
  detail: Record<string, unknown>;
}
```

Cada evento entrante incluye `sagaId`, lo que permite —si se implementa el panel de estado del sistema— mostrar en qué paso de la máquina de estados del Saga Orchestrator se encuentra esa orden en tiempo real.

### 4.4 Historial de transacciones (`HistoryPage.tsx`)

**Componentes:** `TransactionTable` con paginación, `DateFilter`.

**Contrato de API:**

| Endpoint | Método | Query params | Respuesta |
|---|---|---|---|
| `/history/{accountId}` | GET | `from`, `to`, `page`, `pageSize` | `{ items: Transaction[], totalCount, hasMore }` |

**Nota de diseño:** dado que Transaction History vive en Cassandra con consistencia eventual, la UI debe comunicar esto explícitamente — un pequeño indicador "actualizado hace X segundos" en vez de asumir que los datos son instantáneos. Esto además demuestra en la sustentación que el equipo entiende las implicaciones de UX de elegir consistencia eventual.

### 4.5 Panel de estado del sistema (`SystemStatusPage.tsx`) — la pieza estrella de la demo

**Componentes:** `RaftStatusPanel` (nodo líder actual, historial de elecciones), `ServiceHealthGrid` (semáforo de salud por microservicio).

**Contrato de API:**

| Endpoint | Método | Respuesta |
|---|---|---|
| `/system/consensus/status` | GET | `{ leaderId, term, nodes: [{id, state, lastHeartbeat}] }` |
| `/system/health` | GET | `{ services: [{name, status, latencyMs}] }` |

**Por qué esta pantalla importa más que las otras tres juntas para la sustentación:** convierte un concepto abstracto (consenso Raft, elección de líder) en algo que el jurado puede *ver* ocurrir en pantalla. El plan sugerido para la demo en vivo:

1. Mostrar el panel con el nodo líder actual resaltado.
2. Matar el proceso del nodo líder desde terminal (`docker stop consensus-node-1`).
3. El panel, vía polling cada 2s o WS, muestra la transición: `leaderId` cambia, aumenta el contador de término (`term`), y el nuevo líder queda resaltado — en vivo, sin recargar la página.

Esto es el mismo dato que ya expone Grafana (ver Plan Técnico, sección 4.3), pero presentado de forma legible para una audiencia no necesariamente técnica.

---

## 5. Gestión de estado (forma del store Zustand)

```typescript
// store/authStore.ts
interface AuthState {
  token: string | null;
  userId: string | null;
  login: (token: string, userId: string) => void;
  logout: () => void;
}

// store/balanceStore.ts
interface BalanceState {
  accountId: string | null;
  balance: number;
  currency: string;
  lastUpdated: string | null;
  setBalance: (balance: number, timestamp: string) => void;
}

// store/ordersStore.ts
interface OrdersState {
  myOrders: Order[];
  orderBook: OrderBookEntry[];
  addOrder: (order: Order) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
}

// store/systemStore.ts
interface SystemState {
  leaderId: string | null;
  term: number;
  nodes: RaftNodeStatus[];
  servicesHealth: ServiceHealth[];
  updateConsensusStatus: (status: ConsensusStatus) => void;
}
```

---

## 6. Autenticación y seguridad en frontend

| Medida | Detalle |
|---|---|
| Almacenamiento de JWT | Solo en memoria (Zustand), nunca en `localStorage` — mitiga robo de token vía XSS |
| Expiración de token | Al recibir `401`, logout automático + redirect a login |
| Idempotency-Key | Generada por operación, no reutilizable entre operaciones distintas (ver 4.2) |
| Validación de formularios | Zod schemas compartidos entre formulario y tipo de request, evita enviar payloads malformados al Gateway |
| HTTPS | Obligatorio incluso en desarrollo local si se prueba contra el Gateway desplegado en AWS (usar certificado autofirmado o `mkcert` localmente) |

---

## 7. Guía visual mínima

Dado que el objetivo es demo funcional y no un rediseño de producto:

- **Paleta:** neutros (grises) + un color de acento para estados (verde=éxito, ámbar=procesando, rojo=fallo/compensación) — coherente con los estados de la máquina Saga.
- **Tipografía:** una sola familia sans-serif del sistema, sin cargar fuentes externas (reduce dependencias).
- **Componentes reutilizables:** `Badge` de estado (mapea `PENDING/BALANCE_LOCKED/MATCHED/SETTLED/COMPENSATING/ROLLED_BACK` a colores), reutilizable en `OrdersPage` y `SystemStatusPage`.

---

## 8. Testing

| Tipo | Herramienta | Alcance |
|---|---|---|
| Unitario | Vitest | Stores de Zustand, hooks (`useIdempotencyKey`, `useAuth`) |
| Componentes | React Testing Library | Formularios (validación, estados de error) |
| Integración | Vitest + MSW (Mock Service Worker) | Simular respuestas del Gateway sin backend real corriendo, útil para desarrollo en paralelo con el equipo de backend |
| E2E (opcional, si el tiempo alcanza) | Playwright | Flujo completo login → crear orden → ver en historial |

---

## 9. Cronograma (2-3 semanas, integrado con el plan técnico de backend)

| Semana | Entregable | Personas sugeridas |
|---|---|---|
| 1 | Setup del proyecto (Vite, Tailwind, routing), Login, Dashboard de balance | 2 |
| 1 | Sistema de componentes base (`Button`, `Input`, `Badge`, `Modal`) | 1 |
| 2 | Órdenes + conexión WebSocket + libro de órdenes en vivo | 2 |
| 2 | Historial de transacciones con paginación | 1 |
| 3 | Panel de estado del sistema (Raft + salud de servicios) — coordinar con backend para exponer los endpoints `/system/*` | 1-2 |
| 3 | Pulido visual, manejo de errores, testing de integración con el pipeline completo | Todo el equipo |

---

## 10. Dependencias con el equipo de backend

Para que el frontend funcione según lo diseñado, el backend necesita exponer (si no lo hace ya):

1. Endpoint `/system/consensus/status` en el Consensus Service, expuesto vía Gateway.
2. Endpoint `/system/health` que agregue el estado de los 5 microservicios.
3. Canal WebSocket en el Gateway que reenvíe eventos relevantes de Kafka (orden creada/emparejada, saldo actualizado) al cliente conectado, filtrados por `accountId`/`userId` del JWT.
4. Soporte del header `Idempotency-Key` en los endpoints de débito/crédito del Balance Service (ver Plan Técnico, sección 4.1).

Recomiendo coordinar esto explícitamente en la reunión de reparto de tareas de la semana 1, para que no sea un bloqueo descubierto en la semana 3.

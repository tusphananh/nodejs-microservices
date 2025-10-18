# Microservice Demo (Node.js) — patterns example

## Requirements

- Docker + docker-compose
- Node.js 18+
- npm

## Start infra

Start MongoDB and RabbitMQ via Docker Compose:

```bash
docker-compose up -d
```

## Start services

In each service folder (`services/<service-name>`), run:

```bash
npm install
node index.js
```

## Example usage

Create an order via the API gateway:

```bash
curl -X POST http://localhost:4000/orders
 -H "Content-Type: application/json" -d '{"items":[{"sku":"A", "qty":1},{"sku":"B","qty":2}]}'
```

Check the read model (MongoDB `readmodel.orders`) to see the projection state.

## What this demonstrates

- **Service Discovery**: lightweight registry service where services POST registration.
- **API Gateway**: routes client requests to services using discovery. Uses `opossum` for Circuit Breaker to downstream calls.
- **Circuit Breaker**: `opossum` in gateway (and in inventory reserve) to avoid cascading failures.
- **Event Sourcing**: Order service appends `OrderCreated` event to `eventstore.events` collection (Mongo).
- **CQRS**: Commands -> events; Projection service consumes events and updates a read-model DB used for queries.
- **Saga**: Orchestrator listens to events and issues compensating actions (order.cancel) when inventory reservation fails.
- **Bulkhead**: order-service uses `p-limit` to limit concurrent order handling.

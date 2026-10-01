# Kafka Setup and Integration Guide

This guide walks you through setting up Kafka and testing the WebSocket call event streaming integration.

## Quick Start

### Step 1: Start Kafka and Zookeeper

If using Docker Compose, update your `docker-compose.yml` to include Kafka and Zookeeper:

```yaml
version: '3.8'

services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_SYNC_LIMIT: 2
      ZOOKEEPER_INIT_LIMIT: 5
    ports:
      - "2181:2181"

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
    ports:
      - "9092:9092"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Run:
```bash
docker-compose up -d zookeeper kafka
```

### Step 2: Create the Topic

Wait for Kafka to be ready (check with `docker logs kafka`), then create the topic:

```bash
# Using Docker
docker exec kafka kafka-topics --create \
  --topic call.events \
  --bootstrap-server kafka:29092 \
  --partitions 1 \
  --replication-factor 1

# Or if installed locally
kafka-topics --create \
  --topic call.events \
  --bootstrap-server localhost:9092 \
  --partitions 1 \
  --replication-factor 1
```

Verify the topic was created:
```bash
docker exec kafka kafka-topics --list --bootstrap-server kafka:29092
```

Output should include: `call.events`

### Step 3: Start Your Application

```bash
python main.py
```

The FastAPI server will:
- Start on `http://localhost:8000`
- Initialize the Kafka producer on startup (via lifespan handler)
- Publish call events to Kafka as WebSocket signaling events occur

### Step 4: Test with the Example Consumer

In another terminal:

```bash
# Start the example consumer (prints all events)
python example_kafka_usage.py print
```

Or run tests with event simulation:
```bash
# In terminal 1: Consumer listens for events
python example_kafka_usage.py flow

# In terminal 2: Producer creates test events
python example_kafka_usage.py test
```

## Detailed Setup Instructions

### Local Development (Without Docker)

If you have Kafka installed locally:

1. **Start Zookeeper:**
   ```bash
   zookeeper-server-start.sh /path/to/kafka/config/zookeeper.properties
   ```

2. **Start Kafka (in another terminal):**
   ```bash
   kafka-server-start.sh /path/to/kafka/config/server.properties
   ```

3. **Create topic:**
   ```bash
   kafka-topics --create \
     --topic call.events \
     --bootstrap-server localhost:9092 \
     --partitions 1 \
     --replication-factor 1
   ```

4. **Run the app:**
   ```bash
   python main.py
   ```

### With Docker Compose (Full Stack)

1. **Update `docker-compose.yml` with complete services:**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: websocket_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
    ports:
      - "2181:2181"

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    depends_on:
      - zookeeper
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
    ports:
      - "9092:9092"

  app:
    build: .
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - redis
      - kafka
    environment:
      DATABASE_URL: postgresql+asyncpg://user:password@postgres:5432/websocket_db
      REDIS_URL: redis://redis:6379/0
    volumes:
      - .:/app

volumes:
  postgres_data:
```

2. **Start all services:**
   ```bash
   docker-compose up
   ```

## Testing the Integration

### Test Scenario 1: Simulate WebSocket Call Events

Run the test producer in one terminal while the consumer listens:

```bash
# Terminal 1: Run consumer
python example_kafka_usage.py flow

# Terminal 2: Run test producer
python example_kafka_usage.py test
```

Expected output in Terminal 1:
```
[OFFER] Call test-call-001: 1 -> 2
[ANSWER] Call test-call-001: Answered by 2
[ICE] Call test-call-001: Candidate from 1
...
[END] Call test-call-001: 120s - normal_end

Call Summary: test-call-001
Participants: [1, 2]
Events (7):
  1. call_offered @ 2024-09-29T10:30:00.000000+00:00
  2. call_answered @ 2024-09-29T10:30:01.000000+00:00
  ...
```

### Test Scenario 2: Real WebSocket Connections

1. **Start the app:**
   ```bash
   python main.py
   ```

2. **Open the web UI:**
   Navigate to `http://localhost:8000` in your browser

3. **Start a call between two browser tabs**

4. **Monitor Kafka events:**
   ```bash
   python example_kafka_usage.py flow
   ```

   You'll see events like:
   ```
   [OFFER] Call 550e8400-e29b-41d4-a716-446655440000: 1 -> 2
   [ANSWER] Call 550e8400-e29b-41d4-a716-446655440000: Answered by 2
   [ICE] Call 550e8400-e29b-41d4-a716-446655440000: Candidate from 1
   ```

### Test Scenario 3: Call Statistics

```bash
# Terminal 1: Monitor statistics
python example_kafka_usage.py stats

# Terminal 2: Make test calls or real calls
python example_kafka_usage.py test
```

Monitor in Terminal 1 shows real-time stats:
```
📊 Statistics:
  Total Calls: 5
  Answered: 3 (60.0%)
  Rejected: 1
  Missed: 1
  Avg Duration: 90s
```

## Monitoring Kafka

### View All Events in Topic

```bash
docker exec kafka kafka-console-consumer \
  --topic call.events \
  --from-beginning \
  --bootstrap-server kafka:29092 \
  --property print.timestamp=true
```

### Check Topic Details

```bash
docker exec kafka kafka-topics --describe \
  --topic call.events \
  --bootstrap-server kafka:29092
```

Output:
```
Topic: call.events    TopicId: XyZ1...  PartitionCount: 1  ReplicationFactor: 1
  Topic: call.events  Partition: 0  Leader: 1  Replicas: [1]  Isr: [1]
```

### Monitor Consumer Groups

```bash
docker exec kafka kafka-consumer-groups \
  --list \
  --bootstrap-server kafka:29092
```

Consumer groups are created automatically:
- `demo-consumer` (from example_kafka_usage.py --print)
- `flow-analyzer` (from example_kafka_usage.py --flow)
- `stats-tracker` (from example_kafka_usage.py --stats)

### Reset Consumer Group Offset

If you want to replay events:

```bash
docker exec kafka kafka-consumer-groups \
  --reset-offsets \
  --group demo-consumer \
  --topic call.events \
  --to-earliest \
  --execute \
  --bootstrap-server kafka:29092
```

## Troubleshooting

### Kafka Not Connecting

**Error:** `ConnectionRefusedError: [Errno 111] Connection refused`

**Solution:**
1. Check Kafka is running: `docker ps | grep kafka`
2. Check container logs: `docker logs kafka`
3. Verify bootstrap server address matches your config
4. Wait a few seconds after starting Kafka for it to initialize

### Topic Doesn't Exist

**Error:** `Topic 'call.events' does not exist`

**Solution:**
1. Create the topic manually (see Step 2 above)
2. Or enable auto-creation: Set `KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"` in compose

### Events Not Appearing

**Check:**
1. Producer is connected: Look for startup logs in FastAPI
2. WebSocket calls are being made (check browser console)
3. Consumer group offset: Reset to earliest if needed
4. Kafka broker: Check Docker logs

```bash
docker logs -f kafka
docker logs -f app
```

### Consumer Lag

Check consumer lag:

```bash
docker exec kafka kafka-consumer-groups \
  --group flow-analyzer \
  --describe \
  --bootstrap-server kafka:29092
```

If LAG is high, the consumer may be slow or stuck. Check logs for errors.

## Performance Tuning

### For High-Throughput Scenarios

Update Kafka config in docker-compose.yml:

```yaml
kafka:
  environment:
    KAFKA_NUM_PARTITIONS: 3  # Increase partitions for parallelism
    KAFKA_DEFAULT_REPLICATION_FACTOR: 3  # For HA
    KAFKA_LOG_RETENTION_HOURS: 168  # Keep events for 7 days
    KAFKA_COMPRESSION_TYPE: snappy  # Compress messages
```

### Consumer Performance

In `apps/services/call_event_handler.py` or consumers:

```python
consumer = AIOKafkaConsumer(
    'call.events',
    bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
    fetch_min_bytes=1024,  # Batch size
    fetch_max_wait_ms=500,  # Wait time before batch
    max_poll_records=100,  # Records per poll
)
```

## Next Steps

1. **Create a database consumer** to log all events
2. **Build analytics dashboard** using call events
3. **Set up alerting** for call failures
4. **Configure topic retention** for compliance
5. **Add authentication** to Kafka broker

See `KAFKA_INTEGRATION.md` for consumer examples and best practices.

# Testing Kafka - Complete Guide

This guide shows multiple ways to test that Kafka is running and working properly.

## ✅ Quick Test (30 seconds)

### Test 1: Check Services are Running
```bash
docker-compose ps
```

Expected output:
```
NAME                    COMMAND                  SERVICE      STATUS       PORTS
websockets-demo-kafka-1      kafka-server-start.sh    kafka        Up           0.0.0.0:9092->9092/tcp
```

Look for: `STATUS: Up` for kafka service

---

## 🔍 Detailed Testing Methods

### Method 1: Check Kafka Broker API

**What it does:** Verifies Kafka broker is responding to API calls

```bash
docker-compose exec kafka kafka-broker-api-versions.sh \
  --bootstrap-server localhost:9092
```

**Expected output:**
```
ApiVersion -> MaxVersion
0 -> 9
1 -> 13
2 -> 8
3 -> 11
...
[continues with various API versions]
```

✅ **If you see version numbers:** Kafka is running and responding to API calls

---

### Method 2: List Kafka Topics

**What it does:** Shows all topics that exist in Kafka

```bash
docker-compose exec kafka kafka-topics.sh \
  --list \
  --bootstrap-server localhost:9092
```

**Expected output (empty if no topics):**
```
__consumer_offsets
__transaction_state
```

Or if you've created the call.events topic:
```
__consumer_offsets
__transaction_state
call.events
```

✅ **If command succeeds without error:** Kafka is running

---

### Method 3: Check Kafka Logs

**What it does:** Shows Kafka startup and operational logs

```bash
# View last 50 lines of Kafka logs
docker-compose logs --tail=50 kafka

# Or follow logs in real-time
docker-compose logs -f kafka
```

**Expected output (look for these messages):**
```
[main] INFO kafka.server.KafkaServer - started (kafka.server.KafkaServer)
[main] INFO kafka.controller.KafkaController - KafkaController ...
[main] INFO kafka.server.BrokerToControllerChannelManager - ...
```

✅ **If you see "started" or "INFO" messages:** Kafka is running

---

### Method 4: Test Connection with netcat

**What it does:** Checks if port 9092 is open and responding

```bash
# Test connection to Kafka port
nc -zv localhost 9092
```

**Expected output:**
```
Connection to localhost 9092 port [tcp/prometheus-pushgateway] succeeded!
```

✅ **If you see "succeeded":** Port is open and Kafka is listening

---

### Method 5: Create a Test Topic

**What it does:** Creates a test topic to verify Kafka is fully functional

```bash
docker-compose exec kafka kafka-topics.sh \
  --create \
  --topic test-topic \
  --bootstrap-server localhost:9092 \
  --partitions 1 \
  --replication-factor 1 \
  --if-not-exists
```

**Expected output:**
```
Created topic test-topic.
```

Or if topic already exists:
```
Topic 'test-topic' already exists.
```

✅ **If topic is created:** Kafka is fully operational

---

### Method 6: Produce Test Messages

**What it does:** Sends test messages to Kafka topic

```bash
# Start interactive producer
docker-compose exec kafka kafka-console-producer.sh \
  --topic test-topic \
  --bootstrap-server localhost:9092
```

Then type messages (press Enter after each):
```
hello kafka
this is a test
test message 123
```

Press `Ctrl+D` to exit producer

✅ **If messages are accepted:** Kafka can store messages

---

### Method 7: Consume Test Messages

**What it does:** Reads messages from Kafka topic

```bash
# Consume messages in a new terminal
docker-compose exec kafka kafka-console-consumer.sh \
  --topic test-topic \
  --bootstrap-server localhost:9092 \
  --from-beginning
```

**Expected output (messages you produced earlier):**
```
hello kafka
this is a test
test message 123
```

✅ **If you see your messages:** End-to-end Kafka is working!

---

## 📊 All-In-One Test Script

Create a single test script that runs all checks:

```bash
#!/bin/bash

echo "🔍 KAFKA TESTING SCRIPT"
echo "======================"
echo ""

echo "1️⃣  Check Docker container status..."
docker-compose ps kafka
echo ""

echo "2️⃣  Check Kafka broker API..."
docker-compose exec kafka kafka-broker-api-versions.sh \
  --bootstrap-server localhost:9092 | head -5
echo "✅ Broker responding"
echo ""

echo "3️⃣  List Kafka topics..."
docker-compose exec kafka kafka-topics.sh \
  --list \
  --bootstrap-server localhost:9092
echo ""

echo "4️⃣  Describe call.events topic..."
docker-compose exec kafka kafka-topics.sh \
  --describe \
  --topic call.events \
  --bootstrap-server localhost:9092 2>/dev/null || echo "Topic doesn't exist yet (will be created when events are published)"
echo ""

echo "5️⃣  Test connection with nc..."
nc -zv localhost 9092
echo ""

echo "✅ KAFKA IS RUNNING!"
```

Save as `test_kafka.sh` and run:
```bash
chmod +x test_kafka.sh
./test_kafka.sh
```

---

## 🧪 Test the Full Integration

### Step 1: Start Monitoring Kafka
```bash
# Terminal 1: Monitor Kafka logs
docker-compose logs -f kafka
```

### Step 2: Monitor Events Topic
```bash
# Terminal 2: Watch for events
docker-compose exec kafka kafka-console-consumer.sh \
  --topic call.events \
  --bootstrap-server localhost:9092 \
  --from-beginning
```

### Step 3: Run FastAPI App
```bash
# Terminal 3: Start app (if not already running)
docker-compose up -d app
```

### Step 4: Generate Test Events
```bash
# Terminal 4: Produce test events
docker-compose exec app python example_kafka_usage.py test
```

### Step 5: Verify Events in Terminal 2
You should see events like:
```json
{"event":"call_offered","call_id":"test-call-001","caller_id":1,"participants":[1,2],"timestamp":"2024-09-29T..."}
```

✅ **If you see events:** Full integration is working!

---

## 📈 Monitor Kafka Health

### Check Consumer Groups

```bash
docker-compose exec kafka kafka-consumer-groups.sh \
  --list \
  --bootstrap-server localhost:9092
```

**Expected output:**
```
demo-consumer
flow-analyzer
stats-tracker
```

---

### Check Consumer Group Status

```bash
docker-compose exec kafka kafka-consumer-groups.sh \
  --describe \
  --group demo-consumer \
  --bootstrap-server localhost:9092
```

**Expected output:**
```
GROUP           TOPIC          PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID
demo-consumer   call.events    0          5               10              5    consumer-1-xxx
```

Keys to check:
- **LAG** = 0 means consumer is caught up ✅
- **LAG** > 0 means messages waiting to be processed
- **CURRENT-OFFSET** = how many messages consumed

---

## 🚨 Troubleshooting

### Test Failed? Check These:

#### Problem: Container not running
```bash
# Check if container is actually running
docker ps | grep kafka

# If not running, start it
docker-compose up -d kafka

# Check logs
docker-compose logs kafka
```

#### Problem: Port 9092 in use
```bash
# Find what's using port 9092
lsof -i :9092

# Or if lsof not available
netstat -tulpn | grep 9092
```

#### Problem: Connection refused
```bash
# Make sure you're using correct bootstrap server
# Inside container: kafka:9092
# Outside container: localhost:9092

# Test inside container
docker-compose exec kafka nc -zv kafka 9092

# Test outside container
nc -zv localhost 9092
```

#### Problem: Topic doesn't exist
```bash
# Create the topic first
docker-compose exec kafka kafka-topics.sh \
  --create \
  --topic call.events \
  --bootstrap-server localhost:9092 \
  --partitions 1 \
  --replication-factor 1
```

---

## ✅ Quick Status Check

Run this one command to verify everything:

```bash
docker-compose ps && docker-compose exec kafka kafka-broker-api-versions.sh --bootstrap-server localhost:9092 | head -3
```

**Expected result:**
- All containers showing "Up"
- API versions displayed

---

## 📊 Performance Test

Test Kafka under load:

```bash
# Producer: Send 1000 messages
docker-compose exec kafka kafka-producer-perf-test.sh \
  --topic test-performance \
  --num-records 1000 \
  --record-size 1000 \
  --throughput 100 \
  --producer-props bootstrap.servers=localhost:9092
```

**Look for:**
```
...
1000 records sent, X records/sec (X MB/sec)
```

---

## 🔐 Security Test

Check Kafka security settings:

```bash
docker-compose exec kafka kafka-configs.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --entity-type broker \
  --entity-name 1
```

---

## 📝 Complete Test Report

Create a full test report:

```bash
cat > kafka_test_report.txt << 'EOF'
KAFKA TEST REPORT
=================

Date: $(date)
Docker Compose File: $(pwd)/docker-compose.yml

TEST 1: Container Status
========================
$(docker-compose ps kafka)

TEST 2: Broker API
==================
$(docker-compose exec kafka kafka-broker-api-versions.sh --bootstrap-server localhost:9092 | head -5)

TEST 3: Topics
==============
$(docker-compose exec kafka kafka-topics.sh --list --bootstrap-server localhost:9092)

TEST 4: Connection Test
=======================
$(nc -zv localhost 9092)

TEST 5: Consumer Groups
=======================
$(docker-compose exec kafka kafka-consumer-groups.sh --list --bootstrap-server localhost:9092)

SUMMARY
=======
✅ All tests completed
EOF

cat kafka_test_report.txt
```

---

## 🎯 Testing Checklist

- [ ] `docker-compose ps` shows kafka as "Up"
- [ ] `kafka-broker-api-versions.sh` returns version info
- [ ] `nc -zv localhost 9092` shows connection succeeded
- [ ] `kafka-topics.sh --list` returns topics
- [ ] Can create test topic
- [ ] Can produce messages
- [ ] Can consume messages
- [ ] `call.events` topic exists
- [ ] Events flow through end-to-end
- [ ] Consumer groups are created
- [ ] No lag in consumer groups

---

## 🚀 Next Steps After Testing

Once Kafka is verified working:

1. **Start FastAPI App**
   ```bash
   docker-compose up -d app
   ```

2. **Verify App Connects to Kafka**
   ```bash
   docker-compose logs app | grep -i kafka
   ```

3. **Test WebSocket Integration**
   - Open http://localhost:8000
   - Make test calls
   - Check Kafka for events:
     ```bash
     docker-compose exec kafka kafka-console-consumer.sh \
       --topic call.events \
       --bootstrap-server localhost:9092
     ```

4. **Run Example Consumer**
   ```bash
   docker-compose exec app python example_kafka_usage.py flow
   ```

---

## 📞 Debug Commands Reference

```bash
# View Kafka container
docker-compose ps kafka

# View Kafka logs (last 100 lines)
docker-compose logs --tail=100 kafka

# View Kafka logs (follow in real-time)
docker-compose logs -f kafka

# Connect to Kafka container shell
docker-compose exec kafka bash

# List topics
docker-compose exec kafka kafka-topics.sh --list --bootstrap-server localhost:9092

# Describe topic
docker-compose exec kafka kafka-topics.sh --describe --topic call.events --bootstrap-server localhost:9092

# Consumer groups
docker-compose exec kafka kafka-consumer-groups.sh --list --bootstrap-server localhost:9092

# Check consumer group lag
docker-compose exec kafka kafka-consumer-groups.sh --describe --group demo-consumer --bootstrap-server localhost:9092

# Reset consumer group offset
docker-compose exec kafka kafka-consumer-groups.sh --reset-offsets --group demo-consumer --topic call.events --to-earliest --execute --bootstrap-server localhost:9092

# Delete topic
docker-compose exec kafka kafka-topics.sh --delete --topic test-topic --bootstrap-server localhost:9092

# Consume messages from beginning
docker-compose exec kafka kafka-console-consumer.sh --topic call.events --bootstrap-server localhost:9092 --from-beginning

# Consume last 10 messages
docker-compose exec kafka kafka-console-consumer.sh --topic call.events --bootstrap-server localhost:9092 --max-messages 10
```

---

## ✨ Expected Outputs

### Healthy Kafka Instance
```
✅ Container shows "Up"
✅ API versions display correctly
✅ Topics can be listed
✅ Messages can be produced and consumed
✅ Consumer groups work
✅ No error messages in logs
```

### Unhealthy Kafka Instance
```
❌ Container shows "Exited" or "Error"
❌ Connection refused on port 9092
❌ Error messages in logs
❌ Cannot create topics
❌ Cannot produce/consume messages
```

---

## 🎉 You're All Set!

If all tests pass, Kafka is running perfectly and ready to stream your WebSocket events!

Run the verification command one more time:
```bash
docker-compose exec kafka kafka-broker-api-versions.sh --bootstrap-server localhost:9092 | head -3
```

Should display API versions, confirming Kafka is operational.

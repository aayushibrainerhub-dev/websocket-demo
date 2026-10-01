# ⚡ Quick Start - WebSocket Kafka Integration

## 🚀 30-Second Setup

### Step 1: Start Services
```bash
cd /home/brainerhub/Downloads/websockets-demo
docker-compose up -d
```

### Step 2: Verify Services
```bash
docker-compose ps
# Should show: postgres, redis, kafka, app all "Up"
```

### Step 3: Create Kafka Topic
```bash
docker-compose exec kafka kafka-topics.sh \
  --create \
  --topic call.events \
  --bootstrap-server localhost:9092 \
  --if-not-exists
```

### Step 4: Monitor Events
```bash
docker-compose exec kafka kafka-console-consumer.sh \
  --topic call.events \
  --bootstrap-server localhost:9092 \
  --from-beginning
```

### Step 5: Access Application
Visit: **http://localhost:8000**

## 🧪 Test It

### Option A: Generate Test Events
```bash
# In new terminal:
docker-compose exec app python example_kafka_usage.py test
```

Watch events appear in the consumer terminal!

### Option B: Real WebSocket Calls
1. Open http://localhost:8000 in two browser tabs
2. Create call between them
3. Watch Kafka events stream in consumer terminal

## 📊 Event Examples

Events published to Kafka look like:
```json
{
  "event": "call_offered",
  "call_id": "abc123",
  "caller_id": 1,
  "participants": [1, 2],
  "timestamp": "2024-09-29T10:30:00Z"
}
```

## 🛠️ Common Commands

```bash
# View logs
docker-compose logs -f app

# Stop services
docker-compose stop

# Restart services
docker-compose restart

# Clean up
docker-compose down

# Run example consumer
docker-compose exec app python example_kafka_usage.py flow

# View topic stats
docker-compose exec kafka kafka-topics.sh \
  --describe \
  --topic call.events \
  --bootstrap-server localhost:9092
```

## 📚 Documentation

- **DEPLOYMENT_READY.md** - Full deployment guide
- **KAFKA_INTEGRATION.md** - Architecture details
- **DOCKER_SETUP.md** - Docker configuration
- **IMPLEMENTATION_CHECKLIST.md** - Verification steps

## 🎯 What's Happening

```
Your App                Kafka                Consumers
    ↓                     ↓                     ↓
WebSocket ──────→ call.events topic ──→ Analytics
Event                     ↓              Notifications
    ↓                 Durable Log        Database
    ├─→ Peer A                          Custom Apps
    └─→ Peer B
```

Real-time WebSocket signaling + Kafka event log = best of both!

## ✅ Verification

All services healthy?
```bash
docker-compose ps
# All should show: Up and passing health check
```

Kafka working?
```bash
docker-compose exec kafka kafka-broker-api-versions.sh \
  --bootstrap-server localhost:9092
# Should show broker details
```

## 🚨 Troubleshooting

**Kafka not connecting:**
```bash
docker logs websockets-demo-kafka-1
```

**Events not appearing:**
```bash
# Check topic exists
docker-compose exec kafka kafka-topics.sh \
  --list \
  --bootstrap-server localhost:9092
```

**Services not starting:**
```bash
docker-compose logs -f
# Check error messages
```

## 📞 Need Help?

| Question | Answer |
|----------|--------|
| How do I deploy? | See DEPLOYMENT_READY.md |
| What's Kafka doing? | See KAFKA_INTEGRATION.md |
| How do I configure? | See DOCKER_SETUP.md |
| Did it work? | See IMPLEMENTATION_CHECKLIST.md |

## 🎉 Done!

You now have:
✅ WebSocket + Kafka integration  
✅ Docker containerized stack  
✅ Persistent database  
✅ Event streaming  
✅ Example consumers  
✅ Full documentation  

**Start building with:** http://localhost:8000

---

**Time to first event:** < 2 minutes ⚡

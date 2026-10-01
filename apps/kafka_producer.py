import json
import os
import socket
from datetime import datetime, timezone
from aiokafka import AIOKafkaProducer


# Support both local and Docker connections
# For Docker container: kafka:29092 (internal listener)
# For local development: localhost:9092 (external listener)
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

# Fix Kafka URL for local vs Docker
try:
	# If we can resolve 'kafka' hostname, we're in Docker
	socket.gethostbyname('kafka')
	# In Docker: use kafka internal listener on port 29092
	if "kafka:" in KAFKA_BOOTSTRAP_SERVERS:
		KAFKA_BOOTSTRAP_SERVERS = KAFKA_BOOTSTRAP_SERVERS.replace("kafka:9092", "kafka:29092")
except socket.gaierror:
	# Running locally: use localhost external listener
	if "kafka:" in KAFKA_BOOTSTRAP_SERVERS:
		KAFKA_BOOTSTRAP_SERVERS = KAFKA_BOOTSTRAP_SERVERS.replace("kafka:9092", "localhost:9092")
		KAFKA_BOOTSTRAP_SERVERS = KAFKA_BOOTSTRAP_SERVERS.replace("kafka:29092", "localhost:9092")

CALL_EVENTS_TOPIC = "call.events"

print(f"[•] Kafka Bootstrap Servers: {KAFKA_BOOTSTRAP_SERVERS}")

producer = AIOKafkaProducer(
    bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
    value_serializer=lambda value: json.dumps(value).encode("utf-8"),
)


async def start_kafka():
    print("start_kafka------", start_kafka)
    await producer.start()


async def stop_kafka():
    await producer.stop()


def create_call_event(
    event_type: str,
    call_id: str,
    caller_id: int,
    participants: list[int],
    **extra,
):
    """
    Create a standardized call event with timestamp and metadata.
    
    Args:
        event_type: Type of event (e.g., "call_started", "call_answered")
        call_id: Unique identifier for the call
        caller_id: User ID of the person initiating the call
        participants: List of user IDs participating in the call
        **extra: Additional metadata to include in the event
    
    Returns:
        dict: Complete event with timestamp
    """
    print("event_type------------", event_type)
    return {
        "event": event_type,
        "call_id": call_id,
        "caller_id": caller_id,
        "participants": participants,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **extra,
    }


async def publish_call_event(event: dict):
    """
    Publish a call event to Kafka with error handling.
    
    Args:
        event: The event dictionary to publish
    
    Raises:
        Exception: Re-raises any Kafka producer errors
    """
    try:
        await producer.send_and_wait(
            CALL_EVENTS_TOPIC,
            event,
        )
    except Exception as e:
        print(f"[ERROR] Failed to publish call event: {e}")
        raise
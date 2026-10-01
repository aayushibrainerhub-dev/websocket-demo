#!/usr/bin/env python3
"""
Simple Kafka consumer to monitor call events in real-time.
Usage: python test_kafka_consumer.py
"""
import asyncio
from aiokafka import AIOKafkaConsumer
import json

async def consume_call_events():
    consumer = AIOKafkaConsumer(
        'call.events',
        bootstrap_servers='localhost:9092',
        auto_offset_reset='earliest',  # Start from beginning
        enable_auto_commit=True,
        group_id='test-consumer-group',
        value_deserializer=lambda m: json.loads(m.decode('utf-8'))
    )
    
    await consumer.start()
    print("✓ Connected to Kafka")
    print("✓ Listening for call events on 'call.events' topic...")
    print("=" * 80)
    
    try:
        async for message in consumer:
            event = message.value
            print(f"\n📨 NEW EVENT:")
            print(f"   Type: {event.get('event_type')}")
            print(f"   Call ID: {event.get('call_id')}")
            print(f"   Timestamp: {event.get('timestamp')}")
            
            if event.get('event_type') == 'call_offered':
                print(f"   Caller ID: {event.get('caller_id')}")
                print(f"   Receiver ID: {event.get('receiver_id')}")
                print(f"   Participants: {event.get('participants')}")
            elif event.get('event_type') == 'call_answered':
                print(f"   Answerer ID: {event.get('answerer_id')}")
            elif event.get('event_type') == 'call_rejected':
                print(f"   Rejector ID: {event.get('rejector_id')}")
                print(f"   Reason: {event.get('reason')}")
            elif event.get('event_type') == 'call_ended':
                print(f"   Duration: {event.get('duration_seconds')}s")
                print(f"   Reason: {event.get('reason')}")
            elif event.get('event_type') == 'call_missed':
                print(f"   Receiver ID: {event.get('receiver_id')}")
            
            if event.get('metadata'):
                print(f"   Metadata: {event.get('metadata')}")
            
            print("=" * 80)
    finally:
        await consumer.stop()
        print("\n✓ Consumer stopped")

if __name__ == "__main__":
    print("🚀 Starting Kafka Call Events Consumer...")
    print(f"   Topic: call.events")
    print(f"   Bootstrap servers: localhost:9092\n")
    
    try:
        asyncio.run(consume_call_events())
    except KeyboardInterrupt:
        print("\n\n👋 Shutting down...")

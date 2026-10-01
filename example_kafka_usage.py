"""
Example script demonstrating the Kafka integration for WebSocket call events.

This shows how to:
1. Publish call events to Kafka
2. Consume and process events
3. Monitor call flows

Run this alongside the main FastAPI server to see events being published.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP_SERVERS = ["localhost:9092"]
CALL_EVENTS_TOPIC = "call.events"


# ============================================================================
# 1. Simple Event Consumer - Prints all call events
# ============================================================================

async def print_all_events():
    """Print all events in real-time."""
    logger.info("Starting simple event consumer...")
    
    consumer = AIOKafkaConsumer(
        CALL_EVENTS_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id='demo-consumer',
        value_deserializer=lambda m: json.loads(m.decode('utf-8')),
        auto_offset_reset='latest',  # Start from latest
    )
    
    try:
        async for message in consumer:
            event = message.value
            print("\n" + "="*60)
            print(f"Event Type: {event.get('event')}")
            print(f"Call ID: {event.get('call_id')}")
            print(f"Caller: {event.get('caller_id')}")
            print(f"Participants: {event.get('participants')}")
            print(f"Timestamp: {event.get('timestamp')}")
            if 'reason' in event:
                print(f"Reason: {event.get('reason')}")
            if 'duration_seconds' in event:
                print(f"Duration: {event.get('duration_seconds')}s")
            print("="*60)
    except KeyboardInterrupt:
        logger.info("Stopping consumer...")
    finally:
        await consumer.stop()


# ============================================================================
# 2. Call Flow Analyzer - Tracks complete call lifecycle
# ============================================================================

class CallFlowAnalyzer:
    """Tracks and analyzes complete call flows from offer to end."""
    
    def __init__(self):
        self.calls = {}  # call_id -> {participants, events: [], start_time, ...}
    
    async def start(self):
        """Start monitoring call flows."""
        logger.info("Starting call flow analyzer...")
        
        consumer = AIOKafkaConsumer(
            CALL_EVENTS_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            group_id='flow-analyzer',
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
        )
        
        try:
            async for message in consumer:
                event = message.value
                await self.process_event(event)
        except KeyboardInterrupt:
            logger.info("Stopping analyzer...")
        finally:
            await consumer.stop()
    
    async def process_event(self, event: dict):
        """Process event and update call flow."""
        call_id = event.get('call_id')
        event_type = event.get('event')
        timestamp = event.get('timestamp')
        
        # Initialize call entry
        if call_id not in self.calls:
            self.calls[call_id] = {
                'events': [],
                'participants': event.get('participants', []),
                'caller_id': event.get('caller_id'),
                'start_time': timestamp
            }
        
        # Add event to call history
        self.calls[call_id]['events'].append({
            'type': event_type,
            'timestamp': timestamp,
            'data': event
        })
        
        # Handle different event types
        if event_type == 'call_offered':
            logger.info(f"[OFFER] Call {call_id}: {event.get('caller_id')} -> {event.get('receiver_id')}")
        
        elif event_type == 'call_answered':
            logger.info(f"[ANSWER] Call {call_id}: Answered by {event.get('answerer_id')}")
        
        elif event_type == 'call_ended':
            duration = event.get('duration_seconds', 0)
            reason = event.get('reason', 'unknown')
            logger.info(f"[END] Call {call_id}: {duration}s - {reason}")
            self._print_call_summary(call_id)
        
        elif event_type == 'call_rejected':
            reason = event.get('reason', 'unknown')
            logger.info(f"[REJECTED] Call {call_id}: {reason}")
            self._print_call_summary(call_id)
        
        elif event_type == 'call_missed':
            logger.info(f"[MISSED] Call {call_id}")
            self._print_call_summary(call_id)
        
        elif event_type == 'ice_candidate':
            logger.debug(f"[ICE] Call {call_id}: Candidate from {event.get('caller_id')}")
    
    def _print_call_summary(self, call_id: str):
        """Print summary of a completed call."""
        if call_id not in self.calls:
            return
        
        call = self.calls[call_id]
        logger.info(f"\n{'='*60}")
        logger.info(f"Call Summary: {call_id}")
        logger.info(f"Participants: {call['participants']}")
        logger.info(f"Started: {call['start_time']}")
        logger.info(f"Events ({len(call['events'])}):")
        
        for i, event in enumerate(call['events'], 1):
            logger.info(f"  {i}. {event['type']} @ {event['timestamp']}")
        
        logger.info(f"{'='*60}\n")


# ============================================================================
# 3. Call Statistics Tracker - Real-time metrics
# ============================================================================

class CallStatistics:
    """Track and report call statistics in real-time."""
    
    def __init__(self):
        self.stats = {
            'total_calls': 0,
            'answered_calls': 0,
            'rejected_calls': 0,
            'missed_calls': 0,
            'total_duration': 0,
            'by_reason': {},
        }
    
    async def start(self):
        """Start tracking statistics."""
        logger.info("Starting call statistics tracker...")
        
        consumer = AIOKafkaConsumer(
            CALL_EVENTS_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            group_id='stats-tracker',
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
        )
        
        try:
            async for message in consumer:
                event = message.value
                await self.update_stats(event)
                self._print_stats()
        except KeyboardInterrupt:
            logger.info("Stopping statistics tracker...")
        finally:
            await consumer.stop()
    
    async def update_stats(self, event: dict):
        """Update statistics based on event."""
        event_type = event.get('event')
        
        if event_type == 'call_offered':
            self.stats['total_calls'] += 1
        
        elif event_type == 'call_answered':
            self.stats['answered_calls'] += 1
        
        elif event_type == 'call_rejected':
            self.stats['rejected_calls'] += 1
            reason = event.get('reason', 'unknown')
            self.stats['by_reason'][reason] = self.stats['by_reason'].get(reason, 0) + 1
        
        elif event_type == 'call_missed':
            self.stats['missed_calls'] += 1
        
        elif event_type == 'call_ended':
            duration = event.get('duration_seconds', 0)
            self.stats['total_duration'] += duration
    
    def _print_stats(self):
        """Print current statistics."""
        total = self.stats['total_calls']
        answered = self.stats['answered_calls']
        rejected = self.stats['rejected_calls']
        missed = self.stats['missed_calls']
        
        if total == 0:
            return
        
        success_rate = (answered / total) * 100 if total > 0 else 0
        avg_duration = (
            self.stats['total_duration'] / answered
            if answered > 0 else 0
        )
        
        logger.info(
            f"\n📊 Statistics:\n"
            f"  Total Calls: {total}\n"
            f"  Answered: {answered} ({success_rate:.1f}%)\n"
            f"  Rejected: {rejected}\n"
            f"  Missed: {missed}\n"
            f"  Avg Duration: {avg_duration:.0f}s\n"
        )


# ============================================================================
# 4. Test Event Producer - For testing without real WebSocket clients
# ============================================================================

async def produce_test_events():
    """Produce test call events for demonstration."""
    logger.info("Starting test event producer...")
    
    producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode('utf-8'),
    )
    
    try:
        await producer.start()
        
        # Simulate a call flow
        call_id = "test-call-001"
        
        # 1. Call offered
        event1 = {
            "event": "call_offered",
            "call_id": call_id,
            "caller_id": 1,
            "receiver_id": 2,
            "participants": [1, 2],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sdp": "v=0\r\n..."
        }
        await producer.send_and_wait(CALL_EVENTS_TOPIC, event1)
        logger.info(f"Published: call_offered")
        await asyncio.sleep(1)
        
        # 2. Call answered
        event2 = {
            "event": "call_answered",
            "call_id": call_id,
            "caller_id": 1,
            "answerer_id": 2,
            "participants": [1, 2],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sdp": "v=0\r\n..."
        }
        await producer.send_and_wait(CALL_EVENTS_TOPIC, event2)
        logger.info(f"Published: call_answered")
        await asyncio.sleep(3)
        
        # 3. ICE candidates (multiple)
        for i in range(3):
            event3 = {
                "event": "ice_candidate",
                "call_id": call_id,
                "caller_id": 1,
                "participants": [],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "candidate": {"candidate": f"candidate {i}", "sdpMLineIndex": 0}
            }
            await producer.send_and_wait(CALL_EVENTS_TOPIC, event3)
            logger.info(f"Published: ice_candidate {i+1}")
            await asyncio.sleep(0.5)
        
        # 4. Call ended
        event4 = {
            "event": "call_ended",
            "call_id": call_id,
            "caller_id": 1,
            "participants": [1, 2],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": 120,
            "reason": "normal_end"
        }
        await producer.send_and_wait(CALL_EVENTS_TOPIC, event4)
        logger.info(f"Published: call_ended")
        
        logger.info("Test events published successfully!")
    
    finally:
        await producer.stop()


# ============================================================================
# Main - Run the demo
# ============================================================================

async def main():
    """Run the example consumers."""
    import sys
    
    # Ensure Kafka is running first
    logger.info("Kafka Call Events Demo")
    logger.info("Make sure Kafka is running on localhost:9092")
    logger.info("")
    
    if len(sys.argv) > 1:
        mode = sys.argv[1]
    else:
        mode = 'print'
    
    if mode == 'print':
        logger.info("Mode: Print all events")
        await print_all_events()
    
    elif mode == 'flow':
        logger.info("Mode: Call flow analysis")
        analyzer = CallFlowAnalyzer()
        await analyzer.start()
    
    elif mode == 'stats':
        logger.info("Mode: Call statistics")
        stats = CallStatistics()
        await stats.start()
    
    elif mode == 'test':
        logger.info("Mode: Test event producer")
        await produce_test_events()
    
    elif mode == 'all':
        logger.info("Mode: All consumers (parallel)")
        # Run all consumers in parallel
        await asyncio.gather(
            print_all_events(),
            # Uncomment to run multiple consumers:
            # CallFlowAnalyzer().start(),
            # CallStatistics().start(),
        )
    
    else:
        print("\nUsage: python example_kafka_usage.py [mode]")
        print("\nAvailable modes:")
        print("  print    - Print all call events (default)")
        print("  flow     - Analyze complete call flows")
        print("  stats    - Track call statistics")
        print("  test     - Produce test events")
        print("  all      - Run all consumers (parallel)")
        print("\nExample:")
        print("  python example_kafka_usage.py flow")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Exiting...")

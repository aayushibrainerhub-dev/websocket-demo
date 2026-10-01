# """
# Example Kafka consumers for call events.

# These examples show how to consume and process call events from Kafka
# for various use cases like analytics, logging, and notifications.

# Usage: Adapt these examples to your specific consumer needs.
# """

# import json
# import logging
# from datetime import datetime
# from aiokafka import AIOKafkaConsumer
# from sqlalchemy import insert

# logger = logging.getLogger(__name__)

# # ============================================================================
# # Example 1: Real-time Monitoring Consumer
# # ============================================================================

# async def monitor_call_events():
#     """
#     Simple consumer that logs all call events in real-time.
#     Useful for debugging and development.
#     """
#     consumer = AIOKafkaConsumer(
#         'call.events',
#         bootstrap_servers=['localhost:9092'],
#         group_id='monitoring-consumer',
#         value_deserializer=lambda m: json.loads(m.decode('utf-8')),
#         auto_offset_reset='latest',  # Start from latest for real-time monitoring
#     )

#     try:
#         async for message in consumer:
#             event = message.value
#             logger.info(
#                 f"[{event['event']}] Call: {event['call_id']}, "
#                 f"Caller: {event['caller_id']}, "
#                 f"Timestamp: {event['timestamp']}"
#             )
#     finally:
#         await consumer.stop()


# # ============================================================================
# # Example 2: Call Analytics Consumer
# # ============================================================================

# class CallAnalyticsConsumer:
#     """
#     Processes call events for analytics and metrics.
#     Computes: call duration, success rate, rejection reasons, etc.
#     """

#     def __init__(self):
#         self.active_calls = {}  # Track ongoing calls
#         self.call_stats = {
#             'total_calls': 0,
#             'completed_calls': 0,
#             'rejected_calls': 0,
#             'missed_calls': 0,
#             'total_duration': 0,
#         }

#     async def start(self):
#         """Start consuming call events."""
#         consumer = AIOKafkaConsumer(
#             'call.events',
#             bootstrap_servers=['localhost:9092'],
#             group_id='analytics-consumer',
#             value_deserializer=lambda m: json.loads(m.decode('utf-8')),
#             auto_offset_reset='earliest',
#         )

#         try:
#             async for message in consumer:
#                 event = message.value
#                 await self.process_event(event)
#                 await self.print_stats()
#         finally:
#             await consumer.stop()

#     async def process_event(self, event: dict):
#         """Process individual call events."""
#         event_type = event.get('event')
#         call_id = event.get('call_id')

#         if event_type == 'call_offered':
#             self.active_calls[call_id] = {
#                 'caller_id': event['caller_id'],
#                 'receiver_id': event.get('receiver_id'),
#                 'start_time': datetime.fromisoformat(event['timestamp']),
#             }
#             self.call_stats['total_calls'] += 1
#             logger.info(f"Call started: {call_id}")

#         elif event_type == 'call_answered':
#             if call_id in self.active_calls:
#                 logger.info(f"Call answered: {call_id}")

#         elif event_type == 'call_ended':
#             if call_id in self.active_calls:
#                 duration = event.get('duration_seconds', 0)
#                 self.call_stats['completed_calls'] += 1
#                 self.call_stats['total_duration'] += duration
#                 del self.active_calls[call_id]
#                 logger.info(f"Call ended: {call_id}, Duration: {duration}s")

#         elif event_type == 'call_rejected':
#             reason = event.get('reason', 'unknown')
#             self.call_stats['rejected_calls'] += 1
#             if call_id in self.active_calls:
#                 del self.active_calls[call_id]
#             logger.info(f"Call rejected: {call_id}, Reason: {reason}")

#         elif event_type == 'call_missed':
#             self.call_stats['missed_calls'] += 1
#             if call_id in self.active_calls:
#                 del self.active_calls[call_id]
#             logger.info(f"Call missed: {call_id}")

#     async def print_stats(self):
#         """Print current call statistics."""
#         completed = self.call_stats['completed_calls']
#         total = self.call_stats['total_calls']
        
#         if total > 0:
#             success_rate = (completed / total) * 100
#             avg_duration = (
#                 self.call_stats['total_duration'] / completed
#                 if completed > 0 else 0
#             )
            
#             logger.info(
#                 f"Stats - Total: {total}, Completed: {completed}, "
#                 f"Success Rate: {success_rate:.1f}%, Avg Duration: {avg_duration:.0f}s"
#             )


# # ============================================================================
# # Example 3: Database Logging Consumer
# # ============================================================================

# async def log_to_database(session_maker):
#     """
#     Logs all call events to database for audit trail and analytics.
#     Requires a CallEvent model in your database.
#     """
#     consumer = AIOKafkaConsumer(
#         'call.events',
#         bootstrap_servers=['localhost:9092'],
#         group_id='database-logger',
#         value_deserializer=lambda m: json.loads(m.decode('utf-8')),
#         auto_offset_reset='earliest',
#     )

#     try:
#         async for message in consumer:
#             event = message.value
            
#             # Store raw event data
#             async with session_maker() as session:
#                 # Example: Insert into call_events table
#                 # Adjust based on your actual schema
#                 query = insert(CallEvent).values(
#                     event_type=event.get('event'),
#                     call_id=event.get('call_id'),
#                     caller_id=event.get('caller_id'),
#                     receiver_id=event.get('receiver_id'),
#                     data=json.dumps(event),
#                     timestamp=datetime.fromisoformat(event.get('timestamp'))
#                 )
#                 await session.execute(query)
#                 await session.commit()
#                 logger.debug(f"Event logged to DB: {event['call_id']}")
#     finally:
#         await consumer.stop()


# # ============================================================================
# # Example 4: Notification Consumer
# # ============================================================================

# class NotificationConsumer:
#     """
#     Sends notifications to users based on call events.
#     Examples: ringing notification, call missed alert, etc.
#     """

#     async def start(self):
#         """Start consuming call events for notifications."""
#         consumer = AIOKafkaConsumer(
#             'call.events',
#             bootstrap_servers=['localhost:9092'],
#             group_id='notification-consumer',
#             value_deserializer=lambda m: json.loads(m.decode('utf-8')),
#             auto_offset_reset='latest',
#         )

#         try:
#             async for message in consumer:
#                 event = message.value
#                 await self.handle_event(event)
#         finally:
#             await consumer.stop()

#     async def handle_event(self, event: dict):
#         """Send appropriate notifications for events."""
#         event_type = event.get('event')
        
#         if event_type == 'call_offered':
#             # Send ringing notification to receiver
#             receiver_id = event.get('receiver_id')
#             caller_id = event.get('caller_id')
#             await self.send_notification(
#                 receiver_id,
#                 f"Incoming call from user {caller_id}",
#                 event_type='ringing'
#             )
#             logger.info(f"Ringing notification sent to {receiver_id}")

#         elif event_type == 'call_rejected':
#             # Notify caller that call was rejected
#             caller_id = event.get('caller_id')
#             reason = event.get('reason', 'unknown')
#             await self.send_notification(
#                 caller_id,
#                 f"Call rejected: {reason}",
#                 event_type='call_rejected'
#             )
#             logger.info(f"Rejection notification sent to {caller_id}")

#         elif event_type == 'call_missed':
#             # Send missed call notification
#             caller_id = event.get('caller_id')
#             receiver_id = event.get('receiver_id')
#             await self.send_notification(
#                 receiver_id,
#                 f"Missed call from user {caller_id}",
#                 event_type='missed_call'
#             )
#             logger.info(f"Missed call notification sent to {receiver_id}")

#     async def send_notification(self, user_id: int, message: str, event_type: str):
#         """
#         Send notification to user via push, email, SMS, etc.
#         Implement based on your notification system.
#         """
#         logger.info(f"Notification to {user_id}: {message} ({event_type})")
#         # TODO: Implement actual notification delivery
#         # await push_service.send(user_id, message)
#         # await email_service.send(user_id, message)
#         # etc.


# # ============================================================================
# # Example 5: Batch Processing Consumer
# # ============================================================================

# class BatchAnalyticsConsumer:
#     """
#     Processes events in batches for heavy analytics work.
#     Example: daily call reports, user metrics, etc.
#     """

#     def __init__(self, batch_size: int = 100):
#         self.batch_size = batch_size
#         self.batch = []

#     async def start(self):
#         """Start consuming call events in batches."""
#         consumer = AIOKafkaConsumer(
#             'call.events',
#             bootstrap_servers=['localhost:9092'],
#             group_id='batch-analytics-consumer',
#             value_deserializer=lambda m: json.loads(m.decode('utf-8')),
#             auto_offset_reset='earliest',
#         )

#         try:
#             async for message in consumer:
#                 event = message.value
#                 self.batch.append(event)
                
#                 if len(self.batch) >= self.batch_size:
#                     await self.process_batch()
#                     self.batch = []
#         finally:
#             # Process remaining batch
#             if self.batch:
#                 await self.process_batch()
#             await consumer.stop()

#     async def process_batch(self):
#         """Process a batch of events."""
#         logger.info(f"Processing batch of {len(self.batch)} events")
        
#         # Example: Generate daily report
#         call_events = {e.get('event'): 0 for e in self.batch}
#         for event in self.batch:
#             call_events[event.get('event')] = call_events.get(event.get('event'), 0) + 1
        
#         logger.info(f"Event summary: {call_events}")
#         # TODO: Store batch results, generate reports, etc.


# # ============================================================================
# # Example Usage
# # ============================================================================

# async def main():
#     """Run example consumers."""
#     import asyncio
    
#     # Run monitoring consumer
#     # await monitor_call_events()
    
#     # Run analytics consumer
#     # analytics = CallAnalyticsConsumer()
#     # await analytics.start()
    
#     # Run notification consumer
#     # notifications = NotificationConsumer()
#     # await notifications.start()
    
#     # Run batch analytics consumer
#     # batch_analytics = BatchAnalyticsConsumer(batch_size=100)
#     # await batch_analytics.start()
    
#     pass


# if __name__ == '__main__':
#     import asyncio
#     asyncio.run(main())

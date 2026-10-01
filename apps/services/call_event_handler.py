"""
Call event handler for WebSocket streaming events through Kafka.

This module provides centralized handling of all call-related events,
ensuring consistent structure and reliable message delivery to Kafka.
"""

import logging
from datetime import datetime, timezone
from apps.kafka_producer import create_call_event, publish_call_event

logger = logging.getLogger(__name__)


class CallEventHandler:
    """
    Centralized handler for all call lifecycle events.
    Ensures consistent event structure and handles Kafka publishing.
    """

    @staticmethod
    async def handle_call_offer(
        call_id: str,
        caller_id: int,
        receiver_id: int,
        participants: list[int],
        metadata: dict = None,
    ) -> dict:
        """
        Handle incoming call offer event.
        
        Args:
            call_id: Unique identifier for the call
            caller_id: User ID initiating the call
            receiver_id: User ID receiving the call
            participants: List of all participants
            metadata: Additional call metadata
        
        Returns:
            Event dict sent to Kafka
        """
        print("handle call offer called----------------")
        event = create_call_event(
            event_type="call_offered",
            call_id=call_id,
            caller_id=caller_id,
            participants=participants,
            receiver_id=receiver_id,
            **(metadata or {})
        )
        
        try:
            await publish_call_event(event)
            logger.info(f"Call offered: {call_id} from {caller_id} to {receiver_id}")
        except Exception as e:
            logger.error(f"Failed to publish call_offered event: {e}")
            raise
        
        return event

    @staticmethod
    async def handle_call_answer(
        call_id: str,
        answerer_id: int,
        caller_id: int,
        participants: list[int],
        metadata: dict = None,
    ) -> dict:
        """
        Handle call answer event when recipient accepts the call.
        
        Args:
            call_id: Unique identifier for the call
            answerer_id: User ID accepting the call
            caller_id: Original caller's user ID
            participants: List of all participants
            metadata: Additional call metadata
        
        Returns:
            Event dict sent to Kafka
        """
        print("handle call answer called-----------------------")
        event = create_call_event(
            event_type="call_answered",
            call_id=call_id,
            caller_id=caller_id,
            participants=participants,
            answerer_id=answerer_id,
            **(metadata or {})
        )
        
        try:
            await publish_call_event(event)
            logger.info(f"Call answered: {call_id} by {answerer_id}")
        except Exception as e:
            logger.error(f"Failed to publish call_answered event: {e}")
            raise
        
        return event

    @staticmethod
    async def handle_call_rejected(
        call_id: str,
        rejector_id: int,
        caller_id: int,
        reason: str = "user_declined",
        metadata: dict = None,
    ) -> dict:
        """
        Handle call rejection event.
        
        Args:
            call_id: Unique identifier for the call
            rejector_id: User ID rejecting the call
            caller_id: Original caller's user ID
            reason: Reason for rejection (user_declined, busy, unavailable)
            metadata: Additional call metadata
        
        Returns:
            Event dict sent to Kafka
        """
        print("handle call rejected called-------------------")
        event = create_call_event(
            event_type="call_rejected",
            call_id=call_id,
            caller_id=caller_id,
            participants=[caller_id, rejector_id],
            rejector_id=rejector_id,
            reason=reason,
            **(metadata or {})
        )
        
        try:
            await publish_call_event(event)
            logger.info(f"Call rejected: {call_id} by {rejector_id} - {reason}")
        except Exception as e:
            logger.error(f"Failed to publish call_rejected event: {e}")
            raise
        
        return event

    @staticmethod
    async def handle_call_ended(
        call_id: str,
        caller_id: int,
        participants: list[int],
        duration_seconds: int = 0,
        reason: str = "normal_end",
        metadata: dict = None,
    ) -> dict:
        """
        Handle call end/termination event.
        
        Args:
            call_id: Unique identifier for the call
            caller_id: Original caller's user ID
            participants: List of all participants
            duration_seconds: Call duration in seconds
            reason: Reason for call end (normal_end, network_error, timeout)
            metadata: Additional call metadata
        
        Returns:
            Event dict sent to Kafka
        """
        print("handle call ended called--------------------")
        event = create_call_event(
            event_type="call_ended",
            call_id=call_id,
            caller_id=caller_id,
            participants=participants,
            duration_seconds=duration_seconds,
            reason=reason,
            **(metadata or {})
        )
        
        try:
            await publish_call_event(event)
            logger.info(f"Call ended: {call_id} - duration: {duration_seconds}s - reason: {reason}")
        except Exception as e:
            logger.error(f"Failed to publish call_ended event: {e}")
            raise
        
        return event

    @staticmethod
    async def handle_ice_candidate(
        call_id: str,
        sender_id: int,
        candidate: dict,
        metadata: dict = None,
    ) -> dict:
        """
        Handle ICE candidate exchange event.
        
        Args:
            call_id: Unique identifier for the call
            sender_id: User ID sending the ICE candidate
            candidate: ICE candidate object
            metadata: Additional call metadata
        
        Returns:
            Event dict sent to Kafka
        """
        print("handle ice candidate called-------------------")
        event = create_call_event(
            event_type="ice_candidate",
            call_id=call_id,
            caller_id=sender_id,
            participants=[],
            candidate=candidate,
            **(metadata or {})
        )
        
        try:
            await publish_call_event(event)
            logger.debug(f"ICE candidate published for call: {call_id}")
        except Exception as e:
            logger.error(f"Failed to publish ice_candidate event: {e}")
            raise
        
        return event

    @staticmethod
    async def handle_call_missed(
        call_id: str,
        caller_id: int,
        receiver_id: int,
        metadata: dict = None,
    ) -> dict:
        """
        Handle missed call event (no answer within timeout).
        
        Args:
            call_id: Unique identifier for the call
            caller_id: Original caller's user ID
            receiver_id: Intended receiver's user ID
            metadata: Additional call metadata
        
        Returns:
            Event dict sent to Kafka
        """
        print("handle call missed called--------------------")
        event = create_call_event(
            event_type="call_missed",
            call_id=call_id,
            caller_id=caller_id,
            participants=[caller_id, receiver_id],
            receiver_id=receiver_id,
            **(metadata or {})
        )
        
        try:
            await publish_call_event(event)
            logger.info(f"Call missed: {call_id} - receiver: {receiver_id}")
        except Exception as e:
            logger.error(f"Failed to publish call_missed event: {e}")
            raise
        
        return event


# Convenience instance
call_event_handler = CallEventHandler()

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, set[WebSocket]] = {}

    async def connect(
        self,
        user_id: int,
        websocket: WebSocket,
    ):
        await websocket.accept()
        self.active_connections.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        connections = self.active_connections.get(user_id)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            self.active_connections.pop(user_id, None)

    async def send_message(
        self,
        user_id: int,
        message: dict,
    ):
        for websocket in tuple(self.active_connections.get(user_id, ())):
            try:
                await websocket.send_json(message)
            except Exception:
                self.disconnect(user_id, websocket)
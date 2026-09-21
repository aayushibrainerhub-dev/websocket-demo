## Run

```bash
uv run uvicorn main:app --reload
```

You can also start the same Uvicorn server directly with:

```bash
uv run python main.py
```

Open `http://localhost:8000` in a browser. Create two accounts in separate browser tabs or sessions, search for the other user, and open the conversation.

The application provides:

- JWT-backed registration and sign in
- User search and direct-message history
- Persisted messages in SQLite by default, or PostgreSQL through `DATABASE_URL`
- Real-time JSON WebSocket delivery to both participants
- Responsive desktop and mobile chat UI

Registration and login return a signed JWT access token from `python-jose`. The token is verified for API requests and during each WebSocket connection.

Set a production secret before starting the server:

```bash
export JWT_SECRET="replace-this-with-a-long-random-secret"
```

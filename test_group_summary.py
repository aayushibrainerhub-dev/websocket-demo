import asyncio
import httpx
import json
import wave
import struct
import tempfile
import os

def create_dummy_wav(filename):
    """Creates a 1-second silent WAV file."""
    with wave.open(filename, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(16000)
        for _ in range(16000):
            f.writeframesraw(struct.pack('<h', 0))

async def test_group_summary_endpoint():
    print("Creating dummy audio files...")
    local_wav = "dummy_local.wav"
    remote_wav = "dummy_remote.wav"
    create_dummy_wav(local_wav)
    create_dummy_wav(remote_wav)

    url = "http://localhost:8000/api/call-summary/group"

    # Assume we don't have a real token, but the endpoint might require one.
    # If the endpoint doesn't strictly enforce a valid JWT (or if we can bypass it), we will try.
    # Wait, the endpoint uses `authenticated_user(authorization)` which might fail without a token.
    # For a real test, you might need to provide a valid token.
    
    headers = {
        "Authorization": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNyIsInVzZXJuYW1lIjoiS0hVU0hJIEsiLCJleHAiOjE3OTAyNjE0NjV9.vcZIuovuKQ5gh7eZ5N_ABPH8VN2k3KpX0tD58hdrK8Y"
    }

    data = {
        "group_name": "Test Group Alpha",
        "member_names": "Alice, Bob, Charlie",
        "member_emails": json.dumps(["alice@example.com", "bob@example.com", "charlie@example.com"]),
        "call_start": "2023-10-01T10:00:00.000Z",
        "call_end": "2023-10-01T10:05:00.000Z",
        "target_email": "test@example.com"
    }

    print(f"Sending POST request to {url}...")
    
    try:
        with open(local_wav, 'rb') as f_local, open(remote_wav, 'rb') as f_remote:
            files = {
                "local_audio": ("local.wav", f_local, "audio/wav"),
                "remote_audio": ("remote.wav", f_remote, "audio/wav"),
            }
            
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(url, headers=headers, data=data, files=files)
                
            print(f"Status Code: {response.status_code}")
            try:
                print("Response JSON:")
                print(json.dumps(response.json(), indent=2))
            except Exception:
                print("Response Text:")
                print(response.text)
    finally:
        # Cleanup
        if os.path.exists(local_wav):
            os.remove(local_wav)
        if os.path.exists(remote_wav):
            os.remove(remote_wav)

if __name__ == "__main__":
    asyncio.run(test_group_summary_endpoint())

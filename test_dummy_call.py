"""
Test script to send the Rahul & Priya dummy conversation to the call summary endpoint.
Usage:
    uv run python test_dummy_call.py
"""
import httpx
import json

BASE_URL = "http://localhost:8000"

def test_dummy_call():
    print(f"Triggering dummy call summary on {BASE_URL}/api/calls/test-dummy...")
    try:
        resp = httpx.post(f"{BASE_URL}/api/calls/test-dummy", timeout=30)
        print(f"Status Code : {resp.status_code}")
        data = resp.json()
        print("\nResponse from server:")
        print(json.dumps(data, indent=2))

        call_id = data.get("call_id")
        if call_id:
            print(f"\nVerifying stored report at {BASE_URL}/api/calls/{call_id}/report-data ...")
            report_resp = httpx.get(f"{BASE_URL}/api/calls/{call_id}/report-data", timeout=10)
            print(f"Report status : {report_resp.status_code}")
            if report_resp.status_code == 200:
                print("✅ Report successfully stored and retrieved!")
            else:
                print("❌ Failed to retrieve report data")

        n8n_status = data.get("n8n_status")
        if n8n_status == 200:
            print("\n🎉 n8n webhook successfully received the dummy conversation!")
        else:
            print(f"\n⚠️ n8n webhook returned status: {n8n_status}")

    except Exception as e:
        print(f"Error connecting to server: {e}")

if __name__ == "__main__":
    test_dummy_call()
